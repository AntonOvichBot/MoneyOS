import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const EOA = "0x1111111111111111111111111111111111111111";
const SMART = "0x2222222222222222222222222222222222222222";
const OVERRIDE = "0x3333333333333333333333333333333333333333";

const mocks = vi.hoisted(() => ({
  listTokens: vi.fn(),
  loadConfig: vi.fn(),
  buildCliMoneyOSConfig: vi.fn(),
  resolveCliOwnedAddresses: vi.fn(),
  moneyosBalance: vi.fn(),
  MoneyOS: vi.fn(),
}));

vi.mock("@moneyos/core", () => ({
  listTokens: mocks.listTokens,
}));

vi.mock("../src/cli/config.js", () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock("../src/cli/wallet.js", () => ({
  buildCliMoneyOSConfig: mocks.buildCliMoneyOSConfig,
  resolveCliOwnedAddresses: mocks.resolveCliOwnedAddresses,
}));

vi.mock("../src/core/client.js", () => ({
  MoneyOS: vi.fn().mockImplementation(() => ({
    balance: mocks.moneyosBalance,
  })),
}));

describe("balance command", () => {
  const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.exitCode = undefined;

    mocks.loadConfig.mockReturnValue({
      chainId: 42161,
      rpcUrl: "https://arb.example/rpc",
      gasless: { enabled: false },
    });
    mocks.buildCliMoneyOSConfig.mockResolvedValue({
      chainId: 42161,
      rpcUrl: "https://arb.example/rpc",
    });
    mocks.resolveCliOwnedAddresses.mockResolvedValue({ eoa: EOA });
    mocks.listTokens.mockReturnValue([
      { symbol: "USDC" },
      { symbol: "ETH" },
    ]);
    mocks.moneyosBalance.mockImplementation(async (token: string, options: { address: string }) => {
      if (token === "USDC" && options.address === EOA) {
        return { symbol: "USDC", amount: "0.081708" };
      }
      if (token === "USDC" && options.address === SMART) {
        return { symbol: "USDC", amount: "0.009" };
      }
      if (token === "ETH" && options.address === EOA) {
        return { symbol: "ETH", amount: "0.000046" };
      }
      if (token === "ETH" && options.address === SMART) {
        return { symbol: "ETH", amount: "0" };
      }
      if (token === "USDC" && options.address === OVERRIDE) {
        return { symbol: "USDC", amount: "1.5" };
      }
      return { symbol: token, amount: "0" };
    });
  });

  afterEach(() => {
    consoleLog.mockClear();
    consoleError.mockClear();
    process.exitCode = undefined;
  });

  async function loadCommand() {
    const mod = await import("../src/cli/commands/balance.js");
    mod.balanceCommand.exitOverride();
    return mod.balanceCommand;
  }

  it("prints both EOA and smart-account balances when gasless is enabled", async () => {
    mocks.resolveCliOwnedAddresses.mockResolvedValue({
      eoa: EOA,
      smartAccount: SMART,
    });

    const command = await loadCommand();
    await command.parseAsync(["node", "balance", "USDC"]);

    const lines = consoleLog.mock.calls.map((call) => call[0]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^EOA \(0x1111…1111\):\s+USDC 0\.081708$/);
    expect(lines[1]).toMatch(/^Smart account \(0x2222…2222\):\s+USDC 0\.009$/);
  });

  it("keeps the current single-line output when gasless is off", async () => {
    const command = await loadCommand();
    await command.parseAsync(["node", "balance", "USDC"]);

    expect(consoleLog.mock.calls.map((call) => call[0])).toEqual([
      "0.081708 USDC",
    ]);
  });

  it("keeps single-address behavior when --address is passed", async () => {
    const command = await loadCommand();
    await command.parseAsync([
      "node",
      "balance",
      "USDC",
      "--address",
      OVERRIDE,
    ]);

    expect(mocks.resolveCliOwnedAddresses).not.toHaveBeenCalled();
    expect(mocks.moneyosBalance).toHaveBeenCalledWith("USDC", {
      address: OVERRIDE,
      chainId: 42161,
    });
    expect(consoleLog.mock.calls.map((call) => call[0])).toEqual([
      "1.5 USDC",
    ]);
  });

  it("prints two balance grids for --all when gasless is enabled", async () => {
    mocks.resolveCliOwnedAddresses.mockResolvedValue({
      eoa: EOA,
      smartAccount: SMART,
    });

    const command = await loadCommand();
    await command.parseAsync(["node", "balance", "--all"]);

    const lines = consoleLog.mock.calls.map((call) => call[0]);
    expect(lines).toEqual([
      "EOA (0x1111…1111):",
      "USDC  0.081708",
      "ETH   0.000046",
      "",
      "Smart account (0x2222…2222):",
      "USDC  0.009",
      "ETH   0",
    ]);
  });
});
