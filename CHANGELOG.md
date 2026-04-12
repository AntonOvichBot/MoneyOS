# Changelog

All notable changes to the repo's current `main` branch are documented here.

## 0.5.0 - 2026-04-12

### Added

- `moneyos` now ships first-class CLI tool install/use UX with `moneyos add`,
  `moneyos remove`, and `moneyos tools`
- root CLI tool loading now uses a user-scoped registry and lazy-loads
  installed tool packages on demand instead of baking tool logic into root
- `@moneyos/swap@0.2.0` now exports `moneyosCliTool`, making `moneyos swap`
  mountable through the root CLI after install

### Fixed

- runtime errors thrown by installed tools now pass through to the user instead
  of being mislabeled as broken-tool repair errors; only load/validation
  failures are wrapped as installed-tool breakage

## 0.4.1 - 2026-04-12

### Fixed

- fixed the published `moneyos` CLI entrypoint so `npm install moneyos` now
  produces a working `moneyos` binary from `node_modules/.bin`; `0.4.0`
  incorrectly exited without printing help or version because the entrypoint
  guard did not resolve npm's symlinked bin path

## 0.4.0 - 2026-04-12

### Added

- published `@moneyos/core@0.1.0` as the stable runtime contract package for
  MoneyOS tools and custom runtimes
- published `@moneyos/swap@0.1.0` as the canonical swap package with
  `executeSwap`, `swapAction`, `createSwapTool`, and `OdosProvider`

### Changed

- `moneyos` now treats swap as an external package instead of a built-in root
  workflow; install `@moneyos/swap` separately when you want swap support
- the root README and developer docs now point at the published workspace
  packages and the current package boundary split

## 0.3.4 - 2026-04-12

### Added

- added `moneyos auth change-password` so users can rotate the active wallet
  password without changing wallet identity metadata; a successful rotation
  also locks the current local session and leaves existing backup files as
  old-password snapshots until a fresh export is created

### Changed

- added CLI-level regression coverage for legacy plaintext wallet migration,
  `moneyos init --force`, malformed `moneyos init --key`, backup export
  messaging, and wallet password rotation flows

### Fixed

- `moneyos backup export` now states plainly that exported backups use the same
  wallet password as the active wallet and that restore requires that same
  password
- insecure backup export destinations now report destination-specific
  permission errors instead of misleading wallet-path errors

## 0.3.3 - 2026-04-11

### Removed

- removed the unused Particle executor workspace, smoke script, and supporting
  docs/build references so the repo matches the current local-wallet-first
  product surface

## 0.3.2 - 2026-04-11

### Changed

- corrected the README's published-package section so the npm package page no
  longer claims `moneyos` is still on a pre-encrypted-wallet release

## 0.3.1 - 2026-04-11

### Fixed

- `moneyos --version` now reports the package version from `package.json`
  instead of a stale hardcoded string
- added regression coverage to keep the CLI version output aligned with the
  published package version

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
