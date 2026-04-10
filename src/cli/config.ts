import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { Address, Hex } from "viem";

const CONFIG_DIR = join(homedir(), ".moneyos");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

/**
 * Local CLI configuration persisted at `~/.moneyos/config.json`.
 *
 * Current landed storage is a local file-backed private key at the CLI layer.
 * The longer-term encrypted-wallet design is intentionally not represented in
 * this schema yet.
 */
export interface CLIConfig {
  chainId?: number;
  rpcUrl?: string;
  /** Local file-backed private key used by the current landed CLI path. */
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

  return config;
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
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  writeFileSync(path, JSON.stringify(config, null, 2), {
    mode: 0o600,
  });
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}
