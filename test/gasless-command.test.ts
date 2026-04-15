import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getGaslessNetworkDefaults: vi.fn(),
  loadFileConfig: vi.fn(),
  saveConfig: vi.fn(),
  getConfigPath: vi.fn(),
  getSessionSocketPath: vi.fn(),
  getSessionTokenPath: vi.fn(),
  loadCliAddress: vi.fn(),
  resolveGaslessExecutionConfig: vi.fn(),
  getGaslessRequiredEnvPresence: vi.fn(),
  isGaslessEnabled: vi.fn(),
  lockSession: vi.fn(),
}));

vi.mock("@moneyos/gasless", () => ({
  getGaslessNetworkDefaults: mocks.getGaslessNetworkDefaults,
}));

vi.mock("../src/cli/config.js", () => ({
  loadFileConfig: mocks.loadFileConfig,
  saveConfig: mocks.saveConfig,
  getConfigPath: mocks.getConfigPath,
  getSessionSocketPath: mocks.getSessionSocketPath,
  getSessionTokenPath: mocks.getSessionTokenPath,
}));

vi.mock("../src/cli/wallet.js", () => ({
  loadCliAddress: mocks.loadCliAddress,
}));

vi.mock("../src/cli/session.js", () => ({
  lockSession: mocks.lockSession,
}));

vi.mock("../src/cli/gasless.js", () => ({
  gaslessEnvVarNames: {
    enabled: "MONEYOS_GASLESS_ENABLED",
    relayUrl: "MONEYOS_GASLESS_RELAY_URL",
    account: "MONEYOS_GASLESS_ACCOUNT",
    sponsor: "MONEYOS_GASLESS_SPONSOR",
  },
  resolveGaslessExecutionConfig: mocks.resolveGaslessExecutionConfig,
  getGaslessRequiredEnvPresence: mocks.getGaslessRequiredEnvPresence,
  isGaslessEnabled: mocks.isGaslessEnabled,
}));

describe("gasless command", () => {
  const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    mocks.loadFileConfig.mockReturnValue({
      chainId: 42161,
      gasless: { enabled: false },
    });
    mocks.getConfigPath.mockReturnValue("/tmp/moneyos-config.json");
    mocks.getSessionSocketPath.mockReturnValue("/tmp/moneyos.sock");
    mocks.getSessionTokenPath.mockReturnValue("/tmp/moneyos.token");
    mocks.getGaslessNetworkDefaults.mockReturnValue({
      rpcUrl: "https://arb.example/rpc",
      relayUrl: "https://relay.example",
      sponsor: "0x2222222222222222222222222222222222222222",
    });
    mocks.loadCliAddress.mockResolvedValue({
      address: "0x1111111111111111111111111111111111111111",
    });
    mocks.resolveGaslessExecutionConfig.mockImplementation(async (config) => {
      if (!config.gasless?.enabled) {
        return undefined;
      }

      return {
        relayUrl: "https://relay.example",
        sponsor: "0x2222222222222222222222222222222222222222",
        account: "0x3333333333333333333333333333333333333333",
      };
    });
    mocks.getGaslessRequiredEnvPresence.mockReturnValue({
      relayUrl: true,
      account: true,
      sponsor: true,
    });
    mocks.isGaslessEnabled.mockReturnValue(false);
    mocks.lockSession.mockResolvedValue(false);
  });

  afterEach(() => {
    consoleLog.mockClear();
  });

  it("derives and saves the default smart-account when enabling gasless", async () => {
    const { gaslessCommand } = await import("../src/cli/commands/gasless.js");
    gaslessCommand.exitOverride();

    await gaslessCommand.parseAsync(["node", "gasless", "enable"]);

    expect(mocks.resolveGaslessExecutionConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        chainId: 42161,
        gasless: expect.objectContaining({ enabled: true }),
      }),
      expect.objectContaining({
        ownerAddress: "0x1111111111111111111111111111111111111111",
        chainId: 42161,
        rpcUrl: "https://arb.example/rpc",
      }),
    );

    expect(mocks.saveConfig).toHaveBeenCalledTimes(1);
    expect(mocks.saveConfig.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        chainId: 42161,
        gasless: expect.objectContaining({
          enabled: true,
          relayUrl: "https://relay.example",
          sponsor: "0x2222222222222222222222222222222222222222",
          account: "0x3333333333333333333333333333333333333333",
        }),
      }),
    );
  });
});
