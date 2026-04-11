import type { MoneyOSConfig } from "@moneyos/core";
import type { Address, Hex } from "viem";
import { FileEncryptedWalletStore } from "../core/encrypted-wallet.js";
import { privateKeyToManagedAccount } from "../core/signer.js";
import {
  getLegacyPlaintextWalletStorageMessage,
  getRemovedOnePasswordStorageMessage,
  getSessionSocketPath,
  getSessionTokenPath,
  getWalletPath,
  hasLegacyPlaintextWalletConfig,
  hasRemovedOnePasswordConfig,
  type CLIConfig,
} from "./config.js";
import { getSessionStatus, SessionExecutionClient } from "./session.js";

export type CliWalletBackendKind = "env" | "wallet-file" | "session";

export interface ResolvedCliAddress {
  kind: "env" | "wallet-file";
  address: Address;
  source: "env" | "encrypted-wallet";
}

export interface ResolveCliWalletOptions {
  walletPath?: string;
  sessionSocketPath?: string;
  sessionTokenPath?: string;
  envPrivateKey?: Hex;
}

export interface BuildCliMoneyOSConfigOptions extends ResolveCliWalletOptions {
  chainId?: number;
  requireSigner?: boolean;
}

function resolveEnvPrivateKey(explicit?: Hex): Hex | undefined {
  return explicit ?? (process.env.MONEYOS_PRIVATE_KEY as Hex | undefined);
}

function getWalletStore(
  config: CLIConfig,
  options: ResolveCliWalletOptions = {},
): FileEncryptedWalletStore {
  return new FileEncryptedWalletStore(options.walletPath ?? getWalletPath(config));
}

function getSessionPath(options: ResolveCliWalletOptions = {}): string {
  return options.sessionSocketPath ?? getSessionSocketPath();
}

function getTokenPath(options: ResolveCliWalletOptions = {}): string {
  return options.sessionTokenPath ?? getSessionTokenPath();
}

/**
 * Resolve the address the CLI should use for read-only "my wallet" commands.
 *
 * This prefers cheap wallet metadata over any signing path so read-only
 * balance checks do not require an unlocked session.
 */
export async function loadCliAddress(
  config: CLIConfig,
  options: ResolveCliWalletOptions = {},
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

  const wallet = getWalletStore(config, options);
  const metadata = await wallet.metadata();
  if (metadata?.address) {
    return {
      kind: "wallet-file",
      address: metadata.address,
      source: "encrypted-wallet",
    };
  }

  if (hasLegacyPlaintextWalletConfig(config)) {
    throw new Error(getLegacyPlaintextWalletStorageMessage());
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

  const envPrivateKey = resolveEnvPrivateKey(options.envPrivateKey);
  if (envPrivateKey) {
    return {
      ...moneyosConfig,
      signer: privateKeyToManagedAccount(envPrivateKey),
    };
  }

  if (hasRemovedOnePasswordConfig(config)) {
    throw new Error(getRemovedOnePasswordStorageMessage());
  }

  const socketPath = getSessionPath(options);
  const tokenPath = getTokenPath(options);
  const session = await getSessionStatus(socketPath, tokenPath);
  if (session) {
    return {
      ...moneyosConfig,
      execute: new SessionExecutionClient({
        socketPath,
        tokenPath,
        address: session.address,
      }),
    };
  }

  const wallet = getWalletStore(config, options);
  if (wallet.exists()) {
    throw new Error(
      "Wallet is locked. Run `moneyos auth unlock` locally before using write commands.",
    );
  }

  if (hasLegacyPlaintextWalletConfig(config)) {
    throw new Error(getLegacyPlaintextWalletStorageMessage());
  }

  throw new Error("No wallet configured. Run `moneyos init`.");
}
