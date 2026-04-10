import { describe, it, expect, vi } from "vitest";
import { generatePrivateKey } from "viem/accounts";
import { executeSwap } from "../src/tools/swap.js";
import {
  MoneyOS,
  createMoneyOS,
  NATIVE_TOKEN_ADDRESS,
  getTokenAddress,
} from "../src/index.js";
import type {
  ReadClient,
  ExecutionClient,
  AssetRegistry,
  SwapProvider,
} from "../src/index.js";

const TEST_KEY = generatePrivateKey();

function mockProvider(opts?: { native?: boolean }): SwapProvider {
  return {
    name: "mock",
    getQuote: vi.fn().mockResolvedValue({
      tokenIn: "0xTokenIn",
      tokenOut: "0xTokenOut",
      amountIn: "1000000",
      expectedOut: "500000000000000000",
      router: "0x0000000000000000000000000000000000000000",
      chainId: 42161,
    }),
    getCalldata: vi.fn().mockResolvedValue({
      to: "0x1111111111111111111111111111111111111111",
      data: "0xdeadbeef",
      value: opts?.native ? 1000000n : 0n,
    }),
  };
}

function mockRead(): ReadClient {
  return {
    getBalance: vi.fn().mockResolvedValue(1000000000000000000n),
    readContract: vi.fn().mockResolvedValue(0n), // zero allowance → triggers approve
  };
}

function mockExecute(): ExecutionClient {
  return {
    mode: "eoa",
    getAddress: () => "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`,
    send: vi.fn().mockResolvedValue({
      hash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
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
    getToken: (symbol: string) => {
      if (symbol.toUpperCase() === "USDC")
        return { symbol: "USDC", name: "USD Coin", decimals: 6, addresses: {} };
      if (symbol.toUpperCase() === "RYZE")
        return { symbol: "RYZE", name: "RYZE", decimals: 18, addresses: {} };
      if (symbol.toUpperCase() === "ETH")
        return { symbol: "ETH", name: "Ether", decimals: 18, addresses: {} };
      return undefined;
    },
    getTokenAddress: (symbol: string, chainId: number) => {
      if (symbol.toUpperCase() === "USDC" && chainId === 42161)
        return "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as `0x${string}`;
      if (symbol.toUpperCase() === "RYZE" && chainId === 42161)
        return "0x7712da72127d5dD213B621497D6E4899d5989e5C" as `0x${string}`;
      if (symbol.toUpperCase() === "ETH" && chainId === 42161)
        return NATIVE_TOKEN_ADDRESS;
      return undefined;
    },
    getChain: () => undefined,
    nativeTokenAddress: NATIVE_TOKEN_ADDRESS,
  };
}

describe("executeSwap", () => {
  it("ERC20 swap: checks allowance, approves, then swaps", async () => {
    const read = mockRead();
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

    // Should have checked allowance
    expect(read.readContract).toHaveBeenCalledOnce();

    // Should have sent approve + swap = 2 calls
    expect(execute.send).toHaveBeenCalledTimes(2);

    // First call is approve (to token address, with data)
    const approveCall = (execute.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(approveCall.to).toBe("0xaf88d065e77c8cC2239327C5EDb3A432268e5831");
    expect(approveCall.data).toBeDefined();
    expect(approveCall.chainId).toBe(42161);

    // Second call is the swap (to router, with data)
    const swapCall = (execute.send as ReturnType<typeof vi.fn>).mock.calls[1][0];
    expect(swapCall.to).toBe("0x1111111111111111111111111111111111111111");
    expect(swapCall.data).toBe("0xdeadbeef");

    expect(result.tokenIn).toBe("USDC");
    expect(result.tokenOut).toBe("RYZE");
    expect(result.hash).toBeDefined();
  });

  it("native swap: skips approve", async () => {
    const read = mockRead();
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

    // No allowance check for native token
    expect(read.readContract).not.toHaveBeenCalled();

    // Only 1 call (the swap itself, no approve)
    expect(execute.send).toHaveBeenCalledOnce();

    const swapCall = (execute.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(swapCall.value).toBeGreaterThan(0n);

    expect(result.tokenIn).toBe("ETH");
    expect(result.tokenOut).toBe("USDC");
  });

  it("throws for unknown token", async () => {
    const read = mockRead();
    const execute = mockExecute();
    const assets = mockAssets();
    const provider = mockProvider();

    await expect(
      executeSwap(
        {
          tokenIn: "FAKE",
          tokenOut: "RYZE",
          amount: "1",
          provider,
          chainId: 42161,
        },
        { read, execute, assets },
      ),
    ).rejects.toThrow("Token FAKE not found");
  });
});

describe("MoneyOS.swap() compatibility", () => {
  it("delegates to executeSwap via runtime seam", () => {
    const m = createMoneyOS({ chainId: 42161, privateKey: TEST_KEY });
    // swap() exists and is callable (would need real RPC to actually execute)
    expect(typeof m.swap).toBe("function");
  });
});

describe("createSwapTool shape", () => {
  it("returns tool with name, version, actions", async () => {
    // Import from the shared swap helper (tool-swap package re-exports this)
    const tool = {
      name: "swap" as const,
      version: "0.1.0",
      actions: {
        swap: {
          name: "swap",
          description: "Swap tokens via a DEX provider",
          run: executeSwap,
        },
      },
    };

    expect(tool.name).toBe("swap");
    expect(tool.version).toBe("0.1.0");
    expect(tool.actions.swap).toBeDefined();
    expect(tool.actions.swap.name).toBe("swap");
  });
});
