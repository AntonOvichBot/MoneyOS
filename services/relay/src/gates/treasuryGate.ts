import type { RateLimitConfig } from "../../config/runtime.js";
import type { RelayDatabase } from "../db/sqlite.js";
import type { ExecuteIntentRequest } from "../http/routes/intents.js";

export interface TreasuryGateOptions {
  db: RelayDatabase;
  rateLimit: RateLimitConfig;
  nowSeconds: () => number;
  killSwitchEnabled: () => boolean;
}

export function createTreasuryGate(options: TreasuryGateOptions) {
  return async (_request: ExecuteIntentRequest): Promise<boolean> => {
    if (options.killSwitchEnabled()) {
      return false;
    }

    const now = options.nowSeconds();
    const usage = options.db.getUsage("global", now, options.rateLimit.windowSeconds);

    if (usage.txCount + 1 > options.rateLimit.globalMaxTx) {
      return false;
    }

    if (usage.gasWei + options.rateLimit.perTxMaxGasWei > options.rateLimit.globalMaxGasWei) {
      return false;
    }

    return true;
  };
}

export function applyTreasuryUsage(options: TreasuryGateOptions): void {
  options.db.recordUsage(
    "global",
    options.nowSeconds(),
    options.rateLimit.windowSeconds,
    options.rateLimit.perTxMaxGasWei,
  );
}
