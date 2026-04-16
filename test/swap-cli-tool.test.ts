import { beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { NATIVE_TOKEN_ADDRESS, type MoneyOSRuntime } from "@moneyos/core";
import { moneyosCliTool } from "@moneyos/swap";

const ROUTER = "0x1111111111111111111111111111111111111111";
const TOKEN_ADDRESSES: Record<string, `0x${string}`> = {
  USDC: "0x2222222222222222222222222222222222222222",
  RYZE: "0x3333333333333333333333333333333333333333",
  ETH: NATIVE_TOKEN_ADDRESS,
};

function createRuntime(chainId: number): MoneyOSRuntime & {
  read: { readContract: ReturnType<typeof vi.fn> };
  execute: { send: ReturnType<typeof vi.fn> };
} {
  return {
    read: {
      getBalance: vi.fn(),
      readContract: vi.fn().mockResolvedValue(10n ** 18n),
    },
    execute: {
      mode: "eoa",
      getAddress: () => "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      send: vi.fn().mockResolvedValue({ hash: "0xabc", chainId }),
      capabilities: () => ({ sponsoredGas: false, batching: false, simulation: false }),
    },
    assets: {
      getToken: (symbol) => (
        symbol in TOKEN_ADDRESSES
          ? { name: symbol, symbol, decimals: symbol === "USDC" ? 6 : 18 }
          : undefined
      ),
      getTokenAddress: (symbol, requestedChainId) =>
        requestedChainId === chainId ? TOKEN_ADDRESSES[symbol] : undefined,
      getChain: vi.fn(),
      nativeTokenAddress: NATIVE_TOKEN_ADDRESS,
    },
    config: { defaultChainId: chainId },
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
  });

  it("defaults the provider to odos and maps arguments into executeSwap", async () => {
    const runtime = createRuntime(42161);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ pathId: "path-1", outAmounts: ["1234500000000000000"], outValues: [1] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ transaction: { to: ROUTER, data: "0xdeadbeef", value: "0" } }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const getRuntime = vi.fn().mockResolvedValue(runtime);

    await moneyosCliTool.createCommand({ Command, getRuntime }).parseAsync([
      "node",
      "swap",
      "0.1",
      "RYZE",
      "ETH",
    ]);

    expect(getRuntime).toHaveBeenCalledWith({ chainId: undefined, requireSession: true });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.odos.xyz/sor/quote/v2",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toMatchObject({
      chainId: 42161,
      inputTokens: [{ tokenAddress: TOKEN_ADDRESSES.RYZE, amount: "100000000000000000" }],
      outputTokens: [{ tokenAddress: "0x0000000000000000000000000000000000000000", proportion: 1 }],
    });
    expect(runtime.execute.send).toHaveBeenCalledWith({
      to: ROUTER,
      data: "0xdeadbeef",
      value: 0n,
      chainId: 42161,
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Swapped 0.1 RYZE for 1.2345 ETH."));
  });

  it("passes the parsed chain id through getRuntime and the runtime execution path", async () => {
    const runtime = createRuntime(137);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ pathId: "path-1", outAmounts: ["1234500000000000000"], outValues: [1] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ transaction: { to: ROUTER, data: "0xdeadbeef", value: "0" } }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const getRuntime = vi.fn().mockResolvedValue(runtime);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await moneyosCliTool.createCommand({ Command, getRuntime }).parseAsync([
      "node",
      "swap",
      "1",
      "USDC",
      "ETH",
      "--chain",
      "137",
    ]);

    expect(getRuntime).toHaveBeenCalledWith({ chainId: 137, requireSession: true });
    expect(runtime.execute.send).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: 137 }),
    );
  });

  it("surfaces the missing-session error clearly", async () => {
    await expect(
      moneyosCliTool.createCommand({
        Command,
        getRuntime: vi.fn().mockRejectedValue(
          new Error("No active local MoneyOS session found. Run `moneyos auth unlock` locally first."),
        ),
      }).parseAsync(["node", "swap", "1", "USDC", "ETH"]),
    ).rejects.toThrow(/moneyos auth unlock/i);
  });

  it("uses MoneyOSRuntime rather than session internals directly", async () => {
    const runtime = createRuntime(42161);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ pathId: "path-1", outAmounts: ["1234500000000000000"], outValues: [1] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ transaction: { to: ROUTER, data: "0xdeadbeef", value: "0" } }),
      });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await moneyosCliTool.createCommand({
      Command,
      getRuntime: vi.fn().mockResolvedValue(runtime),
    }).parseAsync(["node", "swap", "1", "USDC", "ETH"]);

    expect(runtime.read.readContract).toHaveBeenCalledTimes(2);
    expect(runtime.execute.send).toHaveBeenCalledOnce();
  });
});
