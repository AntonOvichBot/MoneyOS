import type { Account, Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { KeyStore, KeyStoreMetadata } from "@moneyos/core";
import type { OpRunner } from "./op-runner.js";
import { privateKeyToManagedAccount } from "./signer.js";

/**
 * OnePasswordKeyStore — loads a signer from a 1Password item via the `op`
 * CLI.
 *
 * This preserves the currently-landed 1Password private-key storage path for
 * continuity, but it should be treated as transitional relative to the target
 * encrypted-local-wallet architecture documented in `docs/keystore.md`.
 *
 * Design rules:
 *
 *   - The store holds the stable identifier set `{ vaultId, itemId }`,
 *     never user-visible titles. `address` and `label` are display caches
 *     only and are NOT used for lookups.
 *   - Retrieval uses the secret reference
 *     `op://<vaultId>/<itemId>/private_key`, which is rename-proof,
 *     reorganization-proof, and special-character-proof because it uses
 *     opaque 1Password IDs throughout.
 *   - The `private_key` field label is pinned — it's part of the
 *     architectural contract with the 1Password item schema.
 *   - This module deliberately does NOT know how to *create* an item.
 *     Item creation lives in the CLI flow for `moneyos init --store
 *     1password`. This class is read-only; it assumes someone else wrote
 *     the item.
 *   - `hasKey()` and `metadata()` are cheap and synchronous-shaped — they
 *     do not shell out to `op` and therefore do not trigger biometric
 *     prompts. Only `loadSigner()` actually calls the runner.
 */

export interface OnePasswordKeyStoreOptions {
  /** The `OpRunner` used to execute `op` commands. Injected for testability. */
  runner: OpRunner;
  /** Stable 1Password vault ID. Opaque 26-character string. */
  vaultId: string;
  /** Stable 1Password item ID. Opaque 26-character string. */
  itemId: string;
  /** Optional cached EOA address. If present, `loadSigner()` verifies the retrieved key derives to this address. */
  address?: Address;
  /** Optional human-readable label for diagnostics. */
  label?: string;
}

/** Pinned field label for the concealed private key. See design doc. */
const PRIVATE_KEY_FIELD_LABEL = "private_key";

export class OnePasswordKeyStore implements KeyStore {
  readonly kind = "1password" as const;
  private runner: OpRunner;
  private vaultId: string;
  private itemId: string;
  private cachedAddress: Address | undefined;
  private label: string | undefined;

  constructor(options: OnePasswordKeyStoreOptions) {
    this.runner = options.runner;
    this.vaultId = options.vaultId;
    this.itemId = options.itemId;
    this.cachedAddress = options.address;
    this.label = options.label;
  }

  async hasKey(): Promise<boolean> {
    // Shallow check: the store is "configured" iff it has both identifiers.
    // A deep "does the item still exist" check would require an `op` call,
    // which triggers a biometric prompt — too expensive for a cheap probe.
    // Callers that need a liveness check should call `loadSigner()` and
    // handle the failure path.
    return Boolean(this.vaultId && this.itemId);
  }

  async metadata(): Promise<KeyStoreMetadata> {
    return {
      kind: "1password",
      address: this.cachedAddress,
      label: this.label,
    };
  }

  async loadSigner(): Promise<Account> {
    const reference = `op://${this.vaultId}/${this.itemId}/${PRIVATE_KEY_FIELD_LABEL}`;

    let result;
    try {
      result = await this.runner.run(["read", reference, "--no-newline"]);
    } catch (error) {
      // Spawn-level failure (op not installed, etc.) is already wrapped by
      // the runner. Re-throw with keystore-level context.
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `OnePasswordKeyStore: failed to invoke \`op\` for ${reference}: ${message}`,
        { cause: error },
      );
    }

    if (result.exitCode !== 0) {
      // Non-zero exit from `op read` typically means the item or vault is
      // gone, access was revoked, or the field label doesn't exist. Surface
      // whatever `op` said on stderr along with the reference so the user
      // can diagnose.
      const stderr = result.stderr.trim() || "(no stderr output)";
      throw new Error(
        `OnePasswordKeyStore: \`op read ${reference}\` exited with code ${result.exitCode}: ${stderr}`,
      );
    }

    const raw = result.stdout.trim();
    if (!raw) {
      throw new Error(
        `OnePasswordKeyStore: \`op read ${reference}\` returned an empty value`,
      );
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) {
      throw new Error(
        `OnePasswordKeyStore: value at ${reference} is not a valid 32-byte hex private key`,
      );
    }

    let signer: Account;
    try {
      signer = privateKeyToManagedAccount(raw as Hex);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `OnePasswordKeyStore: private key at ${reference} rejected by viem: ${message}`,
        { cause: error },
      );
    }

    if (this.cachedAddress && signer.address !== this.cachedAddress) {
      throw new Error(
        `OnePasswordKeyStore: address mismatch for ${reference}. Expected ${this.cachedAddress}, got ${signer.address}. The 1Password item may have been tampered with or replaced.`,
      );
    }

    return signer;
  }
}

/**
 * Pure helper: extract `vaultId` and `itemId` from the JSON response of
 * `op item create --format json`.
 *
 * The public 1Password CLI docs do not show the exact response shape, so
 * this adapter defensively handles both the nested form
 * `{ id, vault: { id } }` and the flat form `{ id, vault_id }`. Whichever
 * shape the live `op` binary actually returns gets pinned during the
 * implementation probe; until then, this helper is the ONLY place in the
 * codebase that touches the shape, per the design doc.
 *
 * Any garbage or missing-field input throws a clear error naming what was
 * wrong so the CLI slice can surface it to the user.
 */
export function extractIds(
  response: unknown,
): { vaultId: string; itemId: string } {
  if (typeof response !== "object" || response === null) {
    throw new Error(
      "extractIds: `op item create --format json` response is not an object",
    );
  }
  const obj = response as Record<string, unknown>;

  // Item ID is universally at the top level as `id` in all observed
  // 1Password CLI responses. If that ever changes, this is the single spot
  // to fix.
  const itemId = obj.id;
  if (typeof itemId !== "string" || itemId.length === 0) {
    throw new Error(
      "extractIds: `op item create --format json` response is missing `id`",
    );
  }

  // Vault ID may live at `vault.id` (nested) or `vault_id` (flat).
  // Try nested first.
  const vaultField = obj.vault;
  if (
    typeof vaultField === "object" &&
    vaultField !== null &&
    typeof (vaultField as Record<string, unknown>).id === "string" &&
    ((vaultField as Record<string, unknown>).id as string).length > 0
  ) {
    return {
      vaultId: (vaultField as Record<string, unknown>).id as string,
      itemId,
    };
  }

  const flatVaultId = obj.vault_id;
  if (typeof flatVaultId === "string" && flatVaultId.length > 0) {
    return { vaultId: flatVaultId, itemId };
  }

  throw new Error(
    "extractIds: `op item create --format json` response is missing a vault identifier (neither `vault.id` nor `vault_id`)",
  );
}

// --- Item creation (for `moneyos init --store 1password`) ---

/**
 * Build the in-memory JSON template for `op item create`. Internal shape —
 * deliberately not exported as a public type because:
 *
 *   - the 1Password item *category* is probe-required (see design doc) and
 *     must not bleed into any user-facing surface;
 *   - tags are attached via the `op` CLI's `--tags` flag at invocation
 *     time, not in this template body, so the body stays tag-free and we
 *     sidestep the docs ambiguity about template-body `tags` support.
 *
 * Only the field shape is load-bearing: one `CONCEALED` field labeled
 * `private_key`, and two `STRING` fields labeled `address` and `chain_id`.
 */
interface OnePasswordItemTemplate {
  title: string;
  category: string;
  fields: Array<{
    label: string;
    type: "CONCEALED" | "STRING";
    value: string;
  }>;
}

/**
 * Short-form address display: `0x1234…5678`. Used only in the item title
 * so the user can tell one MoneyOS wallet from another in the 1Password
 * UI. Not load-bearing — titles are not persisted as identifiers.
 */
function shortAddress(address: Address): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function buildInitTemplate(args: {
  privateKey: Hex;
  address: Address;
  chainId: number;
}): OnePasswordItemTemplate {
  const { privateKey, address, chainId } = args;

  // TODO(probe): 1Password item category is implementation-probe-required.
  // Picking "PASSWORD" as the default because every 1Password category
  // accepts arbitrary custom CONCEALED + STRING fields and PASSWORD is the
  // most semantically obvious for a wallet entry. Revisit after probing
  // the live `op item create` call — if another category produces a
  // cleaner UI or a more searchable shape, switch here. Category is NOT
  // part of any public type or CLI surface, so changing it is a local
  // implementation detail.
  const category = "PASSWORD";

  return {
    title: `MoneyOS key (${shortAddress(address)})`,
    category,
    fields: [
      {
        label: PRIVATE_KEY_FIELD_LABEL,
        type: "CONCEALED",
        value: privateKey,
      },
      {
        label: "address",
        type: "STRING",
        value: address,
      },
      {
        label: "chain_id",
        type: "STRING",
        value: String(chainId),
      },
    ],
  };
}

export interface CreateInOnePasswordOptions {
  /** The `OpRunner` used to execute `op`. Injected for testability. */
  runner: OpRunner;
  /** Private key to store. Derived address is returned for caller convenience. */
  privateKey: Hex;
  /** Default chain for this wallet. Stored as a STRING field in the item. */
  chainId: number;
}

export interface CreateInOnePasswordResult {
  vaultId: string;
  itemId: string;
  address: Address;
}

/**
 * Create a new MoneyOS wallet item in 1Password via the `op` CLI.
 *
 * Invokes `op item create --format json --tags moneyos -` with the item
 * template piped to stdin, then parses the returned JSON through
 * `extractIds` to recover the stable `{ vaultId, itemId }` pair. The
 * private key never appears in argv because the template goes over stdin.
 *
 * Tags are attached via the CLI flag `--tags moneyos`, not inside the
 * template body — this is the documented path, and it sidesteps the
 * probe-required ambiguity about template-body tag support.
 *
 * Errors are wrapped with context so the CLI layer can surface them
 * verbatim to the user:
 *
 *   - runner spawn failure (op not installed, etc.)
 *   - non-zero exit code from `op item create`
 *   - response body that is not valid JSON
 *   - response body that parses but is missing the expected identifiers
 *     (via `extractIds`)
 */
export async function createInOnePassword(
  options: CreateInOnePasswordOptions,
): Promise<CreateInOnePasswordResult> {
  const { runner, privateKey, chainId } = options;
  const account = privateKeyToAccount(privateKey);
  const address = account.address;

  const template = buildInitTemplate({ privateKey, address, chainId });

  let result;
  try {
    result = await runner.run(
      ["item", "create", "--format", "json", "--tags", "moneyos", "-"],
      { stdin: JSON.stringify(template) },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `createInOnePassword: failed to invoke \`op item create\`: ${message}`,
      { cause: error },
    );
  }

  if (result.exitCode !== 0) {
    const stderr = result.stderr.trim() || "(no stderr output)";
    throw new Error(
      `createInOnePassword: \`op item create\` exited with code ${result.exitCode}: ${stderr}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `createInOnePassword: \`op item create\` returned invalid JSON: ${message}`,
      { cause: error },
    );
  }

  const { vaultId, itemId } = extractIds(parsed);
  return { vaultId, itemId, address };
}

/**
 * Migration-specific escape hatch: read the raw private key hex from a
 * 1Password item.
 *
 * This deliberately lives OUTSIDE the `KeyStore` interface. The interface
 * exposes `loadSigner()` which returns a viem `Account` precisely to avoid
 * normalizing hex extraction — `getPrivateKey()` was rejected in the
 * design doc because it would make future hardware-, KMS-, or MPC-backed
 * stores awkward or impossible.
 *
 * Reverse migration (`moneyos keystore migrate --to file`) is the one
 * legitimate use case where the raw hex is required: we have to write it
 * back to `~/.moneyos/config.json`. This helper is the narrow, opt-in
 * escape hatch for that single flow. New consumers should call
 * `OnePasswordKeyStore.loadSigner()` instead and work with a viem
 * `Account`.
 *
 * Validation matches `OnePasswordKeyStore.loadSigner()`:
 *   - non-zero exit code → throw with stderr surfaced
 *   - empty output → throw
 *   - malformed hex → throw
 *   - spawn error → wrap with context
 *
 * Does NOT do the cached-address mismatch check — that's specific to the
 * `OnePasswordKeyStore` class because it holds the cached address. The
 * migration caller is expected to perform the check itself if it has a
 * cached address available.
 */
export async function readPrivateKeyHex(args: {
  runner: OpRunner;
  vaultId: string;
  itemId: string;
}): Promise<Hex> {
  const { runner, vaultId, itemId } = args;
  const reference = `op://${vaultId}/${itemId}/${PRIVATE_KEY_FIELD_LABEL}`;

  let result;
  try {
    result = await runner.run(["read", reference, "--no-newline"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `readPrivateKeyHex: failed to invoke \`op\` for ${reference}: ${message}`,
      { cause: error },
    );
  }

  if (result.exitCode !== 0) {
    const stderr = result.stderr.trim() || "(no stderr output)";
    throw new Error(
      `readPrivateKeyHex: \`op read ${reference}\` exited with code ${result.exitCode}: ${stderr}`,
    );
  }

  const raw = result.stdout.trim();
  if (!raw) {
    throw new Error(
      `readPrivateKeyHex: \`op read ${reference}\` returned an empty value`,
    );
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(
      `readPrivateKeyHex: value at ${reference} is not a valid 32-byte hex private key`,
    );
  }

  return raw as Hex;
}
