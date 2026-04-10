import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Address, Hex } from "viem";
import {
  loadConfig,
  loadFileConfig,
  saveConfig,
  type CLIConfig,
} from "../src/cli/config.js";

describe("loadConfig env vars", () => {
  const envKeys = [
    "MONEYOS_PRIVATE_KEY",
    "MONEYOS_RPC_URL",
    "MONEYOS_CHAIN_ID",
  ];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of envKeys) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (saved[key] !== undefined) {
        process.env[key] = saved[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it("MONEYOS_PRIVATE_KEY overrides file config", () => {
    const pk =
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    process.env.MONEYOS_PRIVATE_KEY = pk;
    const config = loadConfig();
    expect(config.privateKey).toBe(pk);
  });

  it("MONEYOS_RPC_URL overrides file config", () => {
    process.env.MONEYOS_RPC_URL = "https://custom-rpc.example.com";
    const config = loadConfig();
    expect(config.rpcUrl).toBe("https://custom-rpc.example.com");
  });

  it("MONEYOS_CHAIN_ID accepts valid integer", () => {
    process.env.MONEYOS_CHAIN_ID = "137";
    const config = loadConfig();
    expect(config.chainId).toBe(137);
  });

  it("MONEYOS_CHAIN_ID rejects non-numeric string", () => {
    process.env.MONEYOS_CHAIN_ID = "abc";
    expect(() => loadConfig()).toThrow('Invalid MONEYOS_CHAIN_ID: "abc"');
  });

  it("MONEYOS_CHAIN_ID rejects trailing text", () => {
    process.env.MONEYOS_CHAIN_ID = "42161abc";
    expect(() => loadConfig()).toThrow(
      'Invalid MONEYOS_CHAIN_ID: "42161abc"',
    );
  });

  it("MONEYOS_CHAIN_ID rejects negative values", () => {
    process.env.MONEYOS_CHAIN_ID = "-1";
    expect(() => loadConfig()).toThrow('Invalid MONEYOS_CHAIN_ID: "-1"');
  });

  it("MONEYOS_CHAIN_ID rejects zero", () => {
    process.env.MONEYOS_CHAIN_ID = "0";
    expect(() => loadConfig()).toThrow('Invalid MONEYOS_CHAIN_ID: "0"');
  });

  it("env vars do not appear in loadFileConfig", () => {
    process.env.MONEYOS_PRIVATE_KEY =
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    process.env.MONEYOS_CHAIN_ID = "137";
    const fileConfig = loadFileConfig();
    // loadFileConfig reads only the file — env vars should not leak in
    // (privateKey would only be set if a config file exists with it)
    expect(fileConfig.privateKey).not.toBe(
      process.env.MONEYOS_PRIVATE_KEY,
    );
  });
});

// --- CLIConfig keyStore schema (step 5) ---
//
// These tests exercise the actual `loadFileConfig` / `saveConfig` round-trip
// against a tmpdir-backed config file. They rely on the optional path
// parameter added in step 5 so that no test touches the real
// `~/.moneyos/config.json`.

const TEST_PK: Hex =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TEST_ADDRESS: Address =
  "0x1234567890123456789012345678901234567890";

describe("CLIConfig keyStore schema", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "moneyos-cli-cfg-"));
    configPath = join(tmpDir, "config.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("legacy config without keyStore round-trips unchanged", () => {
    const legacy: CLIConfig = {
      chainId: 42161,
      rpcUrl: "https://arb1.arbitrum.io/rpc",
      privateKey: TEST_PK,
    };
    saveConfig(legacy, configPath);

    const loaded = loadFileConfig(configPath);
    expect(loaded.chainId).toBe(42161);
    expect(loaded.rpcUrl).toBe("https://arb1.arbitrum.io/rpc");
    expect(loaded.privateKey).toBe(TEST_PK);
    expect(loaded.keyStore).toBeUndefined();
  });

  it("round-trips a keyStore with kind 'file'", () => {
    const config: CLIConfig = {
      chainId: 42161,
      privateKey: TEST_PK,
      keyStore: { kind: "file" },
    };
    saveConfig(config, configPath);

    const loaded = loadFileConfig(configPath);
    expect(loaded.keyStore?.kind).toBe("file");
    expect(loaded.keyStore?.vaultId).toBeUndefined();
    expect(loaded.keyStore?.itemId).toBeUndefined();
    // privateKey is preserved — file kind is the legacy path
    expect(loaded.privateKey).toBe(TEST_PK);
  });

  it("round-trips a keyStore with kind '1password' and stable IDs", () => {
    const config: CLIConfig = {
      chainId: 42161,
      keyStore: {
        kind: "1password",
        vaultId: "abcd1234vaultid26char0001",
        itemId: "efgh5678itemid26char00002",
        address: TEST_ADDRESS,
        label: "MoneyOS main wallet",
      },
    };
    saveConfig(config, configPath);

    const loaded = loadFileConfig(configPath);
    expect(loaded.keyStore?.kind).toBe("1password");
    expect(loaded.keyStore?.vaultId).toBe("abcd1234vaultid26char0001");
    expect(loaded.keyStore?.itemId).toBe("efgh5678itemid26char00002");
    expect(loaded.keyStore?.address).toBe(TEST_ADDRESS);
    expect(loaded.keyStore?.label).toBe("MoneyOS main wallet");
    expect(loaded.privateKey).toBeUndefined();
  });

  it("tolerates privateKey and keyStore coexisting (no schema enforcement)", () => {
    // Transitional state during a migration: both may be present. The
    // config schema must NOT reject this — enforcement lives at the
    // resolution/command layer, not here.
    const transitional: CLIConfig = {
      chainId: 42161,
      privateKey: TEST_PK,
      keyStore: {
        kind: "1password",
        vaultId: "v1",
        itemId: "i1",
      },
    };
    saveConfig(transitional, configPath);

    const loaded = loadFileConfig(configPath);
    expect(loaded.privateKey).toBe(TEST_PK);
    expect(loaded.keyStore?.kind).toBe("1password");
    expect(loaded.keyStore?.vaultId).toBe("v1");
    expect(loaded.keyStore?.itemId).toBe("i1");
  });

  it("saveConfig creates the parent directory for a custom path", () => {
    const nestedPath = join(tmpDir, "nested", "subdir", "config.json");
    const config: CLIConfig = {
      chainId: 42161,
      keyStore: { kind: "file" },
    };
    saveConfig(config, nestedPath);

    const loaded = loadFileConfig(nestedPath);
    expect(loaded.chainId).toBe(42161);
    expect(loaded.keyStore?.kind).toBe("file");
  });

  it("missing file returns an empty config", () => {
    const missingPath = join(tmpDir, "does-not-exist.json");
    const loaded = loadFileConfig(missingPath);
    expect(loaded).toEqual({});
  });
});
