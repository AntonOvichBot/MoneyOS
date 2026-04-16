import type { CallRequest } from "@moneyos/core";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import { GaslessExecutor, GaslessRelayError } from "../src/executor/gasless-executor.js";
import type { RelayClient } from "../src/relay/client.js";

const ACCOUNT = "0x1111111111111111111111111111111111111111" as Address;
const SPONSOR = "0x2222222222222222222222222222222222222222" as Address;
const TARGET = "0x3333333333333333333333333333333333333333" as Address;
const TX_HASH = `0x${"11".repeat(32)}` as Hex;

function createExecutor(options?: {
  chainId?: number;
  relayTxHash?: Hex;
  validityWindowSeconds?: number;
}) {
  const signer = privateKeyToAccount(`0x${"12".repeat(32)}` as Hex);
  const nonceResolver = vi.fn().mockResolvedValue(7n);
  const execute = vi.fn().mockResolvedValue({
    submissionId: "submission-1",
    status: "submitted",
    txHash: options?.relayTxHash ?? TX_HASH,
  });

  const relay = {
    execute,
  } as unknown as RelayClient;

  const executor = new GaslessExecutor({
    account: ACCOUNT,
    sponsor: SPONSOR,
    chainId: options?.chainId ?? 42161,
    signer,
    relay,
    nonceResolver,
    validityWindowSeconds: options?.validityWindowSeconds ?? 90,
  });

  return { executor, signer, nonceResolver, relayExecute: execute };
}

describe("GaslessExecutor", () => {
  it("send delegates to sendBatch with a single call", async () => {
    const { executor } = createExecutor();
    const call: CallRequest = { to: TARGET, chainId: 42161 };

    const sendBatchSpy = vi
      .spyOn(executor, "sendBatch")
      .mockResolvedValue({ hash: TX_HASH, chainId: 42161 });

    const result = await executor.send(call);

    expect(sendBatchSpy).toHaveBeenCalledTimes(1);
    expect(sendBatchSpy).toHaveBeenCalledWith([call]);
    expect(result).toEqual({ hash: TX_HASH, chainId: 42161 });
  });

  it("builds relay intent + route metadata and returns tx hash", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T16:00:00Z"));

    const { executor, signer, nonceResolver, relayExecute } = createExecutor({
      validityWindowSeconds: 90,
    });

    try {
      const result = await executor.sendBatch([{ to: TARGET, chainId: 42161 }]);

      expect(result).toEqual({ hash: TX_HASH, chainId: 42161 });
      expect(nonceResolver).toHaveBeenCalledWith({ signer: signer.address, nonceKey: 0n });
      expect(relayExecute).toHaveBeenCalledTimes(1);

      const request = relayExecute.mock.calls[0]![0];
      expect(request.intent.account).toBe(ACCOUNT);
      expect(request.intent.sponsor).toBe(SPONSOR);
      expect(request.intent.nonceKey).toBe(0n);
      expect(request.intent.nonceSeq).toBe(7n);
      expect(request.intent.calls).toEqual([{ target: TARGET, value: 0n, data: "0x" }]);
      expect(request.intent.validAfter).toBe(1_776_268_770n);
      expect(request.intent.validUntil).toBe(1_776_268_860n);
      expect(request.intent.validUntil - request.intent.validAfter).toBe(90n);

      expect(request.route.providerId).toBe("moneyos-native");
      expect(request.route.quoteId).toBe("native-7");
      expect(request.route.quotedAt).toBe(1_776_268_800);
      expect(request.route.expiresAt).toBe(1_776_268_890);
      expect(request.route.expiresAt - request.route.quotedAt).toBe(90);

      expect(request.signature).toMatch(/^0x[0-9a-f]+$/i);
      expect(request.signature.length).toBeGreaterThan(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects calls with chainId mismatch", async () => {
    const { executor } = createExecutor({ chainId: 42161 });

    await expect(executor.sendBatch([{ to: TARGET, chainId: 10 }])).rejects.toThrow(
      "Gasless executor configured for chain 42161 but received 10",
    );
  });

  it("surfaces the simulation revert reason when the relay rejects", async () => {
    const { executor, relayExecute } = createExecutor();
    relayExecute.mockResolvedValueOnce({
      submissionId: "submission-2",
      status: "rejected",
      reason: "simulation failed",
      policyCode: "simulation_failed",
      revertReason: "ERC20: transfer amount exceeds balance",
    });

    const promise = executor.sendBatch([{ to: TARGET, chainId: 42161 }]);
    await expect(promise).rejects.toBeInstanceOf(GaslessRelayError);
    await expect(promise).rejects.toMatchObject({
      message:
        "Gasless swap failed: ERC20: transfer amount exceeds balance [simulation_failed]",
      policyCode: "simulation_failed",
      revertReason: "ERC20: transfer amount exceeds balance",
      status: "rejected",
    });
  });

  it("falls back to the policy code when the relay rejects without a reason", async () => {
    const { executor, relayExecute } = createExecutor();
    relayExecute.mockResolvedValueOnce({
      submissionId: "submission-3",
      status: "rejected",
      policyCode: "treasury_or_wallet_limit",
    });

    await expect(
      executor.sendBatch([{ to: TARGET, chainId: 42161 }]),
    ).rejects.toThrow(
      "Gasless swap failed: treasury_or_wallet_limit [treasury_or_wallet_limit]",
    );
  });
});
