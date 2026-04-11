import {
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";
import type { Address } from "viem";
import {
  FileEncryptedWalletStore,
  type EncryptedWalletMetadata,
  readEncryptedWalletFile,
  verifyEncryptedWalletPassphrase,
} from "./encrypted-wallet.js";

export interface BackupProvider {
  readonly kind: "file";
  exportWallet(options?: { outPath?: string }): Promise<string>;
  restoreWallet(
    fromPath: string,
    options: { passphrase: string; allowOverwrite?: boolean },
  ): Promise<EncryptedWalletMetadata>;
  status(): Promise<{
    walletPath: string;
    backupDir: string;
    exists: boolean;
    latestBackupPath?: string;
    backupCount: number;
    address?: Address;
  }>;
}

function formatTimestamp(now: Date): string {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return [
    now.getUTCFullYear().toString(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
    "-",
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
    pad(now.getUTCSeconds()),
  ].join("");
}

export class FileBackupProvider implements BackupProvider {
  readonly kind = "file" as const;
  private readonly store: FileEncryptedWalletStore;
  private readonly backupDir: string;

  constructor(params: { walletPath: string; backupDir: string }) {
    this.store = new FileEncryptedWalletStore(params.walletPath);
    this.backupDir = params.backupDir;
  }

  private defaultBackupPath(address: Address): string {
    return join(
      this.backupDir,
      `wallet-${address}-${formatTimestamp(new Date())}.json`,
    );
  }

  async exportWallet(options: { outPath?: string } = {}): Promise<string> {
    if (options.outPath === "-") {
      throw new Error("Refusing to export an encrypted wallet backup to stdout.");
    }
    const wallet = await this.store.exportData();
    const targetPath = options.outPath
      ? resolve(options.outPath)
      : this.defaultBackupPath(wallet.address);
    await new FileEncryptedWalletStore(targetPath).restore(wallet);
    return targetPath;
  }

  async restoreWallet(
    fromPath: string,
    options: { passphrase: string; allowOverwrite?: boolean },
  ): Promise<EncryptedWalletMetadata> {
    if (this.store.exists() && !options.allowOverwrite) {
      throw new Error(
        "A wallet already exists. Re-run with `--force` if you really want to overwrite it.",
      );
    }

    const sourcePath = resolve(fromPath);
    const wallet = await readEncryptedWalletFile(sourcePath);
    await verifyEncryptedWalletPassphrase(wallet, options.passphrase);
    return this.store.restore(wallet);
  }

  async status(): Promise<{
    walletPath: string;
    backupDir: string;
    exists: boolean;
    latestBackupPath?: string;
    backupCount: number;
    address?: Address;
  }> {
    const exists = this.store.exists();
    const metadata = exists ? await this.store.metadata() : undefined;

    if (!existsSync(this.backupDir)) {
      return {
        walletPath: this.store.walletPath,
        backupDir: this.backupDir,
        exists,
        backupCount: 0,
        address: metadata?.address,
      };
    }

    const files = readdirSync(this.backupDir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => join(this.backupDir, name))
      .sort(
        (a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs,
      );

    return {
      walletPath: this.store.walletPath,
      backupDir: this.backupDir,
      exists,
      latestBackupPath: files[0],
      backupCount: files.length,
      address: metadata?.address,
    };
  }
}
