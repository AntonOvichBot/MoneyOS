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

## CLI

Available commands:

```bash
moneyos init [--key 0x...] [--force] [--chain 42161] [--rpc https://...]
moneyos auth unlock
moneyos auth lock
moneyos auth status
moneyos auth change-password
moneyos backup export [--out ./wallet-backup.json] [--force]
moneyos backup restore <path> [--force]
moneyos backup status
moneyos keystore status
moneyos balance <token> [--address 0x...]
moneyos send <amount> <token> <to>
moneyos swap <amount> <tokenIn> <tokenOut>
```

For the full command surface and flag details, run `moneyos --help`.

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

## Published npm package

`moneyos` is published on npm. `npm install moneyos` and `npx moneyos` give
you the latest tagged release, not unreleased commits on `main`. If you want
work that has not shipped in a tagged release yet, clone the repo and build
from source.

## Current wallet model

What is landed in code today:

- The CLI stores the root wallet in an encrypted local wallet file at `~/.moneyos/wallet.json`
- `~/.moneyos/config.json` now stores only non-secret settings such as chain and RPC configuration
- `MONEYOS_PRIVATE_KEY` remains an explicit override for ephemeral CI or agent runs
- `moneyos auth unlock` opens a short-lived local session for write commands
- `moneyos auth change-password` rotates the local wallet password and locks the current session
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

## Importing an existing wallet

If you already have a raw private key, import it with `init`:

```bash
moneyos init --key 0x...
```

MoneyOS prompts you for a wallet password, encrypts the key into
`~/.moneyos/wallet.json`, and writes an initial encrypted backup under
`~/.moneyos/backups/`. After that, use `moneyos auth unlock` before any
write command.

The CLI only supports raw hex private-key import today. Seed phrases,
keystore v3 JSON files, and hardware-wallet derivation are not implemented.
If your wallet currently lives in one of those formats, derive the raw hex
with another tool first.

If you have a legacy `~/.moneyos/config.json` with a plaintext `privateKey`
field from a pre-encrypted-wallet version of the CLI, `moneyos init` with no
flags will detect and import that key automatically.

## Changing the wallet password

Use:

```bash
moneyos auth change-password
```

This re-encrypts the active local wallet file with a new password and locks the
current local session. Existing backup files and previously exported backups
remain snapshots encrypted with the old password. If you want a backup under
the new password, run `moneyos backup export` after the password change.

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

## Known operational limitations

- If a session-backed `send` or `swap` returns a timeout or disconnect error,
  do not assume nothing was broadcast. Verify on-chain before retrying.
- PR #12 fixed the common 750ms false-timeout path, but client-disconnect
  detection and request idempotency are still follow-up work.

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
- encrypted wallet creation, unlock/session, backup export, and backup restore protections are covered by tests
- read-only balance checks work
- the session-backed send path has a real slow-daemon regression test after PR #12
- repeated live transactions worked before wallet v1 landed, which validated the
  nonce-manager fix but should not be treated as end-to-end validation of the
  current session-backed wallet flow

What still needs more hands-on validation:

- live session-backed ETH send
- live session-backed ERC-20 send
- live session-backed swap
- more live usage of the encrypted-wallet/auth/backup flow in a real terminal

## Development

```bash
npm install
npm run build:core
npm run build:tool-swap
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
