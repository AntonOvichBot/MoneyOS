import type { Account, Hex } from "viem";
import { nonceManager } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * Build a local viem Account with nonce management enabled so back-to-back
 * live transactions use a pending-aware nonce source.
 */
export function privateKeyToManagedAccount(privateKey: Hex): Account {
  return privateKeyToAccount(privateKey, { nonceManager });
}
