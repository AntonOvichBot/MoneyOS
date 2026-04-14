import { describe, expect, it } from "vitest";
import type { PolicyConfig } from "../../policy/types.js";
import { relayCapabilities } from "./capabilities.js";

const basePolicy: PolicyConfig = {
  policyVersion: "gasless-v1-path-c",
  chainId: 42161,
  relayAddress: "0x1111111111111111111111111111111111111111",
  maxIntentWindowSeconds: 300,
  maxRouteAgeSeconds: 300,
  tokenAllowlist: ["0xaf88d065e77c8cC2239327C5EDb3A432268e5831"],
  odosRouters: [],
  odosSwapSelectors: [],
};

describe("relayCapabilities", () => {
  it("does not advertise swap flows when swap config is absent", () => {
    const capabilities = relayCapabilities(basePolicy);

    expect(capabilities.supports).toEqual(["native-send", "erc20-send"]);
  });

  it("advertises swap flows when router + selectors are configured", () => {
    const capabilities = relayCapabilities({
      ...basePolicy,
      odosRouters: ["0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa"],
      odosSwapSelectors: ["0x12345678"],
    });

    expect(capabilities.supports).toEqual([
      "native-send",
      "erc20-send",
      "native-swap",
      "erc20-swap",
    ]);
  });
});
