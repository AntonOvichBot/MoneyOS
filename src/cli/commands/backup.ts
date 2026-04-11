import { Command } from "commander";
import { FileBackupProvider } from "../../core/backup-file.js";
import {
  getBackupDir,
  getSessionSocketPath,
  getSessionTokenPath,
  getWalletPath,
  loadFileConfig,
} from "../config.js";
import { promptHidden } from "../prompt.js";
import { lockSession } from "../session.js";

function formatBackupStatus(params: {
  walletPath: string;
  backupDir: string;
  exists: boolean;
  backupCount: number;
  latestBackupPath?: string;
  address?: string;
}): string {
  const lines: string[] = [];
  lines.push(`Wallet:    ${params.exists ? "present" : "missing"}`);
  if (params.address) {
    lines.push(`Address:   ${params.address}`);
  }
  lines.push(`Wallet at: ${params.walletPath}`);
  lines.push(`Backups:   ${params.backupCount}`);
  lines.push(`Directory: ${params.backupDir}`);
  if (params.latestBackupPath) {
    lines.push(`Latest:    ${params.latestBackupPath}`);
  }
  return lines.join("\n");
}

export const backupCommand = new Command("backup").description(
  "Export, restore, and inspect encrypted wallet backups",
);

backupCommand
  .command("export")
  .description("Write a copy of the encrypted wallet backup")
  .option("-o, --out <path>", "Custom path for the backup file")
  .action(async (options) => {
    const config = loadFileConfig();
    const provider = new FileBackupProvider({
      walletPath: getWalletPath(config),
      backupDir: getBackupDir(config),
    });

    try {
      const targetPath = await provider.exportWallet({
        outPath: options.out,
      });
      console.log(`Backup exported to ${targetPath}`);
      console.log(
        "Save your wallet password in your password manager of choice. MoneyOS does not store or sync it for you.",
      );
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  });

backupCommand
  .command("restore")
  .description("Restore the encrypted wallet from a backup file")
  .argument("<path>", "Path to the encrypted backup file")
  .option("--force", "Overwrite an existing encrypted wallet")
  .action(async (path: string, options) => {
    const config = loadFileConfig();
    const provider = new FileBackupProvider({
      walletPath: getWalletPath(config),
      backupDir: getBackupDir(config),
    });

    try {
      const passphrase = await promptHidden(
        "Wallet password for backup verification: ",
      );
      const metadata = await provider.restoreWallet(path, {
        passphrase,
        allowOverwrite: Boolean(options.force),
      });
      await lockSession(getSessionSocketPath(), getSessionTokenPath());
      console.log("Encrypted wallet restored.");
      console.log(`Address:   ${metadata.address}`);
      console.log(`Wallet:    ${getWalletPath(config)}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  });

backupCommand
  .command("status")
  .description("Show the local wallet backup status")
  .action(async () => {
    const config = loadFileConfig();
    const provider = new FileBackupProvider({
      walletPath: getWalletPath(config),
      backupDir: getBackupDir(config),
    });
    const status = await provider.status();
    console.log(formatBackupStatus(status));
  });
