# Sepolia rehearsal (MoneyOS gasless v1 Path C)

This lane is for rehearsal only. It blocks non-Sepolia chain IDs.

## What these scripts do

1. `SepoliaSendRehearsal.s.sol`
   - deploys `MoneyOSAccountFactoryV1`
   - deploys a simple receiver harness
   - executes `deployAndExecute` with one native-send call
   - verifies deterministic account, value transfer, and owner-signed intent flow

2. `SepoliaSwapShapeMockRehearsal.s.sol`
   - deploys `MoneyOSAccountFactoryV1`
   - deploys mock token + mock swap router harnesses
   - executes atomic `approve + swap` shape through `deployAndExecute`
   - verifies allowance set + router call via account

Note: swap script validates **shape** with mocks, not a live DEX provider route.

## Required env

Copy template and fill with throwaway keys:

```bash
cp packages/gasless/script/sepolia.rehearsal.env.example /tmp/moneyos.sepolia.env
# edit /tmp/moneyos.sepolia.env
set -a; source /tmp/moneyos.sepolia.env; set +a
```

Required variables:
- `SEPOLIA_RPC_URL`
- `SEPOLIA_SPONSOR_PK` (funded with Sepolia ETH)
- `SEPOLIA_OWNER_PK` (signing key)

## Preflight

```bash
packages/gasless/script/check-sepolia-prereqs.sh
```

## Run (send-first)

```bash
cd packages/gasless
forge script script/SepoliaSendRehearsal.s.sol:SepoliaSendRehearsalScript \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --broadcast \
  -vvv
```

## Optional follow-up (swap shape with mocks)

```bash
cd packages/gasless
forge script script/SepoliaSwapShapeMockRehearsal.s.sol:SepoliaSwapShapeMockRehearsalScript \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --broadcast \
  -vvv
```
