import type { MoneyOSConfig } from "@moneyos/core";
import type { Address, Hex } from "viem";
import { FileEncryptedWalletStore } from "../core/encrypted-wallet.js";
import { createGaslessExecutionClient } from "../core/gasless.js";
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
import { connectLocalSession } from "../local-session.js";
import { resolveGaslessExecutionConfig } from "./gasless.js";

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
  const gasless = resolveGaslessExecutionConfig(config);

  if (!options.requireSigner) {
    return moneyosConfig;
  }

  const envPrivateKey = resolveEnvPrivateKey(options.envPrivateKey);
  if (envPrivateKey) {
    const signer = privateKeyToManagedAccount(envPrivateKey);
    if (!gasless) {
      return {
        ...moneyosConfig,
        signer,
      };
    }

    return {
      ...moneyosConfig,
      execute: createGaslessExecutionClient({
        signer,
        chainId: moneyosConfig.chainId,
        rpcUrl: moneyosConfig.rpcUrl,
        gasless,
      }),
    };
  }

  if (hasRemovedOnePasswordConfig(config)) {
    throw new Error(getRemovedOnePasswordStorageMessage());
  }

  const socketPath = getSessionPath(options);
  const tokenPath = getTokenPath(options);
  try {
    const sessionExecute = await connectLocalSession({
      socketPath,
      tokenPath,
    });

    if (gasless && sessionExecute.mode !== "smart-account") {
      throw new Error(
        "Gasless mode is enabled, but the active wallet session is still using the EOA executor. Run `moneyos auth unlock` again.",
      );
    }

    if (!gasless && sessionExecute.mode === "smart-account") {
      throw new Error(
        "Gasless mode is disabled, but the active wallet session is still gasless. Run `moneyos auth unlock` again.",
      );
    }

    return {
      ...moneyosConfig,
      execute: sessionExecute,
    };
  } catch (error) {
    if (error instanceof Error && /active wallet session is still/.test(error.message)) {
      throw error;
    }
    // Fall through so the CLI preserves the current locked-wallet error path.
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
