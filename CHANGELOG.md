# Changelog

All notable changes to the repo's current `main` branch are documented here.

## 0.3.0 - 2026-04-11

### Added

- encrypted local wallet storage at `~/.moneyos/wallet.json`
- `moneyos auth unlock|lock|status` for local session-based write access
- encrypted wallet backup support via `moneyos backup export|restore|status`
- tests for encrypted wallet storage, session lifecycle, prompt TTY gating, and
  backup safety checks
- GitHub Actions CI workflow running lint, typecheck, tests, and builds across
  the root package and every workspace package on every pull request and on
  pushes to `main`

### Changed

- `~/.moneyos/config.json` now stores non-secret settings only
- legacy plaintext `config.json.privateKey` state is treated as import-only, not
  active runtime wallet state
- the removed 1Password-backed wallet model remains unsupported
- the README and wallet architecture docs now describe the encrypted-wallet
  model as the current source of truth
- `@moneyos/core` is now bundled into the published `moneyos` package; it is
  internal workspace plumbing and consumers no longer need to resolve it
- `package-lock.json` is now tracked in git for reproducible installs across CI
  and developer machines

### Fixed

- session-backed `send` and `swap` no longer use the same `750ms` timeout as
  `auth status` and `auth lock`
- session-backed send requests now use a longer RPC-appropriate timeout budget
- the daemon send path has regression coverage for slow local IPC round trips
- a leaky wallet-path test now uses an isolated tmpdir instead of the
  developer's real `~/.moneyos/wallet.json`
- the published `moneyos` tarball now installs cleanly as a standalone package;
  earlier builds leaked `@moneyos/core` as a runtime import in both the emitted
  JS and the emitted type declarations, so `npm install moneyos` in a clean
  directory could not resolve its own runtime dependencies
- `EOAExecutor.send` now awaits the transaction receipt before resolving and
  throws on a non-success receipt; sequenced flows like "approve then swap" now
  work on the first attempt against a fresh wallet, and viem's in-memory nonce
  manager no longer drifts past the chain when a preflight rejects a queued
  transaction
- session tests now use short socket and token paths so they no longer break in
  long temp directories (the POSIX 108-byte unix socket path limit)
