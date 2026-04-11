# MoneyOS — Developer Guide

## Project

MoneyOS is an open source programmable money SDK and CLI by Aryze.
`npm install moneyos` gives developers balance, send, and swap on Arbitrum.

See `VISION.md` for broader architecture direction and roadmap.

## Structure

```text
packages/
├── core/                      — @moneyos/core: runtime interfaces, types, registries
│   └── src/
│       ├── types.ts           — result/value types (Balance, SendResult, SwapQuote, SwapProvider, Chain)
│       ├── runtime.ts         — runtime interfaces + MoneyOSConfig (ExecutionClient, ReadClient, AssetRegistry, etc.)
│       ├── tokens.ts          — token registry (USDC, USDT, RYZE, ETH, POL)
│       ├── chains.ts          — chain registry (Arbitrum, Ethereum, Polygon)
│       ├── keystore.ts        — shared KeyStore types
│       └── index.ts           — public exports
├── tool-swap/                 — @moneyos/tool-swap: swap tool with pluggable providers
│   └── src/
│       ├── tool.ts            — swapAction, createSwapTool
│       ├── providers/
│       │   └── odos.ts        — Odos DEX provider
│       └── index.ts
src/
├── core/
│   ├── types.ts         — re-exports from @moneyos/core
│   ├── runtime.ts       — re-exports from @moneyos/core
│   ├── tokens.ts        — re-exports from @moneyos/core
│   ├── chains.ts        — re-exports from @moneyos/core + getViemChain
│   ├── client.ts        — MoneyOS class (balance, send, swap)
│   ├── eoa.ts           — EOAExecutor, ViemReadClient implementations
│   ├── encrypted-wallet.ts — encrypted local wallet file + crypto helpers
│   ├── backup-file.ts   — encrypted wallet backup provider
│   ├── signer.ts        — nonce-managed local signer helper
│   ├── access-local.ts  — LocalAccessAdapter
│   └── factory.ts       — createMoneyOS helper
├── providers/
│   └── odos.ts          — Odos DEX swap provider (root-level, used by CLI)
├── tools/
│   └── swap.ts          — executeSwap shared helper
├── cli/
│   ├── index.ts         — CLI entry (commander)
│   ├── config.ts        — ~/.moneyos/config.json + wallet/backup path helpers
│   ├── wallet.ts        — shared CLI wallet/address resolution
│   ├── wallet-status.ts — wallet status formatting and legacy detection
│   ├── prompt.ts        — hidden terminal password prompt
│   ├── session.ts       — local unlock session daemon/client
│   ├── version.ts
│   └── commands/
│       ├── init.ts
│       ├── auth.ts
│       ├── backup.ts
│       ├── balance.ts
│       ├── send.ts
│       ├── swap.ts
│       └── keystore.ts
└── index.ts             — SDK public exports (re-exports @moneyos/core + implementations)
```

## Packages

| Package | Description | Dependencies |
|---------|-------------|-------------|
| `@moneyos/core` | Runtime interfaces, shared types, token/chain registries | viem (peer) |
| `@moneyos/tool-swap` | Swap tool with pluggable providers | @moneyos/core, viem (peer) |
| `moneyos` | SDK + CLI — composes core + implementations | @moneyos/core, viem, commander |

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

## Wallet architecture

What is landed today:

- the root CLI wallet lives in `~/.moneyos/wallet.json` as an encrypted local wallet
- `~/.moneyos/config.json` stores only non-secret config such as chain and RPC settings
- `~/.moneyos/backups/` stores encrypted wallet backup files
- `MONEYOS_PRIVATE_KEY` can still override local wallet state for explicit ephemeral runs
- `src/cli/wallet.ts` is the shared resolver for wallet address and write access
- `moneyos auth unlock` starts a short-lived local session daemon for write commands
- read-only own-wallet balance resolves address metadata without requiring unlock
- local EOA execution still uses viem's nonce manager

What was intentionally removed:

- the old 1Password-as-wallet-backend model
- CLI flows that treated password managers as the place where the wallet secret
  actually lived

Target direction:

- local encrypted wallet as source of truth
- local hidden password prompt for human unlock
- short-lived local session for agents and terminal workflows
- password managers as optional password storage choices, not wallet backends

Upgrade note:

- legacy `config.json` files that still contain `privateKey` are treated as
  import-only state now, not active runtime state
- local users should run `moneyos init` to move that wallet into the encrypted
  wallet file and create the first backup artifact

For deeper notes, see [`docs/keystore.md`](docs/keystore.md).

## Key decisions

- workspace monorepo with `packages/*`
- `moneyos` re-exports `@moneyos/core`
- viem for on-chain interaction
- Commander for CLI
- Arbitrum as default chain
- Odos as default swap provider
- current CLI wallet resolution: env private key -> local unlock session -> fail closed
- shared wallet resolution lives in `src/cli/wallet.ts`
- SDK surface stays storage-agnostic via `signer` / `execute`
- current product direction is encrypted local wallet + unlock/session + encrypted backups
- EOA is the canonical identity
- runtime shape stays intentionally small: read, execute, assets, config
- `createMoneyOS` accepts injected runtime parts

## Publishing

- package name: `moneyos`
- workspace packages: `@moneyos/core`, `@moneyos/tool-swap`
- before publish: verify registry ownership, replace `workspace:*` runtime
  dependencies with publish-safe version ranges, and confirm packed tarballs
  include built artifacts
- test before publish: `npm pack --dry-run`, install tarball, verify CLI works
- bump version in `package.json`

## Rules

- no AI attribution in code, commits, or docs
- no secrets, API keys, or Aryze-internal references
- open source ready from every commit
- test packages locally before publishing to npm
