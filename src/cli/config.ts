import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { Address, Hex } from "viem";

const CONFIG_DIR = join(homedir(), ".moneyos");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

/**
 * Local CLI configuration persisted at `~/.moneyos/config.json`.
 *
 * Only non-secret settings should be persisted here. Wallet secrets now live
 * in the encrypted wallet file, while `privateKey` remains as a legacy-only
 * field so older configs can be detected and upgraded through `moneyos init`.
 */
export interface CLIConfig {
  chainId?: number;
  rpcUrl?: string;
  walletPath?: string;
  backupDir?: string;
  gasless?: {
    enabled?: boolean;
    relayUrl?: string;
    account?: string;
    sponsor?: string;
  };
  /**
   * Legacy plaintext wallet field from earlier MoneyOS versions. This should
   * never be written by the current CLI.
   */
  privateKey?: Hex;
}

interface RemovedOnePasswordConfigShape {
  keyStore?: {
    kind?: unknown;
    address?: unknown;
  };
}

export function hasRemovedOnePasswordConfig(config: CLIConfig): boolean {
  return (
    (config as CLIConfig & RemovedOnePasswordConfigShape).keyStore?.kind ===
    "1password"
  );
}

export function getRemovedOnePasswordCachedAddress(
  config: CLIConfig,
): Address | undefined {
  const address = (config as CLIConfig & RemovedOnePasswordConfigShape)
    .keyStore?.address;
  return typeof address === "string" ? (address as Address) : undefined;
}

export function getRemovedOnePasswordStorageMessage(): string {
  return "This repo no longer supports the old 1Password-backed private-key storage path. Re-import the wallet into the local file path with `moneyos init --key <privateKey>`.";
}

/**
 * Read the CLI config file.
 *
 * @param path Optional absolute path to the config file. Defaults to
 *   `~/.moneyos/config.json`. Primarily exposed so tests can point at a
 *   tmpdir without mocking `homedir`.
 */
export function loadFileConfig(path: string = CONFIG_FILE): CLIConfig {
  if (!existsSync(path)) {
    return {};
  }
  return JSON.parse(readFileSync(path, "utf-8")) as CLIConfig;
}

export function loadConfig(): CLIConfig {
  const config: CLIConfig = { ...loadFileConfig() };

  // Env vars override file config — standard for agents/CI
  if (process.env.MONEYOS_PRIVATE_KEY) {
    config.privateKey = process.env.MONEYOS_PRIVATE_KEY as Hex;
  }
  if (process.env.MONEYOS_RPC_URL) {
    config.rpcUrl = process.env.MONEYOS_RPC_URL;
  }
  if (process.env.MONEYOS_CHAIN_ID) {
    const parsed = Number(process.env.MONEYOS_CHAIN_ID);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(
        `Invalid MONEYOS_CHAIN_ID: "${process.env.MONEYOS_CHAIN_ID}" — must be a positive integer`,
      );
    }
    config.chainId = parsed;
  }
  if (process.env.MONEYOS_GASLESS_ENABLED !== undefined) {
    config.gasless = {
      ...config.gasless,
      enabled: parseBooleanEnv(
        process.env.MONEYOS_GASLESS_ENABLED,
        "MONEYOS_GASLESS_ENABLED",
      ),
    };
  }

  return config;
}

export function parseBooleanEnv(value: string, key: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(
    `Invalid ${key}: "${value}" — expected true/false, 1/0, yes/no, or on/off`,
  );
}

/**
 * Write the CLI config file.
 *
 * @param config The config to persist.
 * @param path Optional absolute path to the config file. Defaults to
 *   `~/.moneyos/config.json`. Primarily exposed so tests can point at a
 *   tmpdir without mocking `homedir`. When a custom path is passed, the
 *   parent directory is created with mode 0o700 if it does not already
 *   exist.
 */
export function saveConfig(
  config: CLIConfig,
  path: string = CONFIG_FILE,
): void {
  const safeConfig = { ...config };
  delete safeConfig.privateKey;
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  writeFileSync(path, JSON.stringify(safeConfig, null, 2), {
    mode: 0o600,
  });
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

export function getMoneyOSDir(): string {
  return CONFIG_DIR;
}

export function getToolHomeDir(): string {
  return join(CONFIG_DIR, "tools");
}

export function getToolHomePackageJsonPath(): string {
  return join(getToolHomeDir(), "package.json");
}

export function getToolHomeLockPath(): string {
  return join(getToolHomeDir(), "package-lock.json");
}

export function getToolHomeNodeModulesPath(): string {
  return join(getToolHomeDir(), "node_modules");
}

export function getToolRegistryPath(): string {
  return join(getToolHomeDir(), "registry.json");
}

export function getWalletPath(config?: CLIConfig): string {
  return config?.walletPath ?? join(CONFIG_DIR, "wallet.json");
}

export function getContactsPath(): string {
  return join(CONFIG_DIR, "contacts.json");
}

export function getBackupDir(config?: CLIConfig): string {
  return config?.backupDir ?? join(CONFIG_DIR, "backups");
}

export function getSessionSocketPath(): string {
  if (process.platform === "win32") {
    const suffix = createHash("sha256")
      .update(CONFIG_DIR)
      .digest("hex")
      .slice(0, 16);
    return `\\\\.\\pipe\\moneyos-session-${suffix}`;
  }

  return join(CONFIG_DIR, "session.sock");
}

export function getSessionTokenPath(): string {
  return join(CONFIG_DIR, "session.token");
}

export function hasLegacyPlaintextWalletConfig(config: CLIConfig): boolean {
  return typeof config.privateKey === "string";
}

export function getLegacyPlaintextWalletStorageMessage(): string {
  return "Plaintext local wallet configs are no longer used for runtime access. Run `moneyos init` locally to encrypt your wallet into the new MoneyOS wallet file.";
}
