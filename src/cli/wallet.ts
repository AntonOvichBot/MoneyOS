import type { MoneyOSConfig } from "@moneyos/core";
import type { Account, Address, Hex } from "viem";
import { FileKeyStore } from "../core/keystore-file.js";
import { OnePasswordKeyStore } from "../core/keystore-1password.js";
import { ChildProcessOpRunner } from "../core/op-runner.js";
import type { OpRunner } from "../core/op-runner.js";
import { privateKeyToManagedAccount } from "../core/signer.js";
import { getConfigPath } from "./config.js";
import type { CLIConfig } from "./config.js";

export type CliWalletBackendKind = "env" | "file" | "1password";

export interface ResolvedCliSigner {
  kind: CliWalletBackendKind;
  signer: Account;
  address: Address;
}

export interface ResolvedCliAddress {
  kind: CliWalletBackendKind;
  address: Address;
  source: "env" | "config-cache" | "local-file" | "signer";
}

export interface ResolveCliSignerOptions {
  configPath?: string;
  envPrivateKey?: Hex;
  opBinary?: string;
  runner?: OpRunner;
}

export interface BuildCliMoneyOSConfigOptions
  extends ResolveCliSignerOptions {
  chainId?: number;
  requireSigner?: boolean;
}

function resolveEnvPrivateKey(explicit?: Hex): Hex | undefined {
  return explicit ?? (process.env.MONEYOS_PRIVATE_KEY as Hex | undefined);
}

function getRunner(options: ResolveCliSignerOptions): OpRunner {
  return (
    options.runner ??
    new ChildProcessOpRunner({
      binary: options.opBinary,
    })
  );
}

/**
 * Resolve the signer the CLI should use for "my wallet" operations.
 *
 * Precedence is deliberate:
 * 1. `MONEYOS_PRIVATE_KEY` env var for ephemeral agent/CI usage.
 * 2. Configured transitional 1Password-compatible path.
 * 3. Legacy file-backed config.
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

  if (config.keyStore?.kind === "1password") {
    const { vaultId, itemId, address, label } = config.keyStore;
    if (!vaultId || !itemId) {
      throw new Error(
        "Configured 1Password-compatible path is missing vaultId or itemId. Run `moneyos keystore status` or reinitialize the wallet.",
      );
    }

    const store = new OnePasswordKeyStore({
      runner: getRunner(options),
      vaultId,
      itemId,
      address,
      label,
    });
    const signer = await store.loadSigner();
    return {
      kind: "1password",
      signer,
      address: signer.address,
    };
  }

  if (config.privateKey || config.keyStore?.kind === "file") {
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
 * This prefers cheap local metadata over signer loading so balance checks stay
 * lightweight. For 1Password-compatible configs, a cached address avoids an
 * `op read`. If the cache is missing, we fall back to signer loading for
 * compatibility with older or hand-edited configs.
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

  if (config.keyStore?.kind === "1password") {
    const { vaultId, itemId, address } = config.keyStore;
    if (!vaultId || !itemId) {
      throw new Error(
        "Configured 1Password-compatible path is missing vaultId or itemId. Run `moneyos keystore status` or reinitialize the wallet.",
      );
    }

    if (address) {
      return {
        kind: "1password",
        address,
        source: "config-cache",
      };
    }

    const resolved = await loadCliSigner(config, options);
    return {
      kind: resolved.kind,
      address: resolved.address,
      source: "signer",
    };
  }

  if (config.privateKey || config.keyStore?.kind === "file") {
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
