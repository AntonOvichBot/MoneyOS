# @moneyos/swap

Canonical swap package for MoneyOS.

This package owns the public swap execution surface, swap provider contract,
and the first provider implementation, `OdosProvider`.

## Install

```bash
npm install @moneyos/swap viem
```

If you want to use it against the root MoneyOS runtime seam, use `moneyos@0.4.0`
or later. Until that root release is published, use this package from the repo
or against a custom runtime that implements the `@moneyos/core` contract.

## What it exports

- `executeSwap`
- `swapAction`
- `createSwapTool`
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
