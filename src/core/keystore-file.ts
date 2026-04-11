import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Account, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { KeyStore, KeyStoreMetadata } from "@moneyos/core";
import { privateKeyToManagedAccount } from "./signer.js";

/**
 * FileKeyStore — raw-key JSON helper for library consumers.
 *
 * Reads a raw private key from a JSON file on disk (by default
 * `~/.moneyos/config.json`) and derives a viem `Account` from it.
 *
 * MoneyOS CLI no longer uses plaintext `config.json` wallet storage as its
 * default path. The CLI now uses an encrypted wallet file plus a local unlock
 * session. This helper remains available for advanced SDK use cases and
 * explicit raw-key compatibility paths outside the default CLI flow.
 */

export interface FileKeyStoreOptions {
  /**
   * Absolute path to the JSON config file that holds the private key.
   * Defaults to `~/.moneyos/config.json` for compatibility with earlier
   * raw-key layouts and explicit SDK usage.
   */
  configPath?: string;
}

const DEFAULT_CONFIG_PATH = join(homedir(), ".moneyos", "config.json");

/**
 * Minimal shape of the on-disk config that `FileKeyStore` cares about.
 * Other fields (chainId, rpcUrl, future keystore metadata) are tolerated
 * and ignored.
 */
interface FileKeyStoreConfig {
  privateKey?: Hex;
}

export class FileKeyStore implements KeyStore {
  readonly kind = "file" as const;
  private configPath: string;

  constructor(options: FileKeyStoreOptions = {}) {
    this.configPath = options.configPath ?? DEFAULT_CONFIG_PATH;
  }

  async hasKey(): Promise<boolean> {
    const config = this.readConfig();
    return Boolean(config?.privateKey);
  }

  async metadata(): Promise<KeyStoreMetadata> {
    const config = this.readConfig();
    const address = config?.privateKey
      ? privateKeyToAccount(config.privateKey).address
      : undefined;
    return {
      kind: "file",
      address,
    };
  }

  async loadSigner(): Promise<Account> {
    const config = this.readConfig();
    if (!config?.privateKey) {
      throw new Error(
        `FileKeyStore: no private key found at ${this.configPath}. Run \`moneyos init\` to create one.`,
      );
    }
    return privateKeyToManagedAccount(config.privateKey);
  }

  /**
   * Read and validate the config file. Returns `undefined` if the file does
   * not exist. Throws with context for any other failure mode (malformed
   * JSON, wrong top-level type, wrong `privateKey` type). The hex format of
   * the key itself is validated later by viem's `privateKeyToAccount`.
   */
  private readConfig(): FileKeyStoreConfig | undefined {
    if (!existsSync(this.configPath)) {
      return undefined;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.configPath, "utf-8"));
    } catch (error) {
      throw new Error(
        `FileKeyStore: failed to read config at ${this.configPath}`,
        { cause: error },
      );
    }

    if (typeof parsed !== "object" || parsed === null) {
      throw new Error(
        `FileKeyStore: config at ${this.configPath} is not a JSON object`,
      );
    }

    const pk = (parsed as { privateKey?: unknown }).privateKey;
    if (pk === undefined || pk === null) {
      return {};
    }
    if (typeof pk !== "string") {
      throw new Error(
        `FileKeyStore: privateKey at ${this.configPath} must be a string`,
      );
    }
    return { privateKey: pk as Hex };
  }
}
