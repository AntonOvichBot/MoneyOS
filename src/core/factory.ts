import type { MoneyOSConfig } from "./types.js";
import { MoneyOS } from "./client.js";

/**
 * Create a MoneyOS instance.
 *
 * Usage:
 *   const moneyos = createMoneyOS({ chainId: 42161, privateKey: "0x..." });
 *   await moneyos.send("USDC", "0x...", "10");
 *
 * Future (with tools):
 *   const moneyos = createMoneyOS(config).use(swapTool());
 */
export function createMoneyOS(config: MoneyOSConfig): MoneyOS {
  return new MoneyOS(config);
}
