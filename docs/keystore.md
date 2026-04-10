# KeyStore Architecture

Status: current-state document with explicit future direction. This file keeps
"what is landed today" separate from "what we intend to build next."

## Short version

The keeper architecture is already in place:

- the SDK stays storage-agnostic
- the CLI resolves "my wallet" through one shared path
- local EOA signers use nonce management
- read-only commands can resolve an address without building a send-capable SDK
  signer path

The old product model is gone:

- MoneyOS no longer supports storing the real wallet private key in 1Password
- password managers are not wallet backends in the intended design

The target product direction is:

- encrypted local wallet as the source of truth
- password/passphrase unlock model
- short-lived unlock/session flow
- optional password-manager helpers that supply an unlock secret, not the
  wallet private key itself

## What is landed today

### SDK boundary

`MoneyOS` itself does not know or care where a signer came from.

It accepts one of:

- `privateKey`
- `signer`
- `execute`

That boundary is the keeper. It lets the CLI or future tooling decide how to
resolve a signer without teaching the SDK about local files, password managers,
hardware wallets, or cloud KMS products.

### Current CLI wallet path

Today, the CLI has one supported wallet path:

1. `MONEYOS_PRIVATE_KEY` env override
2. local file-backed config in `~/.moneyos/config.json`

That shared resolution path is used by:

- `moneyos send`
- `moneyos swap`
- `moneyos balance` when no explicit `--address` is provided

This is the important cleanup that stays:

- commands no longer each read `config.privateKey` on their own
- signer resolution is centralized
- the CLI can keep evolving without spreading wallet logic everywhere

### Current storage reality

The current local wallet path is still simple and not yet ideal:

- `~/.moneyos/config.json` stores `privateKey`
- `moneyos init` writes that file
- `moneyos keystore status` inspects that file

This is good enough as a temporary local path, but it is not the final product
model. The final model should remove plaintext private key storage from the
default CLI flow.

### Read-only balance behavior

Own-wallet balance does not need a full signer object.

Current behavior:

- `moneyos balance <token> --address 0x...` stays fully read-only
- `moneyos balance <token>` resolves your address from env or local wallet
  metadata and then performs a read-only balance query

In plain English: balance checks do not need to prepare a transaction signer
just to know which address to read.

### Nonce behavior

Any local EOA signer loaded through the shared resolver uses viem's nonce
manager.

That means back-to-back live transactions use pending-aware nonce sequencing
instead of accidentally reusing a stale nonce.

## What was removed on purpose

The old 1Password wallet-backend model has been removed.

That removed model was:

- storing the real wallet private key in 1Password
- keeping vault/item metadata in local config
- reading the wallet key back through `op`

Why it was removed:

- it made the password manager the true wallet backend
- it pushed product logic toward "wallet secret lives in 1Password"
- that is the wrong direction for a system that wants an encrypted local wallet
  as the source of truth

If you find old configs that still mention `keyStore.kind: "1password"`, treat
them as unsupported legacy state. The CLI should fail clearly and tell the user
to re-import into the supported local wallet path.

## Target architecture

This is the clean design to steer toward next.

### Layer 1: encrypted local wallet

The wallet at rest should live locally in an encrypted wallet file.

This layer should own:

- encrypted key material
- wallet metadata such as address and label
- migration from the current plaintext config

### Layer 2: unlock helpers

Unlock helpers should provide the secret needed to unlock the local encrypted
wallet.

Examples:

- terminal password prompt
- environment variable for controlled automation
- OS keychain
- 1Password
- Bitwarden

Important rule: these helpers should not store the wallet private key as the
canonical source of truth.

### Layer 3: session cache

The CLI is short-lived, so unlock state should live in a small session layer.

This layer should own:

- unlock TTL
- lock and unlock commands
- avoiding repeated prompts on every command
- safe expiry and cleanup

### Layer 4: shared signer resolver

The CLI should keep one shared resolver that turns "current wallet state" into
either:

- an address for read-only commands
- a signer for write commands

That resolver should remain the single place that knows about:

- env overrides
- unlocked session state
- encrypted wallet loading
- emergency migration fallbacks during rollout

### Layer 5: SDK stays clean

The SDK should continue to focus on:

- `signer`
- `execute`
- `read`
- `assets`

Do not make the SDK know about:

- 1Password
- Bitwarden
- Ledger
- cloud KMS providers

## Practical guidance for future work

Keep:

- shared CLI signer resolution
- nonce-managed EOA signers
- storage-agnostic SDK boundary
- read-only address resolution path separate from write-time signer loading

Do not reintroduce:

- a `1password` wallet backend
- direct command-level reads of `config.privateKey`
- product language that treats password managers as wallet storage

Build next:

- encrypted wallet file
- passphrase unlock flow
- session cache
- migration from plaintext local config into the encrypted wallet model
