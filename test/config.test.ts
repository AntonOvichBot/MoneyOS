import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hex } from "viem";
import {
  getLegacyPlaintextWalletStorageMessage,
  getRemovedOnePasswordCachedAddress,
  getRemovedOnePasswordStorageMessage,
  hasLegacyPlaintextWalletConfig,
  hasRemovedOnePasswordConfig,
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

  it("MONEYOS_PRIVATE_KEY remains an explicit env override", () => {
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

  it("MONEYOS_CHAIN_ID rejects invalid values", () => {
    process.env.MONEYOS_CHAIN_ID = "abc";
    expect(() => loadConfig()).toThrow('Invalid MONEYOS_CHAIN_ID: "abc"');
  });
});

describe("CLIConfig file schema", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "moneyos-cli-cfg-"));
    configPath = join(tmpDir, "config.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("round-trips non-secret config settings", () => {
    const config: CLIConfig = {
      chainId: 42161,
      rpcUrl: "https://arb1.arbitrum.io/rpc",
      walletPath: join(tmpDir, "wallet.json"),
      backupDir: join(tmpDir, "backups"),
    };
    saveConfig(config, configPath);

    const loaded = loadFileConfig(configPath);
    expect(loaded).toEqual(config);
  });

  it("never persists plaintext private keys", () => {
    const config: CLIConfig = {
      chainId: 42161,
      privateKey:
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    };
    saveConfig(config, configPath);

    const loaded = loadFileConfig(configPath);
    expect(loaded.privateKey).toBeUndefined();
    expect(loaded.chainId).toBe(42161);
  });

  it("missing file returns an empty config", () => {
    const missingPath = join(tmpDir, "does-not-exist.json");
    expect(loadFileConfig(missingPath)).toEqual({});
  });
});

describe("legacy config detection", () => {
  const removedConfig = {
    keyStore: {
      kind: "1password",
      address: "0x1234567890123456789012345678901234567890",
    },
  } as CLIConfig;

  const legacyPlaintext = {
    privateKey:
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex,
  };

  it("detects a removed 1Password-backed config shape", () => {
    expect(hasRemovedOnePasswordConfig(removedConfig)).toBe(true);
    expect(hasRemovedOnePasswordConfig({})).toBe(false);
  });

  it("returns cached address metadata when present", () => {
    expect(getRemovedOnePasswordCachedAddress(removedConfig)).toBe(
      "0x1234567890123456789012345678901234567890",
    );
  });

  it("returns the clear removal message", () => {
    expect(getRemovedOnePasswordStorageMessage()).toMatch(
      /no longer supports the old 1Password-backed private-key storage path/i,
    );
  });

  it("detects legacy plaintext wallet configs", () => {
    expect(hasLegacyPlaintextWalletConfig(legacyPlaintext)).toBe(true);
    expect(hasLegacyPlaintextWalletConfig({})).toBe(false);
  });

  it("returns the plaintext upgrade message", () => {
    expect(getLegacyPlaintextWalletStorageMessage()).toMatch(
      /plaintext local wallet configs are no longer used/i,
    );
  });
});
