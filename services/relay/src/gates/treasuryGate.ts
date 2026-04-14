import type { RateLimitConfig } from "../../config/runtime.js";
import type { RelayDatabase } from "../db/sqlite.js";
import type { ExecuteIntentRequest } from "../http/routes/intents.js";

const ONE_DAY_SECONDS = 60 * 60 * 24;
const STATION_SCOPE = "station";

export interface TreasuryGateOptions {
  db: RelayDatabase;
  rateLimit: RateLimitConfig;
  nowSeconds: () => number;
}

export function createTreasuryGate(options: TreasuryGateOptions) {
  return async (_request: ExecuteIntentRequest): Promise<boolean> => {
    const now = options.nowSeconds();
    const usage = options.db.getUsage(STATION_SCOPE, now, ONE_DAY_SECONDS);

    if (usage.txCount + 1 > options.rateLimit.perStationPerDayTx) {
      return false;
    }

    return true;
  };
}

export function applyTreasuryUsage(options: TreasuryGateOptions): void {
  options.db.recordUsage(
    STATION_SCOPE,
    options.nowSeconds(),
    ONE_DAY_SECONDS,
    options.rateLimit.perTxMaxGasWei,
  );
}
