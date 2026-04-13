import { describe, it, expect } from "vitest";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { FileEncryptedWalletStore } from "../src/core/encrypted-wallet.js";
import { FileBackupProvider } from "../src/core/backup-file.js";

const TEST_PK: Hex =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ALT_PK: Hex =
  "0x59c6995e998f97a5a0044966f094538e6f2f0a38d7c7d0b7e54b5f3c7f4e6a15";
const TEST_ADDRESS = privateKeyToAccount(TEST_PK).address;
const ALT_ADDRESS = privateKeyToAccount(ALT_PK).address;

describe("FileEncryptedWalletStore", () => {
  it("saves and decrypts an encrypted wallet", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "moneyos-encrypted-wallet-"));
    const walletPath = join(tmpDir, "wallet.json");
    const store = new FileEncryptedWalletStore(walletPath);

    try {
      const metadata = await store.save({
        privateKey: TEST_PK,
        passphrase: "secret passphrase",
      });

      expect(metadata.address).toBe(TEST_ADDRESS);
      expect(await store.decrypt("secret passphrase")).toBe(TEST_PK);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("fails cleanly on the wrong password", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "moneyos-encrypted-wallet-"));
    const walletPath = join(tmpDir, "wallet.json");
    const store = new FileEncryptedWalletStore(walletPath);

    try {
      await store.save({
        privateKey: TEST_PK,
        passphrase: "secret passphrase",
      });

      await expect(store.decrypt("wrong password")).rejects.toThrow(
        /invalid password or corrupted wallet/i,
      );
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects tampered wallet metadata", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "moneyos-encrypted-wallet-"));
    const walletPath = join(tmpDir, "wallet.json");
    const store = new FileEncryptedWalletStore(walletPath);

    try {
      await store.save({
        privateKey: TEST_PK,
        passphrase: "secret passphrase",
      });

      const wallet = JSON.parse(readFileSync(walletPath, "utf8")) as {
        address: string;
      };
      wallet.address = ALT_ADDRESS;
      writeFileSync(walletPath, JSON.stringify(wallet, null, 2), { mode: 0o600 });

      await expect(store.metadata()).rejects.toThrow(/address proof/i);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects tampered KDF parameters", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "moneyos-encrypted-wallet-"));
    const walletPath = join(tmpDir, "wallet.json");
    const store = new FileEncryptedWalletStore(walletPath);

    try {
      await store.save({
        privateKey: TEST_PK,
        passphrase: "secret passphrase",
      });

      const wallet = JSON.parse(readFileSync(walletPath, "utf8")) as {
        kdf: { N: number; r: number; p: number; keyLength: number; name: string };
      };
      wallet.kdf.N = 1024;
      writeFileSync(walletPath, JSON.stringify(wallet, null, 2), { mode: 0o600 });

      await expect(store.decrypt("secret passphrase")).rejects.toThrow(
        /invalid password or corrupted wallet/i,
      );
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("refuses insecure wallet file permissions on unix", async () => {
    if (process.platform === "win32") {
      return;
    }

    const tmpDir = mkdtempSync(join(tmpdir(), "moneyos-encrypted-wallet-"));
    const walletPath = join(tmpDir, "wallet.json");
    const store = new FileEncryptedWalletStore(walletPath);

    try {
      await store.save({
        privateKey: TEST_PK,
        passphrase: "secret passphrase",
      });
      chmodSync(walletPath, 0o644);

      await expect(store.metadata()).rejects.toThrow(/insecure permissions/i);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("reports insecure wallet directories as wallet-path errors", async () => {
    if (process.platform === "win32") {
      return;
    }

    const tmpDir = mkdtempSync(join(tmpdir(), "moneyos-encrypted-wallet-"));
    const insecureDir = join(tmpDir, "unsafe-wallet-dir");
    const walletPath = join(insecureDir, "wallet.json");
    const store = new FileEncryptedWalletStore(walletPath);

    try {
      mkdirSync(insecureDir, { recursive: true, mode: 0o777 });
      chmodSync(insecureDir, 0o777);

      await expect(
        store.save({
          privateKey: TEST_PK,
          passphrase: "secret passphrase",
        }),
      ).rejects.toThrow(/wallet directory .* has insecure permissions/i);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("skips unix-only permission checks when the platform is win32", async () => {
    const originalPlatform = process.platform;
    const tmpDir = mkdtempSync(join(tmpdir(), "moneyos-encrypted-wallet-"));
    const insecureDir = join(tmpDir, "unsafe-wallet-dir");
    const walletPath = join(insecureDir, "wallet.json");
    const store = new FileEncryptedWalletStore(walletPath);

    try {
      mkdirSync(insecureDir, { recursive: true, mode: 0o777 });
      chmodSync(insecureDir, 0o777);
      Object.defineProperty(process, "platform", { value: "win32" });

      await expect(
        store.save({
          privateKey: TEST_PK,
          passphrase: "secret passphrase",
        }),
      ).resolves.toEqual(
        expect.objectContaining({
          address: TEST_ADDRESS,
        }),
      );
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("rotates the wallet password without changing wallet metadata", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "moneyos-encrypted-wallet-"));
    const walletPath = join(tmpDir, "wallet.json");
    const store = new FileEncryptedWalletStore(walletPath);

    try {
      await store.save({
        privateKey: TEST_PK,
        passphrase: "old secret",
      });

      const before = await store.exportData();
      const rotated = await store.rotatePassphrase({
        oldPassphrase: "old secret",
        newPassphrase: "new secret phrase",
      });
      const after = await store.exportData();

      expect(rotated).toEqual({
        version: before.version,
        kind: before.kind,
        address: before.address,
        createdAt: before.createdAt,
      });
      expect(after.version).toBe(before.version);
      expect(after.kind).toBe(before.kind);
      expect(after.address).toBe(before.address);
      expect(after.createdAt).toBe(before.createdAt);
      expect(after.addressProof).toBe(before.addressProof);
      expect(after.crypto.ciphertext).not.toBe(before.crypto.ciphertext);
      expect(await store.decrypt("new secret phrase")).toBe(TEST_PK);
      await expect(store.decrypt("old secret")).rejects.toThrow(
        /invalid password or corrupted wallet/i,
      );
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("leaves the wallet unchanged when password rotation uses the wrong current password", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "moneyos-encrypted-wallet-"));
    const walletPath = join(tmpDir, "wallet.json");
    const store = new FileEncryptedWalletStore(walletPath);

    try {
      await store.save({
        privateKey: TEST_PK,
        passphrase: "old secret",
      });

      const before = await store.exportData();

      await expect(
        store.rotatePassphrase({
          oldPassphrase: "wrong secret",
          newPassphrase: "new secret phrase",
        }),
      ).rejects.toThrow(/invalid password or corrupted wallet/i);

      const after = await store.exportData();
      expect(after).toEqual(before);
      expect(await store.decrypt("old secret")).toBe(TEST_PK);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("FileBackupProvider", () => {
  it("exports an encrypted backup and restores it", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "moneyos-backup-"));
    const walletPath = join(tmpDir, "wallet.json");
    const backupDir = join(tmpDir, "backups");
    const restoredPath = join(tmpDir, "restored-wallet.json");
    const store = new FileEncryptedWalletStore(walletPath);

    try {
      await store.save({
        privateKey: TEST_PK,
        passphrase: "secret passphrase",
      });

      const provider = new FileBackupProvider({
        walletPath,
        backupDir,
      });
      const backupPath = await provider.exportWallet();
      expect(backupPath).toContain(backupDir);

      const restoreProvider = new FileBackupProvider({
        walletPath: restoredPath,
        backupDir,
      });
      const restored = await restoreProvider.restoreWallet(backupPath, {
        passphrase: "secret passphrase",
        allowOverwrite: true,
      });
      expect(restored.address).toBe(TEST_ADDRESS);

      const restoredStore = new FileEncryptedWalletStore(restoredPath);
      expect(await restoredStore.decrypt("secret passphrase")).toBe(TEST_PK);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects restore with the wrong password without touching the existing wallet", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "moneyos-backup-"));
    const walletPath = join(tmpDir, "wallet.json");
    const backupDir = join(tmpDir, "backups");
    const restoredPath = join(tmpDir, "restored-wallet.json");
    const sourceStore = new FileEncryptedWalletStore(walletPath);
    const targetStore = new FileEncryptedWalletStore(restoredPath);

    try {
      await sourceStore.save({
        privateKey: TEST_PK,
        passphrase: "secret passphrase",
      });
      await targetStore.save({
        privateKey: ALT_PK,
        passphrase: "secret passphrase",
      });

      const provider = new FileBackupProvider({
        walletPath,
        backupDir,
      });
      const backupPath = await provider.exportWallet();

      const restoreProvider = new FileBackupProvider({
        walletPath: restoredPath,
        backupDir,
      });

      await expect(
        restoreProvider.restoreWallet(backupPath, {
          passphrase: "wrong password",
          allowOverwrite: true,
        }),
      ).rejects.toThrow(/invalid password or corrupted wallet/i);

      expect(await targetStore.decrypt("secret passphrase")).toBe(ALT_PK);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("reports backup status with latest backup metadata", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "moneyos-backup-"));
    const walletPath = join(tmpDir, "wallet.json");
    const backupDir = join(tmpDir, "backups");
    const store = new FileEncryptedWalletStore(walletPath);

    try {
      await store.save({
        privateKey: ALT_PK,
        passphrase: "secret passphrase",
      });

      const provider = new FileBackupProvider({
        walletPath,
        backupDir,
      });
      await provider.exportWallet();
      const status = await provider.status();
      expect(status.exists).toBe(true);
      expect(status.backupCount).toBe(1);
      expect(status.address).toBe(ALT_ADDRESS);
      expect(status.latestBackupPath).toContain(backupDir);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite an existing wallet on restore without force", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "moneyos-backup-"));
    const walletPath = join(tmpDir, "wallet.json");
    const backupDir = join(tmpDir, "backups");
    const restoredPath = join(tmpDir, "restored-wallet.json");
    const sourceStore = new FileEncryptedWalletStore(walletPath);
    const targetStore = new FileEncryptedWalletStore(restoredPath);

    try {
      await sourceStore.save({
        privateKey: TEST_PK,
        passphrase: "secret passphrase",
      });
      await targetStore.save({
        privateKey: ALT_PK,
        passphrase: "secret passphrase",
      });

      const provider = new FileBackupProvider({
        walletPath,
        backupDir,
      });
      const backupPath = await provider.exportWallet();

      const restoreProvider = new FileBackupProvider({
        walletPath: restoredPath,
        backupDir,
      });

      await expect(
        restoreProvider.restoreWallet(backupPath, {
          passphrase: "secret passphrase",
        }),
      ).rejects.toThrow(/already exists/i);

      expect(await targetStore.decrypt("secret passphrase")).toBe(ALT_PK);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite an existing backup file on export without force", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "moneyos-backup-"));
    const walletPath = join(tmpDir, "wallet.json");
    const backupDir = join(tmpDir, "backups");
    const outPath = join(tmpDir, "manual-backup.json");
    const store = new FileEncryptedWalletStore(walletPath);

    try {
      await store.save({
        privateKey: TEST_PK,
        passphrase: "secret passphrase",
      });

      const provider = new FileBackupProvider({
        walletPath,
        backupDir,
      });
      await provider.exportWallet({ outPath });

      await expect(provider.exportWallet({ outPath })).rejects.toThrow(
        /backup file already exists/i,
      );

      await expect(
        provider.exportWallet({ outPath, allowOverwrite: true }),
      ).resolves.toBe(outPath);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("reports insecure export destinations separately from wallet-path errors", async () => {
    if (process.platform === "win32") {
      return;
    }

    const tmpDir = mkdtempSync(join(tmpdir(), "moneyos-backup-"));
    const walletPath = join(tmpDir, "wallet.json");
    const backupDir = join(tmpDir, "backups");
    const insecureDir = join(tmpDir, "unsafe-export-dir");
    const outPath = join(insecureDir, "manual-backup.json");
    const store = new FileEncryptedWalletStore(walletPath);

    try {
      await store.save({
        privateKey: TEST_PK,
        passphrase: "secret passphrase",
      });
      mkdirSync(insecureDir, { recursive: true, mode: 0o777 });
      chmodSync(insecureDir, 0o777);

      const provider = new FileBackupProvider({
        walletPath,
        backupDir,
      });

      await expect(provider.exportWallet({ outPath })).rejects.toThrow(
        /backup export destination directory .* has insecure permissions/i,
      );
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
