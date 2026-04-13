# MoneyOS — Developer Guide

## Project

MoneyOS is an open source programmable money SDK and CLI by Aryze.
`npm install moneyos` gives developers runtime composition, wallet/session
flows, balance, send, and the `connectLocalSession()` helper for workflow
authors. Swap lives in `@moneyos/swap`, not in the root package.

Current docs:

- current package boundaries: [`docs/architecture.md`](docs/architecture.md)
- wallet and session architecture: [`docs/keystore.md`](docs/keystore.md)
- broader product direction: [`VISION.md`](VISION.md)

## Structure

```text
docs/
├── architecture.md           — current package boundaries and rules
└── keystore.md               — wallet/session/backup architecture
packages/
├── core/                     — @moneyos/core: runtime interfaces, shared types, registries
│   └── src/
│       ├── runtime.ts        — runtime interfaces + MoneyOSConfig
│       ├── types.ts          — shared result/value types
│       ├── tokens.ts         — token registry
│       ├── chains.ts         — chain registry
│       ├── keystore.ts       — shared KeyStore types
│       └── index.ts          — public exports
├── swap/                     — @moneyos/swap: swap package + Odos provider
│   └── src/
│       ├── tool.ts           — executeSwap, swapAction, createSwapTool
│       ├── types.ts          — SwapProvider and swap result types
│       ├── providers/
│       │   └── odos.ts       — Odos provider adapter
│       └── index.ts
src/
├── core/
│   ├── client.ts             — MoneyOS class (balance, send, runtime)
│   ├── factory.ts            — createMoneyOS helper
│   ├── eoa.ts                — ViemReadClient + EOAExecutor
│   ├── access-local.ts       — LocalAccessAdapter
│   ├── encrypted-wallet.ts   — encrypted local wallet file
│   ├── keystore-file.ts      — file-backed keystore adapter
│   ├── backup-file.ts        — encrypted wallet backup flow
│   ├── signer.ts             — nonce-managed local signer helper
│   ├── runtime.ts            — re-exports from @moneyos/core
│   ├── types.ts              — re-exports from @moneyos/core
│   ├── tokens.ts             — re-exports from @moneyos/core
│   └── chains.ts             — re-exports from @moneyos/core
├── local-session.ts          — public workflow-author connector to the local unlocked session
├── cli/
│   ├── index.ts              — CLI entry
│   ├── config.ts             — local config and path helpers
│   ├── wallet.ts             — shared CLI wallet/address resolution
│   ├── wallet-status.ts      — wallet status formatting and legacy detection
│   ├── prompt.ts             — hidden terminal password prompt
│   ├── session.ts            — local unlock session daemon/client
│   ├── version.ts
│   └── commands/
│       ├── init.ts
│       ├── auth.ts
│       ├── backup.ts
│       ├── balance.ts
│       ├── send.ts
│       └── keystore.ts
└── index.ts                  — root package public exports
```

## Packages

| Package | Description | Dependencies |
|---------|-------------|-------------|
| `@moneyos/core` | Runtime interfaces, shared types, token/chain registries | viem (peer) |
| `@moneyos/swap` | Swap package with pluggable providers | @moneyos/core, viem (peer) |
| `moneyos` | SDK + CLI for runtime composition, wallet flows, balance, send, and workflow-author session attachment | @moneyos/core, viem, commander |

Dependency direction:

```text
moneyos ──┐
          ├──► @moneyos/core ◄── @moneyos/swap
```

## Build

```bash
npm install
npm run build:core
npm run build
npm run build:swap
npm run typecheck
npm run test
```

Build order matters: `@moneyos/core` must be built before the root package and
the downstream workspace packages.

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
