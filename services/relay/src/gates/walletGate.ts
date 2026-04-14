import type { RateLimitConfig } from "../../config/runtime.js";
import type { RelayDatabase } from "../db/sqlite.js";
import type { ExecuteIntentRequest } from "../http/routes/intents.js";

function walletScope(address: string): string {
  return `wallet:${address.toLowerCase()}`;
}

export interface WalletGateOptions {
  db: RelayDatabase;
  rateLimit: RateLimitConfig;
  nowSeconds: () => number;
  killSwitchEnabled: () => boolean;
}

export function createWalletGate(options: WalletGateOptions) {
  return async (request: ExecuteIntentRequest): Promise<boolean> => {
    if (options.killSwitchEnabled()) {
      return false;
    }

    const now = options.nowSeconds();
    const scope = walletScope(request.intent.account);
    const usage = options.db.getUsage(scope, now, options.rateLimit.windowSeconds);

    if (usage.txCount + 1 > options.rateLimit.walletMaxTx) {
      return false;
    }

    if (usage.gasWei + options.rateLimit.perTxMaxGasWei > options.rateLimit.walletMaxGasWei) {
      return false;
    }

    return true;
  };
}

export function applyWalletUsage(options: WalletGateOptions, account: string): void {
  options.db.recordUsage(
    walletScope(account),
    options.nowSeconds(),
    options.rateLimit.windowSeconds,
    options.rateLimit.perTxMaxGasWei,
  );
}
