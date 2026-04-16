// End-to-end verification that the swap tool's batch actually passes the
// live relay policy. This is the test I should have written the first time
// to catch the "shape_not_allowed" failure seen live when submitting a
// USDC -> ETH swap on Arbitrum.
//
// It runs the real policy evaluator (services/relay/src/policy) against the
// exact IntentV1 that the swap tool emits, for every allowance state the
// smart account can realistically be in. No mocking of the policy; the
// policy code imported here is the same code the relay runs.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import {
  NATIVE_TOKEN_ADDRESS,
  getChain,
  getToken,
  getTokenAddress,
  type AssetRegistry,
  type CallRequest,
  type ExecutionClient,
  type ReadClient,
} from "@moneyos/core";
import type { SwapProvider } from "@moneyos/swap";
import { executeSwap } from "@moneyos/swap";
import { evaluateMoneyOSNativePolicy } from "../services/relay/src/policy/moneyos-native-policy.js";
import type {
  PolicyConfig,
  PolicyInput,
} from "../services/relay/src/policy/types.js";

// Load the live Arbitrum policy file the relay uses in production so this
// test reflects the actual allowlist, not a parallel fixture.
const ARBITRUM_POLICY_URL = new URL(
  "../services/relay/config/policy.arbitrum.json",
  import.meta.url,
);
const arbitrumPolicy = JSON.parse(
  readFileSync(ARBITRUM_POLICY_URL, "utf8"),
) as PolicyConfig;

// Pick values that match the live allowlist: USDC as token-in, the
// allowlisted Odos router as swap target, and swapCompact() as selector.
const USDC = arbitrumPolicy.tokenAllowlist.find(
  (token) => token.toLowerCase() === "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
)!;
const ODOS_ROUTER = arbitrumPolicy.odosRouters[0] as Address;
const SWAP_COMPACT_SELECTOR = arbitrumPolicy.odosSwapSelectors[0];

const SMART_ACCOUNT = "0x9c2938355Eae6129290e0Ec183696fd0b2a7A5F3" as Address;
const RELAY_SPONSOR = arbitrumPolicy.relayAddress as Address;
const CHAIN_ID = arbitrumPolicy.chainId;
const TX_HASH =
  "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" as Hex;

// Produce Odos-shaped calldata: starts with swapCompact selector + filler
// payload. Policy only inspects the selector, but keep enough body that
// nothing downstream treats it as empty.
function fakeOdosSwapCalldata(): Hex {
  return `${SWAP_COMPACT_SELECTOR}${"00".repeat(132)}` as Hex;
}

function assets(): AssetRegistry {
  return {
    getToken,
    getTokenAddress,
    getChain,
    nativeTokenAddress: NATIVE_TOKEN_ADDRESS,
  };
}

function provider(opts?: {
  nativeIn?: boolean;
  router?: Address;
  data?: Hex;
  value?: bigint;
}): SwapProvider {
  const tokenIn = opts?.nativeIn ? NATIVE_TOKEN_ADDRESS : (USDC as Address);
  const tokenOut = opts?.nativeIn ? (USDC as Address) : NATIVE_TOKEN_ADDRESS;
  return {
    name: "mock-odos",
    getQuote: async () => ({
      tokenIn,
      tokenOut,
      amountIn: "20000",
      expectedOut: opts?.nativeIn ? "20000" : "10000000000000000",
      chainId: CHAIN_ID,
    }),
    getCalldata: async () => ({
      to: (opts?.router ?? ODOS_ROUTER) as Address,
      data: (opts?.data ?? fakeOdosSwapCalldata()) as Hex,
      value: opts?.value ?? (opts?.nativeIn ? 20000n : 0n),
    }),
  };
}

function readWithAllowance(allowance: bigint): ReadClient {
  return {
    getBalance: async () => 0n,
    readContract: async () => allowance as unknown as never,
  };
}

function captureBatchingExecute(): {
  execute: ExecutionClient;
  batches: CallRequest[][];
  sends: CallRequest[];
} {
  const batches: CallRequest[][] = [];
  const sends: CallRequest[] = [];
  const execute: ExecutionClient = {
    mode: "smart-account",
    getAddress: () => SMART_ACCOUNT,
    async send(call) {
      sends.push(call);
      return { hash: TX_HASH, chainId: call.chainId };
    },
    async sendBatch(calls) {
      batches.push(calls);
      return { hash: TX_HASH, chainId: calls[0]!.chainId };
    },
    capabilities: () => ({
      sponsoredGas: true,
      batching: true,
      simulation: true,
    }),
  };
  return { execute, batches, sends };
}

// Turn CallRequest[] into the IntentV1 shape the policy evaluator consumes.
// This mirrors how GaslessExecutor composes the intent in production.
function toPolicyInput(
  calls: CallRequest[],
  options: { nowSeconds?: number; includeRoute?: boolean } = {},
): PolicyInput {
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  return {
    nowSeconds: now,
    chainId: CHAIN_ID,
    relayAddress: RELAY_SPONSOR,
    intent: {
      account: SMART_ACCOUNT,
      sponsor: RELAY_SPONSOR,
      nonceKey: 0n,
      nonceSeq: 0n,
      validAfter: BigInt(now - 30),
      validUntil: BigInt(now + 270),
      calls: calls.map((call) => ({
        target: call.to,
        value: call.value ?? 0n,
        data: (call.data ?? "0x") as Hex,
      })),
    },
    route: options.includeRoute === false
      ? undefined
      : {
        providerId: "odos",
        quotedAt: now,
        expiresAt: now + 60,
        quoteId: "mock-quote-id",
      },
    nonceReserved: true,
    simulationPassed: true,
    treasuryAllowed: true,
    relayHealthy: true,
    walletAllowed: true,
  };
}

describe("swap -> relay policy (end-to-end shape verification)", () => {
  for (const { label, allowance } of [
    { label: "zero allowance (first swap)", allowance: 0n },
    { label: "dust allowance (leftover from prior swap)", allowance: 1n },
    { label: "exactly covering", allowance: 20000n },
    { label: "over-covering allowance", allowance: 1_000_000_000n },
  ]) {
    it(`ERC-20-in batch passes the live Arbitrum policy with ${label}`, async () => {
      const { execute, batches, sends } = captureBatchingExecute();

      await executeSwap(
        {
          tokenIn: "USDC",
          tokenOut: "ETH",
          amount: "0.02",
          provider: provider(),
          chainId: CHAIN_ID,
        },
        { read: readWithAllowance(allowance), execute, assets: assets() },
      );

      // Regardless of allowance, the batching path must emit exactly
      // [approve, swap] — never a bare swap call that the relay would
      // reject as shape_not_allowed.
      expect(sends).toEqual([]);
      expect(batches).toHaveLength(1);
      expect(batches[0]).toHaveLength(2);

      const decision = evaluateMoneyOSNativePolicy(
        toPolicyInput(batches[0]!),
        arbitrumPolicy,
      );

      if (!decision.ok) {
        throw new Error(
          `Policy rejected ERC-20 swap batch with ${label}: ${decision.code} — ${decision.reason}`,
        );
      }
      expect(decision.flow).toBe("erc20-swap");
    });
  }

  it("native-in swap passes the live Arbitrum policy as flow=native-swap", async () => {
    const { execute, batches, sends } = captureBatchingExecute();

    await executeSwap(
      {
        tokenIn: "ETH",
        tokenOut: "USDC",
        amount: "0.01",
        provider: provider({ nativeIn: true }),
        chainId: CHAIN_ID,
      },
      { read: readWithAllowance(0n), execute, assets: assets() },
    );

    expect(batches).toEqual([]);
    expect(sends).toHaveLength(1);

    const decision = evaluateMoneyOSNativePolicy(
      toPolicyInput(sends),
      arbitrumPolicy,
    );
    if (!decision.ok) {
      throw new Error(
        `Policy rejected native-in swap: ${decision.code} — ${decision.reason}`,
      );
    }
    expect(decision.flow).toBe("native-swap");
  });

  it("regression guard: a bare ERC-20 swap call (pre-fix shape) is rejected as shape_not_allowed", async () => {
    // This reproduces exactly the failure reported live before this fix.
    // If the swap tool ever reverts to emitting a single swap call on
    // pre-existing allowance, this test will still pass (the bare shape
    // still fails), so it guards the direction of the invariant.
    const bareSwapCall: CallRequest = {
      to: ODOS_ROUTER,
      data: fakeOdosSwapCalldata(),
      value: 0n,
      chainId: CHAIN_ID,
    };

    const decision = evaluateMoneyOSNativePolicy(
      toPolicyInput([bareSwapCall]),
      arbitrumPolicy,
    );
    expect(decision.ok).toBe(false);
    expect(decision.code).toBe("shape_not_allowed");
  });
});
