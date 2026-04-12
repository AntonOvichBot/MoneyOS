# Wallet Architecture

Status: current-state document. This file describes what is landed now and the
guardrails for future work.

## Short version

MoneyOS now uses:

- an encrypted local wallet file as the root wallet state
- a hidden local password prompt for unlock
- a short-lived local session daemon for write commands
- encrypted wallet backup files

MoneyOS does not use:

- password managers as wallet backends
- password managers as signers
- raw private keys stored in `~/.moneyos/config.json`

## What is landed today

### SDK boundary stays clean

`MoneyOS` itself still accepts one of:

- `privateKey`
- `signer`
- `execute`

That boundary is the keeper. The SDK does not know about password prompts,
local wallet files, backup files, or session daemons.

### Local wallet storage

Current CLI wallet state is split into:

- `~/.moneyos/wallet.json` for the encrypted wallet
- `~/.moneyos/config.json` for non-secret settings
- `~/.moneyos/backups/` for encrypted wallet backup files

The wallet file contains:

- encrypted key material
- address metadata
- KDF parameters
- encryption metadata

The config file should not contain the wallet private key anymore.

### Unlock and session flow

Current write-path behavior is:

1. `MONEYOS_PRIVATE_KEY` env override for explicit CI/dev use
2. local unlocked session started by `moneyos auth unlock`
3. otherwise fail and tell the user to unlock locally

The session model is intentionally local-first:

- the human types the password in a hidden terminal prompt
- MoneyOS decrypts the wallet locally
- a short-lived local daemon keeps the decrypted signer in memory only
- later CLI commands use the local session until it expires or is locked

This avoids sending the wallet password through normal AI chat flows.

### Read-only wallet behavior

Own-wallet balance does not require unlock.

Current behavior:

- `moneyos balance <token> --address 0x...` stays fully read-only
- `moneyos balance <token>` reads wallet address metadata from the encrypted
  wallet file

In plain English: reads do not need the hot signer path just to discover the
current address.

### Backup behavior

Current wallet backup behavior:

- `moneyos init` creates an initial encrypted wallet backup automatically
- `moneyos backup export` writes another encrypted copy using the same wallet
  password as the active wallet
- `moneyos backup restore <path>` restores the encrypted wallet file
- restore requires that same wallet password
- restore does not auto-unlock the wallet

Important rule: backup files contain the encrypted wallet, not the raw private
key.

### Nonce behavior

Any local EOA signer that actually sends transactions still uses viem's nonce
manager.

That means back-to-back live transactions use pending-aware nonce sequencing
instead of accidentally reusing a stale nonce.

## What was removed on purpose

The old 1Password wallet-backend model remains removed.

That removed model was:

- storing the real wallet private key in 1Password
- treating the password manager as the canonical wallet store
- routing wallet recovery through vendor-specific secret storage

Why it stays removed:

- it makes a vendor the true wallet backend
- it creates product confusion about where the wallet actually lives
- it is the wrong model for an OS-style local wallet core

Legacy configs that still mention `keyStore.kind: "1password"` are treated as
unsupported.

Legacy plaintext local configs that still contain `privateKey` are no longer
used at runtime. They should be re-imported through `moneyos init`.

## Upgrade path for older local users

If an older local install still has `privateKey` inside
`~/.moneyos/config.json`, the new runtime treats that as legacy state only.

Practical upgrade path:

1. run `moneyos init` locally on the machine that still has the old config
2. choose a wallet password in the hidden prompt
3. let MoneyOS write the encrypted wallet file plus the first encrypted backup
4. use `moneyos auth unlock` before write commands

If the old config is gone but the raw private key still exists elsewhere, use
`moneyos init --key 0x...` instead.

There is intentionally no parallel runtime mode where plaintext config remains
the active wallet source of truth.

## Future direction

The next layers should build around the current core, not around vendor APIs.

### Root model

Keep this product model:

- local encrypted wallet
- local human unlock
- short-lived session
- encrypted wallet backup

### Possible future extensions

These may be added later as plugins or helpers:

- password-manager password storage guidance
- unlock helpers
- hardware wallets
- KMS or MPC executors
- delegated agent allowances

Important rule: password managers may help with password storage or future
unlock assistance, but they should not become the wallet backend or the signer.

## Security guardrails in the landed implementation

The current encrypted-wallet flow also enforces a few practical guardrails:

- wallet files are written with secure local file permissions
- existing wallets are not overwritten unless the user passes `--force`
- backup restore verifies the password before overwriting the active wallet
- read-only own-wallet balance uses authenticated wallet metadata, not the hot
  signing path
- write commands fail closed when there is no active unlock session

## Known operational limitations

These are real current-state caveats, not future ideas:

- Session-backed `send` and `swap` are still not idempotent across client
  disconnects. If a write command errors after submission begins, the caller
  should verify on-chain state before retrying.
- PR #12 fixed the common false-timeout path by separating short control
  timeouts from longer on-chain send timeouts. It did not add disconnect-aware
  recovery or replay protection.
- The session daemon is still effectively pinned to the chain and RPC chosen at
  unlock time. Cross-chain sends from the same unlocked session are follow-up
  work, not a supported design guarantee yet.

## Practical guidance

Keep:

- shared CLI wallet resolution
- read-only address resolution from wallet metadata
- nonce-managed local EOA execution
- storage-agnostic SDK boundary

Do not reintroduce:

- plaintext private-key storage in `config.json`
- password-manager wallet backends
- product language that treats 1Password or similar tools as the wallet
