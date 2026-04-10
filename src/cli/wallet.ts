import type { MoneyOSConfig } from "@moneyos/core";
import type { Account, Address, Hex } from "viem";
import { FileKeyStore } from "../core/keystore-file.js";
import { privateKeyToManagedAccount } from "../core/signer.js";
import { getConfigPath } from "./config.js";
import {
  getRemovedOnePasswordStorageMessage,
  hasRemovedOnePasswordConfig,
  type CLIConfig,
} from "./config.js";

export type CliWalletBackendKind = "env" | "file";

export interface ResolvedCliSigner {
  kind: CliWalletBackendKind;
  signer: Account;
  address: Address;
}

export interface ResolvedCliAddress {
  kind: CliWalletBackendKind;
  address: Address;
  source: "env" | "local-file";
}

export interface ResolveCliSignerOptions {
  configPath?: string;
  envPrivateKey?: Hex;
}

export interface BuildCliMoneyOSConfigOptions
  extends ResolveCliSignerOptions {
  chainId?: number;
  requireSigner?: boolean;
}

function resolveEnvPrivateKey(explicit?: Hex): Hex | undefined {
  return explicit ?? (process.env.MONEYOS_PRIVATE_KEY as Hex | undefined);
}

/**
 * Resolve the signer the CLI should use for "my wallet" operations.
 *
 * Precedence is deliberate:
 * 1. `MONEYOS_PRIVATE_KEY` env var for ephemeral agent/CI usage.
 * 2. Local file-backed config.
 */
export async function loadCliSigner(
  config: CLIConfig,
  options: ResolveCliSignerOptions = {},
): Promise<ResolvedCliSigner> {
  const envPrivateKey = resolveEnvPrivateKey(options.envPrivateKey);
  if (envPrivateKey) {
    const signer = privateKeyToManagedAccount(envPrivateKey);
    return {
      kind: "env",
      signer,
      address: signer.address,
    };
  }

  if (hasRemovedOnePasswordConfig(config)) {
    throw new Error(getRemovedOnePasswordStorageMessage());
  }

  if (config.privateKey) {
    const store = new FileKeyStore({
      configPath: options.configPath ?? getConfigPath(),
    });
    const signer = await store.loadSigner();
    return {
      kind: "file",
      signer,
      address: signer.address,
    };
  }

  throw new Error("No wallet configured. Run `moneyos init`.");
}

/**
 * Resolve the address the CLI should use for read-only "my wallet" commands.
 *
 * This prefers cheap local metadata over signer loading so read-only balance
 * checks stay lightweight.
 */
export async function loadCliAddress(
  config: CLIConfig,
  options: ResolveCliSignerOptions = {},
): Promise<ResolvedCliAddress> {
  const envPrivateKey = resolveEnvPrivateKey(options.envPrivateKey);
  if (envPrivateKey) {
    const signer = privateKeyToManagedAccount(envPrivateKey);
    return {
      kind: "env",
      address: signer.address,
      source: "env",
    };
  }

  if (hasRemovedOnePasswordConfig(config)) {
    throw new Error(getRemovedOnePasswordStorageMessage());
  }

  if (config.privateKey) {
    const store = new FileKeyStore({
      configPath: options.configPath ?? getConfigPath(),
    });
    const metadata = await store.metadata();
    if (!metadata.address) {
      throw new Error("No wallet configured. Run `moneyos init`.");
    }
    return {
      kind: "file",
      address: metadata.address,
      source: "local-file",
    };
  }

  throw new Error("No wallet configured. Run `moneyos init`.");
}

export async function buildCliMoneyOSConfig(
  config: CLIConfig,
  options: BuildCliMoneyOSConfigOptions = {},
): Promise<MoneyOSConfig> {
  const moneyosConfig: MoneyOSConfig = {
    chainId: options.chainId ?? config.chainId ?? 42161,
    rpcUrl: config.rpcUrl,
  };

  if (!options.requireSigner) {
    return moneyosConfig;
  }

  const { signer } = await loadCliSigner(config, options);
  return {
    ...moneyosConfig,
    signer,
  };
}
