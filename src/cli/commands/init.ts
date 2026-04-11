import { Command } from "commander";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { FileBackupProvider } from "../../core/backup-file.js";
import { FileEncryptedWalletStore } from "../../core/encrypted-wallet.js";
import {
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

export const initCommand = new Command("init")
  .description("Initialize MoneyOS with a new or imported encrypted wallet")
  .option("-k, --key <privateKey>", "Import an existing private key")
  .option("--force", "Overwrite the existing encrypted wallet")
  .option("--chain <chainId>", "Default chain ID (default: 42161 Arbitrum)")
  .option("--rpc <url>", "Custom RPC URL")
  .action(async (options) => {
    const existing = loadFileConfig();
    const walletPath = getWalletPath(existing);
    const backupDir = getBackupDir(existing);
    const wallet = new FileEncryptedWalletStore(walletPath);

    if (wallet.exists() && !options.force) {
      const metadata = await wallet.metadata();
      console.log(`Already initialized.`);
      if (metadata?.address) {
        console.log(`Address: ${metadata.address}`);
      }
      console.log(`Wallet:  ${walletPath}`);
      console.log(`Config:  ${getConfigPath()}`);
      console.log(`\nTo reinitialize, run: moneyos init --force --key <privateKey>`);
      return;
    }

    if (hasRemovedOnePasswordConfig(existing) && !options.key) {
      console.error(getRemovedOnePasswordStorageMessage());
      console.error(`Config: ${getConfigPath()}`);
      return;
    }

    try {
      const privateKey: Hex =
        options.key ??
        (hasLegacyPlaintextWalletConfig(existing)
          ? existing.privateKey!
          : generatePrivateKey());
      const account = privateKeyToAccount(privateKey);
      const chainId = parseChainId(options.chain, existing.chainId ?? 42161);
      const rpcUrl = options.rpc ?? existing.rpcUrl;
      const passphrase = await promptHidden("Choose wallet password: ");
      if (passphrase.length < 8) {
        throw new Error("Wallet password must be at least 8 characters long.");
      }
      const confirmPassphrase = await promptHidden("Confirm wallet password: ");
      if (passphrase !== confirmPassphrase) {
        throw new Error("Wallet password confirmation did not match.");
      }

      await wallet.save({
        privateKey,
        passphrase,
      });
      await lockSession(getSessionSocketPath(), getSessionTokenPath());

      saveConfig({
        chainId,
        rpcUrl,
        walletPath: existing.walletPath,
        backupDir: existing.backupDir,
      });

      const backupProvider = new FileBackupProvider({
        walletPath,
        backupDir,
      });
      const backupPath = await backupProvider.exportWallet();

      console.log(`MoneyOS initialized.`);
      console.log(`Address: ${account.address}`);
      console.log(`Wallet:  ${walletPath}`);
      console.log(`Config:  ${getConfigPath()}`);
      console.log(`Backup:  ${backupPath}`);
      console.log(
        `\nSave your wallet password in your password manager of choice. MoneyOS does not store or sync it for you.`,
      );

      if (hasLegacyPlaintextWalletConfig(existing) && !options.key) {
        console.log(`\nImported legacy plaintext wallet into the encrypted wallet file.`);
        console.log(getLegacyPlaintextWalletStorageMessage());
      } else if (!options.key) {
        console.log(
          `\nThis is a new account. Fund it before sending transactions.`,
        );
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  });
