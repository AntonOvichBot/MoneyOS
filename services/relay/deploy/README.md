# MoneyOS Relay Deployment

Issue #82 is local-first for v1. The first real host is Jack's always-on Mac mini. Cloud migration can wait until a real external user depends on the relay or home-hosting becomes operationally annoying.

## Prereqs

- Node 22
- npm
- Docker Desktop if you want the container path
- Run this once after install or Node upgrades on local machines:

```bash
npm rebuild better-sqlite3 --workspace=services/relay
```

## Direct node run (recommended for Mac mini)

```bash
npm ci
npm rebuild better-sqlite3 --workspace=services/relay
npm run build --workspace=packages/gasless
npm run build --workspace=services/relay
npm run start:node --workspace=services/relay
```

Default endpoint: `http://127.0.0.1:8787`

## Required environment

Set these in shell or an env file you source before launch.

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
MONEYOS_RELAY_PER_USER_PER_DAY_TX=20
MONEYOS_RELAY_PER_USER_PER_HOUR_TX=5
MONEYOS_RELAY_PER_STATION_PER_DAY_TX=2000
MONEYOS_RELAY_PER_TX_MAX_GAS_WEI=500000000000000
MONEYOS_RELAY_HOT_WALLET_MIN_BALANCE_WEI=500000000000000
MONEYOS_RELAY_HOT_WALLET_AUTO_REFILL_THRESHOLD_WEI=2000000000000000
MONEYOS_RELAY_ACCOUNT_FACTORY_ADDRESS=0x...
MONEYOS_RELAY_ACCOUNT_FACTORY_SALT=0x661dc84e663a6c53a7d8c503cd081a8242171c4ee21f5f559d01e1b71d9a8de1
MONEYOS_RELAY_CONFIRM_POLL_MS=5000
```

Default `MONEYOS_RELAY_DB_PATH` by platform:

- Linux production: `/var/lib/moneyos-relay/relay.sqlite`
- macOS local host: `~/Library/Application Support/MoneyOS Relay/relay.sqlite`
- other/dev fallback: `services/relay/data/relay.sqlite`

## launchd install (macOS / Mac mini)

Create an env file such as `~/.config/moneyos-relay.env`:

```bash
export MONEYOS_RELAY_RPC_URL=https://arb-mainnet.example
export MONEYOS_RELAY_SPONSOR_PRIVATE_KEY=0x...
export MONEYOS_RELAY_ADDRESS=0x...
export MONEYOS_RELAY_DB_PATH="$HOME/Library/Application Support/MoneyOS Relay/relay.sqlite"
```

Then install the plist:

```bash
mkdir -p "$HOME/Library/Application Support/MoneyOS Relay"
mkdir -p "$HOME/.config"
cp services/relay/deploy/ai.moneyos.relay.plist "$HOME/Library/LaunchAgents/ai.moneyos.relay.plist"
launchctl unload "$HOME/Library/LaunchAgents/ai.moneyos.relay.plist" 2>/dev/null || true
launchctl load "$HOME/Library/LaunchAgents/ai.moneyos.relay.plist"
launchctl kickstart -k gui/$(id -u)/ai.moneyos.relay
launchctl print gui/$(id -u)/ai.moneyos.relay
```

Logs:

- `~/Library/Logs/moneyos-relay.log`
- `~/Library/Logs/moneyos-relay.err.log`

## systemd install (Linux / later VPS)

```bash
sudo install -D -m 0644 services/relay/deploy/moneyos-relay.service /etc/systemd/system/moneyos-relay.service
sudo install -d -m 0750 /var/lib/moneyos-relay
sudo systemctl daemon-reload
sudo systemctl enable --now moneyos-relay
sudo systemctl status moneyos-relay
```

## Docker

Docker is optional for v1 local hosting. On macOS this means Docker Desktop.

```bash
docker build -f services/relay/deploy/Dockerfile -t moneyos-relay:local .
docker run --rm -p 8787:8787 --env-file /etc/moneyos/relay.env moneyos-relay:local
```

## Home-network edge checklist

If the relay is reachable from outside your home network, document and choose the boring edge path:

- domain or subdomain name
- DNS or DDNS
- TLS termination path
- direct port-forward vs Cloudflare Tunnel
- how you will rotate the relay off the Mac mini later without breaking the public endpoint

For v1, Cloudflare Tunnel is usually the cleaner choice than raw port-forwarding.
