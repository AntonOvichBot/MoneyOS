# Changelog

All notable changes to the repo's current `main` branch are documented here.

## Unreleased

The current `main` branch is ahead of the published npm package.

### Added

- encrypted local wallet storage at `~/.moneyos/wallet.json`
- `moneyos auth unlock|lock|status` for local session-based write access
- encrypted wallet backup support via `moneyos backup export|restore|status`
- tests for encrypted wallet storage, session lifecycle, prompt TTY gating, and
  backup safety checks

### Changed

- `~/.moneyos/config.json` now stores non-secret settings only
- legacy plaintext `config.json.privateKey` state is treated as import-only, not
  active runtime wallet state
- the removed 1Password-backed wallet model remains unsupported
- the README and wallet architecture docs now describe the encrypted-wallet
  model as the current source of truth

### Fixed

- session-backed `send` and `swap` no longer use the same `750ms` timeout as
  `auth status` and `auth lock`
- session-backed send requests now use a longer RPC-appropriate timeout budget
- the daemon send path has regression coverage for slow local IPC round trips
- a leaky wallet-path test now uses an isolated tmpdir instead of the
  developer's real `~/.moneyos/wallet.json`
