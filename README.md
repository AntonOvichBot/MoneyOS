# MoneyOS

MoneyOS is an open source programmable money SDK and CLI for developers and AI
agents. It currently covers balances, sends, swaps, runtime composition, a
Particle-backed smart-account executor, and a KeyStore abstraction with both
file-backed and 1Password-backed wallet storage.

The project is still early. Package boundaries and some APIs are still settling,
but the repo is structured so each major surface can evolve independently.

## What lives in this repo

- `moneyos`: the root SDK + CLI package
- `@moneyos/core`: runtime interfaces, shared types, chain/token registries
- `@moneyos/tool-swap`: swap execution tool and provider surface
- `@moneyos/executor-particle`: Particle AA smart-account executor

## CLI

Current commands:

```bash
moneyos init [--store file|1password]
moneyos balance <token> [--address 0x...]
moneyos send <amount> <token> <to>
moneyos swap <amount> <tokenIn> <tokenOut>
moneyos keystore status [--live]
moneyos keystore migrate --to 1password
moneyos keystore migrate --to file
```

Example:

```bash
moneyos init
moneyos balance USDC
moneyos send 10 USDC 0x...
moneyos swap 25 USDC RYZE
moneyos keystore status
```

## SDK

```ts
import { createMoneyOS } from "moneyos";

const moneyos = createMoneyOS({
  chainId: 42161,
  privateKey: process.env.MONEYOS_PRIVATE_KEY as `0x${string}`,
});

const balance = await moneyos.balance("USDC");
console.log(balance.amount);

const tx = await moneyos.send("USDC", "0x...", "10");
console.log(tx.hash);
```

The runtime seam is intentionally small. `createMoneyOS` can also take injected
`execute`, `read`, and `assets` implementations, which is how external packages
like the Particle executor and swap tool plug in.

## Key storage

MoneyOS currently supports two wallet-storage modes:

- File-backed: legacy `~/.moneyos/config.json` private-key storage
- 1Password-backed: stores the key in 1Password and keeps only stable IDs plus
  cached metadata in local config

The design notes for the KeyStore work live in
[`docs/step-7-keystore.md`](docs/step-7-keystore.md).

## Supported chains and tokens

Default chain: Arbitrum One (`42161`)

Built-in chains:

- Arbitrum
- Ethereum
- Polygon

Built-in tokens:

- USDC
- USDT
- RYZE
- ETH
- POL

## Development

```bash
npm install
npm run build:core
npm run build:tool-swap
npm run build:executor-particle
npm run typecheck
npm test
npm run lint
npm run build
```

The repo currently uses npm workspaces. Before any npm release, verify the
packed tarballs with `npm pack --dry-run` and confirm publish-time dependency
resolution for the extracted workspace packages.

## License

MIT
