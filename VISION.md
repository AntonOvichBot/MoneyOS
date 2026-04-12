# MoneyOS Vision

This file is directional. For the current shipped package boundaries and rules,
see [`docs/architecture.md`](docs/architecture.md).

## What it is

The operating system for money. A programmable money engine that developers and
AI agents install with one command. Not a wallet, not an app — infrastructure.

The FFmpeg analogy: nobody sees FFmpeg, but everything uses it. MoneyOS is the
same for money.

## Architecture

### Bare-metal core

The bare-metal core stays tiny.

Today that means:

- `@moneyos/core` for runtime contracts, shared types, and registries
- `moneyos` for runtime composition, local wallet/session flows, balance, send,
  and the root CLI

Everything product-specific above that should live in tool packages.

### Tools

Tools are separate packages above the core that implement one workflow against
the runtime seam.

Current example: `@moneyos/swap`.

Longer term, the repo may grow more tool packages such as bank, card, bridge,
onramp, or offramp. Those are direction notes, not shipped root-package
features.

### Providers

Providers are tool-level adapters for external protocols or services.

Today, Odos lives under `@moneyos/swap`. The root package should not
special-case provider logic. If more providers arrive, they should belong to
the swap tool, not to `moneyos` or `@moneyos/core`.

### Surfaces

Longer term, the same mental model should span CLI, SDK, and agent surfaces.
That is a direction, not a claim that every tool is built into every surface
today.

## RYZE Token

MoneyOS is open source by Aryze. RYZE is woven into the system naturally:

- Default fee token for premium features
- Default trading pair in swaps
- RPC infrastructure funding

All optional, all replaceable by someone who forks. But the default path runs
through RYZE.

## KYC & Enterprise

The tool architecture doubles as a compliance layer:

- Permissionless tools: swap, bridge, send (crypto)
- KYC-gated tools: bank, card, offramp

This makes MoneyOS sellable to regulated institutions. Banks plug in as
providers inside KYC-gated tools. They do not need to build the whole agent
surface themselves.

Aryze is the bridge: regulatory relationships, Mastercard partnership, UK
pay-by-bank.

## Distribution

Target audience: AI developers and crypto-native builders. The people on
GitHub, HuggingFace, following OpenAI and Anthropic ecosystems.

Distribution strategy:

1. Developers find the workflow package they need.
2. That package pulls in `@moneyos/core`.
3. They compose it with `moneyos` or another compatible runtime.
4. The developer is now in the ecosystem.

The npm package is the wedge. Not a landing page, not a pitch deck.

## Technical Stack

- **Chain**: Arbitrum first
- **On-chain reads**: viem
- **Wallet/signing**: viem
- **Swaps**: `@moneyos/swap` with Odos today
- **Language**: TypeScript
- **Package**: `npm install moneyos`

## What exists today

- `moneyos init` for account generation or import
- `moneyos auth` for local unlock, lock, status, and password rotation
- `moneyos backup` for encrypted wallet backup export, restore, and status
- `moneyos balance` for on-chain balance reads
- `moneyos send` for token sends
- SDK surface: `createMoneyOS`, `MoneyOS.balance`, `MoneyOS.send`,
  `moneyos.runtime`
- `@moneyos/swap` as an in-repo workspace package with `executeSwap` and
  `OdosProvider`
- Chains: Arbitrum, Ethereum, Polygon

## What's next

- Error handling with clearer operator-facing messages
- More chains and tokens
- More live validation of session-backed send and external-tool execution
- A real second swap provider before adding provider-selection UX
- Registry, installer, routing, or plugin layers only when repeated pressure
  makes them necessary
