# @moneyos/core

Bare-metal runtime contracts, shared types, and registries for MoneyOS.

Use this package when you are building tools, providers, or custom runtimes.
If you want the default SDK and CLI, install [`moneyos`](https://www.npmjs.com/package/moneyos).

## Install

```bash
npm install @moneyos/core viem
```

## What it includes

- runtime contracts such as `ReadClient`, `ExecutionClient`, `ActionContext`, and `MoneyOSRuntime`
- shared value types such as `Balance`, `SendResult`, and `Chain`
- built-in chain and token registries
- shared keystore interfaces

## Example

```ts
import type { ActionContext, MoneyOSAction } from "@moneyos/core";

type PingInput = { message: string };
type PingResult = { echoed: string };

export const pingAction: MoneyOSAction<PingInput, PingResult> = {
  name: "ping",
  description: "Example action built on the MoneyOS runtime seam",
  async run(input: PingInput, _ctx: ActionContext): Promise<PingResult> {
    return { echoed: input.message };
  },
};
```

## Related packages

- [`moneyos`](https://www.npmjs.com/package/moneyos) for the default SDK and CLI
- [`@moneyos/tool-swap`](https://www.npmjs.com/package/@moneyos/tool-swap) for the canonical swap tool
