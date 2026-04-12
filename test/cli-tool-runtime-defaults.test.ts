import type { ExecutionClient } from "@moneyos/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockLoadConfig,
  mockConnectLocalSession,
  MockViemReadClient,
  MockDefaultAssetRegistry,
} = vi.hoisted(() => ({
  mockLoadConfig: vi.fn(),
  mockConnectLocalSession: vi.fn(),
  MockViemReadClient: vi.fn(),
  MockDefaultAssetRegistry: vi.fn(),
}));

vi.mock("../src/cli/config.js", () => ({
  loadConfig: mockLoadConfig,
}));

vi.mock("../src/local-session.js", () => ({
  connectLocalSession: mockConnectLocalSession,
}));

vi.mock("../src/core/eoa.js", () => ({
  ViemReadClient: MockViemReadClient,
}));

vi.mock("../src/core/assets.js", () => ({
  DefaultAssetRegistry: MockDefaultAssetRegistry,
}));

import { createMoneyOSCliContext } from "../src/cli/tools/runtime.js";

function createMockExecutionClient(): ExecutionClient {
  return {
    mode: "eoa",
    getAddress: () => "0x1111111111111111111111111111111111111111",
    send: vi.fn(),
    capabilities: () => ({
      sponsoredGas: false,
      batching: false,
      simulation: false,
    }),
  };
}

describe("MoneyOSCliContext default dependencies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockReturnValue({
      chainId: 10,
      rpcUrl: "https://optimism.example.invalid",
    });
    mockConnectLocalSession.mockResolvedValue(createMockExecutionClient());
    MockViemReadClient.mockImplementation((params: { defaultChainId: number; rpcUrl?: string }) => ({
      getBalance: vi.fn(),
      readContract: vi.fn(),
      params,
    }));
    MockDefaultAssetRegistry.mockImplementation(() => ({
      getToken: vi.fn(),
      getTokenAddress: vi.fn(),
      getChain: vi.fn(),
      nativeTokenAddress: "0x0000000000000000000000000000000000000000",
    }));
  });

  it("uses the built-in read client and asset registry factories", async () => {
    const ctx = createMoneyOSCliContext();
    const runtime = await ctx.getRuntime({ requireSession: true });

    expect(mockLoadConfig).toHaveBeenCalledOnce();
    expect(MockViemReadClient).toHaveBeenCalledWith({
      defaultChainId: 10,
      rpcUrl: "https://optimism.example.invalid",
    });
    expect(MockDefaultAssetRegistry).toHaveBeenCalledOnce();
    expect(mockConnectLocalSession).toHaveBeenCalledOnce();
    expect(runtime.read).toMatchObject({
      params: {
        defaultChainId: 10,
        rpcUrl: "https://optimism.example.invalid",
      },
    });
  });
});
