# Step 7 — KeyStore Abstraction for EOA Signers

Status: draft, uncommitted

Branch target: `claude/review-wal-bugfixes-XSff1`

This document proposes the next slice after the Step 1-6 runtime seam work:
replace "raw private key in `~/.moneyos/config.json`" as the only storage
model with a `KeyStore` abstraction, while keeping execution on the existing
EOA path.

This is a pivot away from "social binding" as the centerpiece. The product
need we are solving here is secret storage, sync, and recovery UX, not social
identity or gasless execution.

## Goals

- Let users initialize and use MoneyOS without manually managing a raw key
  file as the only option.
- Keep the execution path as a normal EOA using the existing runtime seam.
- Add a pluggable `KeyStore` abstraction that can back an EOA signer from:
  - file storage (current behavior)
  - 1Password via the `op` CLI and desktop app integration
- Keep `@moneyos/core` vendor-neutral and future-compatible with hardware,
  MPC, or KMS-backed signers.
- Preserve backward compatibility for existing users with
  `~/.moneyos/config.json` containing `privateKey`.

## Non-goals

- No social identity binding in this step.
- No backend service.
- No encrypted backup blob managed by MoneyOS.
- No account abstraction / gasless / Particle dependency changes.
- No promise that key material never exists. This is not MPC.
- No OS keychain integration in v1 of this slice.

## What This Is / What This Isn't

This step is:

- a storage abstraction for obtaining a signer
- a UX improvement for setup, sync, and recovery when users already trust a
  secret manager like 1Password
- a way to keep the runtime seam honest by separating "how a signer is loaded"
  from "how transactions are sent"

This step is not:

- social login
- public identity binding
- custody
- MPC
- "no private key exists anywhere"

With `OnePasswordKeyStore`, the private key still exists and is still used to
produce signatures. The improvement is that MoneyOS does not require the user
to keep that key in a plaintext-ish app config file under `~/.moneyos/` as the
default long-term storage model.

## Trust Model

### FileKeyStore

- Trust boundary: the local machine and filesystem permissions.
- The private key lives in `~/.moneyos/config.json` with mode `0o600`.
- Losing the file loses the wallet unless the user has copied the key
  elsewhere.
- Compromise of the machine or the config file compromises the wallet.

### OnePasswordKeyStore

- Trust boundary: local machine, 1Password desktop app, `op` CLI, and the
  user's 1Password account.
- The private key is stored in a 1Password item rather than in MoneyOS config.
- Cross-device sync and account recovery are delegated to 1Password.
- Compromise of the user's 1Password account or a maliciously approved
  `op` request can compromise the wallet.
- If 1Password is unavailable, the wallet is temporarily inaccessible.

### In-process secret lifetime

Even with `OnePasswordKeyStore`, the private key still enters MoneyOS process
memory at sign time unless and until we support a non-exportable signer.

Implications:

- This is an improvement in storage and recovery UX, not elimination of secret
  exposure.
- We should minimize secret lifetime in memory and avoid logging, throwing,
  or persisting raw key material anywhere outside the store boundary.
- The `KeyStore` API should not normalize the codebase around
  `getPrivateKey(): Hex`, because that would make future hardware/MPC stores
  awkward or impossible.

## High-level design

### Guiding principle

The runtime seam already has the right split:

- `ExecutionClient` decides how transactions are sent
- `ReadClient` decides how chain state is read

This step adds a separate concern:

- `KeyStore` decides how an EOA signer is loaded

The `KeyStore` does not become part of `ExecutionClient`. Instead, the store
resolves to a signer, and the existing EOA executor uses that signer.

### Proposed architectural split

- `@moneyos/core` gains `KeyStore` types
- `src/core/eoa.ts` changes `EOAExecutor` to take a signer/account instead of a
  raw private key
- the CLI resolves the configured store into a signer before constructing
  `MoneyOS`
- `MoneyOSConfig` gains a `signer` field, while `privateKey` remains as a
  legacy convenience

This keeps the public runtime seam honest:

- `MoneyOS` does not care whether the signer came from a file, 1Password,
  hardware wallet, or future MPC session
- `KeyStore` stays a separate abstraction from `AccessAdapter`

## Core types

### New file in `@moneyos/core`

Add a new file, likely:

- `packages/core/src/keystore.ts`

and re-export from:

- `packages/core/src/index.ts`

This keeps the terminology separate from `AccessAdapter` / `AccessSession`
already defined in `packages/core/src/runtime.ts`.

### Proposed types

```ts
import type { Account, Address } from "viem";

export type KeyStoreKind =
  | "file"
  | "1password"
  | "hardware"
  | "kms"
  | "custom";

export interface KeyStoreMetadata {
  kind: KeyStoreKind;
  address?: Address;
  label?: string;
}

export interface KeyStore {
  readonly kind: KeyStoreKind;
  metadata(): Promise<KeyStoreMetadata>;
  hasKey(): Promise<boolean>;
  loadSigner(): Promise<Account>;
}
```

Notes:

- `loadSigner()` returns viem's `Account`, not a raw key and not the narrower
  `LocalAccount`. This is deliberate: `Account` accommodates both
  `privateKeyToAccount(...)` and
  `toAccount({ signMessage, signTransaction, signTypedData })` wrappers, which
  is how future hardware, KMS, and MPC stores will fit the same interface
  without a redesign.
- `metadata()` is async because some stores may need I/O even for metadata.
- We are deliberately not exposing `getPrivateKey()`.

## Changes to `MoneyOSConfig`

Current `MoneyOSConfig` in `packages/core/src/runtime.ts` supports:

- `privateKey?: Hex`
- `execute?: ExecutionClient`
- `read?: ReadClient`
- `assets?: AssetRegistry`

Proposed addition:

```ts
import type { Account } from "viem";

// in MoneyOSConfig:
signer?: Account;
```

Rules:

- `execute` remains mutually exclusive with `privateKey` and `signer`
- `privateKey` and `signer` are mutually exclusive
- `signer` is the preferred new path for EOA execution
- `privateKey` remains supported as a legacy shortcut

### Why `signer` instead of `keyStore` in `MoneyOSConfig`

`MoneyOS` should receive a resolved signer, not own the logic for launching
`op`, handling app prompts, or deciding how secrets are loaded.

That keeps:

- library usage simple and predictable
- CLI-specific keystore plumbing outside the core client
- the core runtime synchronous once dependencies are resolved

## `EOAExecutor` refactor

Current constructor in `src/core/eoa.ts`:

```ts
constructor(privateKey: Hex, config: RuntimeConfig)
```

Proposed constructor:

```ts
constructor(signer: Account, config: RuntimeConfig)
```

Proposed helper:

```ts
static fromPrivateKey(privateKey: Hex, config: RuntimeConfig): EOAExecutor
```

Behavioral changes:

- `getAddress()` returns `signer.address`
- no direct private-key parsing inside the executor unless the convenience
  helper is used
- `send()` uses the resolved signer with `createWalletClient`

Benefits:

- `EOAExecutor` stops assuming keys always come from raw hex
- the execution seam stays reusable for file, 1Password, hardware, and future
  stores
- the current private-key path remains a one-line convenience

## FileKeyStore

### Purpose

Wrap the current `~/.moneyos/config.json` storage model behind the same
interface as future stores.

### Behavior

- Reads `privateKey` from existing CLI config
- Returns metadata with:
  - `kind: "file"`
  - derived `address`
- `hasKey()` checks whether `privateKey` exists
- `loadSigner()` derives a viem signer from the private key

### Backward compatibility

This store is the bridge that lets all existing users continue to work without
changing their config immediately.

The old config shape remains valid:

```json
{
  "chainId": 42161,
  "rpcUrl": "https://...",
  "privateKey": "0x..."
}
```

### Storage

- Continue using `~/.moneyos/config.json`
- Continue using `0o700` for the directory and `0o600` for the file

## OnePasswordKeyStore

### Purpose

Use 1Password as the secret store for the EOA private key while keeping the
execution path local and non-custodial.

### Supported mode in v1

Desktop app integration is the default supported path.

That means:

- `op` CLI must be installed
- the 1Password desktop app must be installed and signed in
- authorization prompts happen through the desktop app

Manual `op signin` is not the default UX. It may remain a fallback for
headless environments later, but it is not the primary design target for this
step.

### 1Password item schema

The wallet lives in a single 1Password item. Only the field shape is
architecturally load-bearing; the category is an implementation detail.

**Pinned (architectural):**

- one `CONCEALED` field with label `private_key` — holds the hex-encoded key
- one `STRING` field with label `address` — the derived EOA address, for
  diagnostics and display
- one `STRING` field with label `chain_id` — the default chain for this wallet

The labels `private_key`, `address`, and `chain_id` are intentionally pinned.
They become part of the secret reference MoneyOS constructs at read time
(`op://<vaultId>/<itemId>/private_key`), and changing them later is a
migration.

**Implementation-probe required (not architectural):**

- the 1Password item *category*. No architectural dependency on a specific
  category has been established. `PASSWORD`, `API_CREDENTIAL`, and
  `SECURE_NOTE` all accept arbitrary custom `CONCEALED` and `STRING` fields,
  and the public docs do not indicate a functional difference for our shape.
  The final category gets pinned during implementation after a live probe.
  Until then, treat the category as an internal choice inside
  `OnePasswordKeyStore`, not a user-visible contract.

**Tags:**

Tags are set via `--tags moneyos` on the `op item create` invocation, not
inside the stdin JSON template body. Whether 1Password's template schema
accepts a top-level `tags` array is not clearly documented; the `--tags`
CLI flag is documented and works regardless. Using the flag sidesteps the
ambiguity entirely.

Template-body tag support is implementation-probe required and may be
adopted later if it simplifies the flow.

**MoneyOS local config persists (stable identifier set):**

- `kind: "1password"`
- `vaultId` — opaque 1Password identifier, persisted verbatim
- `itemId` — opaque 1Password identifier, persisted verbatim

`address` may also be cached locally as a display convenience, but it is
*not* part of the stable identifier set and must not be relied on for
lookups.

**Identifier format note:**

1Password IDs are opaque 26-character strings (Crockford-style), not RFC 4122
UUIDs. Do not type them as `UUID` in TypeScript. Treat them as `string` and
persist whatever the CLI returns verbatim.

**Why IDs, not titles:**

MoneyOS must persist stable IDs, never titles. Titles are user-editable.
Using `vaultId`/`itemId` in the secret reference makes the reference
resilient to vault renames, item renames, and field reorganization into
sections — the reference `op://<vaultId>/<itemId>/private_key` resolves
regardless of what the user does in the 1Password UI, as long as the item
and its `private_key` field still exist.

### Secret creation flow

When `moneyos init --store 1password` is used:

1. Generate a new private key or import one via `--key`.
2. Derive the address locally with viem.
3. Build the 1Password item template as an in-memory JSON object containing
   the three pinned fields (`private_key`, `address`, `chain_id`) and the
   `title`. Do **not** include a top-level `tags` array in the template body.
4. Pipe the JSON to `op item create --tags moneyos --format json` via stdin.
   The `--tags` flag is how the `moneyos` tag gets attached; the template
   body stays tag-free.
5. Parse the returned JSON and extract the item and vault identifiers via a
   small adapter:

       function extractIds(createResponse: unknown): { vaultId: string; itemId: string }

   The adapter is the *only* place that knows the shape of `op item create
   --format json` output. The public CLI docs do not show the response
   schema, so the exact nesting (`{ vault: { id } }` vs `{ vault_id }`) is
   treated as implementation-probe-required and isolated to this one
   function. Nothing else in the codebase depends on it.

6. Save only `{ kind: "1password", vaultId, itemId }` (plus an optional
   `address` display cache) to `~/.moneyos/config.json`.

Security notes:

- Never pass the private key on the command line as `key=value` field
  arguments. The `op` CLI help explicitly warns that "command arguments can
  be visible to other processes on your machine. If you're assigning
  sensitive values, use an item JSON template instead." The item creation
  payload must go through stdin so the secret does not appear in process
  args, shell history, or `ps`.
- Clear the in-memory private key buffer as soon as the `op` call resolves.

### Secret read flow

When a command needs a signer:

1. Read the local MoneyOS config and resolve `vaultId` and `itemId`.
2. Run `op read "op://<vaultId>/<itemId>/private_key"` (with `--no-newline`)
   to retrieve the concealed private key.
3. Derive the address locally and verify it matches the cached `address`
   metadata if present; mismatch is a hard error.
4. Return a viem `Account` constructed from the retrieved key.

The reference format `op://<vaultId>/<itemId>/private_key` uses opaque IDs,
not user-visible names. This is deliberate and load-bearing: the reference
survives vault renames, item renames, and reorganizing the field into a
section. The only thing that can break it is the user deleting the item or
revoking MoneyOS's access to the vault, both of which are handled
explicitly in the error cases below.

The `private_key` segment is a field *label*. 1Password's secret-reference
syntax documents that labels may contain alphanumerics, `-`, `_`, `.`, and
spaces, so `private_key` is a valid and stable choice.

### Error cases

Expected failure cases include:

- `op` CLI not installed
- 1Password app not installed or not running
- user not signed into the app
- item deleted
- vault deleted or access revoked
- required field missing
- stored `address` metadata does not match the retrieved private key

These should produce direct, user-actionable CLI errors.

## CLI config changes

Current `src/cli/config.ts` schema:

```ts
interface CLIConfig {
  chainId?: number;
  rpcUrl?: string;
  privateKey?: Hex;
}
```

Proposed shape:

```ts
interface CLIConfig {
  chainId?: number;
  rpcUrl?: string;
  privateKey?: Hex; // legacy / file-keystore compatibility
  keyStore?: {
    kind: "file" | "1password";
    // Stable identifier set for the 1password kind — the only fields MoneyOS
    // relies on for lookups. Persisted verbatim from the op CLI response.
    vaultId?: string;
    itemId?: string;
    // Display cache only. Never used for lookups; safe to drop or refresh.
    address?: Address;
    label?: string;
  };
}
```

Rules:

- existing configs with only `privateKey` remain valid
- a config should not persist both active `privateKey` and active
  `keyStore.kind === "1password"` unless explicitly in a transitional state
- if `MONEYOS_PRIVATE_KEY` is set in the environment, it continues to override
  file config and behaves as an ephemeral file-style signer

## CLI command changes

### `moneyos init`

Current:

- generates a new private key or imports one via `--key`
- writes `privateKey` to config

Proposed:

```text
moneyos init [--store file|1password] [--key <privateKey>] [--chain <id>] [--rpc <url>] [--vault <vaultId>]
```

Behavior:

- default store is `file`
- `--store file` preserves current behavior
- `--store 1password` creates/imports the key and writes it to 1Password,
  storing only metadata locally
- output always prints the derived address and config path
- for 1Password, also print enough metadata to help the user diagnose later,
  but never the secret

### `moneyos keystore status`

Purpose:

- show how the current wallet is stored
- confirm whether the configured store is accessible

Example output:

```text
Key store: 1password
Address:   0x...
Vault ID:  vault-uuid
Item ID:   item-uuid
Config:    /Users/.../.moneyos/config.json
Status:    ready
```

Error examples:

- `1Password CLI (op) not found in PATH`
- `1Password desktop app is not available or not signed in`
- `Configured 1Password item was not found`
- `Configured wallet metadata does not match retrieved signer`

### `moneyos keystore migrate --to 1password`

Purpose:

- move an existing file-backed wallet into 1Password

Flow:

1. Read the existing file-backed private key
2. Create the 1Password item
3. Verify the derived address matches the original
4. Rewrite config to `keyStore.kind = "1password"`
5. Remove `privateKey` from config by default

Suggested optional flag:

- `--keep-file-copy` for users who explicitly want a transitional duplicate

Default should favor safety of the new model:

- successful migration removes the file copy unless explicitly overridden

### `moneyos keystore migrate --to file`

Purpose:

- downgrade from a 1Password-backed wallet back to a file-backed wallet

This is a security downgrade: the private key moves from a concealed
1Password item to a plaintext field in `~/.moneyos/config.json`. The command
must make this explicit to the user and must not proceed silently.

Flow:

1. Print an explicit downgrade warning and require a typed `yes`
   confirmation (or `--yes` for non-interactive use), naming the exact file
   that will hold the plaintext key.
2. Read the private key from 1Password via
   `op read "op://<vaultId>/<itemId>/private_key"`.
3. Derive the address locally and verify it matches the stored `address`
   metadata; mismatch aborts the migration without touching config.
4. Rewrite `~/.moneyos/config.json` to set `privateKey` and
   `keyStore.kind = "file"` (or remove the `keyStore` block entirely, since
   file-backed is the legacy/default shape).
5. Do **not** delete the 1Password item by default. The user may want a
   backup; deletion is opt-in via `--delete-1password-item`.

Rationale for including this in v1:

- Symmetry. "You can get in but not out" is a bad first impression for an
  optional feature.
- Implementation cost is small: one `op read`, one `saveConfig`, one
  confirmation prompt. The error-handling surface overlaps with the forward
  migration.
- Users experimenting with 1Password need an escape hatch that doesn't
  require manual JSON editing.

## Integration with `MoneyOS`

### Recommended construction path

For library consumers:

- `privateKey` remains supported
- `signer` becomes the preferred advanced EOA path

For CLI consumers:

- CLI loads config
- CLI resolves the configured `KeyStore`
- CLI calls `loadSigner()`
- CLI constructs `MoneyOS` with `signer`

Example:

```ts
const signer = await keyStore.loadSigner();
const moneyos = createMoneyOS({
  chainId,
  rpcUrl,
  signer,
});
```

### Why this avoids the sync/async trap

The keystore boundary is async. The runtime is not forced to be.

This keeps:

- `KeyStore.loadSigner()` async, which is correct for 1Password and future
  hardware/MPC stores
- `MoneyOS` and `EOAExecutor` operating on a resolved signer once constructed

This is the current recommended answer to the sync-vs-async question.

## Test plan

### Unit tests

Add tests for:

- `FileKeyStore`
  - no key present
  - key present
  - derived address correctness
- `OnePasswordKeyStore`
  - metadata resolution
  - successful `loadSigner()`
  - missing `op`
  - missing item
  - mismatched address
- `EOAExecutor`
  - accepts a signer/account directly
  - preserves current behavior through `fromPrivateKey`
- CLI config migration
  - legacy config still works
  - migration removes `privateKey` by default

### Mocking strategy

Do not shell out to a real `op` binary in normal unit tests.

Instead:

- isolate shell execution behind a small `OpRunner` interface
- mock that runner in tests
- keep 1Password-specific parsing logic deterministic

### Optional smoke path

Add an opt-in local smoke script later, for example:

- `scripts/smoke-1password.ts`

This should not run in CI by default. It is only for manual verification on a
machine with `op` and the desktop app installed.

## Backward compatibility

This slice must not break existing users.

Backward-compat requirements:

- existing `privateKey` configs still work
- env var override `MONEYOS_PRIVATE_KEY` still works
- `createMoneyOS({ privateKey })` still works
- `EOAExecutor.fromPrivateKey(...)` remains available

Migration should be opt-in.

## Future extensions

### Near-term

- `KeychainKeyStore` for macOS
- `BitwardenKeyStore`
- `AWSKmsKeyStore`
- `GCPKmsKeyStore`

### Longer-term

- hardware-backed signer stores
- MPC-backed signers
- true non-exportable signers

### Explicitly deferred

- social binding
- email verification
- encrypted backup blob
- recovery workflows

Those remain separate features and should not be folded back into the keystore
slice.

## Decisions

### Decided

- Step 7 pivots from social binding to keystore-backed EOA signers.
- `KeyStore` is a separate abstraction from `AccessAdapter`. The two must
  not be conflated even though both touch identity.
- `loadSigner()` returns viem's `Account` type, not a raw key and not the
  narrower `LocalAccount`. This is the widest viem signer type that
  `createWalletClient({ account })` accepts, and it accommodates future
  hardware, KMS, and MPC stores without a redesign.
- `FileKeyStore` and `OnePasswordKeyStore` are the v1 stores.
- 1Password desktop app integration is the supported default mode. Manual
  `op signin` remains a headless fallback for later.
- Local config persists the stable 1Password identifier set
  `{ kind: "1password", vaultId, itemId }`, never titles. Any additional
  fields (`address`, `label`) are display caches only.
- 1Password IDs are opaque 26-character strings, not RFC 4122 UUIDs. Persist
  them verbatim as `string`.
- 1Password item creation pipes JSON via stdin, never via command-line
  `key=value` field arguments, because the `op` CLI documents that argv is
  visible to other processes.
- The three architecturally pinned fields on the 1Password item are:
  - `CONCEALED` field labeled `private_key`
  - `STRING` field labeled `address`
  - `STRING` field labeled `chain_id`
- Retrieval uses the secret reference
  `op://<vaultId>/<itemId>/private_key`, which is rename-proof and
  reorganization-proof because it uses IDs rather than names.
- Tags are attached via the `--tags moneyos` CLI flag on `op item create`,
  not inside the stdin JSON template body. Template-body tag support is
  probe-required and may be adopted later.
- `op item create --format json` response parsing lives behind a single
  `extractIds(response)` adapter. The rest of the codebase does not depend
  on the response JSON shape.
- `privateKey` remains supported in `MoneyOSConfig` and `CLIConfig` for
  backward compatibility.
- `moneyos keystore migrate --to file` is in scope for v1, with an explicit
  typed-confirmation downgrade prompt.

### Open questions (implementation probe required)

- The final 1Password item *category*. No architectural dependency exists;
  the choice is whichever category makes the live `op item create` call
  cleanest. Pin during implementation.
- The exact JSON shape of `op item create --format json` (nested
  `{ vault: { id } }` vs flat `{ vault_id }`). Isolated to `extractIds()`.
- Whether a top-level `tags` array in the stdin template body is accepted.
  Sidestepped in v1 by using the documented `--tags` CLI flag; revisit only
  if it simplifies the flow.
- Whether to clear the in-memory private key buffer explicitly after
  signing (best-effort — Node does not guarantee memory zeroization, but we
  can at least drop references promptly).

## Proposed implementation order

1. Add `KeyStore` core types and exports (viem `Account` return type pinned).
2. Refactor `EOAExecutor` to accept a signer, plus `fromPrivateKey` helper.
3. Extend `MoneyOSConfig` with `signer` and preserve `privateKey`.
4. Add `FileKeyStore`.
5. Extend CLI config schema for `keyStore` (stable identifier set only).
6. Add a small `OpRunner` shell-execution abstraction and mock it in tests.
7. Add `OnePasswordKeyStore`, including the `extractIds()` adapter and the
   `op://<vaultId>/<itemId>/private_key` read path.
8. Update `moneyos init --store file|1password`.
9. Add `moneyos keystore status`.
10. Add `moneyos keystore migrate --to 1password`.
11. Add `moneyos keystore migrate --to file` with typed-confirmation downgrade.
12. Add unit tests and optional `scripts/smoke-1password.ts` scaffolding.

## Why this is the right next step

Compared to the parked email-binding design, this slice:

- solves the real user pain more directly
- avoids building a backend
- delegates sync and recovery to a tool users may already trust
- keeps the runtime seam reusable
- is honest about the remaining security boundary

Compared to Particle/MPC, this slice:

- does not provide "no private key exists" UX
- does not provide social login
- does provide a simpler, faster, and more portable path to better key
  management today
