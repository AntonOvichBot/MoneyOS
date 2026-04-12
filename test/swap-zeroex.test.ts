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
import { ZeroExProvider, executeSwap } from "@moneyos/swap";

const SENDER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
const ROUTER = "0x0000000000001ff3684f28c67538d4d072c22734" as Address;
const TX_HASH =
  "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" as Hex;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ZeroExProvider", () => {
  it("is exported from the canonical package surface", () => {
    expect(ZeroExProvider).toBeTypeOf("function");
  });

  it("requires a non-empty apiKey", () => {
    expect(() => new ZeroExProvider({ apiKey: "" })).toThrow(
      "ZeroExProvider requires apiKey",
    );
  });

  it("parses the quote response and converts percent slippage to bps", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        createZeroExQuoteResponse({
          buyAmount: "500000000000000000",
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new ZeroExProvider({ apiKey: "secret" });
    const quote = await provider.getQuote({
      chainId: 42161,
      tokenIn: getTokenAddress("USDC", 42161)!,
      tokenOut: getTokenAddress("RYZE", 42161)!,
      amount: 1000000n,
      sender: SENDER,
      slippage: 0.5,
    });

    const calldata = await provider.getCalldata(quote);
    const [requestUrl, init] = fetchMock.mock.calls[0]!;
    const url = new URL(requestUrl as string);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(url.origin + url.pathname).toBe(
      "https://api.0x.org/swap/allowance-holder/quote",
    );
    expect(url.searchParams.get("chainId")).toBe("42161");
    expect(url.searchParams.get("sellToken")).toBe(
      getTokenAddress("USDC", 42161),
    );
    expect(url.searchParams.get("buyToken")).toBe(
      getTokenAddress("RYZE", 42161),
    );
    expect(url.searchParams.get("sellAmount")).toBe("1000000");
    expect(url.searchParams.get("taker")).toBe(SENDER);
    expect(url.searchParams.get("slippageBps")).toBe("50");
    expect(init).toEqual({
      headers: {
        "Content-Type": "application/json",
        "0x-api-key": "secret",
        "0x-version": "v2",
      },
    });
    expect(quote.expectedOut).toBe("500000000000000000");
    expect(calldata).toEqual({
      to: ROUTER,
      data: "0xdeadbeef",
      value: 0n,
    });
  });

  it("defaults slippage to 1 percent and keeps calldata in provider quote state", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => createZeroExQuoteResponse(),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new ZeroExProvider({ apiKey: "secret" });
    const quote = await provider.getQuote({
      chainId: 42161,
      tokenIn: getTokenAddress("USDC", 42161)!,
      tokenOut: getTokenAddress("RYZE", 42161)!,
      amount: 1000000n,
      sender: SENDER,
    });

    const calldata = await provider.getCalldata(quote);
    const [requestUrl] = fetchMock.mock.calls[0]!;
    const url = new URL(requestUrl as string);

    expect(url.searchParams.get("slippageBps")).toBe("100");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(calldata).toEqual({
      to: ROUTER,
      data: "0xdeadbeef",
      value: 0n,
    });
  });

  it("translates native token addresses internally", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        createZeroExQuoteResponse({
          issues: { allowance: null },
          transaction: {
            to: ROUTER,
            data: "0xfeedbeef",
            value: "1000000000000000000",
          },
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new ZeroExProvider({ apiKey: "secret" });
    const quote = await provider.getQuote({
      chainId: 42161,
      tokenIn: NATIVE_TOKEN_ADDRESS,
      tokenOut: getTokenAddress("USDC", 42161)!,
      amount: 1000000000000000000n,
      sender: SENDER,
      slippage: 1.25,
    });

    const calldata = await provider.getCalldata(quote);
    const [requestUrl] = fetchMock.mock.calls[0]!;
    const url = new URL(requestUrl as string);

    expect(url.searchParams.get("sellToken")).toBe(NATIVE_TOKEN_ADDRESS);
    expect(url.searchParams.get("buyToken")).toBe(getTokenAddress("USDC", 42161));
    expect(url.searchParams.get("slippageBps")).toBe("125");
    expect(calldata).toEqual({
      to: ROUTER,
      data: "0xfeedbeef",
      value: 1000000000000000000n,
    });
  });

  it("rejects quotes that would require a wider approval-target seam", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        createZeroExQuoteResponse({
          allowanceTarget: "0x1111111111111111111111111111111111111111",
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new ZeroExProvider({ apiKey: "secret" });

    await expect(
      provider.getQuote({
        chainId: 42161,
        tokenIn: getTokenAddress("USDC", 42161)!,
        tokenOut: getTokenAddress("RYZE", 42161)!,
        amount: 1000000n,
        sender: SENDER,
      }),
    ).rejects.toThrow("distinct allowance target");
  });
});

describe("executeSwap with ZeroExProvider", () => {
  it("uses the stored 0x quote state for the ERC20 approve + swap path", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        createZeroExQuoteResponse({
          buyAmount: "500000000000000000",
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const read = mockRead();
    const execute = mockExecute();
    const assets = mockAssets();
    const provider = new ZeroExProvider({ apiKey: "secret" });

    const result = await executeSwap(
      {
        tokenIn: "USDC",
        tokenOut: "RYZE",
        amount: "1",
        provider,
        chainId: 42161,
        slippage: 0.5,
      },
      { read, execute, assets },
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(read.readContract).toHaveBeenCalledWith({
      address: getTokenAddress("USDC", 42161)!,
      abi: expect.any(Array),
      functionName: "allowance",
      args: [SENDER, ROUTER],
      chainId: 42161,
    });
    expect(execute.send).toHaveBeenCalledTimes(2);

    const approveCall = (execute.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(approveCall.to).toBe(getTokenAddress("USDC", 42161));

    const swapCall = (execute.send as ReturnType<typeof vi.fn>).mock.calls[1][0];
    expect(swapCall).toEqual({
      to: ROUTER,
      data: "0xdeadbeef",
      value: 0n,
      chainId: 42161,
    });
    expect(result.amountOut).toBe("0.5");
  });

  it("skips approve for native-token swaps and still uses stored calldata", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        createZeroExQuoteResponse({
          buyAmount: "1000000",
          issues: { allowance: null },
          transaction: {
            to: ROUTER,
            data: "0xfeedbeef",
            value: "1000000000000000000",
          },
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const read = mockRead();
    const execute = mockExecute();
    const assets = mockAssets();
    const provider = new ZeroExProvider({ apiKey: "secret" });

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

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(read.readContract).not.toHaveBeenCalled();
    expect(execute.send).toHaveBeenCalledOnce();
    expect(execute.send).toHaveBeenCalledWith({
      to: ROUTER,
      data: "0xfeedbeef",
      value: 1000000000000000000n,
      chainId: 42161,
    });
    expect(result.tokenIn).toBe("ETH");
    expect(result.tokenOut).toBe("USDC");
  });
});

function createZeroExQuoteResponse(
  overrides: Partial<{
    allowanceTarget: string;
    buyAmount: string;
    issues: {
      allowance: {
        actual: string;
        spender: string;
      } | null;
    };
    transaction: {
      to: string;
      data: string;
      value: string;
    };
  }> = {},
) {
  return {
    allowanceTarget: ROUTER,
    buyAmount: "500000000000000000",
    issues: {
      allowance: {
        actual: "0",
        spender: ROUTER,
      },
    },
    transaction: {
      to: ROUTER,
      data: "0xdeadbeef",
      value: "0",
    },
    ...overrides,
  };
}

function mockRead(): ReadClient {
  return {
    getBalance: vi.fn().mockResolvedValue(1000000000000000000n),
    readContract: vi.fn().mockResolvedValue(0n),
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
