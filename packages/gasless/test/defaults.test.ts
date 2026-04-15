import { describe, expect, it } from "vitest";

import {
  ARBITRUM_MAINNET_GASLESS_DEFAULTS,
  getGaslessNetworkDefaults,
  MONEYOS_GASLESS_ACCOUNT_FACTORY_SALT,
} from "../src/defaults.js";

describe("gasless network defaults", () => {
  it("exposes Arbitrum mainnet defaults", () => {
    expect(getGaslessNetworkDefaults(42161)).toEqual(
      ARBITRUM_MAINNET_GASLESS_DEFAULTS,
    );
    expect(ARBITRUM_MAINNET_GASLESS_DEFAULTS.relayUrl).toBe(
      "https://anton-2-1-1.tail9b8c50.ts.net:8443",
    );
    expect(getGaslessNetworkDefaults(11155111)).toBeUndefined();
  });

  it("keeps the canonical v1 factory salt", () => {
    expect(MONEYOS_GASLESS_ACCOUNT_FACTORY_SALT).toBe(
      "0x661dc84e663a6c53a7d8c503cd081a8242171c4ee21f5f559d01e1b71d9a8de1",
    );
  });
});
