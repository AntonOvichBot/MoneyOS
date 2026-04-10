# KeyStore

Status: design draft. Describes where MoneyOS key management is going, not
everything that exists in code today. This doc is the living source of
truth; `docs/step-7-keystore.md` is archived history and divergences from it
are intentional.

## What it is

KeyStore is the concept that owns the private key **at rest**. A separate
session cache owns the **runtime unlocked state**. Signing commands check
the session first and only reach the backing store during an explicit
unlock. Outside the backing store and the session cache, nothing else in
the codebase should read or persist private key material directly.

The flagship story is simple:

- The wallet lives on disk, encrypted with a passphrase.
- A short-lived session cache sits above the backing store so you don't
  re-enter the passphrase on every command.
- 1Password is an optional backend for people who already live there.

Three backends in v1: `encrypted` (default), `plaintext` (the historical
stopgap, retained as an explicit opt-in), `1password` (optional).

## Where this fits

```
        moneyos send / swap / balance
                     │
                     ▼
              SessionCache
        (owns runtime unlocked state,
         session.json + in-memory,
         holds plaintext key while unlocked)
                     │
               miss  │  hit
                     ▼
               KeyStore
        (owns key at rest, one of:)
        ┌────────────┼──────────────┐
        ▼            ▼              ▼
   encrypted      plaintext      1Password
   wallet.json    wallet.json    item
```

Signing commands never touch the backing store in the happy path. They ask
the session cache for an account. On a miss, they fail fast and tell the
user to run `moneyos auth unlock`. Unlock is the only operation that
decrypts the backing store.

## Flagship: encrypted local wallet

The default backend. No accounts to create, no external services, works
offline.

- Private key is generated or imported via `moneyos init`.
- A passphrase is requested once at init time.
- The key is encrypted and written to `~/.moneyos/wallet.json`.
- Unlocking requires the passphrase; a successful unlock populates the
  session cache.

### Crypto choices (pinned)

v1 uses only Node's built-in `node:crypto`. No new runtime dependencies.

- **KDF**: `scrypt` (via `crypto.scryptSync` / `crypto.scrypt`)
- **Cipher**: `AES-256-GCM` (via `crypto.createCipheriv("aes-256-gcm", …)`)
- **Salt**: 16 bytes, `crypto.randomBytes`, stored per-file
- **IV**: 12 bytes, `crypto.randomBytes`, stored per-file
- **Auth tag**: 16 bytes from GCM, stored per-file
- **Version field**: present so the format can evolve

Exact scrypt params are still open (see Open questions) but will be tuned
so unlock takes roughly 500ms on a modern developer laptop. Argon2id and
XChaCha20-Poly1305 are explicitly **not** in v1 — they would pull in a
native dependency and the project has committed to `node:crypto` built-ins
only.

### `wallet.json` layout (sketch, not final)

```json
{
  "version": 1,
  "address": "0x…",
  "kdf": "scrypt",
  "kdfParams": { "N": 131072, "r": 8, "p": 1 },
  "salt": "base64…",
  "cipher": "aes-256-gcm",
  "iv": "base64…",
  "authTag": "base64…",
  "ciphertext": "base64…"
}
```

File mode is `0o600`, directory mode is `0o700`, matching what
`src/cli/config.ts` already does for `config.json`. The address is stored
in clear alongside the ciphertext so `moneyos keystore status` can answer
"which account is this?" without unlocking.

## Session cache

A cache so the passphrase is not demanded on every command. Lives above
the backing store, not inside it.

Behaviour:

- Default TTL: **4 hours**.
- TTL is wall-clock from the last successful unlock, not from last use. A
  session expires even if you are active.
- Backing file: `~/.moneyos/session.json`, `0o600`.
- Writes are **atomic**: write to `session.json.tmp`, `fsync`, then
  `rename`. A crashed CLI never leaves a half-written session file.
- On every read, expired sessions are deleted before being returned as a
  miss.
- `moneyos auth lock` deletes the session file.

Contents (sketch):

```json
{
  "version": 1,
  "address": "0x…",
  "privateKey": "0x…",
  "unlockedAt": 1730000000,
  "expiresAt": 1730014400,
  "backend": "encrypted"
}
```

### Why a file and not just memory

Because the CLI is short-lived. Every `moneyos balance` is a fresh
process. A purely in-memory cache would force the passphrase on every
invocation, which defeats the point. A file on disk, with a TTL, is the
smallest thing that makes the CLI usable without a daemon.

A long-running surface (Telegram bot, agent, SDK embedded in a server)
holds the key in memory only and never touches `session.json`. **The
session cache is CLI-only and is not part of the SDK's public surface.**
SDK embedders pass the key via `MoneyOSConfig.signer` and never interact
with the session cache at all.

## 1Password (optional)

For people who already run 1Password and want the key stored there instead
of a local encrypted file.

- Requires the `op` CLI to be installed and signed in.
- Key is stored as a 1Password item; the backing store reads it via `op`
  on unlock.
- The session cache still sits above it, with the same 4h TTL, so you
  aren't round-tripping to 1Password on every command.
- Selected at init time via `moneyos init --store 1password`.

1Password is explicitly optional. It is not installed as a dependency and
MoneyOS must work end-to-end without it.

## Commands

### `moneyos init [--store encrypted|plaintext|1password]`

Generate or import a key. `--store` picks the backing store; default is
`encrypted`.

- `encrypted`: prompts for a passphrase, writes `wallet.json`.
- `plaintext`: writes the key unencrypted into `wallet.json` (explicit
  opt-in; mirrors the historical behaviour).
- `1password`: writes the key to a 1Password item via `op`.

`init` does **not** populate the session cache. After `init` you run
`moneyos auth unlock` before signing, regardless of backend. For
`plaintext`, `auth unlock` does not prompt — it reads the key from
`wallet.json` and populates the session directly. Every signing path
goes through the session; there is no backend-specific shortcut.

### `moneyos auth unlock`

Prompt for the passphrase, decrypt `wallet.json`, write `session.json`
with a fresh 4h TTL. No-op with a friendly message if a live session
already exists. For the `plaintext` backend, `auth unlock` is still the
command that populates the session cache — it just doesn't prompt.

### `moneyos auth lock`

Delete `session.json`. Safe to run when there is no session.

### `moneyos auth status`

Reports on the **session**, not the backing store:

- Whether the session is currently unlocked
- Backend that unlocked it
- Time remaining on the TTL
- Address the session is bound to

### `moneyos keystore status`

Reports on the **backing store**, not the session:

- Which backend is configured (`encrypted`, `plaintext`, `1password`)
- Whether `wallet.json` exists and is readable
- Address from the stored wallet (read in clear alongside the ciphertext —
  no passphrase prompt)
- KDF / cipher / version fields from the file

This command never prompts for the passphrase.

Keeping `auth status` and `keystore status` separate is deliberate. "Is my
key configured?" and "am I currently unlocked?" are different questions
and should have different answers.

### `moneyos keystore migrate --to encrypted|plaintext|1password`

Move the key from the current backing store to a different one. Prompts
for the source passphrase if the current store is encrypted; prompts for a
new passphrase if the target is encrypted. Atomic: the new backing store
is written and verified before the old one is removed.

There is deliberately **no** `moneyos keystore use` command. Backend
selection happens at `init` time or via `keystore migrate`. Flipping a
pointer without moving the bytes is a footgun.

### Signing commands do not auto-unlock

In v1, `moneyos send`, `moneyos swap`, and `moneyos balance` **do not**
auto-prompt for the passphrase on a session miss. They fail fast with:

```
No active session. Run `moneyos auth unlock`.
```

This is deliberate. Auto-unlock conflates "I want to sign one thing" with
"I want to open a 4-hour signing window", and quietly promotes the latter
every time it fires. Making unlock explicit keeps the security boundary
legible: the window is opened by a command the user typed, not a side
effect.

## Interface sketch

Not locked in. Rough shape:

```ts
// From @moneyos/core (already landed, unchanged by this work):
interface KeyStore {
  readonly kind: KeyStoreKind;
  metadata(): Promise<KeyStoreMetadata>;
  hasKey(): Promise<boolean>;
  loadSigner(): Promise<Account>; // viem Account, never a raw Hex
}

// Concrete KeyStore implementations:
//   EncryptedFileKeyStore  — new: wallet.json + scrypt + AES-256-GCM
//   PlaintextFileKeyStore  — rename of the already-landed FileKeyStore;
//                            deprecated alias kept for one version
//   OnePasswordKeyStore    — already landed; item via `op` CLI

// CLI-only, not exported from @moneyos/core:
interface SessionCache {
  get(): Promise<CachedKey | null>;
  put(material: CachedKey, ttlMs: number): Promise<void>;
  clear(): Promise<void>;
  status(): Promise<SessionStatus>;
}
```

The `KeyStore` interface, `KeyStoreKind`, and `KeyStoreMetadata` are not
modified by this work. `loadSigner()` continues to return a viem
`Account` and there is deliberately no `getPrivateKey()` method — that
was load-bearing for future hardware, KMS, and MPC stores.

`MoneyOSConfig.signer` (the SDK-level config) **remains unchanged**. SDK
consumers pass a signer directly via that field and bypass both the
session cache and the backing store entirely. The keystore work is
strictly additive at the CLI layer.

`UnlockResolver` is a new CLI-only component that sits above the session
cache. It reads `session.json`, reconstructs an `Account` from the cached
material on hit, and fails fast on miss per the no-auto-unlock rule.
Backend-specific unlock code — decrypt `wallet.json`, read plaintext
`wallet.json`, or `op read` — is only invoked by the explicit
`moneyos auth unlock` command, which writes the resulting key material
into the session. Signing commands never call `KeyStore.loadSigner()`
directly; they go through the session cache and fail if it's empty.

## File layout

```
~/.moneyos/
├── config.json      chain, rpc, non-secret preferences (mode 0o600)
├── wallet.json      backing store — encrypted, plaintext, or 1Password
│                    pointer (mode 0o600)
└── session.json     cached plaintext key while unlocked (mode 0o600)
```

Directory itself is `0o700`. After migration, `config.json` stops carrying
the private key — that field moves to `wallet.json` and the config becomes
non-secret.

## Security boundary — honest version

This section exists because the alternative is pretending.

**While unlocked, `~/.moneyos/session.json` contains the plaintext private
key.** It is protected by file permissions (`0o600`) and nothing else. Any
process running as your user can read it. That includes a malicious `npm
postinstall` script, a compromised dev tool, or anything else with your
UID. A root user on the same machine can read it unconditionally.

This is a deliberate trade. The alternatives are:

- Re-prompt the passphrase on every command → unusable for a CLI people
  actually use.
- Hold the key in a background daemon / keychain agent → real project,
  platform-specific, not v1.
- Encrypt the session file under a key that is itself… stored where? →
  ends up somewhere on the same disk and doesn't change the threat model.

So the honest statement is: **the encrypted wallet protects your key at
rest and against disk theft / backup leaks. The session cache does not.
While unlocked, you are trusting your user account.**

The `plaintext` backend provides no at-rest protection either and is
offered only because some users (CI, ephemeral environments, deliberate
throwaway keys) genuinely want it. Choosing `plaintext` at `init` time is
an explicit opt-out of the at-rest guarantee.

Mitigations that are in scope:

- Default 4h TTL so an unattended laptop stops being a live wallet
  overnight.
- `moneyos auth lock` as a one-command wipe.
- Atomic writes so a crash never leaves a partially-written session with
  ambiguous contents.
- `auth status` surfaces the TTL so you can see the window closing.
- No auto-unlock, so the unlocked window is only ever opened by an
  explicit user action.

Mitigations that are out of scope for now and should be noted as such:

- OS keychain integration (macOS Keychain, Windows DPAPI, libsecret)
- Background agent holding the key in locked memory
- Hardware wallet backends
- Per-command re-auth for high-value operations

Users who need any of those today should use the 1Password backend and
accept the session-cache trade, or run MoneyOS inside a surface (server,
bot) that holds the key in memory and never writes `session.json`.

## Backward compatibility / config evolution

This work replaces the current `privateKey`-in-`config.json` stopgap but
must not break in-flight branches or existing installs.

- **Class rename**: the step-7 draft introduced `FileKeyStore`. This doc
  renames it to `PlaintextFileKeyStore` to make the semantics obvious next
  to the new `EncryptedFileKeyStore`. A deprecated alias `FileKeyStore =
  PlaintextFileKeyStore` is exported for **one version** and then removed.
- **Tolerant config reads**: older configs may carry
  `keyStore.kind === "file"`. The loader accepts this and reads it as
  `"plaintext"`. New configs write `"encrypted"` / `"plaintext"` /
  `"1password"` explicitly.
- **`MoneyOSConfig.signer` is unchanged.** SDK consumers see no breaking
  changes. The keystore work lives at the CLI layer.
- **Session cache is CLI-only.** It is not part of the SDK's public
  surface, not exported from `src/index.ts`, and must not be imported by
  any code that runs outside the CLI process.
- **Migration from `CLIConfig.privateKey`**: on first run after upgrade,
  if `config.json` contains `privateKey`, MoneyOS offers to migrate it
  into the new encrypted `wallet.json` (prompt for a new passphrase), then
  strips `privateKey` from `config.json`. Idempotent; runs once.
- `CLIConfig.privateKey` is removed from the type after the migration
  window closes.

## Implementation order

Build the layers bottom-up so each step is testable in isolation:

1. **Crypto helpers** — thin wrappers over `node:crypto` for
   `scrypt + AES-256-GCM` encrypt/decrypt, keyed by a passphrase. Pure
   functions, no I/O. Unit tests cover round-trip, wrong-passphrase
   failure, tampered-ciphertext rejection.
2. **Unlock resolver** — the single function that reads the session,
   returns an account on hit, and fails fast on miss (no auto-unlock).
   Testable against a fake `SessionCache`.
3. **Encrypted backing store** — `EncryptedFileKeyStore` on top of the
   crypto helpers, writing `wallet.json`. Also the
   `PlaintextFileKeyStore` rename and the tolerant legacy-kind read.
4. **Session cache** — `session.json`, atomic writes, TTL, `get`/`put`/
   `clear`/`status`.
5. **CLI / auth commands** — `moneyos init --store`, `moneyos auth
   unlock/lock/status`, `moneyos keystore status/migrate`, plus the
   no-auto-unlock wiring into `send/swap/balance`.

Only step 5 touches user-facing behaviour. Steps 1–4 can land behind the
existing `config.json` path without changing how anything runs today.

## Relationship to step 7

`docs/step-7-keystore.md` captured the first pass at this design. It
stays in the tree as archived history but is **not** the source of truth.
Where this doc and step 7 disagree, this doc wins. Known intentional
divergences:

- v1 crypto is pinned to `node:crypto` built-ins only (scrypt +
  AES-256-GCM). Step 7 left argon2id / XChaCha20-Poly1305 open.
- The file is named `wallet.json`, not `keystore.json`.
- `FileKeyStore` is renamed to `PlaintextFileKeyStore`; a new
  `EncryptedFileKeyStore` is the default.
- There is no `moneyos keystore use` command. Backend selection happens
  at `init` or via `keystore migrate`.
- Signing commands do not auto-unlock.
- Session cache is explicitly CLI-only and not part of the SDK surface.

## Open questions

Things that are not decided and should not be treated as decided:

- **scrypt parameters**: `N`, `r`, `p` values. Target ~500ms unlock on a
  modern developer laptop; measure before committing.
- **Passphrase entry**: `prompts`? `inquirer`? A hand-rolled `readline`
  with echo off? Must handle piped stdin (`echo pass | moneyos auth
  unlock`) for CI.
- **Multiple accounts**: v1 is single-account. The file layout should not
  paint us into a corner if a second account shows up.
- **Session sharing across surfaces**: does the Telegram bot on the same
  machine read the same `session.json`? It should not — it should hold
  its own in-memory key. Worth being explicit in the bot's own docs when
  that work lands.
- **1Password item schema**: field names, vault selection, how the user
  points MoneyOS at an existing item vs creating a new one.
- **Recovery**: lost passphrase = lost key. Do we support a separate
  mnemonic-backed recovery path, or is "write down your seed phrase at
  init" sufficient?

## Not yet

Out of scope for the first keystore landing, but on the radar:

- Hardware wallet backends (Ledger, Trezor)
- Remote KMS backends (AWS KMS, GCP KMS, Turnkey)
- Per-tool permissioning (swap allowed without re-auth, bank requires it)
- Particle Network social login as a backend (see VISION.md v2)
- OS keychain integration
- Auto-unlock with per-command confirmation

Each new backend is additive behind the same `KeyStore` interface. The
point of doing the interface first is so adding them later is additive,
not a rewrite.
