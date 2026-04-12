import { describe, expect, it, vi } from "vitest";
import type { ExecutionClient } from "@moneyos/core";
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

describe("MoneyOSCliContext runtime", () => {
  it("getRuntime({ requireSession: true }) attaches to the local session executor", async () => {
    const execute = createMockExecutionClient();
    const connectLocalSession = vi.fn().mockResolvedValue(execute);
    const ctx = createMoneyOSCliContext({
      loadConfig: () => ({
        chainId: 42161,
        rpcUrl: "https://arb.example.invalid",
      }),
      connectLocalSession,
      createReadClient: vi.fn().mockReturnValue({
        getBalance: vi.fn(),
        readContract: vi.fn(),
      }),
      createAssets: vi.fn().mockReturnValue({
        getToken: vi.fn(),
        getTokenAddress: vi.fn(),
        getChain: vi.fn(),
        nativeTokenAddress: "0x0000000000000000000000000000000000000000",
      }),
    });

    const runtime = await ctx.getRuntime({
      chainId: 10,
      requireSession: true,
    });

    expect(connectLocalSession).toHaveBeenCalledOnce();
    expect(runtime.execute).toBe(execute);
    expect(runtime.config).toEqual({
      defaultChainId: 10,
      rpcUrl: "https://arb.example.invalid",
    });
  });

  it("getRuntime({ requireSession: true }) surfaces the clear unlock error when locked", async () => {
    const ctx = createMoneyOSCliContext({
      loadConfig: () => ({}),
      connectLocalSession: vi.fn().mockRejectedValue(
        new Error(
          "No active local MoneyOS session found. Run `moneyos auth unlock` locally first.",
        ),
      ),
      createReadClient: vi.fn().mockReturnValue({
        getBalance: vi.fn(),
        readContract: vi.fn(),
      }),
      createAssets: vi.fn().mockReturnValue({
        getToken: vi.fn(),
        getTokenAddress: vi.fn(),
        getChain: vi.fn(),
        nativeTokenAddress: "0x0000000000000000000000000000000000000000",
      }),
    });

    await expect(
      ctx.getRuntime({
        requireSession: true,
      }),
    ).rejects.toThrow(/moneyos auth unlock/i);
  });

  it("getRuntime() without requireSession returns a read-only runtime", async () => {
    const ctx = createMoneyOSCliContext({
      loadConfig: () => ({
        chainId: 42161,
      }),
      connectLocalSession: vi.fn(),
      createReadClient: vi.fn().mockReturnValue({
        getBalance: vi.fn(),
        readContract: vi.fn(),
      }),
      createAssets: vi.fn().mockReturnValue({
        getToken: vi.fn(),
        getTokenAddress: vi.fn(),
        getChain: vi.fn(),
        nativeTokenAddress: "0x0000000000000000000000000000000000000000",
      }),
    });

    const runtime = await ctx.getRuntime();

    expect(() => runtime.execute.getAddress()).toThrow(
      /No signing account configured/i,
    );
    await expect(
      runtime.execute.send({
        to: "0x1111111111111111111111111111111111111111",
        chainId: 42161,
        value: 0n,
      }),
    ).rejects.toThrow(/No signing account configured/i);
  });
});
