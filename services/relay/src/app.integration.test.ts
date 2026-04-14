import { describe, expect, it } from "vitest";
import { buildRelayApp } from "./app.js";
import type { PolicyConfig } from "./policy/types.js";
import { RelayDatabase } from "./db/sqlite.js";

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

describe("relay app", () => {
  it("executes submit flow and serves tx status from sqlite", async () => {
    const db = new RelayDatabase(":memory:");

    const app = buildRelayApp({
      policy,
      relayAddress: policy.relayAddress,
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

    const executeResponse = await app.inject({
      method: "POST",
      url: "/v1/execute",
      payload: {
        intent: {
          account: "0x2222222222222222222222222222222222222222",
          sponsor: policy.relayAddress,
          nonceKey: "7",
          nonceSeq: "3",
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
      },
    });

    expect(executeResponse.statusCode).toBe(200);
    const executeBody = executeResponse.json();
    expect(executeBody.status).toBe("submitted");
    expect(executeBody.submissionId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(executeBody.txHash).toMatch(/^0x[0-9a-f]{64}$/);

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
});
