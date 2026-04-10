# MoneyOS — Developer Guide

## Project

MoneyOS is an open source programmable money SDK and CLI by Aryze.
`npm install moneyos` gives developers balance, send, and swap on Arbitrum.

See VISION.md for architecture direction and roadmap.

## Structure

```
packages/
├── core/                      — @moneyos/core: runtime interfaces, types, registries
│   └── src/
│       ├── types.ts           — result/value types (Balance, SendResult, SwapQuote, SwapProvider, Chain)
│       ├── runtime.ts         — runtime interfaces + MoneyOSConfig (ExecutionClient, ReadClient, AssetRegistry, etc.)
│       ├── tokens.ts          — token registry (USDC, USDT, RYZE, ETH, POL)
│       ├── chains.ts          — chain registry (Arbitrum, Ethereum, Polygon)
│       └── index.ts           — public exports
├── tool-swap/                 — @moneyos/tool-swap: swap tool with pluggable providers
│   └── src/
│       ├── tool.ts            — swapAction, createSwapTool
│       ├── providers/
│       │   └── odos.ts        — Odos DEX provider
│       └── index.ts
├── executor-particle/         — @moneyos/executor-particle: Particle AA smart-account executor
│   ├── src/
│   │   ├── executor.ts        — createParticleExecutor async factory, ParticleExecutor class
│   │   └── index.ts
│   └── test/
│       └── executor.test.ts   — mocks @particle-network/aa, tests v1 locks + ExecutionClient contract
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
| `@moneyos/executor-particle` | Particle Network smart-account executor (gasless on Arbitrum) | @moneyos/core, viem (peer); @particle-network/aa |
| `moneyos` | SDK + CLI — composes core + implementations | @moneyos/core, viem, commander |

Dependency direction (all arrows point at `@moneyos/core`):

```
moneyos ──┐
          ├──► @moneyos/core ◄── @moneyos/tool-swap
          │
          └──► @moneyos/executor-particle ──► @moneyos/core
```

No vendor SDK types are exposed through `@moneyos/core`. Particle-specific
concepts (SmartAccount, AAWrapProvider, UserOp, paymaster config) stay
inside `@moneyos/executor-particle`.

### Injecting a custom executor

```ts
import { createMoneyOS } from "moneyos";
import { createParticleExecutor } from "@moneyos/executor-particle";

const execute = await createParticleExecutor({
  chainId: 42161,
  projectId: "...",
  clientKey: "...",
  appId: "...",
  ownerPrivateKey: "0x...",
});

const moneyos = createMoneyOS({ chainId: 42161, execute });
await moneyos.send("USDC", "0x...", "1"); // gasless, sponsored by paymaster
```

`createParticleExecutor` is async because Particle resolves the smart-account
address asynchronously. After the factory settles, the returned executor has
a sync `getAddress()` that satisfies the core `ExecutionClient` contract.

### Particle executor v1 locks (enforced at runtime)

- Arbitrum One only (`chainId: 42161`)
- `SIMPLE` account contract, version `2.0.0`
- `gasMode: "gasless"` only — sponsorship failures throw, no silent fallback
- Owner is a local private key (no social login, no Ledger)
- No batching, no session keys, no AccountSpec in core

### Smoke test: `scripts/smoke-particle.ts`

End-to-end validation of the Particle executor against Arbitrum One.

> ⚠️ **Arbitrum mainnet only.** The executor is hard-locked to chainId 42161;
> there is no testnet path. The script WILL move real value unless
> `PARTICLE_SMOKE_SKIP_SEND=1` is set.

**First run — dry-run only (validates credentials + smart-account derivation,
moves no funds):**

```bash
PARTICLE_PROJECT_ID=… \
PARTICLE_CLIENT_KEY=… \
PARTICLE_APP_ID=… \
MONEYOS_PRIVATE_KEY=0x… \
PARTICLE_SMOKE_SKIP_SEND=1 \
  npm run smoke:particle
```

**Full run — tiny amount after dry-run passes:**

```bash
PARTICLE_PROJECT_ID=… \
PARTICLE_CLIENT_KEY=… \
PARTICLE_APP_ID=… \
MONEYOS_PRIVATE_KEY=0x… \
PARTICLE_SMOKE_TO=0x… \
PARTICLE_SMOKE_TOKEN=ETH \
PARTICLE_SMOKE_AMOUNT=0.00001 \
  npm run smoke:particle
```

The smart account (not the owner EOA) must hold the token being sent. Gas is
sponsored by Particle's paymaster — the owner EOA does not need an ETH
balance.

Exit codes:
- `0` — success (or dry-run completed cleanly)
- `1` — runtime failure (wrapped error + `.cause` printed)
- `2` — missing required environment variable

### Smoke test: `scripts/smoke-1password.ts`

End-to-end validation of the 1Password keystore CLI path against a real
`op` binary and a real 1Password account.

> ⚠️ **Touches your real `~/.moneyos/` directory.** The script backs up any
> existing `~/.moneyos/config.json` to
> `~/.moneyos/config.json.smoke-backup-<pid>` before starting and restores
> it in a `finally` block. Do **not** kill the process mid-run — the restore
> step will be skipped and you'll need to recover the backup manually.

The script drives the composed CLI flow in a subprocess per phase so each
command runs in a fresh commander state:

1. `moneyos init --store 1password`
2. `moneyos keystore status`           (cheap probe, no prompt)
3. `moneyos keystore status --live`    (1Password biometric prompt)
4. `moneyos keystore migrate --to file --yes --delete-1password-item`
5. `moneyos keystore status`           (verify file backend)

Expect at least **four biometric prompts** on your Mac: one for
`op item create`, one for `op read` (status --live), one for `op read`
(migrate), and one for `op item delete` (migrate cleanup).

**Prerequisites:**

- `op` CLI installed, resolvable on PATH (or pass `MONEYOS_SMOKE_OP_BINARY`).
- 1Password desktop app integration enabled in Developer settings.
- Signed into at least one 1Password account in the desktop app.
- At least one vault where `op` can create items (default "Private" works).

**Required env:**

```bash
MONEYOS_SMOKE_1PASSWORD=1 npm run smoke:1password
```

The explicit safety switch prevents accidental runs that would touch the
real `~/.moneyos/` directory and the real 1Password account.

**Optional env:**

- `MONEYOS_SMOKE_OP_BINARY=<path>` — point at a specific `op` binary (useful
  if you have multiple installed, e.g. a beta build).
- `MONEYOS_SMOKE_SKIP_DELETE=1` — stop after `status --live`, leave the
  1Password item in place for manual inspection. The script still prints
  the vault/item IDs and restores the local config.

**Exit codes:**

- `0` — success (or `SKIP_DELETE` completed cleanly)
- `1` — runtime failure (a phase returned non-zero or threw)
- `2` — missing required env or prerequisite

**Cleanup on failure:** the `finally` block always attempts to restore the
backed-up config AND prints the vault/item IDs of any 1Password item the
migrate phase didn't delete, along with the exact `op item delete` command
to clean up manually.

## Build

```bash
npm install
npm run build:core                # build @moneyos/core first
npm run build                     # tsup — outputs to dist/
npm run build:tool-swap           # build @moneyos/tool-swap
npm run build:executor-particle   # build @moneyos/executor-particle
npm run typecheck                 # tsc --noEmit
npm run test                      # vitest run — picks up tests across all workspaces
```

Build order matters: `@moneyos/core` must be built before root, tool-swap,
and executor-particle — everything downstream resolves core types from its
built `dist/`.

## Key decisions

- Workspace monorepo — `packages/*` for core, tools
- `moneyos` re-exports everything from `@moneyos/core` (zero breaking changes)
- Viem for all on-chain interaction
- Commander for CLI
- Arbitrum as default chain (RYZE token lives there)
- Odos as default swap provider (uses 0x000...000 for native ETH)
- Private key stored at ~/.moneyos/config.json with 0o600 permissions
- EOA is the canonical identity; smart accounts are an opt-in execution mode
- Runtime shape: read, execute, assets, config (intentionally small)
- `createMoneyOS` accepts injected runtime parts (`execute`, `read`, `assets`) — external packages plug in via this seam
- `@moneyos/executor-particle` provides gasless on Arbitrum today; social login is explicitly a separate future package (`@moneyos/access-particle`), not combined

## Publishing

- Package name: `moneyos` on npm
- Workspace packages in this repo: `@moneyos/core`, `@moneyos/tool-swap`, `@moneyos/executor-particle`
- Before any publish: verify registry ownership and availability of the scoped package names, replace `workspace:*` runtime dependencies with publish-safe version ranges, and confirm the packed tarballs include built artifacts
- Test before publish: `npm pack --dry-run` → install tarball → verify CLI works
- Bump version in both package.json and src/cli/version.ts

## Rules

- No AI attribution in code, commits, or docs
- No secrets, API keys, or Aryze-internal references
- Open source ready from every commit
- Test packages locally before publishing to npm
