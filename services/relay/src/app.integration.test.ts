import { describe, expect, it, vi } from "vitest";
import { buildRelayApp } from "./app.js";
import type { PolicyConfig } from "./policy/types.js";
import { RelayDatabase } from "./db/sqlite.js";
import { createReserveNonceGate } from "./gates/reserveNonce.js";
import { applyTreasuryUsage, createTreasuryGate } from "./gates/treasuryGate.js";
import { applyWalletUsage, createWalletGate } from "./gates/walletGate.js";
import type { RateLimitConfig } from "../config/runtime.js";

const policy: PolicyConfig = {
  policyVersion: "gasless-v1-path-c",
  chainId: 42161,
  relayAddress: "0x1111111111111111111111111111111111111111",
  maxIntentWindowSeconds: 300,
  maxRouteAgeSeconds: 300,
  tokenAllowlist: ["0xaf88d065e77c8cc2239327c5edb3a432268e5831"],
  odosRouters: [],
  odosSwapSelectors: [],
};

function makeExecutePayload(nonceSeq: string) {
  return {
    intent: {
      account: "0x2222222222222222222222222222222222222222",
      sponsor: policy.relayAddress,
      nonceKey: "7",
      nonceSeq,
      validAfter: "1710000000",
      validUntil: "1710000300",
      calls: [
        {
          target: "0x3333333333333333333333333333333333333333",
          value: "1",
          data: "0x",
        },
      ],
    },
    signature: "0xdeadbeef",
  };
}

function buildRateLimit(perUserPerHourTx: number, perUserPerDayTx: number, perStationPerDayTx: number): RateLimitConfig {
  return {
    perUserPerHourTx,
    perUserPerDayTx,
    perStationPerDayTx,
    perTxMaxGasWei: 500_000_000_000_000n,
  };
}

describe("relay app", () => {
  it("executes submit flow, supports idempotent replay, and serves tx status", async () => {
    const db = new RelayDatabase(":memory:");
    let now = 1710000001;
    const nowSeconds = () => now;

    const rateLimit = buildRateLimit(5, 20, 2000);
    const walletOptions = { db, rateLimit, nowSeconds };
    const treasuryOptions = { db, rateLimit, nowSeconds };

    const app = buildRelayApp({
      policy,
      relayAddress: policy.relayAddress,
      killSwitchEnabled: () => false,
      db,
      nowSeconds,
      reserveNonce: createReserveNonceGate(db, nowSeconds),
      simulate: async () => true,
      treasuryGate: createTreasuryGate(treasuryOptions),
      walletGate: createWalletGate(walletOptions),
      relayHealthy: async () => true,
      submissionAdapter: {
        submitIntent: async () => ({
          txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        }),
        stop: () => {},
      },
      onSubmissionAccepted: (request) => {
        applyTreasuryUsage(treasuryOptions);
        applyWalletUsage(walletOptions, request.intent.account);
      },
    });

    const executeResponse = await app.inject({
      method: "POST",
      url: "/v1/execute",
      payload: makeExecutePayload("3"),
    });

    expect(executeResponse.statusCode).toBe(200);
    const executeBody = executeResponse.json();
    expect(executeBody.status).toBe("submitted");
    expect(executeBody.submissionId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(executeBody.txHash).toMatch(/^0x[0-9a-f]{64}$/);

    const replayResponse = await app.inject({
      method: "POST",
      url: "/v1/execute",
      payload: makeExecutePayload("3"),
    });

    expect(replayResponse.statusCode).toBe(200);
    expect(replayResponse.json()).toMatchObject({
      status: "submitted",
      submissionId: executeBody.submissionId,
    });

    const txResponse = await app.inject({
      method: "GET",
      url: `/v1/tx/${executeBody.submissionId}`,
    });

    expect(txResponse.statusCode).toBe(200);
    expect(txResponse.json()).toEqual({
      id: executeBody.submissionId,
      status: "submitted",
      txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });

    const capabilitiesResponse = await app.inject({
      method: "GET",
      url: "/v1/capabilities",
    });

    expect(capabilitiesResponse.statusCode).toBe(200);
    expect(capabilitiesResponse.json().supports).toEqual(["native-send", "erc20-send"]);

    await app.close();
    db.close();
  });

  it("returns 404 on missing submission id", async () => {
    const db = new RelayDatabase(":memory:");

    const app = buildRelayApp({
      policy,
      relayAddress: policy.relayAddress,
      killSwitchEnabled: () => false,
      db,
      nowSeconds: () => 1710000001,
      reserveNonce: async () => true,
      simulate: async () => true,
      treasuryGate: async () => true,
      walletGate: async () => true,
      relayHealthy: async () => true,
      submissionAdapter: {
        submitIntent: async () => ({
          txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        }),
        stop: () => {},
      },
    });

    const txResponse = await app.inject({
      method: "GET",
      url: "/v1/tx/0xdeadbeef",
    });

    expect(txResponse.statusCode).toBe(404);
    expect(txResponse.json()).toEqual({ error: "Submission not found" });

    await app.close();
    db.close();
  });

  it("enforces wallet rate limit with 429 status", async () => {
    const db = new RelayDatabase(":memory:");
    const nowSeconds = () => 1710000001;
    const rateLimit = buildRateLimit(1, 20, 2000);
    const walletOptions = { db, rateLimit, nowSeconds };
    const treasuryOptions = { db, rateLimit, nowSeconds };

    const app = buildRelayApp({
      policy,
      relayAddress: policy.relayAddress,
      killSwitchEnabled: () => false,
      db,
      nowSeconds,
      reserveNonce: createReserveNonceGate(db, nowSeconds),
      simulate: async () => true,
      treasuryGate: createTreasuryGate(treasuryOptions),
      walletGate: createWalletGate(walletOptions),
      relayHealthy: async () => true,
      submissionAdapter: {
        submitIntent: async () => ({
          txHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        }),
        stop: () => {},
      },
      onSubmissionAccepted: (request) => {
        applyTreasuryUsage(treasuryOptions);
        applyWalletUsage(walletOptions, request.intent.account);
      },
    });

    const first = await app.inject({
      method: "POST",
      url: "/v1/execute",
      payload: makeExecutePayload("10"),
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "POST",
      url: "/v1/execute",
      payload: makeExecutePayload("11"),
    });
    expect(second.statusCode).toBe(429);
    expect(second.json()).toMatchObject({
      status: "rejected",
      policyCode: "treasury_or_wallet_limit",
    });

    await app.close();
    db.close();
  });

  it("returns kill_switch_active before gate execution", async () => {
    const db = new RelayDatabase(":memory:");
    const simulate = vi.fn(async () => true);
    const treasuryGate = vi.fn(async () => true);
    const walletGate = vi.fn(async () => true);
    const reserveNonce = vi.fn(async () => true);
    const relayHealthy = vi.fn(async () => true);

    const app = buildRelayApp({
      policy,
      relayAddress: policy.relayAddress,
      killSwitchEnabled: () => true,
      db,
      nowSeconds: () => 1710000001,
      reserveNonce,
      simulate,
      treasuryGate,
      walletGate,
      relayHealthy,
      submissionAdapter: {
        submitIntent: async () => ({
          txHash: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        }),
        stop: () => {},
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/execute",
      payload: makeExecutePayload("12"),
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: "rejected",
      code: "kill_switch_active",
      reason: "Relay kill switch is active.",
    });

    expect(relayHealthy).not.toHaveBeenCalled();
    expect(simulate).not.toHaveBeenCalled();
    expect(treasuryGate).not.toHaveBeenCalled();
    expect(walletGate).not.toHaveBeenCalled();
    expect(reserveNonce).not.toHaveBeenCalled();

    await app.close();
    db.close();
  });

  it("returns 502 when submission adapter fails", async () => {
    const db = new RelayDatabase(":memory:");

    const app = buildRelayApp({
      policy,
      relayAddress: policy.relayAddress,
      killSwitchEnabled: () => false,
      db,
      nowSeconds: () => 1710000001,
      reserveNonce: async () => true,
      simulate: async () => true,
      treasuryGate: async () => true,
      walletGate: async () => true,
      relayHealthy: async () => true,
      submissionAdapter: {
        submitIntent: async () => {
          throw new Error("upstream RPC failure");
        },
        stop: () => {},
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/execute",
      payload: makeExecutePayload("42"),
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({
      status: "failed",
      reason: "upstream RPC failure",
    });

    await app.close();
    db.close();
  });
});
