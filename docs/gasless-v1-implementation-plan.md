# Gasless V1 Implementation Plan

Status: planning draft
Depends on: `docs/adr-gasless-v1.md`

## Goal

Translate the gasless v1 ADR into a repo-aware implementation plan that is
ready for work in the fork.

V1 remains:
- Arbitrum first
- MoneyOS-native only
- gasless `send`
- gasless `swap`
- empty-wallet UX
- MoneyOS-sponsored gas
- minimal smart account, not full ERC-4337

## Current repo fit

The repo already has the seam we need:
- `@moneyos/core` defines runtime contracts
- `moneyos` composes runtime and executors
- tools execute through runtime, not through tool-owned signing logic

That means gasless should land as a new executor path and contract/service
package, not as a rewrite of existing tool APIs.

## Phase plan

### Phase 0: freeze the contract + intent spec

Output:
- accepted ADR text for v1
- frozen `IntentV1` typed-data shape
- frozen `MoneyOSAccountV1` and `MoneyOSAccountFactoryV1` surface

Lock now:
- sponsor binding in production flows
- user-side authorized keys only
- atomic sponsored swap path
- Foundry as the contract toolchain

### Phase 1: add contract package

Recommended new package:
- `packages/gasless`

Initial contents:
- `contracts/MoneyOSAccountV1.sol`
- `contracts/MoneyOSAccountFactoryV1.sol`
- `contracts/lib/IntentHashV1.sol`
- Foundry config and tests

Minimum contract requirements:
- deterministic deployment via CREATE2
- owner key + scoped authorized keys
- ERC-1271-compatible `isValidSignature`
- `execute(IntentV1, signature)` with `calls[]`
- nonce lanes per signer/key
- deploy-and-execute support for first-action flow

### Phase 2: add intent/auth SDK in `packages/gasless`

Files:
- `src/intent/v1-types.ts`
- `src/intent/v1-hash.ts`
- `src/intent/v1-sign.ts`
- `src/nonce/lane.ts`
- `src/contracts/abi/*.ts`

Purpose:
- typed intent construction
- hashing/signing helpers
- address derivation helpers
- ABI exports for runtime and relay use

Keep this package opinionated around Path C, not generic AA abstractions.

### Phase 3: add gasless executor package surface

Files:
- `src/executor/gasless-executor.ts`
- `src/relay/client.ts`
- `src/smart-account.ts`

Requirements:
- implement the existing execution seam instead of inventing a new one
- support `send`
- support atomic `calls[]` execution for sponsored swap
- expose capability metadata so runtime/CLI can tell when gasless is active

Note: the current swap path does sequential `approve` then `swap`. Sponsored
swap should move to an atomic batch path when gasless execution is available.

### Phase 4: relay service

Recommended private service package:
- `services/relay`

Responsibilities:
- verify intent signature and account derivation
- enforce Arbitrum + MoneyOS-native policy
- reserve nonce/idempotency
- simulate full execution before submit
- sponsor gas from treasury
- submit and track tx lifecycle
- enforce caps and pause/kill switch

Minimum routes:
- `POST /v1/execute`
- `GET /v1/tx/:id`
- `GET /v1/capabilities`

### Phase 5: runtime + CLI integration

Likely touched files:
- `src/cli/config.ts`
- `src/cli/session.ts`
- `src/cli/wallet.ts`
- root `package.json`
- CI/release verification scripts

Principles:
- keep existing EOA path working
- gasless should be opt-in first
- if CLI gasless signing is needed, route signing through the existing local
  session model rather than leaking raw key handling into random CLI code

### Phase 6: docs and runbook

Update after implementation starts:
- `docs/architecture.md`
- operational runbook for relay
- developer setup for Foundry + workspace package

## Proposed package and file placement

### `packages/gasless`
- `contracts/MoneyOSAccountV1.sol`
- `contracts/MoneyOSAccountFactoryV1.sol`
- `contracts/lib/IntentHashV1.sol`
- `src/index.ts`
- `src/intent/v1-types.ts`
- `src/intent/v1-hash.ts`
- `src/intent/v1-sign.ts`
- `src/nonce/lane.ts`
- `src/executor/gasless-executor.ts`
- `src/relay/client.ts`
- `src/smart-account.ts`
- `src/contracts/abi/*.ts`

### `services/relay`
- `src/http/routes/intents.ts`
- `src/policy/moneyos-native-policy.ts`
- `src/nonce/store.ts`
- `src/simulate/simulate-intent.ts`
- `src/submit/arb-submit.ts`
- `src/ops/caps-and-killswitch.ts`

### existing files likely touched later
- `packages/swap/src/tool.ts`
- `src/cli/config.ts`
- `src/cli/session.ts`
- `src/cli/wallet.ts`
- `docs/architecture.md`
- root `package.json`
- CI/release scripts

## Current decisions already settled

Settled:
- Path C / minimal smart account from v1
- sponsor binding from day one
- explicit static MoneyOS-native allowlist
- atomic sponsored swap
- authorized keys are user-side, not MoneyOS-held
- gasless starts opt-in
- Foundry for the contract lane

## Remaining blockers before build

### 1. Exact MoneyOS-native allowlist
Needs a concrete v1 definition for relay policy.

Current likely categories:
- native send
- ERC-20 transfer / transferFrom-equivalent send paths used by MoneyOS
- ERC-20 approve for supported swap token inputs
- approved swap router/calldata path for the supported provider on Arbitrum

This needs to become explicit addresses/selectors/config, not hand-wavy prose.

### 2. Treasury caps
Need launch defaults for:
- per-wallet spend cap
- global daily cap
- max gas per sponsored tx
- behavior on relay outage / simulation failure

### 3. User-side automation-key UX
Need the minimal v1 story for:
- how a user creates an authorized key
- how it is scoped
- how it is revoked
- whether v1 ships any CLI UX for this or keeps it owner-only first

## Recommended defaults if we need to keep moving

If no better product decision appears quickly, use these:
- sponsored send + swap only
- owner key can always sign
- authorized keys supported in contract surface from day one
- owner-only signing path at first release if automation-key UX slips
- static allowlist driven by config per chain/provider
- conservative treasury caps with a global kill switch

## What counts as implementation-ready

Before safe coding starts, we should have:
- the ADR accepted in substance
- `IntentV1` shape frozen
- contract toolchain chosen
- contract surface frozen enough for tests
- MoneyOS-native allowlist defined concretely for Arbitrum v1
- treasury caps chosen
- package boundaries accepted

Once those are true, implementation can start in the fork without guessing.
