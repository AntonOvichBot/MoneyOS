import type { Account, Address } from "viem";

/**
 * KeyStore — pluggable backend for loading an EOA signer.
 *
 * A KeyStore decides *how* a signer is obtained. It does not decide how
 * transactions are sent — that remains the responsibility of
 * `ExecutionClient`. See `docs/step-7-keystore.md` for the full design.
 *
 * The interface is deliberately narrow:
 *   - `loadSigner()` returns a viem `Account`, not a raw private key.
 *     There is intentionally no `getPrivateKey()` method. Future
 *     hardware-, KMS-, or MPC-backed stores must fit the same shape.
 *   - `metadata()` is async because some stores (e.g. 1Password) need I/O
 *     even to answer questions about the stored key.
 *   - `hasKey()` lets callers probe the store without triggering a full
 *     `loadSigner()` (which may prompt the user for biometric auth).
 */

/**
 * Identifies the backend kind of a `KeyStore`. `"custom"` is reserved for
 * stores that don't fit any of the built-in kinds and is not expected to be
 * used in v1.
 */
export type KeyStoreKind =
  | "file"
  | "1password"
  | "hardware"
  | "kms"
  | "custom";

/**
 * Non-secret descriptive information about a stored key. Safe to log or
 * display.
 */
export interface KeyStoreMetadata {
  kind: KeyStoreKind;
  /** Derived EOA address, if the store can produce it without loading the signer. */
  address?: Address;
  /** Optional human-readable label for the key (e.g. a 1Password item title). */
  label?: string;
}

export interface KeyStore {
  readonly kind: KeyStoreKind;
  metadata(): Promise<KeyStoreMetadata>;
  hasKey(): Promise<boolean>;
  /**
   * Load a viem `Account` that can sign transactions and messages.
   *
   * Returns viem's `Account` type (not the narrower `LocalAccount`) so that
   * future stores backed by hardware wallets, remote KMS, or MPC can return
   * a `toAccount({ signMessage, signTransaction, signTypedData })` wrapper
   * without changing this interface.
   */
  loadSigner(): Promise<Account>;
}
