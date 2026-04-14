# Gasless V1 Spec Freeze

Status: planning freeze before first code
Depends on:
- `docs/adr-gasless-v1.md`
- `docs/gasless-v1-implementation-plan.md`

## Purpose

Freeze the parts that define the product surface before implementation starts:
- `IntentV1`
- nonce and idempotency semantics
- sponsored call-shape policy
- relay failure posture
- launch stance on authorized keys
- required golden test vectors

This is a spec freeze for the first coding wave, not a forever document.

## 1. Launch stance

Path C remains the chosen direction.

Launch scope stays:
- Arbitrum first
- MoneyOS-native only
- gasless `send`
- gasless `swap`
- empty-wallet UX
- MoneyOS-sponsored gas
- minimal smart account
- no ERC-4337 bundler/paymaster in v1

### Authorized-key launch stance

Freeze this now:
- **contract support day one**
- **owner-only end-to-end path acceptable for first coding wave**
- scoped authorized-key UX may ship one increment later without changing the contract surface

Reason:
- authorized keys are part of the durable account model and must exist in the contract now
- but they do not need to block the first end-to-end gasless send/swap path if the CLI/session UX would slow initial delivery

## 2. IntentV1 is frozen for first coding wave

`IntentV1`:

```ts
IntentV1 {
  account: address
  sponsor: address
  nonceKey: uint192
  nonceSeq: uint64
  validAfter: uint48
  validUntil: uint48
  calls: Call[] // { target, value, data }
}
```

Rules:
- `account` is the deterministic smart-account address
- `sponsor` is part of the signed payload
- production sponsored flows use **non-zero sponsor binding**
- `validUntil - validAfter` should stay short in practice (target: 5 minutes max)
- `calls[]` is the signed execution payload, not tool-specific metadata

### What is intentionally not in IntentV1
- quote metadata
- router labels
- provider names
- policy version
- treasury limits

Those are relay/service concerns, not account-signature concerns.

## 3. Sponsored swap semantics are frozen

Sponsored swap is allowed only in these shapes.

### Native-in swap
- `calls.length === 1`
- target must be an allowlisted Odos router on Arbitrum
- selector must be an allowlisted swap selector
- `value > 0`

### ERC-20-in swap
- `calls.length === 2`
- call 1: allowlisted token `approve(address,uint256)`
- call 2: allowlisted Odos router swap call
- `approve.spender === swap.target`
- approve amount must be exact, not unlimited
- no extra calls in the batch

### Explicitly not allowed in v1
- loose two-transaction sponsored swap flow
- arbitrary batching beyond the approved swap shape
- `transferFrom(address,address,uint256)` sponsorship by default
- non-Arbitrum sponsorship
- third-party generic relay usage

## 4. Relay policy is part of the trust boundary

Do not treat the relay as a minor sidecar. For v1 it is part of the effective product security model.

Relay must enforce all of the following before sponsorship:
- chain is Arbitrum
- sponsor binding matches the submitting relay identity
- target/selector pattern is allowlisted
- call-count pattern matches an approved send/swap shape
- decoded approve and transfer args are valid
- quote/route freshness is still valid
- full execution simulation passes
- treasury caps and wallet limits allow the spend
- nonce reservation succeeds

## 5. Quote freshness and opaque calldata rules

Router allowlisting alone is not sufficient.

For sponsored swap, relay must reject stale or ambiguous routes.

Freeze this rule:
- the signed payload binds the actual `calls[]`
- sponsorship still depends on relay-side freshness and policy checks
- swap submissions must include enough provider metadata for relay validation, at minimum:
  - provider id
  - assembled/quoted timestamp or expiry
  - any provider quote identifier available

If provider metadata is absent or stale, relay fails closed.

For v1, the relay may trust a provider-specific integration path, but must not sponsor opaque swap calldata with no freshness context.

## 6. Nonce and idempotency semantics are frozen

### On-chain nonce rule
- nonce storage is lane-based
- exact match required on `nonceSeq`
- successful execution increments the lane nonce once

### Relay idempotency rule
Freeze a separate relay reservation concept now.

Relay must reserve by a stable key equivalent to:
- `account`
- `sponsor`
- `nonceKey`
- `nonceSeq`

The same reserved intent may be retried idempotently, but a second distinct submission for the same tuple must not race into sponsorship.

### Deploy-and-execute rule
For undeployed accounts:
- relay must simulate the exact deploy-and-execute path that will be submitted
- nonce semantics do not change between deployed and undeployed flow
- deploy cost must count toward the same treasury caps

## 7. Failure posture is frozen

V1 fails closed on:
- simulation failure
- stale route/quote
- selector/target outside allowlist
- unhealthy relay or RPC state
- nonce reservation failure
- treasury cap breach
- missing or mismatched sponsor binding

Operational posture:
- short sponsor TTL (target 5 minutes max)
- global pause available
- per-wallet blocklist available
- swap sponsorship can be disabled without disabling send

## 8. Config source of truth is frozen

### Relay policy code
- `services/relay/src/policy/moneyos-native-policy.ts`

### Relay config
- `services/relay/config/policy.arbitrum.json`

### Token source of truth
- seed from `packages/core/src/tokens.ts` where `chainId === 42161`
- relay config may narrow, but not widen silently without review

### Odos source of truth
- router addresses and allowed swap selectors live in relay config
- they are provider/config-driven, not hardcoded constants in core

### Capability reporting
- `GET /v1/capabilities` should expose active policy version and supported flow shapes

## 9. Golden test vectors required before merge-worthy implementation

At minimum, create golden vectors for:
1. `IntentV1` hash generation
2. owner signature validation
3. authorized-key signature validation with allowed scope
4. authorized-key rejection outside scope
5. CREATE2 account address derivation
6. deploy + native send
7. deploy + atomic approve+swap
8. replay rejection on reused `(signer, nonceKey, nonceSeq)`
9. sponsor mismatch rejection
10. stale route rejection in relay path

## 10. What this means for the first coding wave

First coding wave is allowed to be narrower than the final product dream.

Acceptable first coding wave:
- owner-signed gasless send
- owner-signed gasless atomic swap
- contract supports authorized keys already
- relay enforces exact v1 policy
- no end-user authorized-key UX yet

Not acceptable:
- shipping without frozen nonce/idempotency semantics
- shipping sponsored swap without route freshness checks
- shipping a loose two-step sponsored swap path
- treating relay policy as "just config we can figure out later"
