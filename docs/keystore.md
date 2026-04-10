# KeyStore Architecture

Status: current-state document with forward-looking notes. This file describes
what is landed in code today, then calls out the next architectural steps
separately. It does not pretend the future design is already built.

## The short version

MoneyOS already has the right high-level seam:

- The SDK is storage-agnostic.
- The CLI is responsible for turning "whatever backend owns the key" into a
  signer.
- Backends implement the `KeyStore` interface and return a viem `Account`,
  not a raw private key API.

What is still transitional is the storage model and some naming:

- `file` currently means "legacy plaintext private key in
  `~/.moneyos/config.json`".
- `1password` currently means "the private key itself is stored in 1Password
  in a field named `private_key`".
- The intended product model is different: encrypted local wallet as source of
  truth, with password managers acting only as optional unlock helpers.
- That encrypted-wallet plus unlock/session flow is not landed yet.

## What is true today

### SDK boundary

`MoneyOS` itself does not know or care where a key came from.

It accepts one of:

- `privateKey`: legacy shortcut for a local EOA
- `signer`: a pre-loaded viem `Account`
- `execute`: a fully custom `ExecutionClient`

That means the long-term product shape is already viable: CLI and tooling can
resolve signers from many backends without teaching the SDK about 1Password,
Bitwarden, Ledger, KMS, or anything else.

### Current backends

#### `file`

Current meaning: legacy plaintext local storage.

- The private key lives directly in `~/.moneyos/config.json` as
  `privateKey`.
- `keyStore.kind === "file"` is only a descriptor. The actual secret is still
  the root-level `privateKey`.
- This is a compatibility backend, not the final local-wallet design.

#### `1password`

Current landed meaning: the real wallet private key is stored in 1Password.

- The 1Password item contains the private key in a concealed field named
  `private_key`.
- Local config stores only stable identifiers and cached metadata:
  `vaultId`, `itemId`, optional `address`, optional `label`.
- Reads happen through the `op` CLI using the stable reference
  `op://<vaultId>/<itemId>/private_key`.

This is important: the current 1Password-compatible path is not "store a
passphrase in 1Password and unlock a separate local encrypted wallet". It
stores the private key itself.

That is landed code, but it is not the intended end-state product model.

### Current CLI resolution path

Normal wallet commands now resolve a signer through one shared backend-aware
path instead of reading `config.privateKey` directly inside each command.

Current precedence:

1. `MONEYOS_PRIVATE_KEY` env var
2. configured `1password` backend
3. legacy `file` backend

Commands using that path:

- `moneyos send`
- `moneyos swap`
- `moneyos balance` when no explicit `--address` is provided

Read-only balance lookups stay read-only:

- `moneyos balance <token> --address 0x...` does not load a signer and should
  not trigger a 1Password prompt.
- `moneyos balance <token>` also stays lightweight for a 1Password-compatible
  config when `keyStore.address` is present in local config. In that case the
  CLI uses cached address metadata and does not need `op read` just to know
  "my address".
- If a 1Password-compatible config is missing cached address metadata, the CLI
  currently falls back to loading the signer from 1Password to derive the
  address. That fallback exists for continuity with older or hand-edited
  configs, but it is a compatibility limitation, not the desired long-term UX.

### Nonce behavior

Local EOA signers derived from:

- the legacy file path
- the current 1Password-compatible path
- `MONEYOS_PRIVATE_KEY`

attach viem's nonce manager so back-to-back live transactions use
pending-aware nonce sequencing.

### Current commands

- `moneyos init [--store file|1password]`
- `moneyos keystore status [--live]`
- `moneyos keystore migrate --to file|1password`

Important product rule:

- For an existing file-backed wallet, the move to 1Password is
  `moneyos keystore migrate --to 1password`.
- `moneyos init --store 1password` is the "create or reinitialize wallet"
  path, not the migration path for an already-in-use wallet.

## What is not landed yet

The following design ideas are still future work:

- encrypted local wallet file such as `wallet.json`
- passphrase-based unlock flow
- session cache / TTL
- `moneyos auth unlock`
- `moneyos auth lock`
- `moneyos auth status`
- strict removal of plaintext key material from local config for the default
  local backend

Those ideas may still be the right direction, but they are not the current
architecture and docs should not describe them as if they already exist.

## Long-term architecture target

This is the clean model to design toward.

### Layer 1: encrypted local wallet is the source of truth

The wallet at rest should live locally in an encrypted wallet file, not inside
1Password or another password manager.

That layer should own:

- encrypted key material
- wallet metadata needed to identify the account
- migration from the legacy plaintext config format

### Layer 2: unlock helpers supply the passphrase or unlock secret

Password managers belong here, not at the wallet-storage layer.

Examples:

- manual terminal prompt
- environment variable for controlled automation
- 1Password
- Bitwarden
- OS keychain helpers

These helpers should provide the secret needed to unlock the local encrypted
wallet. They should not become the canonical place where the wallet private key
itself lives.

### Layer 3: session cache sits above the encrypted wallet

The CLI is short-lived, so an unlock/session layer is still the right target.

That layer should own:

- unlock TTL
- lock/unlock/status commands
- avoiding repeated prompts on every command
- deleting expired session state safely

### Layer 4: SDK stays backend-agnostic

Keep `MoneyOS` and `@moneyos/core` focused on:

- `signer`
- `execute`
- `read`
- `assets`

Do not make the SDK know about 1Password, Bitwarden, hardware wallets, or
cloud providers.

### Layer 5: CLI resolves the active signer through one shared path

The CLI should own:

- reading local config
- env overrides
- session lookup
- unlock flow
- prompting / unlock UX
- migration between storage modes

The output of that layer should be a signer-like object, not raw secret bytes
leaking through the app.

### Transitional backend abstraction still matters

While the product direction changes the final storage model, the current shared
signer-resolution seam is still useful. Today it can wrap multiple landed
sources; later it can resolve:

- unlocked session signer
- legacy plaintext fallback during migration
- emergency env override in CI/dev workflows

If a backend-style abstraction remains, it should sit below the shared signer
resolver and be honest about whether it is:

- a true wallet store
- an unlock helper
- or a transitional compatibility path

Any storage-like modules should still conform to a narrow interface such as:

- `metadata()`
- `hasKey()`
- `loadSigner()`

For hardware/KMS-style signers, `loadSigner()` can return a custom viem
`Account` wrapper rather than a locally held private key.

## Design call: does the current 1Password model need redesign?

Yes, relative to the stated product direction.

The current implementation is fine as a transitional bridge, but it is not the
right long-term model if:

- the encrypted local wallet is the source of truth, and
- password managers are only unlock helpers.

Plain English:

- The useful thing we landed is the shared signer-resolution path.
- The thing that should not become product doctrine is "1Password stores the
  real wallet key".
- That 1Password model should be treated as temporary until the encrypted local
  wallet + unlock flow exists.

So the redesign need is:

1. keep the shared signer path
2. stop hardcoding direct `config.privateKey` reads
3. introduce encrypted local wallet + unlock/session flow
4. demote password managers from "wallet backend" to "unlock helper"

## Known architectural debt

### `file` is an overloaded name

Today, `file` means "legacy plaintext config storage".

If MoneyOS later adds a real encrypted local wallet file, `file` becomes
ambiguous:

- plaintext file
- encrypted file

Before that future backend lands, the product should decide whether to:

- keep `file` as a user-facing umbrella and add an internal sub-kind, or
- split the user-facing names explicitly, for example `plaintext` and
  `encrypted`

Do not sleepwalk into that naming collision.

### Local config is still transitional

Today `config.json` mixes:

- runtime config (`chainId`, `rpcUrl`)
- backend descriptor (`keyStore`)
- and, for the legacy local path, the actual secret (`privateKey`)

That is acceptable for transition, but it should not be the end state for the
default local backend.

## Practical release guidance

Before public release, keep the messaging honest:

- current code includes a transitional 1Password-backed wallet path
- the intended product model is encrypted local wallet + unlock helpers
- shared signer resolution is in progress and partially landed
- local encrypted wallet/session flow is not shipped yet
- npm publish readiness is separate from GitHub hygiene

Also keep live-wallet safety conservative:

- do not mutate a real wallet config casually
- back up `~/.moneyos/config.json` before any real migration or smoke test
- do not start live 1Password testing until `op` installation and the desired
  product flow are both clear
