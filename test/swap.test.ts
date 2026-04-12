import { afterEach, describe, expect, it, vi } from "vitest";
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
import type {
  SwapProvider,
  SwapQuote,
} from "@moneyos/swap";
import {
  OdosProvider,
  createSwapTool,
  moneyosCliTool,
  executeSwap,
  swapAction,
} from "@moneyos/swap";
import { MoneyOS } from "../src/index.js";

const SENDER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
const ROUTER = "0x1111111111111111111111111111111111111111" as Address;
const TX_HASH =
  "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" as Hex;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mockProvider(opts?: { native?: boolean }): SwapProvider {
  return {
    name: "mock",
    getQuote: vi.fn().mockResolvedValue({
      tokenIn: getTokenAddress("USDC", 42161)!,
      tokenOut: getTokenAddress("RYZE", 42161)!,
      amountIn: "1000000",
      expectedOut: "500000000000000000",
      chainId: 42161,
    }),
    getCalldata: vi.fn().mockResolvedValue({
      to: ROUTER,
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
    expect(swapCall.to).toBe(ROUTER);
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
    (provider.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue({
      tokenIn: NATIVE_TOKEN_ADDRESS,
      tokenOut: getTokenAddress("USDC", 42161)!,
      amountIn: "1000000000000000000",
      expectedOut: "1000000",
      chainId: 42161,
    } satisfies SwapQuote);

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

  it("skips approve when allowance already covers the input amount", async () => {
    const read = createCoveredAllowanceRead();
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

    expect(read.readContract).toHaveBeenCalledOnce();
    expect(execute.send).toHaveBeenCalledOnce();
    expect(execute.send).toHaveBeenCalledWith({
      to: ROUTER,
      data: "0xdeadbeef",
      value: 0n,
      chainId: 42161,
    });
    expect(result.amountOut).toBe("0.5");
  });

  it("supports provider-specific quote state without lying in the base quote type", async () => {
    type ProviderQuote = SwapQuote & {
      pathId: string;
      router: Address;
    };

    const read = mockRead();
    const execute = mockExecute();
    const assets = mockAssets();
    const provider: SwapProvider<ProviderQuote> = {
      name: "stateful-mock",
      getQuote: vi.fn().mockResolvedValue({
        tokenIn: getTokenAddress("USDC", 42161)!,
        tokenOut: getTokenAddress("RYZE", 42161)!,
        amountIn: "1000000",
        expectedOut: "500000000000000000",
        chainId: 42161,
        pathId: "path-1",
        router: ROUTER,
      }),
      getCalldata: vi.fn().mockImplementation(async (quote) => ({
        to: quote.router,
        data: quote.pathId === "path-1" ? "0xdeadbeef" : "0x",
        value: 0n,
      })),
    };

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
    expect(provider.getCalldata).toHaveBeenCalledWith(
      expect.objectContaining({
        pathId: "path-1",
        router: ROUTER,
      }),
    );
    expect(result.amountOut).toBe("0.5");
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

  it("executes through the root runtime seam without a root swap helper", async () => {
    const read = mockRead();
    const execute = mockExecute();
    const moneyos = new MoneyOS({
      chainId: 42161,
      read,
      execute,
    });

    const result = await executeSwap(
      {
        tokenIn: "USDC",
        tokenOut: "RYZE",
        amount: "1",
        provider: mockProvider(),
        chainId: 42161,
      },
      moneyos.runtime,
    );

    expect(result.hash).toBe(TX_HASH);
    expect(execute.send).toHaveBeenCalledTimes(2);
  });
});

describe("@moneyos/swap exports", () => {
  it("exports executeSwap, swapAction, createSwapTool, and moneyosCliTool with the canonical surface", () => {
    const tool = createSwapTool();

    expect(tool.name).toBe("swap");
    expect(tool.version).toBe("0.1.0");
    expect(tool.actions.swap).toBe(swapAction);
    expect(tool.actions.swap.run).toBe(executeSwap);
    expect(moneyosCliTool).toMatchObject({
      version: 1,
      name: "swap",
      commandPath: ["swap"],
    });
  });

  it("OdosProvider performs quote and calldata flow with core native token wiring", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          pathId: "path-1",
          outAmounts: ["1234500"],
          outValues: [1],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          transaction: {
            to: ROUTER,
            data: "0xdeadbeef",
            value: "7",
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OdosProvider({ apiKey: "secret" });
    const quote = await provider.getQuote({
      chainId: 42161,
      tokenIn: NATIVE_TOKEN_ADDRESS,
      tokenOut: getTokenAddress("USDC", 42161)!,
      amount: 1000000000000000000n,
      sender: SENDER,
      slippage: 0.5,
    });
    const calldata = await provider.getCalldata({
      ...quote,
      pathId: "path-1",
      sender: SENDER,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.odos.xyz/sor/quote/v2",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer secret",
        },
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toMatchObject({
      chainId: 42161,
      inputTokens: [
        {
          tokenAddress: "0x0000000000000000000000000000000000000000",
          amount: "1000000000000000000",
        },
      ],
      outputTokens: [
        {
          tokenAddress: getTokenAddress("USDC", 42161),
          proportion: 1,
        },
      ],
      userAddr: SENDER,
      slippageLimitPercent: 0.5,
    });
    expect(quote.expectedOut).toBe("1234500");
    expect(calldata).toEqual({
      to: ROUTER,
      data: "0xdeadbeef",
      value: 7n,
    });
  });
});

function createCoveredAllowanceRead(): ReadClient & {
  getBalance: ReturnType<typeof vi.fn>;
  readContract: ReturnType<typeof vi.fn>;
} {
  return {
    getBalance: vi.fn().mockResolvedValue(1000000000000000000n),
    readContract: vi.fn().mockResolvedValue(1000000n),
  };
}
