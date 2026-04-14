# MoneyOS Relay

Wave B turns the relay into a runnable Fastify service with SQLite persistence.

## Routes

- `POST /v1/execute`
- `GET /v1/capabilities`
- `GET /v1/tx/:id`

## Local run

```bash
npm ci
npm run build --workspace=packages/gasless
npm run start --workspace=services/relay
```

## What is included

- policy gate wiring (`src/http/routes/intents.ts`, `src/policy/*`)
- SQLite-backed nonce reservations, submissions, and usage counters (`src/db/sqlite.ts`)
- nonce/simulation/treasury/wallet/health gates (`src/gates/*`)
- viem submission adapter + background receipt confirmer (`src/submit/adapter.ts`)
- runtime/env config (`config/runtime.ts`)
- deploy artifacts (`deploy/`)
