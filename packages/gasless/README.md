# @moneyos/gasless

Repo workspace for the MoneyOS gasless smart-account lane.

This package contains:

- Solidity contracts for `MoneyOSAccountV1` and `MoneyOSAccountFactoryV1`
- Intent hash/signing helpers for `IntentV1`
- Address-derivation helpers and baked Arbitrum defaults
- A gasless executor and relay client used by the root SDK and CLI
- Golden vectors and focused tests for the account/auth surface

This package is in the repo today but is not published to npm yet.

## Tooling

- Contract lane: Foundry (`forge`)
- SDK lane: TypeScript + viem

## Contracts

- `contracts/MoneyOSAccountV1.sol`
- `contracts/MoneyOSAccountFactoryV1.sol`
- `contracts/lib/IntentHashV1.sol`

## Tests

- `forge test` (contracts)
- `npm run test --workspace=packages/gasless` (TS vectors/helpers)
