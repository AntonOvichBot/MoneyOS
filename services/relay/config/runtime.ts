import fs from "node:fs";
import path from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import type { PolicyConfig } from "../src/policy/types.js";

const DEFAULT_FACTORY_SALT = "0x661dc84e663a6c53a7d8c503cd081a8242171c4ee21f5f559d01e1b71d9a8de1" as const;

export interface RateLimitConfig {
  perUserPerDayTx: number;
  perUserPerHourTx: number;
  perStationPerDayTx: number;
  perTxMaxGasWei: bigint;
}

export interface HotWalletConfig {
  minBalanceWei: bigint;
  autoRefillThresholdWei: bigint;
}

export interface RuntimeConfig {
  host: string;
  port: number;
  logLevel: string;
  rpcUrl: string;
  chainId: number;
  sqlitePath: string;
  policyPath: string;
  sponsorPrivateKey: `0x${string}`;
  relayAddress: `0x${string}`;
  accountFactoryAddress?: `0x${string}`;
  accountFactorySalt: `0x${string}`;
  killSwitch: boolean;
  confirmPollMs: number;
  rateLimit: RateLimitConfig;
  hotWallet: HotWalletConfig;
}

function parseNumber(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}: expected positive number, got "${value}".`);
  }

  return parsed;
}

function parseBigint(name: string, value: string | undefined, fallback: bigint): bigint {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  try {
    const parsed = BigInt(value);
    if (parsed <= 0n) {
      throw new Error("non-positive");
    }
    return parsed;
  } catch {
    throw new Error(`Invalid ${name}: expected positive bigint string, got "${value}".`);
  }
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`Invalid boolean value "${value}".`);
}

function parseAddress(name: string, value: string | undefined): `0x${string}` {
  if (!value || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Invalid ${name}: expected 0x-prefixed 20-byte address.`);
  }

  return value as `0x${string}`;
}

function parsePrivateKey(name: string, value: string | undefined): `0x${string}` {
  if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`Missing or invalid ${name}: expected 0x-prefixed 32-byte private key.`);
  }

  return value as `0x${string}`;
}

function parseHex32(name: string, value: string | undefined, fallback: `0x${string}`): `0x${string}` {
  const candidate = value?.trim() || fallback;
  if (!/^0x[0-9a-fA-F]{64}$/.test(candidate)) {
    throw new Error(`Invalid ${name}: expected 32-byte hex string.`);
  }

  return candidate as `0x${string}`;
}

function pickEnv(env: NodeJS.ProcessEnv, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = env[name];
    if (value !== undefined && value.trim() !== "") {
      return value;
    }
  }

  return undefined;
}

function resolvePolicyPath(explicit: string | undefined): string {
  const candidates = [
    explicit,
    path.resolve(process.cwd(), "config/policy.arbitrum.json"),
    path.resolve(process.cwd(), "services/relay/config/policy.arbitrum.json"),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0]!;
}

function defaultSqlitePath(): string {
  if (process.platform === "darwin") {
    return path.join(process.env.HOME ?? process.cwd(), "Library", "Application Support", "MoneyOS Relay", "relay.sqlite");
  }
  if (process.platform === "linux") {
    return "/var/lib/moneyos-relay/relay.sqlite";
  }
  return path.resolve(process.cwd(), "data/relay.sqlite");
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const sponsorPrivateKey = parsePrivateKey(
    "MONEYOS_RELAY_SPONSOR_PRIVATE_KEY",
    env.MONEYOS_RELAY_SPONSOR_PRIVATE_KEY,
  );

  const derivedRelayAddress = privateKeyToAccount(sponsorPrivateKey).address;
  const relayAddress =
    env.MONEYOS_RELAY_ADDRESS === undefined
      ? derivedRelayAddress
      : parseAddress("MONEYOS_RELAY_ADDRESS", env.MONEYOS_RELAY_ADDRESS);

  const perTxMaxGasWei = parseBigint(
    "MONEYOS_RELAY_PER_TX_MAX_GAS_WEI",
    pickEnv(env, "MONEYOS_RELAY_PER_TX_MAX_GAS_WEI"),
    500_000_000_000_000n,
  );

  const minBalanceWei = parseBigint(
    "MONEYOS_RELAY_HOT_WALLET_MIN_BALANCE_WEI",
    env.MONEYOS_RELAY_HOT_WALLET_MIN_BALANCE_WEI,
    perTxMaxGasWei,
  );

  const autoRefillThresholdWei = parseBigint(
    "MONEYOS_RELAY_HOT_WALLET_AUTO_REFILL_THRESHOLD_WEI",
    env.MONEYOS_RELAY_HOT_WALLET_AUTO_REFILL_THRESHOLD_WEI,
    2_000_000_000_000_000n,
  );

  if (autoRefillThresholdWei < minBalanceWei) {
    throw new Error(
      "Invalid hot-wallet thresholds: MONEYOS_RELAY_HOT_WALLET_AUTO_REFILL_THRESHOLD_WEI must be >= MONEYOS_RELAY_HOT_WALLET_MIN_BALANCE_WEI.",
    );
  }

  const accountFactoryAddress = env.MONEYOS_RELAY_ACCOUNT_FACTORY_ADDRESS?.trim()
    ? parseAddress("MONEYOS_RELAY_ACCOUNT_FACTORY_ADDRESS", env.MONEYOS_RELAY_ACCOUNT_FACTORY_ADDRESS)
    : undefined;

  return {
    host: env.MONEYOS_RELAY_HOST?.trim() || "0.0.0.0",
    port: parseNumber("MONEYOS_RELAY_PORT", env.MONEYOS_RELAY_PORT, 8787),
    logLevel: env.MONEYOS_RELAY_LOG_LEVEL?.trim() || "info",
    rpcUrl: env.MONEYOS_RELAY_RPC_URL?.trim() || "http://127.0.0.1:8545",
    chainId: parseNumber("MONEYOS_RELAY_CHAIN_ID", env.MONEYOS_RELAY_CHAIN_ID, 42161),
    sqlitePath: env.MONEYOS_RELAY_DB_PATH?.trim() || defaultSqlitePath(),
    policyPath: resolvePolicyPath(env.MONEYOS_RELAY_POLICY_PATH?.trim()),
    sponsorPrivateKey,
    relayAddress,
    accountFactoryAddress,
    accountFactorySalt: parseHex32(
      "MONEYOS_RELAY_ACCOUNT_FACTORY_SALT",
      env.MONEYOS_RELAY_ACCOUNT_FACTORY_SALT,
      DEFAULT_FACTORY_SALT,
    ),
    killSwitch: parseBoolean(env.MONEYOS_RELAY_KILL_SWITCH, false),
    confirmPollMs: parseNumber("MONEYOS_RELAY_CONFIRM_POLL_MS", env.MONEYOS_RELAY_CONFIRM_POLL_MS, 5000),
    rateLimit: {
      perUserPerDayTx: parseNumber(
        "MONEYOS_RELAY_PER_USER_PER_DAY_TX",
        pickEnv(env, "MONEYOS_RELAY_PER_USER_PER_DAY_TX", "MONEYOS_RELAY_WALLET_MAX_TX"),
        20,
      ),
      perUserPerHourTx: parseNumber(
        "MONEYOS_RELAY_PER_USER_PER_HOUR_TX",
        env.MONEYOS_RELAY_PER_USER_PER_HOUR_TX,
        5,
      ),
      perStationPerDayTx: parseNumber(
        "MONEYOS_RELAY_PER_STATION_PER_DAY_TX",
        pickEnv(env, "MONEYOS_RELAY_PER_STATION_PER_DAY_TX", "MONEYOS_RELAY_GLOBAL_MAX_TX"),
        2000,
      ),
      perTxMaxGasWei,
    },
    hotWallet: {
      minBalanceWei,
      autoRefillThresholdWei,
    },
  };
}

export function loadPolicyConfig(policyPath: string, runtime: RuntimeConfig): PolicyConfig {
  const raw = fs.readFileSync(policyPath, "utf8");
  const parsed = JSON.parse(raw) as PolicyConfig;

  return {
    ...parsed,
    chainId: runtime.chainId,
    relayAddress: runtime.relayAddress,
  };
}
