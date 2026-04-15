# MoneyOS

MoneyOS is an open source programmable money SDK and CLI for developers and AI
agents. The root package covers runtime composition, balance/send flows,
wallet/session management, and executor code. Swap now lives as a separate
tool package, with the project currently centered on Arbitrum.

The project is still early. Package boundaries and some APIs are still settling,
but the repo is structured so each major surface can evolve independently.

## What lives in this repo

- `moneyos`: the root SDK + CLI package for runtime, wallet, balance, and send
- `@moneyos/core`: runtime interfaces, shared types, chain/token registries
- `@moneyos/gasless`: smart-account contracts, intent helpers, gasless executor, relay client, and baked Arbitrum defaults
- `@moneyos/swap`: canonical swap package and Odos provider, published on npm
- `services/relay`: the hosted relay service that sponsors gas for the gasless path

Current package-boundary rules live in [`docs/architecture.md`](docs/architecture.md).

## CLI

Install the CLI globally:

```bash
npm install -g moneyos
```

Available commands:

```bash
moneyos init [--key 0x...] [--force] [--chain 42161] [--rpc https://...]
moneyos auth unlock
moneyos auth lock
moneyos auth status
moneyos auth change-password
moneyos gasless status
moneyos gasless enable
moneyos gasless disable
moneyos add <tool>
moneyos remove <tool>
moneyos update [tool] [--check]
moneyos tools
moneyos backup export [--out ./wallet-backup.json] [--force]
moneyos backup restore <path> [--force]
moneyos backup status
moneyos contact set <name> <address>
moneyos contact list
moneyos contact remove <name>
moneyos keystore status
moneyos balance [token] [--address 0x...] [--chain <id>] [--all]
moneyos send <amount> <token> <to|contact>
```

After `moneyos add swap`, the installed swap tool adds:

```bash
moneyos swap <amount> <tokenIn> <tokenOut> [--chain <id>] [--provider odos]
```

For the full command surface and flag details, run `moneyos --help`.

Example:

```bash
npm install -g moneyos
moneyos init
moneyos auth unlock
moneyos balance --all
```

If you want to try swap from the CLI, fund the wallet first with the token you
want to swap and enough gas for the target chain, then install the tool:

```bash
moneyos add swap
moneyos tools
moneyos swap 0.1 RYZE ETH
```

### Local contacts

Save addresses as named contacts and send to them by name:

```bash
moneyos contact set dad 0x689c78B4DBa64A88A0dC03a579D01681F52C5A73
moneyos contact list
moneyos send 10 USDC dad
moneyos contact remove dad
```

Contacts are stored locally at `~/.moneyos/contacts.json`. The file is
per-user, never shared, never synced. `moneyos send` prints the resolved
address before executing so you can verify the recipient:

```
$ moneyos send 10 USDC dad
Resolved dad → 0x689c78B4DBa64A88A0dC03a579D01681F52C5A73
Sending 10 USDC to 0x689c78B4... on Arbitrum One...
```

Raw addresses still work — `moneyos send 10 USDC 0x...` behaves exactly as
before. If the recipient is neither a valid address nor a known contact, the
send fails with a clear error.

### Gasless mode (v1 opt-in)

Gasless is available but default-off in v1.

Gasless changes execution mode. It does not replace or convert the imported
wallet.

Mental model:

- your imported private key remains the owner EOA
- `moneyos gasless enable` derives and stores a separate deterministic smart-account address for that owner
- with the baked network defaults, the same owner derives the same smart-account address on a given chain, so the mapping is recoverable from the owner key alone
- after the next `moneyos auth unlock`, write commands execute from the smart account instead of the owner EOA
- balances do not move automatically between the owner EOA and the smart account
- the relay sponsors gas only; the smart account still needs the asset being sent or swapped

```bash
moneyos gasless status
moneyos gasless enable
# re-unlock so the new executor mode applies
moneyos auth unlock
```

When gasless mode is enabled, write commands use the gasless smart-account
executor instead of the EOA executor. Disable it to return to EOA:

```bash
moneyos gasless disable
moneyos auth unlock
```

On Arbitrum One v1, `moneyos gasless enable` now bakes in the public relay URL, sponsor, and factory-derived smart-account address automatically. Manual overrides still exist through these environment variables:

- `MONEYOS_GASLESS_RELAY_URL`
- `MONEYOS_GASLESS_ACCOUNT`
- `MONEYOS_GASLESS_SPONSOR`
- optional: `MONEYOS_GASLESS_NONCE_KEY`
- optional: `MONEYOS_GASLESS_VALIDITY_WINDOW_SECONDS`

Important bootstrap note: this is gasless execution, not gasless onboarding. The relay sponsors gas, but it does not sponsor transfer value. A brand-new user still has to fund the smart account with actual assets first, for example USDC, ETH, WETH, or RYZE on Arbitrum One, before a gasless send can succeed.

If you already have funds in the owner EOA, the practical flow is:

1. have an initialized wallet (`moneyos init` or `moneyos init --key 0x...`) and unlock it with `moneyos auth unlock`
2. run `moneyos balance --all` to inspect the owner EOA balance
3. run `moneyos gasless enable`, then `moneyos auth unlock`
4. run `moneyos auth status` to see the active smart-account address
5. fund that smart-account address from the owner EOA or another wallet
6. run `moneyos balance --all --address <smart-account-address>` to inspect smart-account funds
7. retry the gasless send or swap

Note: `moneyos balance` without `--address` still shows the owner EOA balance,
even when gasless mode is active. Use `moneyos auth status` to get the active
smart-account address, then pass that address with `--address` to inspect
smart-account funds.

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

If you want a local script or workflow to reuse an already-unlocked MoneyOS
session, unlock first in the terminal:

```bash
moneyos auth unlock
```

Then attach that session explicitly in code:

```ts
import { createMoneyOS, connectLocalSession } from "moneyos";

const execute = await connectLocalSession();
const moneyos = createMoneyOS({
  chainId: 42161,
  execute,
});
```

Session-backed writes currently support the registered chain set only:
Arbitrum `42161`, Ethereum `1`, and Polygon `137`. Each send/swap request
carries its own `chainId`, so a single unlocked session can target any of
those supported chains. A custom `rpcUrl` still applies only to the configured
default chain; other supported chains use the built-in chain registry RPC URLs.

Tool packages should still execute against `moneyos.runtime`; they should not
import `connectLocalSession()` themselves.

The runtime seam is intentionally small. `createMoneyOS` can also take injected
`execute`, `read`, and `assets` implementations, which is how external packages
plug in.

Swap still lives in the separate `@moneyos/swap` package, but the root CLI now
owns first-class tool install/use UX for CLI-integrated packages.

For CLI usage, install the root package first and validate the wallet surface:

```bash
npm install -g moneyos
moneyos init
moneyos auth unlock
moneyos balance --all
```

If you want to use swap from the CLI, fund the wallet first with the input
token and enough gas for the target chain, then add the tool:

```bash
moneyos add swap
moneyos tools
moneyos swap 0.1 RYZE ETH
```

For direct package usage, install the tool package alongside `moneyos`:

```bash
npm install moneyos @moneyos/swap
```

Then call it against the root runtime seam:

```ts
import { createMoneyOS } from "moneyos";
import { executeSwap, OdosProvider } from "@moneyos/swap";

const moneyos = createMoneyOS({
  chainId: 42161,
  privateKey: process.env.MONEYOS_PRIVATE_KEY as `0x${string}`,
});

const result = await executeSwap(
  {
    tokenIn: "USDC",
    tokenOut: "RYZE",
    amount: "1",
    provider: new OdosProvider(),
    chainId: 42161,
  },
  moneyos.runtime,
);

console.log(result.hash);
```

## Published npm packages

Published packages:

- `moneyos`
- `@moneyos/core`
- `@moneyos/swap`

`@moneyos/gasless` exists in this repo but is not published to npm yet.

Current `moneyos` releases no longer bundle swap into the root SDK or CLI. If
you want swap from the root CLI, install `moneyos` and then run
`moneyos add swap`.

## Current wallet model

What is landed in code today:

- The CLI stores the root wallet in an encrypted local wallet file at `~/.moneyos/wallet.json`
- `~/.moneyos/config.json` now stores only non-secret settings such as chain and RPC configuration
- `moneyos gasless enable` keeps that encrypted wallet as the owner EOA and stores a separate smart-account config for gasless execution
- `MONEYOS_PRIVATE_KEY` remains an explicit override for ephemeral CI or agent runs
- `moneyos auth unlock` opens a short-lived local session for write commands
- workflow scripts can attach to that unlocked session with `connectLocalSession()`
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

Importing a raw private key keeps that address as the owner EOA. If you later
enable gasless, MoneyOS derives a separate smart-account address from that
owner key; it does not convert the imported EOA or move its assets.

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

- If a session-backed write command returns a timeout or disconnect error,
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
- workspace lint/typecheck passes after `build:core`
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
- live execution of external tools against the session-backed runtime seam
- more live usage of the encrypted-wallet/auth/backup flow in a real terminal

## Development

```bash
npm install
npm run build:core
npm run build:swap
npm run typecheck
npm run typecheck:core
npm run typecheck:swap
npm test
npm run lint
npm run lint:core
npm run lint:swap
npm run build
```

The repo currently uses npm workspaces. Test runs build `@moneyos/core` and
`@moneyos/swap` first so the swap tests exercise the real workspace
package boundary instead of source-relative imports. Before any npm release,
verify the packed tarballs with `npm pack --dry-run` and confirm publish-time
dependency resolution for the extracted workspace packages.

## License

MIT
