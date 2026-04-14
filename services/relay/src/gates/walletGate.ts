import type { RateLimitConfig } from "../../config/runtime.js";
import type { RelayDatabase } from "../db/sqlite.js";
import type { ExecuteIntentRequest } from "../http/routes/intents.js";

const ONE_HOUR_SECONDS = 60 * 60;
const ONE_DAY_SECONDS = 60 * 60 * 24;

function walletHourlyScope(address: string): string {
  return `wallet:${address.toLowerCase()}:hour`;
}

function walletDailyScope(address: string): string {
  return `wallet:${address.toLowerCase()}:day`;
}

export interface WalletGateOptions {
  db: RelayDatabase;
  rateLimit: RateLimitConfig;
  nowSeconds: () => number;
}

export function createWalletGate(options: WalletGateOptions) {
  return async (request: ExecuteIntentRequest): Promise<boolean> => {
    const now = options.nowSeconds();
    const account = request.intent.account;

    const perHourUsage = options.db.getUsage(
      walletHourlyScope(account),
      now,
      ONE_HOUR_SECONDS,
    );
    if (perHourUsage.txCount + 1 > options.rateLimit.perUserPerHourTx) {
      return false;
    }

    const perDayUsage = options.db.getUsage(
      walletDailyScope(account),
      now,
      ONE_DAY_SECONDS,
    );
    if (perDayUsage.txCount + 1 > options.rateLimit.perUserPerDayTx) {
      return false;
    }

    return true;
  };
}

export function applyWalletUsage(options: WalletGateOptions, account: string): void {
  const now = options.nowSeconds();
  options.db.recordUsage(
    walletHourlyScope(account),
    now,
    ONE_HOUR_SECONDS,
    options.rateLimit.perTxMaxGasWei,
  );
  options.db.recordUsage(
    walletDailyScope(account),
    now,
    ONE_DAY_SECONDS,
    options.rateLimit.perTxMaxGasWei,
  );
}
