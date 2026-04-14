import type { Address } from "viem";
import type { GaslessExecutionConfig } from "../core/gasless.js";
import { parseBooleanEnv, type CLIConfig } from "./config.js";

const GASLESS_ENABLED_ENV = "MONEYOS_GASLESS_ENABLED";
const GASLESS_RELAY_URL_ENV = "MONEYOS_GASLESS_RELAY_URL";
const GASLESS_ACCOUNT_ENV = "MONEYOS_GASLESS_ACCOUNT";
const GASLESS_SPONSOR_ENV = "MONEYOS_GASLESS_SPONSOR";
const GASLESS_NONCE_KEY_ENV = "MONEYOS_GASLESS_NONCE_KEY";
const GASLESS_VALIDITY_WINDOW_ENV = "MONEYOS_GASLESS_VALIDITY_WINDOW_SECONDS";

interface EnvLike {
  [key: string]: string | undefined;
}

function parseAddress(value: string, key: string): Address {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`Invalid ${key}: "${value}" — expected a 20-byte hex address.`);
  }
  return value as Address;
}

function parseOptionalBigInt(value: string | undefined, key: string): bigint | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  const trimmed = value.trim();
  try {
    const parsed = BigInt(trimmed);
    if (parsed < 0n) {
      throw new Error();
    }
    return parsed;
  } catch {
    throw new Error(`Invalid ${key}: "${value}" — expected a non-negative integer.`);
  }
}

function parseOptionalPositiveInt(value: string | undefined, key: string): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${key}: "${value}" — expected a positive integer.`);
  }
  return parsed;
}

export function isGaslessEnabled(
  config: CLIConfig,
  env: EnvLike = process.env,
): boolean {
  const envOverride = env[GASLESS_ENABLED_ENV];
  if (envOverride !== undefined) {
    return parseBooleanEnv(envOverride, GASLESS_ENABLED_ENV);
  }

  return config.gasless?.enabled === true;
}

export function getGaslessRequiredEnvPresence(
  env: EnvLike = process.env,
): Record<string, boolean> {
  return {
    [GASLESS_RELAY_URL_ENV]: Boolean(env[GASLESS_RELAY_URL_ENV]?.trim()),
    [GASLESS_ACCOUNT_ENV]: Boolean(env[GASLESS_ACCOUNT_ENV]?.trim()),
    [GASLESS_SPONSOR_ENV]: Boolean(env[GASLESS_SPONSOR_ENV]?.trim()),
  };
}

export function resolveGaslessExecutionConfig(
  config: CLIConfig,
  env: EnvLike = process.env,
): GaslessExecutionConfig | undefined {
  if (!isGaslessEnabled(config, env)) {
    return undefined;
  }

  const relayUrl = env[GASLESS_RELAY_URL_ENV]?.trim() ?? "";
  const accountValue = env[GASLESS_ACCOUNT_ENV]?.trim() ?? "";
  const sponsorValue = env[GASLESS_SPONSOR_ENV]?.trim() ?? "";

  const missing: string[] = [];
  if (!relayUrl) missing.push(GASLESS_RELAY_URL_ENV);
  if (!accountValue) missing.push(GASLESS_ACCOUNT_ENV);
  if (!sponsorValue) missing.push(GASLESS_SPONSOR_ENV);

  if (missing.length > 0) {
    throw new Error(
      `Gasless mode is enabled but missing required environment variables: ${missing.join(", ")}.`,
    );
  }

  return {
    relayUrl,
    account: parseAddress(accountValue, GASLESS_ACCOUNT_ENV),
    sponsor: parseAddress(sponsorValue, GASLESS_SPONSOR_ENV),
    nonceKey: parseOptionalBigInt(env[GASLESS_NONCE_KEY_ENV], GASLESS_NONCE_KEY_ENV),
    validityWindowSeconds: parseOptionalPositiveInt(
      env[GASLESS_VALIDITY_WINDOW_ENV],
      GASLESS_VALIDITY_WINDOW_ENV,
    ),
  };
}

export const gaslessEnvVarNames = {
  enabled: GASLESS_ENABLED_ENV,
  relayUrl: GASLESS_RELAY_URL_ENV,
  account: GASLESS_ACCOUNT_ENV,
  sponsor: GASLESS_SPONSOR_ENV,
  nonceKey: GASLESS_NONCE_KEY_ENV,
  validityWindowSeconds: GASLESS_VALIDITY_WINDOW_ENV,
} as const;
