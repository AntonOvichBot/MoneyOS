# ADR: Gasless V1 uses a minimal MoneyOS smart account

## Status

Accepted and implemented for the v1 send-first gasless path on `main`.

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
  sponsor: address
  nonceKey: uint192
  nonceSeq: uint64
  validAfter: uint48
  validUntil: uint48
  calls: Call[] // { target, value, data }
}
```

Where `sponsor` is an on-chain address binding:
- `address(0)` means any sponsor or self-pay path may submit
- non-zero means only that sponsor may submit the intent

V1 production flow should use non-zero sponsor binding.

The root owner key remains the ultimate authority. Authorized keys may be added
with explicit scope such as:
- allowed selectors
- allowed targets
- maxAmount
- validAfter
- validUntil

Authorized keys in v1 are **user-side keys**, not MoneyOS-held keys. The
MoneyOS relay sponsors gas and enforces policy, but it must not hold user
signing authority.

Gas sponsorship stays **outside core** in a required MoneyOS-operated service
layer:
- relay API
- sponsorship policy
- treasury controls
- preflight simulation
- Arbitrum submission adapter
- pause / kill switch

Relay policy in v1 should be an explicit static allowlist for MoneyOS-native
send + swap paths. The contract layer enforces per-key scope; the relay layer
enforces what MoneyOS is willing to sponsor.

V1 explicitly defers:
- ERC-4337 bundler/paymaster integration
- paymaster contracts
- multi-chain rollout
- reimbursement/tokenomics logic
- public third-party sponsorship
- broader session-key UX
- bank/card/provider bindings

Sponsored swaps in v1 should use an atomic `calls[]` path, for example
`approve + swap` in one signed execution, rather than a stranded two-step flow.

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

Contract development and testing for this path should use **Foundry**. The
reason is not style preference, but contract correctness: account validation,
ERC-1271 behavior, CREATE2 determinism, scoped-key enforcement, and nonce logic
benefit from fuzzing and invariant testing that Foundry handles well.

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
  ABI, intent hashing, nonce semantics, validation rules, relay policy, and
  user-side authorized-key lifecycle.

## Open questions

- What exact targets and selectors count as "MoneyOS-native" for relay policy?
- What concrete per-wallet and global treasury caps should v1 use at launch?
- What exact user-side automation-key minting and rotation UX should v1 expose?
