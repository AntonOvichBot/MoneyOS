import { describe, expect, it, vi } from "vitest";
import { intentIdempotencyKey } from "../../../../../packages/gasless/src/nonce/lane.js";
import type { PolicyConfig } from "../../policy/types.js";
import { evaluateExecuteIntent, type ExecuteIntentDependencies, type ExecuteIntentRequest } from "./intents.js";

const policy: PolicyConfig = {
  policyVersion: "gasless-v1-path-c",
  chainId: 42161,
  relayAddress: "0x1111111111111111111111111111111111111111",
  maxIntentWindowSeconds: 300,
  maxRouteAgeSeconds: 300,
  tokenAllowlist: ["0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"],
  odosRouters: [],
  odosSwapSelectors: [],
};

function makeRequest(): ExecuteIntentRequest {
  return {
    intent: {
      account: "0x2222222222222222222222222222222222222222",
      sponsor: policy.relayAddress,
      nonceKey: 7n,
      nonceSeq: 3n,
      validAfter: 1710000000n,
      validUntil: 1710000300n,
      calls: [
        {
          target: "0x3333333333333333333333333333333333333333",
          value: 1n,
          data: "0x",
        },
      ],
    },
    signature: "0xdeadbeef",
  };
}

function makeDeps(overrides: Partial<ExecuteIntentDependencies>): ExecuteIntentDependencies {
  return {
    policy,
    relayAddress: policy.relayAddress,
    nowSeconds: () => 1710000001,
    reserveNonce: async () => true,
    simulate: async () => true,
    treasuryGate: async () => true,
    walletGate: async () => true,
    relayHealthy: async () => true,
    ...overrides,
  };
}

describe("evaluateExecuteIntent", () => {
  it("does not reserve nonce when simulation fails", async () => {
    const request = makeRequest();
    const reserveNonce = vi.fn(async () => true);

    const response = await evaluateExecuteIntent(
      request,
      makeDeps({
        reserveNonce,
        simulate: async () => false,
      }),
    );

    expect(reserveNonce).not.toHaveBeenCalled();
    expect(response.status).toBe("rejected");
    expect(response.policyCode).toBe("simulation_failed");
  });

  it("uses intent idempotency key for reservation and submission id", async () => {
    const request = makeRequest();
    const expectedId = intentIdempotencyKey({
      account: request.intent.account as `0x${string}`,
      sponsor: request.intent.sponsor as `0x${string}`,
      nonceKey: request.intent.nonceKey,
      nonceSeq: request.intent.nonceSeq,
    });

    const reserveNonce = vi.fn(async (_intent, idempotencyKey?: `0x${string}`) => {
      expect(idempotencyKey).toBe(expectedId);
      return true;
    });

    const response = await evaluateExecuteIntent(
      request,
      makeDeps({
        reserveNonce,
      }),
    );

    expect(reserveNonce).toHaveBeenCalledTimes(1);
    expect(reserveNonce).toHaveBeenCalledWith(request.intent, expectedId);
    expect(response.status).toBe("accepted");
    expect(response.submissionId).toBe(expectedId);
  });
});
