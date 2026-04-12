import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MoneyOSRuntime } from "@moneyos/core";
import {
  createSwapCliCommand,
  moneyosCliTool,
} from "@moneyos/swap";

function createRuntime(): MoneyOSRuntime {
  return {
    read: {
      getBalance: vi.fn(),
      readContract: vi.fn(),
    },
    execute: {
      mode: "eoa",
      getAddress: () => "0x1111111111111111111111111111111111111111",
      send: vi.fn(),
      capabilities: () => ({
        sponsoredGas: false,
        batching: false,
        simulation: false,
      }),
    },
    assets: {
      getToken: vi.fn(),
      getTokenAddress: vi.fn(),
      getChain: vi.fn(),
      nativeTokenAddress: "0x0000000000000000000000000000000000000000",
    },
    config: {
      defaultChainId: 42161,
    },
  };
}

describe("@moneyos/swap CLI tool", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("exports the root CLI integration contract as moneyos swap", () => {
    expect(moneyosCliTool).toMatchObject({
      version: 1,
      name: "swap",
      commandPath: ["swap"],
    });
    expect(moneyosCliTool.createCommand).toBeTypeOf("function");
  });

  it("defaults the provider to odos and maps arguments into executeSwap", async () => {
    const runtime = createRuntime();
    const getRuntime = vi.fn().mockResolvedValue(runtime);
    const provider = { name: "odos", getQuote: vi.fn(), getCalldata: vi.fn() };
    const createProvider = vi.fn().mockReturnValue(provider);
    const executeSwap = vi.fn().mockResolvedValue({
      amountIn: "0.1",
      amountOut: "1.2",
      tokenIn: "RYZE",
      tokenOut: "ETH",
      hash: "0xabc",
      chainId: 42161,
    });
    const log = vi.fn();

    const command = createSwapCliCommand(
      {
        getRuntime,
      },
      {
        executeSwap,
        createProvider,
        log,
      },
    );

    await command.parseAsync(["node", "swap", "0.1", "RYZE", "ETH"]);

    expect(createProvider).toHaveBeenCalledWith("odos");
    expect(getRuntime).toHaveBeenCalledWith({
      chainId: undefined,
      requireSession: true,
    });
    expect(executeSwap).toHaveBeenCalledWith(
      {
        amount: "0.1",
        tokenIn: "RYZE",
        tokenOut: "ETH",
        chainId: 42161,
        provider,
      },
      runtime,
    );
  });

  it("passes the parsed chain id through getRuntime and executeSwap", async () => {
    const runtime = createRuntime();
    runtime.config.defaultChainId = 10;
    const getRuntime = vi.fn().mockResolvedValue(runtime);
    const executeSwap = vi.fn().mockResolvedValue({
      amountIn: "1",
      amountOut: "2",
      tokenIn: "USDC",
      tokenOut: "ETH",
      hash: "0xdef",
      chainId: 10,
    });

    const command = createSwapCliCommand(
      {
        getRuntime,
      },
      {
        executeSwap,
        createProvider: vi.fn().mockReturnValue({
          name: "odos",
          getQuote: vi.fn(),
          getCalldata: vi.fn(),
        }),
        log: vi.fn(),
      },
    );

    await command.parseAsync([
      "node",
      "swap",
      "1",
      "USDC",
      "ETH",
      "--chain",
      "10",
    ]);

    expect(getRuntime).toHaveBeenCalledWith({
      chainId: 10,
      requireSession: true,
    });
    expect(executeSwap).toHaveBeenCalledWith(
      expect.objectContaining({
        chainId: 10,
      }),
      runtime,
    );
  });

  it("surfaces the missing-session error clearly", async () => {
    const command = createSwapCliCommand(
      {
        getRuntime: vi.fn().mockRejectedValue(
          new Error(
            "No active local MoneyOS session found. Run `moneyos auth unlock` locally first.",
          ),
        ),
      },
      {
        executeSwap: vi.fn(),
        createProvider: vi.fn(),
        log: vi.fn(),
      },
    );

    await expect(
      command.parseAsync(["node", "swap", "1", "USDC", "ETH"]),
    ).rejects.toThrow(/moneyos auth unlock/i);
  });

  it("uses MoneyOSRuntime rather than session internals directly", async () => {
    const runtime = createRuntime();
    const executeSwap = vi.fn().mockResolvedValue({
      amountIn: "1",
      amountOut: "2",
      tokenIn: "USDC",
      tokenOut: "ETH",
      hash: "0x123",
      chainId: 42161,
    });
    const log = vi.fn();

    const command = createSwapCliCommand(
      {
        getRuntime: vi.fn().mockResolvedValue(runtime),
      },
      {
        executeSwap,
        createProvider: vi.fn().mockReturnValue({
          name: "odos",
          getQuote: vi.fn(),
          getCalldata: vi.fn(),
        }),
        log,
      },
    );

    await command.parseAsync(["node", "swap", "1", "USDC", "ETH"]);

    expect(executeSwap).toHaveBeenCalledWith(
      expect.any(Object),
      runtime,
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("Swapped 1 USDC for 2 ETH."),
    );
  });
});
