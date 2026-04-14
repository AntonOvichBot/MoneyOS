import { describe, expect, it } from "vitest";
import type { RateLimitConfig } from "../../config/runtime.js";
import { RelayDatabase } from "../db/sqlite.js";
import { applyWalletUsage, createWalletGate } from "./walletGate.js";
import type { ExecuteIntentRequest } from "../http/routes/intents.js";

const request: ExecuteIntentRequest = {
  intent: {
    account: "0x1111111111111111111111111111111111111111",
    sponsor: "0x2222222222222222222222222222222222222222",
    nonceKey: 1n,
    nonceSeq: 1n,
    validAfter: 1710000000n,
    validUntil: 1710000300n,
    calls: [
      {
        target: "0x3333333333333333333333333333333333333333",
        value: 1n,
        data: "0x" as const,
      },
    ],
  },
  signature: "0xdeadbeef" as const,
};

describe("wallet rate limit rollover", () => {
  it("enforces per-hour cap and allows submissions after next hourly window", async () => {
    const db = new RelayDatabase(":memory:");
    let now = 3_598;

    const rateLimit: RateLimitConfig = {
      perUserPerHourTx: 2,
      perUserPerDayTx: 20,
      perStationPerDayTx: 2000,
      perTxMaxGasWei: 500_000_000_000_000n,
    };

    const options = {
      db,
      rateLimit,
      nowSeconds: () => now,
    };

    const walletGate = createWalletGate(options);

    expect(await walletGate(request)).toBe(true);
    applyWalletUsage(options, request.intent.account);

    expect(await walletGate(request)).toBe(true);
    applyWalletUsage(options, request.intent.account);

    expect(await walletGate(request)).toBe(false);

    now = 3_601;
    expect(await walletGate(request)).toBe(true);

    db.close();
  });
});
