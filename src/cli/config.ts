import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Hex } from "viem";

const CONFIG_DIR = join(homedir(), ".moneyos");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export interface CLIConfig {
  chainId?: number;
  rpcUrl?: string;
  privateKey?: Hex;
}

export function loadFileConfig(): CLIConfig {
  if (!existsSync(CONFIG_FILE)) {
    return {};
  }
  return JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) as CLIConfig;
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

export function saveConfig(config: CLIConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), {
    mode: 0o600,
  });
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}
