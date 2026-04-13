# ADR: Gasless V1 uses a minimal MoneyOS smart account

## Status

Proposed.

## Decision

MoneyOS gasless v1 will use a **minimal smart-account path**, not an EOA
prefund/top-up path and not full ERC-4337 infrastructure.

V1 scope stays narrow:
- Arbitrum first
- MoneyOS-native flows only
- gasless `send`
- gasless `swap`
- MoneyOS sponsors gas from its own treasury/service layer

The v1 account/auth model will be frozen around these primitives:

- one minimal **MoneyOSAccountV1** contract
- one deterministic **MoneyOSAccountFactoryV1** contract using `CREATE2`
- **ERC-1271-compatible** signature validation
- a versioned **EIP-712** intent schema
- scoped authorized keys from day one
- caller-agnostic validation
- replay protection via lane-friendly nonces

Intent v1 shape should stay generic enough to express execution plainly:

```ts
Intent {
  account: address
  nonceKey: uint192
  nonceSeq: uint64
  validAfter: uint48
  validUntil: uint48
  calls: Call[] // { target, value, data }
}
```

The root owner key remains the ultimate authority. Authorized keys may be added
with explicit scope such as:
- allowed selectors
- allowed targets
- maxAmount
- validAfter
- validUntil

Gas sponsorship stays **outside core** in a required MoneyOS-operated service
layer:
- relay API
- sponsorship policy
- treasury controls
- preflight simulation
- Arbitrum submission adapter
- pause / kill switch

V1 explicitly defers:
- ERC-4337 bundler/paymaster integration
- paymaster contracts
- multi-chain rollout
- reimbursement/tokenomics logic
- public third-party sponsorship
- broader session-key UX
- bank/card/provider bindings

## Why

MoneyOS needs empty-wallet UX fast. The product pitch is simple:

> a wallet with no ETH should still be able to use native MoneyOS tools,
> especially send and swap.

A pure minimal relay/EOA path is smaller on paper, but it hardens the wrong
thing. The expensive future rewrite would not be the relay. It would be the
account/auth surface once MoneyOS needs:
- multiple tools sharing one identity
- scoped agent keys
- richer skill execution
- later lending, bank, and card flows
- later AA / ERC-4337 compatibility

This ADR chooses the smallest account model that still preserves a durable
identity and authorization layer.

It avoids two bad extremes:
- **too thin**: quick gasless relay hack that becomes a dead end
- **too heavy**: full ERC-4337 stack in v1 before product truth is proven

## Why this fits the repo

- The current `ExecutionClient` seam is already the right abstraction point.
- Tools execute through runtime rather than owning signing logic.
- Gasless can land as a new executor path/package without rewriting existing
  tool workflows.
- The repo already prefers small, explicit boundaries over heavyweight generic
  frameworks.

## Rejected alternatives

### EOA prefund / top-up model

Rejected as the main v1 architecture because it is operationally convenient but
creates a weaker long-term identity/auth model. It optimizes for short-term gas
advance UX instead of durable execution semantics.

### Full ERC-4337 now

Rejected for v1 because it adds bundler/paymaster/deposit/simulation/ops
complexity before MoneyOS has proven the narrower product need. It solves a
broader ecosystem problem than the current v1 scope.

### Send/swap-specific intent shape

Rejected because it would save a little schema design now at the cost of
painting MoneyOS into a tool-specific corner. The auth envelope should be more
general than the initial policy surface.

## Consequences

- MoneyOS gets a real gasless account model in v1 without taking on full AA
  infra.
- `send` and `swap` can become gasless first while the account/auth layer stays
  usable for future tools.
- The service layer is required for the feature to work, but it stays outside
  core.
- Later ERC-4337 support should be able to arrive as an adapter path instead of
  a full identity rewrite.
- Engineering work now shifts toward getting the account/auth surface right:
  ABI, intent hashing, nonce semantics, validation rules, and relay policy.

## Open questions

- Should sponsored swap in v1 allow a 2-step `approve + swap` path or require
  an atomic path?
- What exact targets and selectors count as "MoneyOS-native" for relay policy?
- What concrete per-wallet and global treasury caps should v1 use?
- Should `sponsor` binding be mandatory in production intent validation from
  day one?
