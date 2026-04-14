import { describe, expect, it, vi } from "vitest";
import { createRelayHealthyGate } from "./relayHealthy.js";

describe("createRelayHealthyGate", () => {
  it("returns false when sponsor balance is below hard minimum", async () => {
    const gate = createRelayHealthyGate({
      expectedChainId: 42161,
      sponsorAddress: "0x1111111111111111111111111111111111111111",
      minimumSponsorBalanceWei: 500n,
      autoRefillThresholdWei: 2000n,
      client: {
        getChainId: async () => 42161,
        getBlockNumber: async () => 1n,
        getBalance: async () => 499n,
      },
    });

    await expect(gate()).resolves.toBe(false);
  });

  it("returns true but signals refill when balance is under refill threshold", async () => {
    const onAutoRefillNeeded = vi.fn();

    const gate = createRelayHealthyGate({
      expectedChainId: 42161,
      sponsorAddress: "0x1111111111111111111111111111111111111111",
      minimumSponsorBalanceWei: 500n,
      autoRefillThresholdWei: 2000n,
      client: {
        getChainId: async () => 42161,
        getBlockNumber: async () => 1n,
        getBalance: async () => 1200n,
      },
      onAutoRefillNeeded,
    });

    await expect(gate()).resolves.toBe(true);
    expect(onAutoRefillNeeded).toHaveBeenCalledWith({
      balanceWei: 1200n,
      thresholdWei: 2000n,
    });
  });

  it("returns false when chain id is wrong", async () => {
    const gate = createRelayHealthyGate({
      expectedChainId: 42161,
      sponsorAddress: "0x1111111111111111111111111111111111111111",
      minimumSponsorBalanceWei: 500n,
      autoRefillThresholdWei: 2000n,
      client: {
        getChainId: async () => 1,
        getBlockNumber: async () => 1n,
        getBalance: async () => 10_000n,
      },
    });

    await expect(gate()).resolves.toBe(false);
  });

  it("returns false when the RPC health check times out", async () => {
    const gate = createRelayHealthyGate({
      expectedChainId: 42161,
      sponsorAddress: "0x1111111111111111111111111111111111111111",
      minimumSponsorBalanceWei: 500n,
      autoRefillThresholdWei: 2000n,
      timeoutMs: 10,
      client: {
        getChainId: async () => {
          await new Promise((resolve) => setTimeout(resolve, 25));
          return 42161;
        },
        getBlockNumber: async () => 1n,
        getBalance: async () => 10_000n,
      },
    });

    await expect(gate()).resolves.toBe(false);
  });
});
