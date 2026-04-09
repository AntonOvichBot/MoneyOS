# MoneyOS — Developer Guide

## Project

MoneyOS is an open source programmable money SDK and CLI by Aryze.
`npm install moneyos` gives developers balance, send, and swap on Arbitrum.

See VISION.md for architecture direction and roadmap.

## Structure

```
src/
├── core/
│   ├── types.ts      — interfaces (Balance, SendResult, SwapQuote, SwapProvider)
│   ├── chains.ts     — chain registry (Arbitrum, Ethereum, Polygon)
│   ├── tokens.ts     — token registry (USDC, USDT, RYZE, ETH)
│   └── client.ts     — MoneyOS class (balance, send, swap)
├── providers/
│   └── odos.ts       — Odos DEX swap provider
├── cli/
│   ├── index.ts      — CLI entry (commander)
│   ├── config.ts     — ~/.moneyos/config.json management
│   ├── version.ts
│   └── commands/
│       ├── init.ts
│       ├── balance.ts
│       ├── send.ts
│       └── swap.ts
└── index.ts          — SDK public exports
```

## Build

```bash
npm install
npm run build        # tsup — outputs to dist/
npm run typecheck    # tsc --noEmit
```

## Key decisions

- Single package (not monorepo) — `npm install moneyos` gives both CLI and SDK
- Viem for all on-chain interaction
- Commander for CLI
- Arbitrum as default chain (RYZE token lives there)
- Odos as default swap provider (uses 0x000...000 for native ETH)
- Private key stored at ~/.moneyos/config.json with 0o600 permissions
- Particle Network planned for v2 (gasless + social login)

## Publishing

- Package name: `moneyos` on npm (owned by @moneyos org, account: ryzelabs)
- Test before publish: `npm pack` → install tarball → verify CLI works
- Bump version in both package.json and src/cli/version.ts

## Rules

- No AI attribution in code, commits, or docs
- No secrets, API keys, or Aryze-internal references
- Open source ready from every commit
- Test packages locally before publishing to npm
