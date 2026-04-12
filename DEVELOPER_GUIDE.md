# MoneyOS — Developer Guide

## Project

MoneyOS is an open source programmable money SDK and CLI by Aryze.
`npm install moneyos` gives developers runtime composition, wallet/session
flows, balance, and send. Swap lives in `@moneyos/tool-swap`, not in the root
package.

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
├── tool-swap/                — @moneyos/tool-swap: swap tool + Odos provider
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
| `@moneyos/tool-swap` | Swap tool with pluggable providers | @moneyos/core, viem (peer) |
| `moneyos` | SDK + CLI for runtime composition, wallet flows, balance, and send | @moneyos/core, viem, commander |

Dependency direction:

```text
moneyos ──┐
          ├──► @moneyos/core ◄── @moneyos/tool-swap
```

## Build

```bash
npm install
npm run build:core
npm run build
npm run build:tool-swap
npm run typecheck
npm run test
```

Build order matters: `@moneyos/core` must be built before the root package and
the downstream workspace packages.

## Publishing

- package name: `moneyos`
- workspace packages: `@moneyos/core`, `@moneyos/tool-swap`
- `@moneyos/tool-swap` is not published yet
- before publish: verify registry ownership, confirm packed tarballs include
  built artifacts, and validate the install surface
- test before publish: `npm pack --dry-run`, install the tarball in a clean
  temp directory, verify CLI behavior and package shape
- keep package-boundary changes in sync with [`docs/architecture.md`](docs/architecture.md)

## Rules

- no root-level tool-specific logic
- no provider-specific logic in `@moneyos/core`
- no AI attribution in code, commits, or docs
- no secrets, API keys, or Aryze-internal references
- open source ready from every commit
- test packages locally before publishing to npm
