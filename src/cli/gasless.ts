import type { Address } from "viem";
import {
  deriveDefaultGaslessAccount,
  getGaslessNetworkDefaults,
} from "@moneyos/gasless";
import type { GaslessExecutionConfig } from "../core/gasless.js";
import type { CLIConfig } from "./config.js";

const GASLESS_ENABLED_ENV = "MONEYOS_GASLESS_ENABLED";
const GASLESS_RELAY_URL_ENV = "MONEYOS_GASLESS_RELAY_URL";
const GASLESS_ACCOUNT_ENV = "MONEYOS_GASLESS_ACCOUNT";
const GASLESS_SPONSOR_ENV = "MONEYOS_GASLESS_SPONSOR";

export const gaslessEnvVarNames = {
  enabled: GASLESS_ENABLED_ENV,
  relayUrl: GASLESS_RELAY_URL_ENV,
  account: GASLESS_ACCOUNT_ENV,
  sponsor: GASLESS_SPONSOR_ENV,
} as const;

function parseGaslessEnabledEnv(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

export function isGaslessEnabled(config: CLIConfig): boolean {
  if (typeof process.env[GASLESS_ENABLED_ENV] === "string") {
    return parseGaslessEnabledEnv(process.env[GASLESS_ENABLED_ENV]);
  }

  return config.gasless?.enabled === true;
}

export function getGaslessRequiredEnvPresence(config: CLIConfig): {
  relayUrl: boolean;
  account: boolean;
  sponsor: boolean;
} {
  const defaults = config.chainId
    ? getGaslessNetworkDefaults(config.chainId)
    : undefined;

  return {
    relayUrl: Boolean(
      process.env[GASLESS_RELAY_URL_ENV] ??
        config.gasless?.relayUrl ??
        defaults?.relayUrl,
    ),
    account: Boolean(process.env[GASLESS_ACCOUNT_ENV] ?? config.gasless?.account),
    sponsor: Boolean(
      process.env[GASLESS_SPONSOR_ENV] ??
        config.gasless?.sponsor ??
        defaults?.sponsor,
    ),
  };
}

export async function resolveGaslessExecutionConfig(
  config: CLIConfig,
  options: {
    ownerAddress?: Address;
    rpcUrl?: string;
    chainId?: number;
  } = {},
): Promise<GaslessExecutionConfig | undefined> {
  if (!isGaslessEnabled(config)) {
    return undefined;
  }

  const chainId = options.chainId ?? config.chainId;
  const defaults = chainId ? getGaslessNetworkDefaults(chainId) : undefined;
  const relayUrl =
    process.env[GASLESS_RELAY_URL_ENV] ??
    config.gasless?.relayUrl ??
    defaults?.relayUrl;
  const sponsor =
    (process.env[GASLESS_SPONSOR_ENV] as Address | undefined) ??
    (config.gasless?.sponsor as Address | undefined) ??
    defaults?.sponsor;

  let account =
    (process.env[GASLESS_ACCOUNT_ENV] as Address | undefined) ??
    (config.gasless?.account as Address | undefined);

  if (!account && chainId && options.ownerAddress) {
    account = await deriveDefaultGaslessAccount({
      chainId,
      owner: options.ownerAddress,
      rpcUrl: options.rpcUrl,
    });
  }

  if (!relayUrl || !account || !sponsor) {
    return undefined;
  }

  return { relayUrl, account, sponsor };
}
