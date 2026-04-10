# MoneyOS — Developer Guide

## Project

MoneyOS is an open source programmable money SDK and CLI by Aryze.
`npm install moneyos` gives developers balance, send, and swap on Arbitrum.

See VISION.md for architecture direction and roadmap.

## Structure

```
packages/
├── core/                — @moneyos/core: runtime interfaces, types, registries
│   └── src/
│       ├── types.ts     — shared types (MoneyOSConfig, Balance, SendResult, SwapQuote, SwapProvider, Chain)
│       ├── runtime.ts   — runtime interfaces (ExecutionClient, ReadClient, AssetRegistry, etc.)
│       ├── tokens.ts    — token registry (USDC, USDT, RYZE, ETH, POL)
│       ├── chains.ts    — chain registry (Arbitrum, Ethereum, Polygon)
│       └── index.ts     — public exports
├── tool-swap/           — @moneyos/tool-swap: swap tool with pluggable providers
│   └── src/
│       ├── tool.ts      — swapAction, createSwapTool
│       ├── providers/
│       │   └── odos.ts  — Odos DEX provider
│       └── index.ts
src/
├── core/
│   ├── types.ts      — re-exports from @moneyos/core
│   ├── runtime.ts    — re-exports from @moneyos/core
│   ├── tokens.ts     — re-exports from @moneyos/core
│   ├── chains.ts     — re-exports from @moneyos/core + getViemChain
│   ├── client.ts     — MoneyOS class (balance, send, swap)
│   ├── eoa.ts        — EOAExecutor, ViemReadClient implementations
│   ├── access-local.ts — LocalAccessAdapter
│   └── factory.ts    — createMoneyOS helper
├── providers/
│   └── odos.ts       — Odos DEX swap provider (root-level, used by CLI)
├── tools/
│   └── swap.ts       — executeSwap shared helper
├── cli/
│   ├── index.ts      — CLI entry (commander)
│   ├── config.ts     — ~/.moneyos/config.json management
│   ├── version.ts
│   └── commands/
│       ├── init.ts
│       ├── balance.ts
│       ├── send.ts
│       └── swap.ts
└── index.ts          — SDK public exports (re-exports @moneyos/core + implementations)
```

## Packages

| Package | Description | Dependencies |
|---------|-------------|-------------|
| `@moneyos/core` | Runtime interfaces, shared types, token/chain registries | viem (peer) |
| `@moneyos/tool-swap` | Swap tool with pluggable providers | @moneyos/core, viem (peer) |
| `moneyos` | SDK + CLI — composes core + implementations | @moneyos/core, viem, commander |

Dependency direction: `moneyos` → `@moneyos/core` ← `@moneyos/tool-swap`

## Build

```bash
npm install
npm run build:core       # build @moneyos/core first
npm run build            # tsup — outputs to dist/
npm run build:tool-swap  # build @moneyos/tool-swap
npm run typecheck        # tsc --noEmit
npm run test             # vitest run (35 tests)
```

Build order matters: `@moneyos/core` must be built before root and tool-swap.

## Key decisions

- Workspace monorepo — `packages/*` for core, tools
- `moneyos` re-exports everything from `@moneyos/core` (zero breaking changes)
- Viem for all on-chain interaction
- Commander for CLI
- Arbitrum as default chain (RYZE token lives there)
- Odos as default swap provider (uses 0x000...000 for native ETH)
- Private key stored at ~/.moneyos/config.json with 0o600 permissions
- EOA is the canonical identity; smart accounts are future opt-in
- Runtime shape: read, execute, assets, config (intentionally small)
- Particle Network planned for gasless + social login

## Publishing

- Package name: `moneyos` on npm (owned by @moneyos org, account: ryzelabs)
- `@moneyos/core` and `@moneyos/tool-swap` published under @moneyos scope
- Test before publish: `npm pack` → install tarball → verify CLI works
- Bump version in both package.json and src/cli/version.ts

## Rules

- No AI attribution in code, commits, or docs
- No secrets, API keys, or Aryze-internal references
- Open source ready from every commit
- Test packages locally before publishing to npm
