import fs from "node:fs";
import path from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import type { PolicyConfig } from "../src/policy/types.js";

const DEFAULT_DEV_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f094538f7d0f8f2f3f4d5c6e7f8090a1b2c3d4e5" as const;

export interface RateLimitConfig {
  windowSeconds: number;
  walletMaxTx: number;
  walletMaxGasWei: bigint;
  globalMaxTx: number;
  globalMaxGasWei: bigint;
  perTxMaxGasWei: bigint;
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
  killSwitch: boolean;
  confirmPollMs: number;
  rateLimit: RateLimitConfig;
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
  const sponsorPrivateKey =
    (env.MONEYOS_RELAY_SPONSOR_PRIVATE_KEY as `0x${string}` | undefined) ??
    DEFAULT_DEV_PRIVATE_KEY;

  const derivedRelayAddress = privateKeyToAccount(sponsorPrivateKey).address;
  const relayAddress =
    (env.MONEYOS_RELAY_ADDRESS as `0x${string}` | undefined) ?? derivedRelayAddress;

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
    killSwitch: parseBoolean(env.MONEYOS_RELAY_KILL_SWITCH, false),
    confirmPollMs: parseNumber("MONEYOS_RELAY_CONFIRM_POLL_MS", env.MONEYOS_RELAY_CONFIRM_POLL_MS, 5000),
    rateLimit: {
      windowSeconds: parseNumber(
        "MONEYOS_RELAY_RATE_LIMIT_WINDOW_SECONDS",
        env.MONEYOS_RELAY_RATE_LIMIT_WINDOW_SECONDS,
        60 * 60 * 24,
      ),
      walletMaxTx: parseNumber("MONEYOS_RELAY_WALLET_MAX_TX", env.MONEYOS_RELAY_WALLET_MAX_TX, 3),
      walletMaxGasWei: parseBigint(
        "MONEYOS_RELAY_WALLET_MAX_GAS_WEI",
        env.MONEYOS_RELAY_WALLET_MAX_GAS_WEI,
        1_000_000_000_000_000n,
      ),
      globalMaxTx: parseNumber("MONEYOS_RELAY_GLOBAL_MAX_TX", env.MONEYOS_RELAY_GLOBAL_MAX_TX, 200),
      globalMaxGasWei: parseBigint(
        "MONEYOS_RELAY_GLOBAL_MAX_GAS_WEI",
        env.MONEYOS_RELAY_GLOBAL_MAX_GAS_WEI,
        30_000_000_000_000_000n,
      ),
      perTxMaxGasWei: parseBigint(
        "MONEYOS_RELAY_PER_TX_MAX_GAS_WEI",
        env.MONEYOS_RELAY_PER_TX_MAX_GAS_WEI,
        800_000_000_000_000n,
      ),
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
