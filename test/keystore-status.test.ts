import { describe, it, expect } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
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
const CACHED_ADDRESS =
  "0x1234567890123456789012345678901234567890" as Address;

// --- resolveStatus ---

describe("resolveStatus", () => {
  it("returns kind='none' for an empty config", () => {
    const config: CLIConfig = {};
    const status = resolveStatus(config, CONFIG_PATH);
    expect(status.kind).toBe("none");
    expect(status.state).toBe("empty");
    expect(status.configPath).toBe(CONFIG_PATH);
  });

  it("returns file/ready for a legacy config with a valid privateKey", () => {
    const config: CLIConfig = {
      chainId: 42161,
      privateKey: TEST_PK,
    };
    const status = resolveStatus(config, CONFIG_PATH);
    expect(status.kind).toBe("file");
    expect(status.state).toBe("ready");
    expect(status.address).toBe(TEST_ADDRESS);
  });

  it("returns file/ready when keyStore.kind='file' is set alongside privateKey", () => {
    const config: CLIConfig = {
      chainId: 42161,
      privateKey: TEST_PK,
      keyStore: { kind: "file" },
    };
    const status = resolveStatus(config, CONFIG_PATH);
    expect(status.kind).toBe("file");
    expect(status.state).toBe("ready");
    expect(status.address).toBe(TEST_ADDRESS);
  });

  it("returns file/empty when keyStore.kind='file' but no privateKey", () => {
    const config: CLIConfig = {
      chainId: 42161,
      keyStore: { kind: "file" },
    };
    const status = resolveStatus(config, CONFIG_PATH);
    expect(status.kind).toBe("file");
    expect(status.state).toBe("empty");
    expect(status.address).toBeUndefined();
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
    expect(status.address).toBeUndefined();
  });

  it("returns 1password/configured when both IDs are present", () => {
    const config: CLIConfig = {
      chainId: 42161,
      keyStore: {
        kind: "1password",
        vaultId: "vault26characterid000000001",
        itemId: "item26characterid000000001",
        address: CACHED_ADDRESS,
      },
    };
    const status = resolveStatus(config, CONFIG_PATH);
    expect(status.kind).toBe("1password");
    expect(status.state).toBe("configured");
    expect(status.vaultId).toBe("vault26characterid000000001");
    expect(status.itemId).toBe("item26characterid000000001");
    expect(status.address).toBe(CACHED_ADDRESS);
  });

  it("returns 1password/invalid when vaultId is missing", () => {
    const config: CLIConfig = {
      chainId: 42161,
      keyStore: {
        kind: "1password",
        itemId: "item26characterid000000001",
      },
    };
    const status = resolveStatus(config, CONFIG_PATH);
    expect(status.kind).toBe("1password");
    expect(status.state).toBe("invalid");
    expect(status.reason).toMatch(/missing vaultId or itemId/);
  });

  it("returns 1password/invalid when itemId is missing", () => {
    const config: CLIConfig = {
      chainId: 42161,
      keyStore: {
        kind: "1password",
        vaultId: "vault26characterid000000001",
      },
    };
    const status = resolveStatus(config, CONFIG_PATH);
    expect(status.kind).toBe("1password");
    expect(status.state).toBe("invalid");
  });

  it("1password wins precedence when both privateKey and 1password keyStore are set (transitional)", () => {
    // Step 5 established that the config schema TOLERATES both being set
    // (it's a transitional state during migration). This test pins the
    // precedence rule: 1password wins at the resolution layer.
    const config: CLIConfig = {
      chainId: 42161,
      privateKey: TEST_PK,
      keyStore: {
        kind: "1password",
        vaultId: "v1",
        itemId: "i1",
        address: CACHED_ADDRESS,
      },
    };
    const status = resolveStatus(config, CONFIG_PATH);
    expect(status.kind).toBe("1password");
    expect(status.state).toBe("configured");
  });
});

// --- formatStatus ---

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
        state: "ready",
        address: TEST_ADDRESS,
      }),
    );
    expect(output).toContain("Key store: file");
    expect(output).toContain(`Address:   ${TEST_ADDRESS}`);
    expect(output).toContain(`Config:    ${CONFIG_PATH}`);
    expect(output).toContain("Status:    ready");
  });

  it("formats file/empty with a helpful pointer to `moneyos init`", () => {
    const output = formatStatus(baseStatus({ state: "empty" }));
    expect(output).toContain("Key store: file");
    expect(output).toContain("Address:   (none)");
    expect(output).toMatch(/Status:\s+empty — run `moneyos init`/);
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

  it("formats 1password/configured with vault and item IDs", () => {
    const output = formatStatus(
      baseStatus({
        kind: "1password",
        state: "configured",
        address: CACHED_ADDRESS,
        vaultId: "vault26characterid000000001",
        itemId: "item26characterid000000001",
      }),
    );
    expect(output).toContain("Key store: 1password");
    expect(output).toContain(`Address:   ${CACHED_ADDRESS}`);
    expect(output).toContain("(from local cache)");
    expect(output).toContain("Vault ID:  vault26characterid000000001");
    expect(output).toContain("Item ID:   item26characterid000000001");
    expect(output).toMatch(/Status:\s+configured \(run with --live/);
  });

  it("formats 1password/ready with a 'verified via op read' note", () => {
    const output = formatStatus(
      baseStatus({
        kind: "1password",
        state: "ready",
        address: CACHED_ADDRESS,
        vaultId: "v1",
        itemId: "i1",
      }),
    );
    expect(output).toContain("(verified via op read)");
    expect(output).toMatch(/Status:\s+ready$/);
  });

  it("formats 1password/invalid when the identifier set is incomplete", () => {
    const output = formatStatus(
      baseStatus({
        kind: "1password",
        state: "invalid",
        vaultId: "v1",
        // itemId missing
        reason: "missing vaultId or itemId",
      }),
    );
    expect(output).toContain("Key store: 1password");
    expect(output).toMatch(/Status:\s+invalid — missing vaultId or itemId/);
  });

  it("formats 1password/unreachable with the failure reason", () => {
    const output = formatStatus(
      baseStatus({
        kind: "1password",
        state: "unreachable",
        address: CACHED_ADDRESS,
        vaultId: "v1",
        itemId: "i1",
        reason: "op read exited with code 1",
      }),
    );
    expect(output).toMatch(
      /Status:\s+unreachable — op read exited with code 1/,
    );
  });

  it("formats none with a clear 'no wallet configured' message", () => {
    const output = formatStatus(
      baseStatus({ kind: "none", state: "empty" }),
    );
    expect(output).toContain("Key store: (none)");
    expect(output).toContain(`Config:    ${CONFIG_PATH}`);
    expect(output).toMatch(/Status:\s+no wallet configured/);
  });
});

// --- Commander wiring sanity ---

describe("keystoreCommand wiring", () => {
  it("registers a 'status' subcommand", () => {
    expect(keystoreCommand.name()).toBe("keystore");
    const status = keystoreCommand.commands.find(
      (c) => c.name() === "status",
    );
    expect(status).toBeDefined();
  });

  it("'status' subcommand exposes --live and --op-binary flags", () => {
    const status = keystoreCommand.commands.find(
      (c) => c.name() === "status",
    );
    const optionNames = status!.options.map((o) => o.long);
    expect(optionNames).toContain("--live");
    expect(optionNames).toContain("--op-binary");
  });
});
