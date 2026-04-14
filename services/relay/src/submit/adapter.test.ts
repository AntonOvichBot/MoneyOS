import { describe, expect, it, vi } from "vitest";
import { TransactionReceiptNotFoundError } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { signIntentV1, toCreate2Salt, type IntentV1 } from "@moneyos/gasless";
import type { RuntimeConfig } from "../../config/runtime.js";
import { RelayDatabase } from "../db/sqlite.js";
import { SubmissionAdapter } from "./adapter.js";

const sponsorPrivateKey =
  "0x8b3a350cf5c34c9194ca7f3f353f4f63b53ea857f95f6ce5db7f4f6f9f7f4f6c" as const;

function makeRuntime(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    host: "0.0.0.0",
    port: 8787,
    logLevel: "info",
    rpcUrl: "http://127.0.0.1:8545",
    chainId: 42161,
    sqlitePath: ":memory:",
    policyPath: "services/relay/config/policy.arbitrum.json",
    sponsorPrivateKey,
    relayAddress: "0x1111111111111111111111111111111111111111",
    accountFactoryAddress: "0x5555555555555555555555555555555555555555",
    accountFactorySalt: toCreate2Salt("moneyos-account-v1"),
    killSwitch: false,
    confirmPollMs: 5000,
    rateLimit: {
      perUserPerDayTx: 20,
      perUserPerHourTx: 5,
      perStationPerDayTx: 2000,
      perTxMaxGasWei: 500_000_000_000_000n,
    },
    hotWallet: {
      minBalanceWei: 500_000_000_000_000n,
      autoRefillThresholdWei: 2_000_000_000_000_000n,
    },
    ...overrides,
  };
}

async function makeSignedIntent(account: `0x${string}`): Promise<{ intent: IntentV1; signature: `0x${string}` }> {
  const owner = privateKeyToAccount(sponsorPrivateKey);
  const intent: IntentV1 = {
    account,
    sponsor: "0x1111111111111111111111111111111111111111",
    nonceKey: 1n,
    nonceSeq: 2n,
    validAfter: 1710000000n,
    validUntil: 1710000300n,
    calls: [
      {
        target: "0x3333333333333333333333333333333333333333",
        value: 1n,
        data: "0x",
      },
    ],
  };

  const signature = await signIntentV1(owner, intent, {
    chainId: 42161,
    verifyingContract: account,
  });

  return {
    intent,
    signature,
  };
}

describe("SubmissionAdapter", () => {
  it("submits intent and confirms via mocked receipt polling", async () => {
    const db = new RelayDatabase(":memory:");
    let now = 1710000000;

    const writeContract = vi.fn(async () => {
      return "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as `0x${string}`;
    });

    const getTransactionReceipt = vi.fn(async () => ({
      status: "success" as const,
      blockNumber: 12345n,
      gasUsed: 21000n,
    }));

    const adapter = new SubmissionAdapter({
      runtime: makeRuntime(),
      db,
      walletClient: { writeContract },
      publicClient: {
        getCode: vi.fn(async () => "0x1234" as const),
        readContract: vi.fn(async () => "0x1111111111111111111111111111111111111111"),
        getTransactionReceipt,
      },
      pollIntervalMs: 10_000,
      nowSeconds: () => now,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    });

    const payload = await makeSignedIntent("0x1111111111111111111111111111111111111111");

    await adapter.submitIntent({
      submissionId: "sub-1",
      request: payload,
    });

    expect(writeContract).toHaveBeenCalledTimes(1);
    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "execute" }),
    );
    expect(db.getSubmission("sub-1")?.status).toBe("submitted");

    now += 6;
    await adapter.pollPendingOnce();

    const submission = db.getSubmission("sub-1");
    expect(getTransactionReceipt).toHaveBeenCalledTimes(1);
    expect(submission?.status).toBe("confirmed");
    expect(submission?.receiptBlockNumber).toBe("12345");
    expect(submission?.receiptGasUsed).toBe("21000");

    db.close();
  });

  it("uses deployAndExecute path when account is undeployed", async () => {
    const db = new RelayDatabase(":memory:");
    const runtime = makeRuntime();

    const writeContract = vi.fn(async () => {
      return "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`;
    });

    const adapter = new SubmissionAdapter({
      runtime,
      db,
      walletClient: { writeContract },
      publicClient: {
        getCode: vi.fn(async () => "0x" as const),
        readContract: vi.fn(async () => "0x4444444444444444444444444444444444444444"),
        getTransactionReceipt: vi.fn(async () => ({
          status: "success" as const,
          blockNumber: 1n,
          gasUsed: 1n,
        })),
      },
      pollIntervalMs: 10_000,
      nowSeconds: () => 1710000000,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    });

    const payload = await makeSignedIntent("0x4444444444444444444444444444444444444444");

    await adapter.submitIntent({
      submissionId: "sub-2",
      request: payload,
    });

    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "deployAndExecute",
        value: 1n,
      }),
    );

    db.close();
  });

  it("keeps submission in submitted state while receipt is pending", async () => {
    const db = new RelayDatabase(":memory:");
    db.upsertSubmission(
      "sub-pending",
      "submitted",
      1710000000,
      {
        txHash: "0x7777777777777777777777777777777777777777777777777777777777777777",
      },
    );

    const adapter = new SubmissionAdapter({
      runtime: makeRuntime(),
      db,
      walletClient: {
        writeContract: vi.fn(
          async () =>
            "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
        ),
      },
      publicClient: {
        getCode: vi.fn(async () => "0x1234" as const),
        readContract: vi.fn(async () => "0x1111111111111111111111111111111111111111"),
        getTransactionReceipt: vi.fn(async () => {
          throw new TransactionReceiptNotFoundError({
            hash: "0x7777777777777777777777777777777777777777777777777777777777777777",
          });
        }),
      },
      pollIntervalMs: 10_000,
      nowSeconds: () => 1710000001,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    });

    await adapter.pollPendingOnce();

    expect(db.getSubmission("sub-pending")?.status).toBe("submitted");
    db.close();
  });
});
