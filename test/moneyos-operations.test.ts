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
  ViemReadClient,
  getTokenAddress,
} from "../src/index.js";
import type {
  ExecutionClient,
  ReadClient,
} from "../src/index.js";

const TEST_KEY: Hex =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const SENDER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
const RECIPIENT = "0x1111111111111111111111111111111111111111" as Address;
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

function expectUnsupportedChainError(result: Promise<unknown>, chainId: number) {
  return expect(result).rejects.toThrow(
    new RegExp(`Unsupported chain ${chainId}\\b.*Supported chains:`),
  );
}

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

});

describe("unsupported chain guards", () => {
  it("ViemReadClient rejects unsupported chain ids before building a transport", async () => {
    const reader = new ViemReadClient({
      defaultChainId: 42161,
    });

    await expectUnsupportedChainError(
      reader.getBalance({
        address: RECIPIENT,
        chainId: 10,
      }),
      10,
    );
  });

  it("EOAExecutor rejects unsupported chain ids before sending", async () => {
    const executor = EOAExecutor.fromPrivateKey(TEST_KEY, {
      defaultChainId: 42161,
    });

    await expectUnsupportedChainError(
      executor.send({
        to: RECIPIENT,
        value: 1n,
        chainId: 10,
      }),
      10,
    );
  });
});
