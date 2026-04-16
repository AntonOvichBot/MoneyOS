import { describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";
import {
  NATIVE_TOKEN_ADDRESS,
  getChain,
  getToken,
  getTokenAddress,
  type AssetRegistry,
  type ExecutionClient,
  type ReadClient,
} from "@moneyos/core";
import type { SwapProvider } from "./types.js";
import { executeSwap, InsufficientBalanceError } from "./tool.js";

const SENDER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
const ROUTER = "0x1111111111111111111111111111111111111111" as Address;
const TX_HASH =
  "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" as Hex;

function mockProvider(opts?: { native?: boolean }): SwapProvider {
  return {
    name: "mock",
    getQuote: vi.fn().mockResolvedValue({
      tokenIn: opts?.native ? NATIVE_TOKEN_ADDRESS : getTokenAddress("USDC", 42161)!,
      tokenOut: opts?.native ? getTokenAddress("USDC", 42161)! : getTokenAddress("RYZE", 42161)!,
      amountIn: opts?.native ? "1000000000000000000" : "1000000",
      expectedOut: opts?.native ? "1000000" : "500000000000000000",
      chainId: 42161,
    }),
    getCalldata: vi.fn().mockResolvedValue({
      to: ROUTER,
      data: "0xdeadbeef",
      value: opts?.native ? 1000000000000000000n : 0n,
    }),
  };
}

function mockRead(options: {
  tokenBalance?: bigint;
  nativeBalance?: bigint;
  allowance?: bigint;
} = {}): ReadClient {
  return {
    getBalance: vi.fn().mockResolvedValue(
      options.nativeBalance ?? 1000000000000000000n,
    ),
    readContract: vi.fn(async (
      params: Parameters<ReadClient["readContract"]>[0],
    ) => {
      const { functionName } = params;
      if (functionName === "balanceOf") {
        return options.tokenBalance ?? 1000000n;
      }
      if (functionName === "allowance") {
        return options.allowance ?? 1000000n;
      }
      throw new Error(`Unexpected readContract(${String(functionName)})`);
    }),
  };
}

function mockExecute(): ExecutionClient {
  return {
    mode: "eoa",
    getAddress: () => SENDER,
    send: vi.fn().mockResolvedValue({
      hash: TX_HASH,
      chainId: 42161,
    }),
    capabilities: () => ({
      sponsoredGas: false,
      batching: false,
      simulation: false,
    }),
  };
}

function mockAssets(): AssetRegistry {
  return {
    getToken,
    getTokenAddress,
    getChain,
    nativeTokenAddress: NATIVE_TOKEN_ADDRESS,
  };
}

describe("executeSwap balance pre-checks", () => {
  it("throws a clear ERC-20 shortfall error before quoting", async () => {
    const read = mockRead({ tokenBalance: 500000n });
    const execute = mockExecute();
    const assets = mockAssets();
    const provider = mockProvider();

    await expect(
      executeSwap(
        {
          tokenIn: "USDC",
          tokenOut: "RYZE",
          amount: "1",
          provider,
          chainId: 42161,
        },
        { read, execute, assets },
      ),
    ).rejects.toEqual(
      new InsufficientBalanceError({
        symbol: "USDC",
        address: SENDER,
        need: "1",
        have: "0.5",
      }),
    );

    expect(provider.getQuote).not.toHaveBeenCalled();
    expect(read.getBalance).not.toHaveBeenCalled();
  });

  it("throws a clear native shortfall error before quoting", async () => {
    const read = mockRead({ nativeBalance: 400000000000000000n });
    const execute = mockExecute();
    const assets = mockAssets();
    const provider = mockProvider({ native: true });

    await expect(
      executeSwap(
        {
          tokenIn: "ETH",
          tokenOut: "USDC",
          amount: "1",
          provider,
          chainId: 42161,
        },
        { read, execute, assets },
      ),
    ).rejects.toEqual(
      new InsufficientBalanceError({
        symbol: "ETH",
        address: SENDER,
        need: "1",
        have: "0.4",
      }),
    );

    expect(provider.getQuote).not.toHaveBeenCalled();
    expect(read.getBalance).toHaveBeenCalledWith({
      address: SENDER,
      chainId: 42161,
    });
  });

  it("allows exact ERC-20 balance and continues to quoting", async () => {
    const read = mockRead({ tokenBalance: 1000000n, allowance: 1000000n });
    const execute = mockExecute();
    const assets = mockAssets();
    const provider = mockProvider();

    const result = await executeSwap(
      {
        tokenIn: "USDC",
        tokenOut: "RYZE",
        amount: "1",
        provider,
        chainId: 42161,
      },
      { read, execute, assets },
    );

    expect(provider.getQuote).toHaveBeenCalledOnce();
    expect(result.hash).toBe(TX_HASH);
  });

  it("allows over-balance native swaps and continues to quoting", async () => {
    const read = mockRead({ nativeBalance: 2000000000000000000n });
    const execute = mockExecute();
    const assets = mockAssets();
    const provider = mockProvider({ native: true });

    const result = await executeSwap(
      {
        tokenIn: "ETH",
        tokenOut: "USDC",
        amount: "1",
        provider,
        chainId: 42161,
      },
      { read, execute, assets },
    );

    expect(provider.getQuote).toHaveBeenCalledOnce();
    expect(result.hash).toBe(TX_HASH);
  });
});
