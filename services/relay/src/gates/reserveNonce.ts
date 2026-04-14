import { intentIdempotencyKey } from "@moneyos/gasless";
import type { PolicyInput } from "../policy/types.js";
import type { RelayDatabase } from "../db/sqlite.js";

export function createReserveNonceGate(db: RelayDatabase, nowSeconds: () => number) {
  return async (intent: PolicyInput["intent"], idempotencyKey?: `0x${string}`): Promise<boolean> => {
    const submissionId =
      idempotencyKey ??
      intentIdempotencyKey({
        account: intent.account as `0x${string}`,
        sponsor: intent.sponsor as `0x${string}`,
        nonceKey: intent.nonceKey,
        nonceSeq: intent.nonceSeq,
      });

    return db.reserveNonce(intent, submissionId, nowSeconds());
  };
}
