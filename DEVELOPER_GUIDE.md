# MoneyOS — Developer Guide

## Project

MoneyOS is an open source programmable money SDK and CLI by Aryze.
`npm install moneyos` gives developers runtime composition, wallet/session
flows, balance, send, and the `connectLocalSession()` helper for workflow
authors. Swap lives in `@moneyos/swap`, and the gasless smart-account lane
lives in `@moneyos/gasless` plus `services/relay`, not in the root package.

Current docs:

- current package boundaries: [`docs/architecture.md`](docs/architecture.md)
- wallet and session architecture: [`docs/keystore.md`](docs/keystore.md)
- gasless account model: [`docs/adr-gasless-v1.md`](docs/adr-gasless-v1.md)
- broader product direction: [`VISION.md`](VISION.md)

## Structure

```text
docs/
├── architecture.md                 — current package boundaries and rules
├── keystore.md                     — wallet/session/backup current-state doc
├── adr-gasless-v1.md               — accepted gasless account-model ADR
├── gasless-v1-spec-freeze.md       — historical v1 gasless design freeze
└── gasless-v1-implementation-plan.md — historical planning doc
packages/
├── core/                           — @moneyos/core: runtime interfaces, shared types, registries
│   └── src/
│       ├── runtime.ts              — runtime interfaces + MoneyOSConfig
│       ├── types.ts                — shared result/value types
│       ├── tokens.ts               — token registry
│       ├── chains.ts               — chain registry
│       ├── keystore.ts             — shared KeyStore types
│       └── index.ts                — public exports
├── gasless/                        — @moneyos/gasless: smart-account contracts, intent helpers, executor, relay client
│   ├── contracts/
│   │   ├── MoneyOSAccountV1.sol    — minimal smart-account contract
│   │   ├── MoneyOSAccountFactoryV1.sol — CREATE2 factory for owner-derived accounts
│   │   └── lib/IntentHashV1.sol    — onchain intent-hash library
│   └── src/
│       ├── defaults.ts             — baked relay/factory defaults and default account derivation
│       ├── smart-account.ts        — CREATE2 address derivation helpers
│       ├── executor/
│       │   └── gasless-executor.ts — typed-data signing + relay-backed execution
│       ├── relay/
│       │   └── client.ts           — relay HTTP client and response types
│       ├── nonce/
│       │   └── lane.ts             — nonce lane and idempotency key helpers
│       ├── intent/
│       │   ├── v1-types.ts         — IntentV1 types
│       │   ├── v1-hash.ts          — EIP-712 hash helpers
│       │   └── v1-sign.ts          — signing and signer recovery helpers
│       ├── contracts/abi/
│       │   ├── moneyos-account-v1.ts — exported account ABI
│       │   └── moneyos-account-factory-v1.ts — exported factory ABI
│       └── index.ts                — public gasless package exports
└── swap/                           — @moneyos/swap: swap package + Odos provider
    └── src/
        ├── tool.ts                 — executeSwap, swapAction, createSwapTool
        ├── cli-tool.ts             — MoneyOS CLI tool entry for `moneyos swap`
        ├── types.ts                — SwapProvider and swap result types
        ├── providers/
        │   └── odos.ts             — Odos provider adapter
        └── index.ts
services/
└── relay/                          — hosted gasless relay service
    ├── src/
    │   ├── app.ts                  — Fastify app and relay routes
    │   ├── server.ts               — process entry for the relay service
    │   ├── policy/                 — policy capabilities and intent validation
    │   ├── gates/                  — treasury, health, simulation, nonce, and rate-limit gates
    │   ├── submit/                 — submission/confirmation adapters and execution path
    │   └── db/sqlite.ts            — SQLite persistence layer
    └── deploy/                     — Docker, launchd, and systemd deploy artifacts
src/
├── core/
│   ├── client.ts                   — MoneyOS class (balance, send, runtime)
│   ├── factory.ts                  — createMoneyOS helper
│   ├── eoa.ts                      — viem read client + EOA executor
│   ├── gasless.ts                  — root bridge from local signer to GaslessExecutor
│   ├── access-local.ts             — local file-backed access adapter
│   ├── assets.ts                   — default asset registry
│   ├── encrypted-wallet.ts         — encrypted local wallet file
│   ├── keystore-file.ts            — file-backed keystore adapter
│   ├── backup-file.ts              — encrypted wallet backup flow
│   ├── signer.ts                   — nonce-managed local signer helper
│   ├── no-executor.ts              — read-only runtime executor
│   ├── runtime.ts                  — re-exports from @moneyos/core
│   ├── types.ts                    — re-exports from @moneyos/core
│   ├── tokens.ts                   — re-exports from @moneyos/core
│   └── chains.ts                   — re-exports from @moneyos/core
├── cli/
│   ├── index.ts                    — CLI entry
│   ├── config.ts                   — local config and path helpers
│   ├── wallet.ts                   — wallet/address resolution for CLI flows
│   ├── wallet-status.ts            — wallet status formatting and legacy detection
│   ├── contacts.ts                 — local contacts address book store
│   ├── gasless.ts                  — gasless env/default resolution helpers
│   ├── prompt.ts                   — hidden terminal password prompt
│   ├── session.ts                  — local unlock session daemon/client
│   ├── tools/
│   │   ├── manager.ts              — install/update/remove/list CLI tools
│   │   └── runtime.ts              — runtime bridge exposed to installed CLI tools
│   ├── commands/
│   │   ├── init.ts                 — initialize or import encrypted wallet
│   │   ├── auth.ts                 — unlock, inspect, lock, rotate wallet password
│   │   ├── backup.ts               — export/restore/status for encrypted backups
│   │   ├── balance.ts              — balance reads for default or explicit address
│   │   ├── contact.ts              — local contacts set/list/remove commands
│   │   ├── gasless.ts              — gasless status/enable/disable commands
│   │   ├── send.ts                 — token sends through the active executor
│   │   ├── tools.ts                — add/remove/list/update CLI tools
│   │   └── keystore.ts             — compatibility alias to wallet status
│   └── version.ts                  — CLI version resolution
├── local-session.ts                — public workflow-author session connector
└── index.ts                        — root package public exports
test/                               — root CLI and runtime regression tests
```

## Packages

| Package | Description | Dependencies |
|---------|-------------|-------------|
| `@moneyos/core` | Runtime interfaces, shared types, token/chain registries | viem (peer) |
| `@moneyos/gasless` | Smart-account contracts, intent helpers, gasless executor, relay client | @moneyos/core, viem |
| `@moneyos/swap` | Swap package with pluggable providers | @moneyos/core, viem (peer) |
| `moneyos` | SDK + CLI for runtime composition, wallet flows, gasless integration, balance, send, and workflow-author session attachment | @moneyos/core, @moneyos/gasless, viem, commander |

Dependency direction:

```text
moneyos ───────────────► @moneyos/core ◄── @moneyos/swap
    │
    └───────────────► @moneyos/gasless ───► @moneyos/core
services/relay ─────► @moneyos/gasless
```

## Build

```bash
npm install
npm run build:core
npm run build:gasless
npm run build
npm run build:swap
npm run typecheck
npm run typecheck:core
npm run typecheck:gasless
npm run typecheck:swap
npm run lint
npm run lint:core
npm run lint:gasless
npm run lint:swap
npm run build --workspace=services/relay
npm run typecheck --workspace=services/relay
npm run test --workspace=services/relay
npm run test
```

Build order matters: `@moneyos/core` and `@moneyos/gasless` must be built
before the root package. The relay has its own focused workspace commands.

## Releases

Each publishable package has its own tag namespace:

- root `moneyos`: `moneyos-v<version>` (e.g. `moneyos-v0.5.1`)
- `@moneyos/core`: `moneyos-core-v<version>`
- `@moneyos/swap`: `moneyos-swap-v<version>`

Flow:

1. Open a PR that bumps only `package.json` and the matching `CHANGELOG.md`
   for the target package. Nothing else.
2. Rebase and merge to `main` (branch protection requires linear history).
3. Tag the merge SHA locally and push: `git tag -a <tag-name> <sha> -m "..."`,
   then `git push origin <tag-name>`.
4. The Publish workflow runs on tag push. It verifies the tag is reachable from
   `origin/main`, checks tag-vs-package.json version, runs the full CI gates
   and `release:verify`, then publishes to npm with provenance via Trusted
   Publisher.

dist-tags are derived from the tag name: versions without `-` go to `latest`,
versions with `-<prerelease>` (e.g. `0.6.0-rc.0`) go to `next`.

Currently published:

| Package          | Version |
|------------------|---------|
| `moneyos`        | 0.5.1   |
| `@moneyos/core`  | 0.1.0   |
| `@moneyos/swap`  | 0.2.0   |

`@moneyos/gasless` exists in the repo but is not published to npm yet.

Before cutting a release:

- confirm the version bump lands in its own PR against `main`
- confirm CI is green on the merged SHA
- `npm pack --dry-run` in the target package dir to verify tarball contents
- do not chain `-rc.N` tags to iterate on CI; use a draft PR or
  `workflow_dispatch` instead

Release discipline is enforced mechanically, not trusted:

- any PR that bumps a `package.json` version is checked by CI and rejected if
  it touches anything outside `package.json`, `CHANGELOG.md`,
  `package-lock.json`, or their workspace equivalents
  (`scripts/check-release-pr-shape.mjs`)
- any PR that bumps a version is rejected if the matching `CHANGELOG.md` does
  not contain an entry for the new version
- the publish workflow refuses to publish a tag that is not reachable from
  `origin/main`
- the publish workflow refuses to publish a tag whose version does not match
  the target `package.json`

## Rules

- no root-level tool-specific logic
- no provider-specific logic in `@moneyos/core`
- tool authors build against `@moneyos/core` and `MoneyOSRuntime`, not root session helpers
- no AI attribution in code, commits, or docs
- no secrets, API keys, or Aryze-internal references
- open source ready from every commit
- test packages locally before publishing to npm
- never force-push `main` or force-update a published tag
- never push a release tag from a commit not reachable from `origin/main`
