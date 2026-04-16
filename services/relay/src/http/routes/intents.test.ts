import { describe, expect, it, vi } from "vitest";
import { intentIdempotencyKey } from "@moneyos/gasless";
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
    simulate: async () => ({ ok: true }),
    treasuryGate: async () => true,
    walletGate: async () => true,
    relayHealthy: async () => true,
    ...overrides,
  };
}

describe("evaluateExecuteIntent", () => {
  it("rejects malformed intents before simulation and reservation", async () => {
    const baseRequest = makeRequest();
    const request: ExecuteIntentRequest = {
      ...baseRequest,
      intent: {
        ...baseRequest.intent,
        calls: [],
      },
    };

    const simulate = vi.fn(async () => ({ ok: true }));
    const treasuryGate = vi.fn(async () => true);
    const walletGate = vi.fn(async () => true);
    const reserveNonce = vi.fn(async () => true);

    const response = await evaluateExecuteIntent(
      request,
      makeDeps({ simulate, treasuryGate, walletGate, reserveNonce }),
    );

    expect(response.status).toBe("rejected");
    expect(response.policyCode).toBe("empty_calls");
    expect(simulate).not.toHaveBeenCalled();
    expect(treasuryGate).not.toHaveBeenCalled();
    expect(walletGate).not.toHaveBeenCalled();
    expect(reserveNonce).not.toHaveBeenCalled();
  });

  it("rejects unbounded sponsored window before simulation", async () => {
    const baseRequest = makeRequest();
    const request: ExecuteIntentRequest = {
      ...baseRequest,
      intent: {
        ...baseRequest.intent,
        validUntil: 0n,
      },
    };

    const simulate = vi.fn(async () => ({ ok: true }));
    const reserveNonce = vi.fn(async () => true);

    const response = await evaluateExecuteIntent(
      request,
      makeDeps({ simulate, reserveNonce }),
    );

    expect(response.status).toBe("rejected");
    expect(response.policyCode).toBe("window_too_long");
    expect(simulate).not.toHaveBeenCalled();
    expect(reserveNonce).not.toHaveBeenCalled();
  });

  it("returns the revert reason when simulation fails", async () => {
    const request = makeRequest();
    const reserveNonce = vi.fn(async () => true);

    const response = await evaluateExecuteIntent(
      request,
      makeDeps({
        reserveNonce,
        simulate: async () => ({
          ok: false,
          revertReason: "execution reverted: insufficient funds",
          revertData: "0xdeadbeef",
        }),
      }),
    );

    expect(reserveNonce).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      status: "rejected",
      policyCode: "simulation_failed",
      revertReason: "execution reverted: insufficient funds",
    });
  });

  it("does not include revert reasons for non-simulation policy rejections", async () => {
    const request = makeRequest();

    const response = await evaluateExecuteIntent(
      request,
      makeDeps({
        treasuryGate: async () => false,
      }),
    );

    expect(response).toMatchObject({
      status: "rejected",
      policyCode: "treasury_or_wallet_limit",
    });
    expect(response.revertReason).toBeUndefined();
  });

  it("rejects when nonce reservation fails", async () => {
    const request = makeRequest();

    const response = await evaluateExecuteIntent(
      request,
      makeDeps({
        reserveNonce: async () => false,
      }),
    );

    expect(response.status).toBe("rejected");
    expect(response.policyCode).toBe("nonce_not_reserved");
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
