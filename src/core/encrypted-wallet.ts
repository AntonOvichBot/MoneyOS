import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { recoverMessageAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export interface EncryptedWalletKdfConfig {
  name: "scrypt";
  N: number;
  r: number;
  p: number;
  keyLength: number;
}

export interface EncryptedWalletCrypto {
  cipher: "aes-256-gcm";
  salt: string;
  nonce: string;
  authTag: string;
  ciphertext: string;
}

export interface EncryptedWalletFile {
  version: 1;
  kind: "encrypted-local-eoa";
  address: Address;
  createdAt: string;
  addressProof: Hex;
  kdf: EncryptedWalletKdfConfig;
  crypto: EncryptedWalletCrypto;
}

export interface EncryptedWalletMetadata {
  version: 1;
  kind: "encrypted-local-eoa";
  address: Address;
  createdAt: string;
}

export interface EncryptedWalletStore {
  readonly walletPath: string;
  exists(): boolean;
  metadata(): Promise<EncryptedWalletMetadata | undefined>;
  save(params: { privateKey: Hex; passphrase: string }): Promise<EncryptedWalletMetadata>;
  decrypt(passphrase: string): Promise<Hex>;
  exportData(): Promise<EncryptedWalletFile>;
  restore(data: EncryptedWalletFile): Promise<EncryptedWalletMetadata>;
}

const DEFAULT_KDF: EncryptedWalletKdfConfig = {
  name: "scrypt",
  N: 131072,
  r: 8,
  p: 1,
  keyLength: 32,
};

const SECURE_FILE_MODE = 0o600;
const SECURE_PARENT_MODE = 0o700;

function normalizePassphrase(passphrase: string): string {
  return passphrase.normalize("NFC");
}

function walletProofMessage(wallet: Pick<
  EncryptedWalletFile,
  "version" | "kind" | "address" | "createdAt"
>): string {
  return [
    "MoneyOS wallet metadata",
    `v=${wallet.version}`,
    `kind=${wallet.kind}`,
    `address=${wallet.address}`,
    `createdAt=${wallet.createdAt}`,
  ].join("|");
}

function ensureParentDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: SECURE_PARENT_MODE });
    return;
  }

  const mode = statSync(dir).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error(
      `Wallet directory ${dir} has insecure permissions (${mode.toString(8)}). Restrict it to 700 before continuing.`,
    );
  }
}

function assertSecureFileMode(path: string, label: string): void {
  if (!existsSync(path)) {
    return;
  }

  const mode = statSync(path).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error(
      `${label} at ${path} has insecure permissions (${mode.toString(8)}). Restrict it to 600 before continuing.`,
    );
  }
}

function parseWalletFile(raw: string, path: string): EncryptedWalletFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Encrypted wallet at ${path} is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Encrypted wallet at ${path} must be a JSON object`);
  }

  const wallet = parsed as Partial<EncryptedWalletFile>;
  if (wallet.version !== 1) {
    throw new Error(`Encrypted wallet at ${path} has unsupported version`);
  }
  if (wallet.kind !== "encrypted-local-eoa") {
    throw new Error(`Encrypted wallet at ${path} has unsupported kind`);
  }
  if (typeof wallet.address !== "string") {
    throw new Error(`Encrypted wallet at ${path} is missing address metadata`);
  }
  if (typeof wallet.addressProof !== "string") {
    throw new Error(`Encrypted wallet at ${path} is missing address proof`);
  }
  if (
    !wallet.kdf ||
    wallet.kdf.name !== "scrypt" ||
    !Number.isInteger(wallet.kdf.N) ||
    !Number.isInteger(wallet.kdf.r) ||
    !Number.isInteger(wallet.kdf.p) ||
    !Number.isInteger(wallet.kdf.keyLength)
  ) {
    throw new Error(`Encrypted wallet at ${path} has invalid KDF parameters`);
  }
  if (
    !wallet.crypto ||
    wallet.crypto.cipher !== "aes-256-gcm" ||
    typeof wallet.crypto.salt !== "string" ||
    typeof wallet.crypto.nonce !== "string" ||
    typeof wallet.crypto.authTag !== "string" ||
    typeof wallet.crypto.ciphertext !== "string"
  ) {
    throw new Error(`Encrypted wallet at ${path} has invalid crypto metadata`);
  }
  if (typeof wallet.createdAt !== "string") {
    throw new Error(`Encrypted wallet at ${path} is missing createdAt`);
  }

  return wallet as EncryptedWalletFile;
}

function toMetadata(wallet: EncryptedWalletFile): EncryptedWalletMetadata {
  return {
    version: wallet.version,
    kind: wallet.kind,
    address: wallet.address,
    createdAt: wallet.createdAt,
  };
}

async function verifyWalletAddressProof(
  wallet: EncryptedWalletFile,
  path: string,
): Promise<void> {
  let recovered: Address;
  try {
    recovered = await recoverMessageAddress({
      message: walletProofMessage(wallet),
      signature: wallet.addressProof,
    });
  } catch {
    throw new Error(`Encrypted wallet at ${path} has an invalid address proof`);
  }

  if (recovered.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error(`Encrypted wallet at ${path} failed address proof validation`);
  }
}

function deriveKey(
  passphrase: string,
  salt: Buffer,
  kdf: EncryptedWalletKdfConfig,
): Buffer {
  return scryptSync(normalizePassphrase(passphrase), salt, kdf.keyLength, {
    N: kdf.N,
    r: kdf.r,
    p: kdf.p,
    maxmem: 256 * 1024 * 1024,
  }) as Buffer;
}

function writeFileAtomicSecure(path: string, contents: string): void {
  ensureParentDir(path);
  assertSecureFileMode(path, "Wallet file");

  const tmpPath = join(
    dirname(path),
    `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`,
  );
  const fd = openSync(tmpPath, "wx", SECURE_FILE_MODE);

  try {
    writeSync(fd, contents);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }

  renameSync(tmpPath, path);
  chmodSync(path, SECURE_FILE_MODE);
}

async function encryptWallet(params: {
  privateKey: Hex;
  passphrase: string;
}): Promise<EncryptedWalletFile> {
  const account = privateKeyToAccount(params.privateKey);
  const createdAt = new Date().toISOString();
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const key = deriveKey(params.passphrase, salt, DEFAULT_KDF);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const plaintext = Buffer.from(
    JSON.stringify({ privateKey: params.privateKey }),
    "utf8",
  );
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const addressProof = await account.signMessage({
    message: walletProofMessage({
      version: 1,
      kind: "encrypted-local-eoa",
      address: account.address,
      createdAt,
    }),
  });

  return {
    version: 1,
    kind: "encrypted-local-eoa",
    address: account.address,
    createdAt,
    addressProof,
    kdf: DEFAULT_KDF,
    crypto: {
      cipher: "aes-256-gcm",
      salt: salt.toString("base64"),
      nonce: nonce.toString("base64"),
      authTag: authTag.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    },
  };
}

async function decryptWalletFile(
  wallet: EncryptedWalletFile,
  passphrase: string,
): Promise<Hex> {
  try {
    const salt = Buffer.from(wallet.crypto.salt, "base64");
    const nonce = Buffer.from(wallet.crypto.nonce, "base64");
    const authTag = Buffer.from(wallet.crypto.authTag, "base64");
    const ciphertext = Buffer.from(wallet.crypto.ciphertext, "base64");
    const key = deriveKey(passphrase, salt, wallet.kdf);
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
    const parsed = JSON.parse(plaintext) as { privateKey?: unknown };
    if (typeof parsed.privateKey !== "string") {
      throw new Error("wallet payload missing privateKey");
    }
    const privateKey = parsed.privateKey as Hex;
    const derivedAddress = privateKeyToAccount(privateKey).address;
    if (derivedAddress.toLowerCase() !== wallet.address.toLowerCase()) {
      throw new Error("wallet address metadata mismatch");
    }
    return privateKey;
  } catch {
    throw new Error("Invalid password or corrupted wallet.");
  }
}

export class FileEncryptedWalletStore implements EncryptedWalletStore {
  readonly walletPath: string;

  constructor(walletPath: string) {
    this.walletPath = walletPath;
  }

  exists(): boolean {
    return existsSync(this.walletPath);
  }

  async metadata(): Promise<EncryptedWalletMetadata | undefined> {
    if (!this.exists()) {
      return undefined;
    }

    assertSecureFileMode(this.walletPath, "Wallet file");
    const wallet = parseWalletFile(
      readFileSync(this.walletPath, "utf8"),
      this.walletPath,
    );
    await verifyWalletAddressProof(wallet, this.walletPath);
    return toMetadata(wallet);
  }

  async save(params: {
    privateKey: Hex;
    passphrase: string;
  }): Promise<EncryptedWalletMetadata> {
    const wallet = await encryptWallet(params);
    writeFileAtomicSecure(this.walletPath, JSON.stringify(wallet, null, 2));
    return toMetadata(wallet);
  }

  async decrypt(passphrase: string): Promise<Hex> {
    if (!this.exists()) {
      throw new Error("No wallet configured. Run `moneyos init`.");
    }

    assertSecureFileMode(this.walletPath, "Wallet file");
    const wallet = parseWalletFile(
      readFileSync(this.walletPath, "utf8"),
      this.walletPath,
    );
    await verifyWalletAddressProof(wallet, this.walletPath);
    return decryptWalletFile(wallet, passphrase);
  }

  async exportData(): Promise<EncryptedWalletFile> {
    if (!this.exists()) {
      throw new Error("No wallet configured. Run `moneyos init`.");
    }

    assertSecureFileMode(this.walletPath, "Wallet file");
    const wallet = parseWalletFile(
      readFileSync(this.walletPath, "utf8"),
      this.walletPath,
    );
    await verifyWalletAddressProof(wallet, this.walletPath);
    return wallet;
  }

  async restore(data: EncryptedWalletFile): Promise<EncryptedWalletMetadata> {
    const wallet = parseWalletFile(JSON.stringify(data), this.walletPath);
    await verifyWalletAddressProof(wallet, this.walletPath);
    writeFileAtomicSecure(this.walletPath, JSON.stringify(wallet, null, 2));
    return toMetadata(wallet);
  }
}

export async function readEncryptedWalletFile(
  path: string,
): Promise<EncryptedWalletFile> {
  assertSecureFileMode(path, "Wallet file");
  const wallet = parseWalletFile(readFileSync(path, "utf8"), path);
  await verifyWalletAddressProof(wallet, path);
  return wallet;
}

export async function verifyEncryptedWalletPassphrase(
  wallet: EncryptedWalletFile,
  passphrase: string,
): Promise<EncryptedWalletMetadata> {
  await verifyWalletAddressProof(wallet, "(in-memory wallet)");
  await decryptWalletFile(wallet, passphrase);
  return toMetadata(wallet);
}
