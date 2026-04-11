import type { MoneyOSConfig } from "@moneyos/core";
import { MoneyOS } from "./client.js";

/**
 * Create a MoneyOS instance.
 *
 * Default EOA usage:
 * ```ts
 *   const moneyos = createMoneyOS({ chainId: 42161, privateKey: "0x..." });
 *   await moneyos.send("USDC", "0x...", "10");
 * ```
 *
 * Custom execution:
 * ```ts
 *   const moneyos = createMoneyOS({
 *     chainId: 42161,
 *     execute: myExecutionClient,
 *   });
 *   // moneyos.send / moneyos.swap transparently use the injected executor
 * ```
 *
 * You can also inject `read` or `assets` if you need custom implementations.
 * `privateKey` and `execute` are mutually exclusive.
 *
 * Future (with tools):
 * ```ts
 *   const moneyos = createMoneyOS(config).use(swapTool());
 * ```
 */
export function createMoneyOS(config: MoneyOSConfig): MoneyOS {
  return new MoneyOS(config);
}
