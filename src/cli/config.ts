import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { Address, Hex } from "viem";

const CONFIG_DIR = join(homedir(), ".moneyos");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

/**
 * Local CLI configuration persisted at `~/.moneyos/config.json`.
 *
 * The `privateKey` field is the legacy file-backed storage shortcut. The
 * optional `keyStore` field is the forward-looking descriptor of *how* the
 * wallet is stored — either in the file itself (`kind: "file"`) or in an
 * external secret manager like 1Password (`kind: "1password"`).
 *
 * Tolerance rule: this layer does NOT enforce exclusivity between
 * `privateKey` and `keyStore`. Both may be present simultaneously, e.g.
 * during a migration. The resolution and command layers (where transitional
 * states are understood) are responsible for deciding which source wins.
 */
export interface CLIConfig {
  chainId?: number;
  rpcUrl?: string;
  /** Legacy file-backed private key. Kept for backward compatibility. */
  privateKey?: Hex;
  /**
   * Descriptor of the active key store. Absent for legacy configs and for
   * brand-new configs that still use the file-backed default.
   */
  keyStore?: {
    kind: "file" | "1password";
    /**
     * Stable identifier set for the 1password kind — the only fields
     * MoneyOS relies on for lookups. Persisted verbatim from the `op` CLI
     * response. Absent for `kind: "file"`.
     */
    vaultId?: string;
    itemId?: string;
    /** Display cache only. Never used for lookups; safe to drop or refresh. */
    address?: Address;
    /** Optional human-readable label. */
    label?: string;
  };
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
