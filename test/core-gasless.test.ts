import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createPublicClient: vi.fn(),
  http: vi.fn((url: string) => ({ url })),
  resolveChainTransport: vi.fn(),
  getCode: vi.fn(),
  readContract: vi.fn(),
  executorOptions: undefined as any,
  RelayClient: vi.fn(),
  GaslessExecutor: vi.fn(),
}));

vi.mock("viem", () => ({
  createPublicClient: mocks.createPublicClient,
  http: mocks.http,
}));

vi.mock("../src/core/chains.js", () => ({
  resolveChainTransport: mocks.resolveChainTransport,
}));

vi.mock("@moneyos/gasless", () => ({
  RelayClient: mocks.RelayClient,
  GaslessExecutor: mocks.GaslessExecutor,
  moneyOSAccountV1Abi: [],
}));

describe("createGaslessExecutionClient", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.executorOptions = undefined;

    mocks.resolveChainTransport.mockReturnValue({
      chain: { id: 42161 },
      rpcUrl: "https://arb.example/rpc",
    });
    mocks.createPublicClient.mockReturnValue({
      getCode: mocks.getCode,
      readContract: mocks.readContract,
    });
    mocks.RelayClient.mockImplementation(() => ({ kind: "relay-client" }));
    mocks.GaslessExecutor.mockImplementation((options) => {
      mocks.executorOptions = options;
      return {
        mode: "smart-account",
        capabilities: async () => ({ sponsoredGas: true }),
      };
    });
  });

  it("returns nonce 0 for an undeployed smart account", async () => {
    mocks.getCode.mockResolvedValue("0x");

    const { createGaslessExecutionClient } = await import("../src/core/gasless.js");
    createGaslessExecutionClient({
      chainId: 42161,
      gasless: {
        relayUrl: "https://relay.example",
        sponsor: "0x2222222222222222222222222222222222222222",
        account: "0x3333333333333333333333333333333333333333",
      },
      signer: {
        address: "0x1111111111111111111111111111111111111111",
        signTypedData: vi.fn(),
      } as any,
    });

    const nonce = await mocks.executorOptions.nonceResolver({
      signer: "0x1111111111111111111111111111111111111111",
      nonceKey: 1n,
    });

    expect(nonce).toBe(0n);
    expect(mocks.getCode).toHaveBeenCalledWith({
      address: "0x3333333333333333333333333333333333333333",
    });
    expect(mocks.readContract).not.toHaveBeenCalled();
  });

  it("reads the nonce on an already deployed smart account", async () => {
    mocks.getCode.mockResolvedValue("0x6001");
    mocks.readContract.mockResolvedValue(7n);

    const { createGaslessExecutionClient } = await import("../src/core/gasless.js");
    createGaslessExecutionClient({
      chainId: 42161,
      gasless: {
        relayUrl: "https://relay.example",
        sponsor: "0x2222222222222222222222222222222222222222",
        account: "0x3333333333333333333333333333333333333333",
      },
      signer: {
        address: "0x1111111111111111111111111111111111111111",
        signTypedData: vi.fn(),
      } as any,
    });

    const nonce = await mocks.executorOptions.nonceResolver({
      signer: "0x1111111111111111111111111111111111111111",
      nonceKey: 1n,
    });

    expect(nonce).toBe(7n);
    expect(mocks.readContract).toHaveBeenCalledWith({
      address: "0x3333333333333333333333333333333333333333",
      abi: [],
      functionName: "getNonce",
      args: ["0x1111111111111111111111111111111111111111", 1n],
    });
  });
});
