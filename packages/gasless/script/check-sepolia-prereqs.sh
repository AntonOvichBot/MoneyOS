#!/usr/bin/env bash
set -euo pipefail

required_tools=(forge cast)
for tool in "${required_tools[@]}"; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing required tool: $tool" >&2
    exit 1
  fi
done

required_vars=(SEPOLIA_RPC_URL SEPOLIA_SPONSOR_PK SEPOLIA_OWNER_PK)
for var in "${required_vars[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    echo "Missing required env var: $var" >&2
    exit 1
  fi
done

chain_id="$(cast chain-id --rpc-url "$SEPOLIA_RPC_URL")"
if [[ "$chain_id" != "11155111" ]]; then
  echo "Wrong chain id: expected 11155111 (Sepolia), got $chain_id" >&2
  exit 1
fi

sponsor_addr="$(cast wallet address --private-key "$SEPOLIA_SPONSOR_PK")"
owner_addr="$(cast wallet address --private-key "$SEPOLIA_OWNER_PK")"
sponsor_balance_wei="$(cast balance "$sponsor_addr" --rpc-url "$SEPOLIA_RPC_URL")"

cat <<EOF
Sepolia prereq check passed.
- chain_id: $chain_id
- sponsor_address: $sponsor_addr
- owner_address: $owner_addr
- sponsor_balance_wei: $sponsor_balance_wei
EOF
