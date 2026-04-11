# MoneyOS

MoneyOS is an open source programmable money SDK and CLI for developers and AI
agents. The repo includes balance, send, swap, runtime-composition, wallet,
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
moneyos auth unlock
moneyos auth lock
moneyos auth status
moneyos backup export [--out ./wallet-backup.json]
moneyos backup restore <path>
moneyos backup status
moneyos balance <token> [--address 0x...]
moneyos send <amount> <token> <to>
moneyos swap <amount> <tokenIn> <tokenOut>
```

Example:

```bash
moneyos init
moneyos auth unlock
moneyos balance USDC
moneyos backup status
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

- The CLI stores the root wallet in an encrypted local wallet file at `~/.moneyos/wallet.json`
- `~/.moneyos/config.json` now stores only non-secret settings such as chain and RPC configuration
- `MONEYOS_PRIVATE_KEY` remains an explicit override for ephemeral CI or agent runs
- `moneyos auth unlock` opens a short-lived local session for write commands
- `moneyos backup export|restore|status` manages encrypted wallet backups
- Normal wallet commands resolve their write path through one shared session-aware flow
- Local EOA signers use viem's nonce manager, so back-to-back live transactions
  use pending-aware nonce sequencing

What is intentionally not shipped yet:

- password-manager integrations
- unlock-helper plugins
- delegated agent spending limits
- smart-account policy sessions

Password managers are not wallet backends in MoneyOS. The current model is:
local encrypted wallet, local human unlock, short-lived session, and encrypted
wallet backup files.

The design notes for the current and target wallet architecture live in
[`docs/keystore.md`](docs/keystore.md).

## Upgrade for older users

If you used an older MoneyOS version that stored `privateKey` in
`~/.moneyos/config.json`, the new CLI does not use that plaintext path at
runtime anymore.

Use `moneyos init` on the same machine to re-import that wallet into the new
encrypted wallet file. MoneyOS will detect the old plaintext config, prompt you
for a wallet password, write `~/.moneyos/wallet.json`, and create an encrypted
backup file. After that, write commands use `moneyos auth unlock`.

If you still have a raw private key from elsewhere, you can also import it
directly with:

```bash
moneyos init --key 0x...
```

## Threat model

What this wallet model is meant to protect against:

- accidental plaintext private-key storage in `config.json`
- casual disk access while the wallet is locked
- copying encrypted wallet backups without also knowing the wallet password
- sending the wallet password through normal AI chat flows

What it does not protect against:

- malware already running as your user while the wallet is unlocked
- a compromised machine that can inspect local process memory
- someone who knows your wallet password
- loss of both the encrypted wallet and its password

The intended operating model is simple: keep the wallet encrypted locally,
unlock it locally when you want to write, keep sessions short, and save the
wallet password in your password manager of choice yourself.

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
- encrypted wallet creation, unlock/session, backup export, and backup restore are covered by tests
- read-only balance checks work
- native ETH send works on Arbitrum
- ERC-20 sends work on Arbitrum (`USDC` and `RYZE`)
- swaps work on Arbitrum (`USDC -> RYZE` and `USDC -> ETH`)
- repeated live transactions work without nonce reuse after the EOA nonce fix

What still needs more hands-on validation:

- Particle executor against real infrastructure
- more live usage of the encrypted-wallet/auth/backup flow in a real terminal

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
