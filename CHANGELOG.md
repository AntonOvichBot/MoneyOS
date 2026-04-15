# Changelog

All notable changes to the repo's current `main` branch are documented here.

## 0.6.0 - 2026-04-15

Gasless execution, local contacts, and a wave of wallet UX cleanup.

### Added

- Gasless execution mode, opt-in and default-off. `moneyos gasless status|enable|disable` routes write commands through a smart-account executor instead of the owner EOA. The relay sponsors gas; the smart account still has to hold the asset being sent or swapped. Arbitrum One is the v1 target, with baked defaults for the relay URL, sponsor, factory, and derived smart-account address so `moneyos gasless enable` works out of the box.
- Smart-account primitives shipped inside the new `@moneyos/gasless` workspace package: `MoneyOSAccountV1`, `MoneyOSAccountFactoryV1` with deterministic CREATE2 deployment, EIP-712 `IntentV1`, ERC-1271 owner-only validation, and replay-safe signer-scoped nonce lanes. The package is bundled inside the published root `moneyos` tarball and is not published to npm on its own.
- Hosted gasless relay at `services/relay/` — Fastify HTTP app with `POST /v1/execute`, `GET /v1/capabilities`, `GET /v1/tx/:id`; SQLite persistence for nonce reservations, submissions, and usage counters; nonce/simulation/treasury/wallet/health gates; submission adapter with `deployAndExecute` for undeployed smart accounts; kill switch; deploy artifacts for macOS launchd, Linux systemd, and Docker.
- Local contacts address book. `moneyos contact set|list|remove` stores `name → address` pairs in `~/.moneyos/contacts.json` with 0600 permissions. `moneyos send <amount> <token> <name>` now accepts either a 0x address or a saved contact name, and prints the resolved address before execution so the recipient is always visible.
- `moneyos update [tool] [--check]` for updating installed MoneyOS CLI tools from the user tool home.
- `moneyos balance --all` to list balances across every built-in token on the selected chain in one call.

### Changed

- Session send requests are idempotent by request ID at the session layer, so a disconnect after broadcast no longer races into a replay.
- Cross-chain writes resolve RPC URLs from the chain registry instead of always using the configured default chain's RPC.
- Core asset registry is honored consistently by balance reads.
- Release PR shape is mechanically enforced in CI: any PR that bumps a `package.json` version is rejected if it touches anything outside `package.json`, `CHANGELOG.md`, or `package-lock.json` (and their workspace equivalents).
- Release discipline documented end-to-end in `CONTRIBUTING.md` and `DEVELOPER_GUIDE.md`.
- Repo docs aligned with the shipped gasless state: `docs/architecture.md`, `DEVELOPER_GUIDE.md`, root `README.md`, `docs/adr-gasless-v1.md`, and the gasless planning documents relabeled as current-state or historical as appropriate.
- Dropped the implicit "no AI attribution" rule from `DEVELOPER_GUIDE.md`. Commit signature hygiene stays a norm; explicit AI attribution is neither required nor forbidden.

### Fixed

- `moneyos gasless enable` on a fresh install now derives and persists the default smart-account address before marking gasless enabled; previously the enabled flag could save without the derived account.
- First gasless send against an undeployed smart account no longer fails while trying to read nonce from bytecode that does not exist yet; missing account code is treated as nonce 0.
- Replayed relay submissions that were already `submitted` or `confirmed` are no longer overwritten by a later rejection record; replay idempotency holds at the app boundary.
- Gasless executor backdates `validAfter` by 30 seconds to tolerate small client/relay clock skew.
- The baked Arbitrum gasless relay default was refreshed to the live Funnel hostname after a Tailscale naming drift.
- Windows session socket/token transport: ACL handling for secure-file checks, named-pipe coverage, and a platform-specific regression fix.
- `moneyos update` edge cases covered by regression tests.

## 0.5.1 - 2026-04-13

### Fixed

- publish workflow now upgrades npm to latest before publish, which
  activates the Trusted Publishing OIDC exchange that Node 22's bundled
  npm does not support out of the box; without this the previous
  prerelease attempts failed at npm auth despite correct Trusted
  Publisher configuration
- publish command now includes `--provenance` again; it was accidentally
  dropped during the `0.5.1-rc.1` auth-path revert, which would have
  resulted in unsigned releases even if publish succeeded

## 0.5.1-rc.1 - 2026-04-13

### Changed

- root release publishing now runs from a tag-triggered GitHub Actions workflow
  that verifies tag-to-version alignment, reruns lint/typecheck/tests, verifies
  packed tarballs, and publishes with npm Trusted Publishing plus provenance
- root release package metadata now uses the canonical `1231CheGites/MoneyOS`
  GitHub URL casing for repository links and provenance alignment
- `CONTRIBUTING.md` now documents the forward release tag convention:
  `moneyos-v<version>` for root releases and `moneyos-<package>-v<version>` for
  workspace packages, with bare `v<version>` retained only for historical tags
- the publish workflow now isolates the actual `npm publish` command from
  token-based npm auth config and publishes prerelease versions under the
  `next` dist-tag instead of `latest`

## 0.5.0 - 2026-04-12

### Added

- `moneyos` now ships first-class CLI tool install/use UX with `moneyos add`,
  `moneyos remove`, and `moneyos tools`
- root CLI tool loading now uses a user-scoped registry and lazy-loads
  installed tool packages on demand instead of baking tool logic into root

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
