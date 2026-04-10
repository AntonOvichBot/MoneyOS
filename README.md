# MoneyOS

MoneyOS is an open source programmable money SDK and CLI for developers and AI
agents. The repo includes balance, send, swap, runtime-composition, keystore,
and executor code, with the project currently centered on Arbitrum.

The project is still early. Package boundaries and some APIs are still settling,
but the repo is structured so each major surface can evolve independently.

## What lives in this repo

- `moneyos`: the root SDK + CLI package
- `@moneyos/core`: runtime interfaces, shared types, chain/token registries
- `@moneyos/tool-swap`: swap execution tool and provider surface
- `@moneyos/executor-particle`: Particle AA smart-account executor

## CLI

Available commands:

```bash
moneyos init [--key 0x...]
moneyos balance <token> [--address 0x...]
moneyos send <amount> <token> <to>
moneyos swap <amount> <tokenIn> <tokenOut>
moneyos keystore status
```

Example:

```bash
moneyos init
moneyos balance USDC
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
plug in.

## Current wallet model

What is landed in code today:

- The CLI supports a local file-backed wallet stored in `~/.moneyos/config.json`
- `MONEYOS_PRIVATE_KEY` can override the local file for ephemeral CI or agent runs
- Normal wallet commands resolve their signer through one shared path instead of
  each command reading `config.privateKey` directly
- Local EOA signers use viem's nonce manager, so back-to-back live transactions
  use pending-aware nonce sequencing

What is not shipped yet:

- encrypted local wallet storage
- password/passphrase unlock flow
- session cache / lock-unlock commands
- password-manager unlock helpers

The old "wallet private key lives in 1Password" model has been removed from the
repo. That is not the product direction for MoneyOS.

The design notes for the current and target wallet architecture live in
[`docs/keystore.md`](docs/keystore.md).

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

## Current validation status

What we have verified locally on the current code:

- unit tests pass
- lint passes
- typechecks pass
- workspace builds pass
- the built CLI runs
- `moneyos keystore status` works against a local wallet config
- read-only balance checks work
- native ETH send works on Arbitrum
- ERC-20 sends work on Arbitrum (`USDC` and `RYZE`)
- swaps work on Arbitrum (`USDC -> RYZE` and `USDC -> ETH`)
- repeated live transactions work without nonce reuse after the EOA nonce fix

What still needs more hands-on validation:

- Particle executor against real infrastructure
- future encrypted-wallet and unlock/session flow after it exists

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
