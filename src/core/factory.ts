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
 *   // moneyos.send transparently uses the injected executor
 * ```
 *
 * You can also inject `read` or `assets` if you need custom implementations.
 * `privateKey` and `execute` are mutually exclusive.
 *
 * External tools execute against the runtime seam. For example, the in-repo
 * swap tool workspace package can run against `moneyos.runtime`:
 * ```ts
 *   const moneyos = createMoneyOS({ chainId: 42161, privateKey: "0x..." });
 *   const result = await executeSwap(
 *     {
 *       tokenIn: "USDC",
 *       tokenOut: "RYZE",
 *       amount: "1",
 *       provider: new OdosProvider(),
 *       chainId: 42161,
 *     },
 *     moneyos.runtime,
 *   );
 * ```
 */
export function createMoneyOS(config: MoneyOSConfig): MoneyOS {
  return new MoneyOS(config);
}
