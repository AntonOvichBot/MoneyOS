# MoneyOS Relay Deployment (single VPS)

## Local run

```bash
npm ci
npm run build --workspace=packages/gasless
npm run start --workspace=services/relay
```

Default endpoint: `http://127.0.0.1:8787`

## Required environment

Set these in shell or `/etc/moneyos/relay.env`:

```bash
MONEYOS_RELAY_RPC_URL=https://arb-mainnet.example
MONEYOS_RELAY_SPONSOR_PRIVATE_KEY=0x...
MONEYOS_RELAY_ADDRESS=0x...
```

Useful optional overrides:

```bash
MONEYOS_RELAY_HOST=0.0.0.0
MONEYOS_RELAY_PORT=8787
MONEYOS_RELAY_DB_PATH=/var/lib/moneyos-relay/relay.sqlite
MONEYOS_RELAY_POLICY_PATH=/opt/moneyos-repo/services/relay/config/policy.arbitrum.json
MONEYOS_RELAY_KILL_SWITCH=false
MONEYOS_RELAY_RATE_LIMIT_WINDOW_SECONDS=86400
MONEYOS_RELAY_WALLET_MAX_TX=3
MONEYOS_RELAY_WALLET_MAX_GAS_WEI=1000000000000000
MONEYOS_RELAY_GLOBAL_MAX_TX=200
MONEYOS_RELAY_GLOBAL_MAX_GAS_WEI=30000000000000000
MONEYOS_RELAY_PER_TX_MAX_GAS_WEI=800000000000000
MONEYOS_RELAY_CONFIRM_POLL_MS=5000
```

## systemd install

```bash
sudo install -D -m 0644 services/relay/deploy/moneyos-relay.service /etc/systemd/system/moneyos-relay.service
sudo install -d -m 0750 /var/lib/moneyos-relay
sudo systemctl daemon-reload
sudo systemctl enable --now moneyos-relay
sudo systemctl status moneyos-relay
```

## Docker

```bash
docker build -f services/relay/deploy/Dockerfile -t moneyos-relay:local .
docker run --rm -p 8787:8787 --env-file /etc/moneyos/relay.env moneyos-relay:local
```
