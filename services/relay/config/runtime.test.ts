import { describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "./runtime.js";

describe("loadRuntimeConfig", () => {
  it("fails startup when sponsor private key is missing", () => {
    expect(() => loadRuntimeConfig({})).toThrow(
      "Missing or invalid MONEYOS_RELAY_SPONSOR_PRIVATE_KEY",
    );
  });

  it("uses issue #82-aligned rate-limit defaults", () => {
    const config = loadRuntimeConfig({
      MONEYOS_RELAY_SPONSOR_PRIVATE_KEY:
        "0x59c6995e998f97a5a0044966f094538f7d0f8f2f3f4d5c6e7f8090a1b2c3d4e5",
    });

    expect(config.rateLimit.perUserPerDayTx).toBe(20);
    expect(config.rateLimit.perUserPerHourTx).toBe(5);
    expect(config.rateLimit.perStationPerDayTx).toBe(2000);
    expect(config.rateLimit.perTxMaxGasWei).toBe(500_000_000_000_000n);
    expect(config.hotWallet.minBalanceWei).toBe(500_000_000_000_000n);
  });
});
