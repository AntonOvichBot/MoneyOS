import { describe, it, expect } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import type { CLIConfig } from "../src/cli/config.js";
import {
  resolveStatus,
  formatStatus,
  keystoreCommand,
  type ResolvedStatus,
} from "../src/cli/commands/keystore.js";

const CONFIG_PATH = "/fake/home/.moneyos/config.json";
const TEST_PK: Hex = generatePrivateKey();
const TEST_ADDRESS = privateKeyToAccount(TEST_PK).address;

describe("resolveStatus", () => {
  it("returns kind='none' for an empty config", () => {
    const status = resolveStatus({}, CONFIG_PATH);
    expect(status.kind).toBe("none");
    expect(status.state).toBe("empty");
    expect(status.configPath).toBe(CONFIG_PATH);
  });

  it("returns file/ready for a valid privateKey", () => {
    const config: CLIConfig = {
      chainId: 42161,
      privateKey: TEST_PK,
    };
    const status = resolveStatus(config, CONFIG_PATH);
    expect(status.kind).toBe("file");
    expect(status.state).toBe("ready");
    expect(status.address).toBe(TEST_ADDRESS);
  });

  it("returns file/invalid when privateKey is malformed", () => {
    const config: CLIConfig = {
      chainId: 42161,
      privateKey: "0xnotarealkey" as Hex,
    };
    const status = resolveStatus(config, CONFIG_PATH);
    expect(status.kind).toBe("file");
    expect(status.state).toBe("invalid");
    expect(status.reason).toBeDefined();
  });

  it("returns unsupported/removed for the deleted 1Password-backed model", () => {
    const removedConfig = {
      keyStore: {
        kind: "1password",
        address: TEST_ADDRESS,
      },
    } as CLIConfig;
    const status = resolveStatus(removedConfig, CONFIG_PATH);
    expect(status.kind).toBe("unsupported");
    expect(status.state).toBe("removed");
    expect(status.address).toBe(TEST_ADDRESS);
    expect(status.reason).toMatch(
      /no longer supports the old 1Password-backed private-key storage path/i,
    );
  });
});

describe("formatStatus", () => {
  function baseStatus(overrides: Partial<ResolvedStatus>): ResolvedStatus {
    return {
      kind: "file",
      state: "ready",
      configPath: CONFIG_PATH,
      ...overrides,
    };
  }

  it("formats file/ready with address and config path", () => {
    const output = formatStatus(
      baseStatus({
        address: TEST_ADDRESS,
      }),
    );
    expect(output).toContain("Key store: file");
    expect(output).toContain(`Address:   ${TEST_ADDRESS}`);
    expect(output).toContain(`Config:    ${CONFIG_PATH}`);
    expect(output).toContain("Status:    ready");
  });

  it("formats file/invalid with the underlying reason", () => {
    const output = formatStatus(
      baseStatus({
        state: "invalid",
        reason: "invalid hex string",
      }),
    );
    expect(output).toMatch(/Status:\s+invalid — invalid hex string/);
  });

  it("formats removed legacy configs clearly", () => {
    const output = formatStatus({
      kind: "unsupported",
      state: "removed",
      address: TEST_ADDRESS,
      configPath: CONFIG_PATH,
      reason:
        "This repo no longer supports the old 1Password-backed private-key storage path.",
    });
    expect(output).toContain("Key store: removed legacy model");
    expect(output).toContain("(cached metadata)");
    expect(output).toMatch(/Status:\s+removed/);
  });

  it("formats none with a clear init pointer", () => {
    const output = formatStatus({
      kind: "none",
      state: "empty",
      configPath: CONFIG_PATH,
    });
    expect(output).toContain("Key store: (none)");
    expect(output).toMatch(/Status:\s+no wallet configured/);
  });
});

describe("keystoreCommand wiring", () => {
  it("registers a 'status' subcommand", () => {
    expect(keystoreCommand.name()).toBe("keystore");
    const status = keystoreCommand.commands.find(
      (c) => c.name() === "status",
    );
    expect(status).toBeDefined();
  });

  it("does not register a 'migrate' subcommand anymore", () => {
    const migrate = keystoreCommand.commands.find(
      (c) => c.name() === "migrate",
    );
    expect(migrate).toBeUndefined();
  });
});
