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

## Key storage

MoneyOS currently supports two wallet-storage modes:

- File-backed: legacy plaintext `~/.moneyos/config.json` private-key storage
- 1Password-backed: stores the private key itself in 1Password and keeps only
  stable IDs plus cached metadata in local config

That is the landed code today. The intended long-term product direction is an
encrypted local wallet as the source of truth, with password managers acting as
optional unlock helpers rather than the true wallet backend.

Normal CLI wallet commands resolve the signer through one shared path, so
`send`, `swap`, and own-wallet `balance` no longer need to read
`config.privateKey` directly. For ephemeral agent/CI runs,
`MONEYOS_PRIVATE_KEY` still overrides the configured path.

For the current transitional 1Password-compatible path, own-wallet balance uses
cached local address metadata when available, so it can stay read-only without
hitting 1Password. If that cached address is missing from an older config, the
CLI currently falls back to a 1Password read to recover the address.

The design notes for the KeyStore work live in
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
- `moneyos keystore status` works against a local file-backed wallet
- read-only balance checks work
- native ETH send works on Arbitrum
- ERC-20 sends work on Arbitrum (`USDC` and `RYZE`)
- swaps work on Arbitrum (`USDC -> RYZE` and `USDC -> ETH`)
- repeated live transactions work without nonce reuse after the EOA nonce fix

What still needs more hands-on validation:

- live 1Password flow with `op`
- Particle executor against real infrastructure

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
