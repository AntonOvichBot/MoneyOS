# MoneyOS

The operating system for money. Programmable money primitives for developers and AI agents.

## Install

```bash
npm install moneyos
```

## CLI

```bash
# Check balance
moneyos balance USDC
moneyos balance ETH --address 0x...

# Send tokens
moneyos send 10 USDC 0x...
moneyos send 0.1 ETH 0x...
```

## SDK

```typescript
import { MoneyOS } from "moneyos";

const moneyos = new MoneyOS({
  chainId: 42161,
  privateKey: process.env.PRIVATE_KEY,
});

// Check balance
const balance = await moneyos.balance("USDC");
console.log(balance.amount); // "250.50"

// Send tokens
const tx = await moneyos.send("USDC", "0x...", "10");
console.log(tx.hash);
```

## Supported Chains

| Chain | ID |
|-------|-----|
| Arbitrum | 42161 |
| Ethereum | 1 |
| Polygon | 137 |

## Supported Tokens

USDC, USDT, RYZE, ETH (native)

## License

MIT
