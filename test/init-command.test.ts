import { describe, it, expect, afterEach } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hex } from "viem";
import { FileBackupProvider } from "../src/core/backup-file.js";
import { FileEncryptedWalletStore } from "../src/core/encrypted-wallet.js";
import {
  getBackupDir,
  getLegacyPlaintextWalletStorageMessage,
  getRemovedOnePasswordStorageMessage,
  getWalletPath,
  hasLegacyPlaintextWalletConfig,
  hasRemovedOnePasswordConfig,
  loadFileConfig,
  saveConfig,
  type CLIConfig,
} from "../src/cli/config.js";
import {
  runInitCommand,
  type InitCommandDependencies,
  type InitCommandOptions,
} from "../src/cli/commands/init.js";

const TEST_PK: Hex =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ALT_PK: Hex =
  "0x59c6995e998f97a5a0044966f094538e6f2f0a38d7c7d0b7e54b5f3c7f4e6a15";

function createInitTestContext(params: {
  config: CLIConfig;
  prompts?: string[];
  generatedPrivateKey?: Hex;
}): {
  tmpDir: string;
  configPath: string;
  walletPath: string;
  backupDir: string;
  logs: string[];
  errors: string[];
  deps: InitCommandDependencies;
} {
  const tmpDir = mkdtempSync(join(tmpdir(), "moneyos-init-command-"));
  const configPath = join(tmpDir, "config.json");
  const walletPath = params.config.walletPath ?? join(tmpDir, "wallet.json");
  const backupDir = params.config.backupDir ?? join(tmpDir, "backups");
  const logs: string[] = [];
  const errors: string[] = [];
  const prompts = [...(params.prompts ?? ["secret passphrase", "secret passphrase"])];

  writeFileSync(
    configPath,
    JSON.stringify(
      {
        chainId: 42161,
        walletPath,
        backupDir,
        ...params.config,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );

  const deps: InitCommandDependencies = {
    loadFileConfig: () => loadFileConfig(configPath),
    getWalletPath,
    getBackupDir,
    getConfigPath: () => configPath,
    createWalletStore: (path) => new FileEncryptedWalletStore(path),
    createBackupProvider: (providerParams) => new FileBackupProvider(providerParams),
    hasRemovedOnePasswordConfig,
    getRemovedOnePasswordStorageMessage,
    hasLegacyPlaintextWalletConfig,
    getLegacyPlaintextWalletStorageMessage,
    promptHidden: async () => {
      const next = prompts.shift();
      if (next === undefined) {
        throw new Error("Unexpected password prompt.");
      }
      return next;
    },
    lockSession: async () => false,
    getSessionSocketPath: () => join(tmpDir, "session.sock"),
    getSessionTokenPath: () => join(tmpDir, "session.token"),
    saveConfig: (config) => saveConfig(config, configPath),
    generatePrivateKey: () => params.generatedPrivateKey ?? TEST_PK,
    log: (message) => logs.push(message),
    error: (message) => errors.push(message),
  };

  return {
    tmpDir,
    configPath,
    walletPath,
    backupDir,
    logs,
    errors,
    deps,
  };
}

afterEach(() => {
  process.exitCode = undefined;
});

describe("runInitCommand", () => {
  it("auto-migrates a legacy plaintext wallet config without --key", async () => {
    const ctx = createInitTestContext({
      config: {
        privateKey: TEST_PK,
      },
    });

    try {
      await runInitCommand({}, ctx.deps);

      const wallet = new FileEncryptedWalletStore(ctx.walletPath);
      expect(await wallet.decrypt("secret passphrase")).toBe(TEST_PK);

      const saved = loadFileConfig(ctx.configPath);
      expect(saved.privateKey).toBeUndefined();
      expect(saved.walletPath).toBe(ctx.walletPath);
      expect(saved.backupDir).toBe(ctx.backupDir);

      expect(ctx.logs.join("\n")).toContain(
        "Imported legacy plaintext wallet into the encrypted wallet file.",
      );
      expect(ctx.logs.join("\n")).toContain(
        getLegacyPlaintextWalletStorageMessage(),
      );
      expect(readdirSync(ctx.backupDir)).toHaveLength(1);
    } finally {
      rmSync(ctx.tmpDir, { recursive: true, force: true });
    }
  });

  it("overwrites an existing wallet when --force is passed", async () => {
    const ctx = createInitTestContext({
      config: {},
      generatedPrivateKey: TEST_PK,
    });
    const existingWallet = new FileEncryptedWalletStore(ctx.walletPath);

    try {
      await existingWallet.save({
        privateKey: ALT_PK,
        passphrase: "old passphrase",
      });

      await runInitCommand({ force: true }, ctx.deps);

      const wallet = new FileEncryptedWalletStore(ctx.walletPath);
      expect(await wallet.decrypt("secret passphrase")).toBe(TEST_PK);
      await expect(wallet.decrypt("old passphrase")).rejects.toThrow(
        /invalid password or corrupted wallet/i,
      );
      expect(ctx.logs.join("\n")).toContain(
        "This is a new account. Fund it before sending transactions.",
      );
    } finally {
      rmSync(ctx.tmpDir, { recursive: true, force: true });
    }
  });

  it("fails cleanly for malformed hex passed to --key", async () => {
    const ctx = createInitTestContext({
      config: {},
      prompts: [],
    });
    let prompted = false;
    ctx.deps.promptHidden = async () => {
      prompted = true;
      return "unused";
    };

    try {
      const options: InitCommandOptions = {
        key: "0x1234",
      };
      await runInitCommand(options, ctx.deps);

      expect(prompted).toBe(false);
      expect(process.exitCode).toBe(1);
      expect(existsSync(ctx.walletPath)).toBe(false);
      expect(ctx.errors).toHaveLength(1);
      expect(ctx.errors[0]).toMatch(/private key|hex|bytes|size/i);
    } finally {
      rmSync(ctx.tmpDir, { recursive: true, force: true });
    }
  });
});
