# MoneyOS Vision

## What it is

The operating system for money. A programmable money engine that developers and AI agents install with one command. Not a wallet, not an app — infrastructure.

The FFmpeg analogy: nobody sees FFmpeg, but everything uses it. MoneyOS is the same for money.

## Architecture

### Core

The core is tiny and stays tiny. It's what `npm install moneyos` gives you:

- Account creation
- Balance reads
- Token send/receive
- Configuration (`~/.moneyos/`)

Two real dependencies: Viem (on-chain) and Commander (CLI). Everything else is a tool.

### Tools

Tools are what you do. Each tool is a separate installable package.

```
moneyos add swap      # Token swaps
moneyos add bank      # IBAN, fiat transfers
moneyos add card      # Virtual/physical cards
moneyos add bridge    # Cross-chain bridging
moneyos add onramp    # Fiat to crypto
moneyos add offramp   # Crypto to fiat
```

Some tools are permissionless (swap, bridge). Some require KYC (bank, card, offramp). The KYC gate is enforced at the tool level.

Developers discover a tool and MoneyOS comes with it as the dependency. Every tool is a door into the ecosystem.

### Providers

Providers are who does it. Each tool can have multiple providers. The developer picks the tool — the provider is either the default or their choice.

```
swap/
├── odos (default)
├── uniswap
├── 1inch
└── lifi

bank/
├── aryze (default)
├── revolut
└── wise

card/
├── aryze (default)
└── ...
```

The tool interface stays the same regardless of provider. `moneyos swap` just works.

### Surfaces

The same primitives work across every surface:

- **CLI**: `moneyos swap 100 USDC RYZE`
- **SDK**: `moneyos.swap("USDC", "RYZE", "100")`
- **Telegram**: `/swap 100 USDC RYZE`
- **Agent**: tool call with same parameters

One mental model, multiple surfaces.

## Gasless

Gasless transactions are core to the experience, not optional. Particle Network provides the account abstraction and paymaster layer. Users should never need to buy ETH for gas.

The gasless sponsorship is funded by RYZE — swap/send fees buy back RYZE, which funds the paymaster. The protocol feeds itself.

## RYZE Token

MoneyOS is open source by Aryze. RYZE is woven into the system naturally:

- Default fee token for premium features
- Gasless transaction sponsorship (fees → RYZE buyback → paymaster funding)
- Default trading pair in swaps
- RPC infrastructure funding

All optional, all replaceable by someone who forks. But the default path runs through RYZE.

## KYC & Enterprise

The tool architecture doubles as a compliance layer:

- Permissionless tools: swap, bridge, send (crypto)
- KYC-gated tools: bank, card, offramp

This makes MoneyOS sellable to regulated institutions. Banks plug in as providers inside KYC-gated tools. They don't build agent APIs — MoneyOS already did.

Aryze is the bridge: regulatory relationships, Mastercard partnership, UK pay-by-bank.

## Distribution

Target audience: AI developers and crypto-native builders. The people on GitHub, HuggingFace, following OpenAI/Anthropic ecosystems.

Distribution strategy:
1. Developers find a tool they need (bank, swap, card)
2. The tool depends on MoneyOS core
3. MoneyOS gets installed as a dependency
4. Developer is now in the ecosystem

The npm package is the wedge. Not a landing page, not a pitch deck.

## Technical Stack

- **Chain**: Arbitrum first (fast, cheap, RYZE is there)
- **On-chain reads**: Viem
- **Wallet/signing**: Viem (v1), Particle Network (v2 — gasless + social login)
- **Swaps**: Odos (default provider, others pluggable)
- **Language**: TypeScript
- **Package**: `npm install moneyos`

## What exists today (v0.2)

- `moneyos init` — generate or import account
- `moneyos balance` — read on-chain balance (ETH, USDC, USDT, RYZE)
- `moneyos send` — send tokens
- `moneyos swap` — swap via Odos DEX aggregator
- SDK: `import { MoneyOS } from "moneyos"`
- Chains: Arbitrum (default), Ethereum, Polygon

## What's next

- Particle Network integration (gasless + social login)
- Tool/provider plugin architecture
- Error handling (human-readable messages)
- More chains, more tokens
- Telegram bot surface
