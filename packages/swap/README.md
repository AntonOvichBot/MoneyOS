# @moneyos/swap

Canonical swap package for MoneyOS.

This package owns the public swap execution surface, swap provider contract,
the first provider implementation, `OdosProvider`, and the root CLI integration
contract for `moneyos swap`.
Release history lives in [`CHANGELOG.md`](https://github.com/1231chegites/moneyos/blob/main/packages/swap/CHANGELOG.md).

## Install

Root CLI path:

```bash
npm install -g moneyos
moneyos init
moneyos auth unlock
moneyos balance --all
```

If you want to swap from the CLI, fund the wallet first with the input token
and enough gas for the target chain, then add the tool:

```bash
moneyos add swap
moneyos swap 0.1 RYZE ETH
```

Direct package path:

```bash
npm install @moneyos/swap viem
```

## What it exports

- `executeSwap`
- `swapAction`
- `createSwapTool`
- `moneyosCliTool`
- `SwapProvider`
- `SwapQuote`
- `SwapResult`
- `SwapInput`
- `OdosProvider`

## Example

```ts
import { createMoneyOS } from "moneyos";
import { executeSwap, OdosProvider } from "@moneyos/swap";

const moneyos = createMoneyOS({
  chainId: 42161,
  privateKey: process.env.MONEYOS_PRIVATE_KEY as `0x${string}`,
});

const result = await executeSwap(
  {
    tokenIn: "USDC",
    tokenOut: "RYZE",
    amount: "1",
    provider: new OdosProvider(),
    chainId: 42161,
  },
  moneyos.runtime,
);

console.log(result.hash);
```

## Related packages

- [`@moneyos/core`](https://www.npmjs.com/package/@moneyos/core) for the runtime contract package
- [`moneyos`](https://www.npmjs.com/package/moneyos) for the default SDK and CLI
