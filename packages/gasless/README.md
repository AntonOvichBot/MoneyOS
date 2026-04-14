# @moneyos/gasless

Gasless Path C package for MoneyOS v1.

This package contains:
- Solidity contracts for `MoneyOSAccountV1` and `MoneyOSAccountFactoryV1`
- Intent hash/signing helpers for `IntentV1`
- Golden vectors for intent hash and signatures
- A gasless executor + relay client skeleton aligned with the v1 trust boundary

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
