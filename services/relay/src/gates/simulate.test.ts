import { describe, expect, it, vi } from "vitest";
import {
  BaseError,
  ContractFunctionRevertedError,
  encodeErrorResult,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { signIntentV1, toCreate2Salt, type IntentV1 } from "@moneyos/gasless";
import type { RuntimeConfig } from "../../config/runtime.js";
import { createSimulateGate } from "./simulate.js";
import type { ExecuteIntentRequest } from "../http/routes/intents.js";

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

async function makeSignedRequest(accountAddress: `0x${string}`): Promise<ExecuteIntentRequest> {
  const owner = privateKeyToAccount(sponsorPrivateKey);
  const intent: IntentV1 = {
    account: accountAddress,
    sponsor: "0x1111111111111111111111111111111111111111",
    nonceKey: 1n,
    nonceSeq: 1n,
    validAfter: 1710000000n,
    validUntil: 1710000300n,
    calls: [
      {
        target: "0x3333333333333333333333333333333333333333",
        value: 0n,
        data: "0x",
      },
    ],
  };

  const signature = await signIntentV1(owner, intent, {
    chainId: 42161,
    verifyingContract: accountAddress,
  });

  return {
    intent,
    signature,
  };
}

describe("createSimulateGate", () => {
  it("uses execute simulation for deployed accounts", async () => {
    const request = await makeSignedRequest("0x2222222222222222222222222222222222222222");

    const simulateContract = vi.fn(async () => ({ result: [] }));
    const gate = createSimulateGate({
      runtime: makeRuntime(),
      sponsorAddress: "0x1111111111111111111111111111111111111111",
      publicClient: {
        getCode: vi.fn(async () => "0x1234" as const),
        readContract: vi.fn(),
        simulateContract,
      },
    });

    await expect(gate(request)).resolves.toEqual({ ok: true });
    expect(simulateContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "execute",
        address: request.intent.account,
      }),
    );
  });

  it("uses deployAndExecute simulation for undeployed accounts", async () => {
    const account = "0x4444444444444444444444444444444444444444" as const;
    const request = await makeSignedRequest(account);
    const owner = privateKeyToAccount(sponsorPrivateKey).address;

    const simulateContract = vi.fn(async () => ({ result: [] }));
    const gate = createSimulateGate({
      runtime: makeRuntime(),
      sponsorAddress: "0x1111111111111111111111111111111111111111",
      publicClient: {
        getCode: vi.fn(async () => "0x" as const),
        readContract: vi.fn(async () => account),
        simulateContract,
      },
    });

    await expect(gate(request)).resolves.toEqual({ ok: true });
    expect(simulateContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "deployAndExecute",
        args: [owner, toCreate2Salt("moneyos-account-v1"), request.intent, request.signature],
      }),
    );
  });

  it("returns the decoded revert reason when chain simulation reverts", async () => {
    const request = await makeSignedRequest("0x6666666666666666666666666666666666666666");
    const revertData = encodeErrorResult({
      abi: parseAbi(["error Error(string)"]),
      errorName: "Error",
      args: ["insufficient funds"],
    });

    const gate = createSimulateGate({
      runtime: makeRuntime(),
      sponsorAddress: "0x1111111111111111111111111111111111111111",
      publicClient: {
        getCode: vi.fn(async () => "0x1234" as const),
        readContract: vi.fn(),
        simulateContract: vi.fn(async () => {
          throw new BaseError("simulation failed", {
            cause: new ContractFunctionRevertedError({
              abi: [],
              data: revertData,
              functionName: "execute",
            }),
          });
        }),
      },
    });

    const result = await gate(request);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      revertData,
    });
    expect(result.ok === false && result.revertReason).toContain("insufficient funds");
  });

  it("falls back to the error message when viem revert data is not decodable", async () => {
    const request = await makeSignedRequest("0x7777777777777777777777777777777777777777");

    const gate = createSimulateGate({
      runtime: makeRuntime(),
      sponsorAddress: "0x1111111111111111111111111111111111111111",
      publicClient: {
        getCode: vi.fn(async () => "0x1234" as const),
        readContract: vi.fn(),
        simulateContract: vi.fn(async () => {
          throw new Error("execution reverted");
        }),
      },
    });

    await expect(gate(request)).resolves.toEqual({
      ok: false,
      revertReason: "execution reverted",
    });
  });
});
