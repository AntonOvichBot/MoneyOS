import { Command } from "commander";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import {
  FileBackupProvider,
  type BackupProvider,
} from "../../core/backup-file.js";
import {
  FileEncryptedWalletStore,
  type EncryptedWalletStore,
} from "../../core/encrypted-wallet.js";
import {
  type CLIConfig,
  getBackupDir,
  getConfigPath,
  getLegacyPlaintextWalletStorageMessage,
  getSessionSocketPath,
  getSessionTokenPath,
  getWalletPath,
  getRemovedOnePasswordStorageMessage,
  hasRemovedOnePasswordConfig,
  hasLegacyPlaintextWalletConfig,
  loadFileConfig,
  saveConfig,
} from "../config.js";
import { promptHidden } from "../prompt.js";
import { lockSession } from "../session.js";

function parseChainId(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid chain ID: "${value}"`);
  }
  return parsed;
}

export interface InitCommandOptions {
  key?: string;
  force?: boolean;
  chain?: string;
  rpc?: string;
}

export interface InitCommandDependencies {
  loadFileConfig: () => CLIConfig;
  getWalletPath: (config?: CLIConfig) => string;
  getBackupDir: (config?: CLIConfig) => string;
  getConfigPath: () => string;
  createWalletStore: (walletPath: string) => EncryptedWalletStore;
  createBackupProvider: (params: {
    walletPath: string;
    backupDir: string;
  }) => BackupProvider;
  hasRemovedOnePasswordConfig: (config: CLIConfig) => boolean;
  getRemovedOnePasswordStorageMessage: () => string;
  hasLegacyPlaintextWalletConfig: (config: CLIConfig) => boolean;
  getLegacyPlaintextWalletStorageMessage: () => string;
  promptHidden: (question: string) => Promise<string>;
  lockSession: (socketPath: string, tokenPath: string) => Promise<boolean>;
  getSessionSocketPath: () => string;
  getSessionTokenPath: () => string;
  saveConfig: (config: CLIConfig) => void;
  generatePrivateKey: () => Hex;
  log: (message: string) => void;
  error: (message: string) => void;
}

const defaultInitCommandDependencies: InitCommandDependencies = {
  loadFileConfig,
  getWalletPath,
  getBackupDir,
  getConfigPath,
  createWalletStore: (walletPath) => new FileEncryptedWalletStore(walletPath),
  createBackupProvider: (params) => new FileBackupProvider(params),
  hasRemovedOnePasswordConfig,
  getRemovedOnePasswordStorageMessage,
  hasLegacyPlaintextWalletConfig,
  getLegacyPlaintextWalletStorageMessage,
  promptHidden,
  lockSession,
  getSessionSocketPath,
  getSessionTokenPath,
  saveConfig,
  generatePrivateKey,
  log: (message) => console.log(message),
  error: (message) => console.error(message),
};

export async function runInitCommand(
  options: InitCommandOptions,
  deps: InitCommandDependencies = defaultInitCommandDependencies,
): Promise<void> {
  const existing = deps.loadFileConfig();
  const walletPath = deps.getWalletPath(existing);
  const backupDir = deps.getBackupDir(existing);
  const wallet = deps.createWalletStore(walletPath);

  if (wallet.exists() && !options.force) {
    const metadata = await wallet.metadata();
    deps.log(`Already initialized.`);
    if (metadata?.address) {
      deps.log(`Address: ${metadata.address}`);
    }
    deps.log(`Wallet:  ${walletPath}`);
    deps.log(`Config:  ${deps.getConfigPath()}`);
    deps.log(`\nTo reinitialize, run: moneyos init --force --key <privateKey>`);
    return;
  }

  if (deps.hasRemovedOnePasswordConfig(existing) && !options.key) {
    deps.error(deps.getRemovedOnePasswordStorageMessage());
    deps.error(`Config: ${deps.getConfigPath()}`);
    return;
  }

  try {
    const privateKey =
      options.key ??
      (deps.hasLegacyPlaintextWalletConfig(existing)
        ? existing.privateKey!
        : deps.generatePrivateKey());
    const account = privateKeyToAccount(privateKey as Hex);
    const chainId = parseChainId(options.chain, existing.chainId ?? 42161);
    const rpcUrl = options.rpc ?? existing.rpcUrl;
    const passphrase = await deps.promptHidden("Choose wallet password: ");
    if (passphrase.length < 8) {
      throw new Error("Wallet password must be at least 8 characters long.");
    }
    const confirmPassphrase = await deps.promptHidden("Confirm wallet password: ");
    if (passphrase !== confirmPassphrase) {
      throw new Error("Wallet password confirmation did not match.");
    }

    await wallet.save({
      privateKey: privateKey as Hex,
      passphrase,
    });
    await deps.lockSession(
      deps.getSessionSocketPath(),
      deps.getSessionTokenPath(),
    );

    deps.saveConfig({
      chainId,
      rpcUrl,
      walletPath: existing.walletPath,
      backupDir: existing.backupDir,
    });

    const backupProvider = deps.createBackupProvider({
      walletPath,
      backupDir,
    });
    const backupPath = await backupProvider.exportWallet();

    deps.log(`MoneyOS initialized.`);
    deps.log(`Address: ${account.address}`);
    deps.log(`Wallet:  ${walletPath}`);
    deps.log(`Config:  ${deps.getConfigPath()}`);
    deps.log(`Backup:  ${backupPath}`);
    deps.log(
      `\nSave your wallet password in your password manager of choice. MoneyOS does not store or sync it for you.`,
    );

    if (deps.hasLegacyPlaintextWalletConfig(existing) && !options.key) {
      deps.log(`\nImported legacy plaintext wallet into the encrypted wallet file.`);
      deps.log(deps.getLegacyPlaintextWalletStorageMessage());
    } else if (!options.key) {
      deps.log(
        `\nThis is a new account. Fund it before sending transactions.`,
      );
    }
  } catch (error) {
    deps.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export const initCommand = new Command("init")
  .description("Initialize MoneyOS with a new or imported encrypted wallet")
  .option("-k, --key <privateKey>", "Import an existing private key")
  .option("--force", "Overwrite the existing encrypted wallet")
  .option("--chain <chainId>", "Default chain ID (default: 42161 Arbitrum)")
  .option("--rpc <url>", "Custom RPC URL")
  .action(async (options) => {
    await runInitCommand(options);
  });
