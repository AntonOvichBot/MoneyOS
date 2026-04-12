import { describe, expect, it, vi } from "vitest";
import {
  encodeFunctionData,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import {
  EOAExecutor,
  MoneyOS,
  NATIVE_TOKEN_ADDRESS,
  ViemReadClient,
  getTokenAddress,
} from "../src/index.js";
import type {
  ExecutionClient,
  ReadClient,
  SwapProvider,
} from "../src/index.js";

const TEST_KEY: Hex =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const SENDER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
const RECIPIENT = "0x1111111111111111111111111111111111111111" as Address;
const ROUTER = "0x2222222222222222222222222222222222222222" as Address;
const TX_HASH =
  "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" as Hex;

const ERC20_TRANSFER_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

function createMockReadClient(params?: {
  balance?: bigint;
  contractResult?: bigint;
}): ReadClient & {
  getBalance: ReturnType<typeof vi.fn>;
  readContract: ReturnType<typeof vi.fn>;
} {
  return {
    getBalance: vi.fn().mockResolvedValue(params?.balance ?? 0n),
    readContract: vi.fn().mockResolvedValue(params?.contractResult ?? 0n),
  };
}

function createMockExecutor(): ExecutionClient & {
  send: ReturnType<typeof vi.fn>;
} {
  return {
    mode: "smart-account",
    getAddress: () => SENDER,
    send: vi.fn().mockResolvedValue({
      hash: TX_HASH,
      chainId: 42161,
    }),
    capabilities: () => ({
      sponsoredGas: true,
      batching: false,
      simulation: false,
    }),
  };
}

function createMockSwapProvider(): SwapProvider & {
  getQuote: ReturnType<typeof vi.fn>;
  getCalldata: ReturnType<typeof vi.fn>;
} {
  return {
    name: "mock",
    getQuote: vi.fn().mockResolvedValue({
      tokenIn: getTokenAddress("USDC", 42161)!,
      tokenOut: getTokenAddress("RYZE", 42161)!,
      amountIn: parseUnits("1", 6).toString(),
      expectedOut: parseUnits("0.5", 18).toString(),
      router: ROUTER,
      chainId: 42161,
      pathId: "mock-path",
      sender: SENDER,
    }),
    getCalldata: vi.fn().mockResolvedValue({
      to: ROUTER,
      data: "0xdeadbeef" as Hex,
      value: 0n,
    }),
  };
}

describe("MoneyOS operations", () => {
  it("balance() reads native balances without a signer when an address is provided", async () => {
    const read = createMockReadClient({
      balance: parseUnits("1.2345", 18),
    });
    const moneyos = new MoneyOS({
      chainId: 137,
      read,
    });

    const result = await moneyos.balance("POL", {
      address: SENDER,
      chainId: 137,
    });

    expect(read.getBalance).toHaveBeenCalledOnce();
    expect(read.getBalance).toHaveBeenCalledWith({
      address: SENDER,
      chainId: 137,
    });
    expect(read.readContract).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      symbol: "POL",
      amount: "1.2345",
      rawAmount: parseUnits("1.2345", 18),
      decimals: 18,
      chainId: 137,
    });
  });

  it("balance() reads ERC-20 balances through balanceOf", async () => {
    const read = createMockReadClient({
      contractResult: 1234567n,
    });
    const moneyos = new MoneyOS({
      chainId: 42161,
      read,
    });

    const result = await moneyos.balance("USDC", {
      address: SENDER,
      chainId: 42161,
    });

    expect(read.getBalance).not.toHaveBeenCalled();
    expect(read.readContract).toHaveBeenCalledOnce();
    expect(read.readContract).toHaveBeenCalledWith({
      address: getTokenAddress("USDC", 42161),
      abi: expect.any(Array),
      functionName: "balanceOf",
      args: [SENDER],
      chainId: 42161,
    });
    expect(result).toMatchObject({
      symbol: "USDC",
      amount: "1.234567",
      rawAmount: 1234567n,
      decimals: 6,
      chainId: 42161,
    });
  });

  it("send() encodes ERC-20 transfers against the token contract", async () => {
    const executor = createMockExecutor();
    const moneyos = new MoneyOS({
      chainId: 42161,
      execute: executor,
    });

    const result = await moneyos.send("USDC", RECIPIENT, "1.25");

    expect(executor.send).toHaveBeenCalledOnce();
    expect(executor.send).toHaveBeenCalledWith({
      to: getTokenAddress("USDC", 42161),
      data: encodeFunctionData({
        abi: ERC20_TRANSFER_ABI,
        functionName: "transfer",
        args: [RECIPIENT, parseUnits("1.25", 6)],
      }),
      chainId: 42161,
    });
    expect(result).toMatchObject({
      hash: TX_HASH,
      from: SENDER,
      to: RECIPIENT,
      amount: "1.25",
      token: "USDC",
      chainId: 42161,
    });
  });

  it("send() sends native tokens directly to the recipient", async () => {
    const executor = createMockExecutor();
    const moneyos = new MoneyOS({
      chainId: 42161,
      execute: executor,
    });

    const result = await moneyos.send("ETH", RECIPIENT, "0.5");

    expect(executor.send).toHaveBeenCalledOnce();
    expect(executor.send).toHaveBeenCalledWith({
      to: RECIPIENT,
      value: parseUnits("0.5", 18),
      chainId: 42161,
    });
    expect(result).toMatchObject({
      hash: TX_HASH,
      from: SENDER,
      to: RECIPIENT,
      amount: "0.5",
      token: "ETH",
      chainId: 42161,
    });
  });

  it("swap() uses the configured runtime clients and asset registry", async () => {
    const read = createMockReadClient({
      contractResult: 0n,
    });
    const executor = createMockExecutor();
    const provider = createMockSwapProvider();
    const moneyos = new MoneyOS({
      chainId: 42161,
      read,
      execute: executor,
    });

    const result = await moneyos.swap("USDC", "RYZE", "1", provider, {
      slippage: 0.5,
    });

    expect(provider.getQuote).toHaveBeenCalledOnce();
    expect(provider.getQuote).toHaveBeenCalledWith({
      chainId: 42161,
      tokenIn: getTokenAddress("USDC", 42161),
      tokenOut: getTokenAddress("RYZE", 42161),
      amount: parseUnits("1", 6),
      sender: SENDER,
      slippage: 0.5,
    });
    expect(read.readContract).toHaveBeenCalledOnce();
    expect(read.readContract).toHaveBeenCalledWith({
      address: getTokenAddress("USDC", 42161),
      abi: expect.any(Array),
      functionName: "allowance",
      args: [SENDER, ROUTER],
      chainId: 42161,
    });
    expect(executor.send).toHaveBeenCalledTimes(2);
    expect(executor.send).toHaveBeenNthCalledWith(1, {
      to: getTokenAddress("USDC", 42161),
      data: expect.any(String),
      chainId: 42161,
    });
    expect(executor.send).toHaveBeenNthCalledWith(2, {
      to: ROUTER,
      data: "0xdeadbeef",
      value: 0n,
      chainId: 42161,
    });
    expect(result).toMatchObject({
      hash: TX_HASH,
      tokenIn: "USDC",
      tokenOut: "RYZE",
      amountIn: "1",
      amountOut: "0.5",
      chainId: 42161,
    });
  });
});

describe("unsupported chain guards", () => {
  it("ViemReadClient rejects unsupported chain ids before building a transport", async () => {
    const reader = new ViemReadClient({
      defaultChainId: 42161,
    });

    await expect(
      reader.getBalance({
        address: RECIPIENT,
        chainId: 10,
      }),
    ).rejects.toThrow(
      "Unsupported chain 10. Supported chains: 1 (Ethereum), 137 (Polygon), 42161 (Arbitrum One).",
    );
  });

  it("EOAExecutor rejects unsupported chain ids before sending", async () => {
    const executor = EOAExecutor.fromPrivateKey(TEST_KEY, {
      defaultChainId: 42161,
    });

    await expect(
      executor.send({
        to: RECIPIENT,
        value: 1n,
        chainId: 10,
      }),
    ).rejects.toThrow(
      "Unsupported chain 10. Supported chains: 1 (Ethereum), 137 (Polygon), 42161 (Arbitrum One).",
    );
  });
});
