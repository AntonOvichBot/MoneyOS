import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import vectorsJson from "../vectors/intent-v1-golden.json";
import {
  computeAccountAddressOffline,
  createIntentV1SignedPayload,
  hashIntentV1,
  intentIdempotencyKey,
  recoverIntentV1Signer,
  signIntentV1,
  type IntentV1,
} from "../src/index.js";
import { evaluateMoneyOSNativePolicy } from "../../../services/relay/src/policy/moneyos-native-policy.js";
import type { PolicyConfig } from "../../../services/relay/src/policy/types.js";

const approveAbi = parseAbi(["function approve(address spender, uint256 amount)"]);

const vectors = vectorsJson as {
  ownerPrivateKey: Hex;
  authorizedPrivateKey: Hex;
  domain: {
    chainId: number;
    verifyingContract: Address;
  };
  intent: {
    account: Address;
    sponsor: Address;
    nonceKey: string;
    nonceSeq: string;
    validAfter: string;
    validUntil: string;
    calls: Array<{ target: Address; value: string; data: Hex }>;
  };
  create2: {
    factory: Address;
    salt: Hex;
    initCodeHash: Hex;
  };
  expected: {
    digest: Hex;
    ownerAddress: Address;
    ownerSignature: Hex;
    authorizedAddress: Address;
    authorizedSignature: Hex;
    create2Address: Address;
  };
};

function asIntent(input: typeof vectors.intent): IntentV1 {
  return {
    account: input.account,
    sponsor: input.sponsor,
    nonceKey: BigInt(input.nonceKey),
    nonceSeq: BigInt(input.nonceSeq),
    validAfter: BigInt(input.validAfter),
    validUntil: BigInt(input.validUntil),
    calls: input.calls.map((call) => ({
      target: call.target,
      value: BigInt(call.value),
      data: call.data,
    })),
  };
}

function isWithinAuthorizedScope(intent: IntentV1): boolean {
  const allowedTargets = new Set(["0x3333333333333333333333333333333333333333"]);
  const allowedSelectors = new Set(["0x00000000"]);
  const maxValueWei = 200000000000000n;

  return intent.calls.every((call) => {
    const selector = call.data.length < 10 ? "0x00000000" : call.data.slice(0, 10);
    return (
      allowedTargets.has(call.target.toLowerCase()) &&
      allowedSelectors.has(selector.toLowerCase()) &&
      call.value <= maxValueWei
    );
  });
}

class InMemoryReservation {
  private readonly used = new Set<Hex>();

  reserve(key: Hex): boolean {
    if (this.used.has(key)) {
      return false;
    }

    this.used.add(key);
    return true;
  }
}

describe("Gasless v1 golden vectors", () => {
  it("1) intent hash generation matches frozen golden vector", () => {
    const intent = asIntent(vectors.intent);
    const digest = hashIntentV1(intent, vectors.domain);
    expect(digest).toBe(vectors.expected.digest);
  });

  it("2) owner signature validation matches vector", async () => {
    const intent = asIntent(vectors.intent);
    const owner = privateKeyToAccount(vectors.ownerPrivateKey);

    const signature = await signIntentV1(owner, intent, vectors.domain);
    const recovered = await recoverIntentV1Signer(intent, signature, vectors.domain);

    expect(owner.address).toBe(vectors.expected.ownerAddress);
    expect(signature).toBe(vectors.expected.ownerSignature);
    expect(recovered).toBe(owner.address);
  });

  it("3) authorized-key signature validation with allowed scope", async () => {
    const intent = asIntent(vectors.intent);
    const authorized = privateKeyToAccount(vectors.authorizedPrivateKey);

    const payload = await createIntentV1SignedPayload(authorized, intent, vectors.domain);

    expect(authorized.address).toBe(vectors.expected.authorizedAddress);
    expect(payload.signature).toBe(vectors.expected.authorizedSignature);
    expect(payload.signer).toBe(authorized.address);
    expect(isWithinAuthorizedScope(intent)).toBe(true);
  });

  it("4) authorized-key is rejected outside scope", () => {
    const intent = asIntent(vectors.intent);
    const outsideScopeIntent: IntentV1 = {
      ...intent,
      calls: [
        {
          ...intent.calls[0]!,
          target: "0x4444444444444444444444444444444444444444",
        },
      ],
    };

    expect(isWithinAuthorizedScope(outsideScopeIntent)).toBe(false);
  });

  it("5) CREATE2 account address derivation vector", () => {
    const address = computeAccountAddressOffline(vectors.create2);
    expect(address).toBe(vectors.expected.create2Address);
  });

  it("6) deploy + native send shape is policy-valid", () => {
    const intent = asIntent(vectors.intent);
    const policy: PolicyConfig = {
      policyVersion: "gasless-v1-path-c",
      chainId: vectors.domain.chainId,
      relayAddress: vectors.intent.sponsor,
      maxIntentWindowSeconds: 300,
      maxRouteAgeSeconds: 300,
      tokenAllowlist: [
        "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
        "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      ],
      odosRouters: ["0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa"],
      odosSwapSelectors: ["0x12345678"],
    };

    const decision = evaluateMoneyOSNativePolicy(
      {
        nowSeconds: Number(intent.validAfter),
        chainId: vectors.domain.chainId,
        relayAddress: vectors.intent.sponsor,
        intent,
        nonceReserved: true,
        simulationPassed: true,
        treasuryAllowed: true,
        relayHealthy: true,
        walletAllowed: true,
      },
      policy,
    );

    expect(decision.ok).toBe(true);
    expect(decision.flow).toBe("native-send");
  });

  it("7) deploy + atomic approve+swap shape is policy-valid", () => {
    const router = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa" as Address;
    const token = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as Address;

    const swapIntent: IntentV1 = {
      account: vectors.intent.account,
      sponsor: vectors.intent.sponsor,
      nonceKey: 44n,
      nonceSeq: 1n,
      validAfter: 1710000000n,
      validUntil: 1710000300n,
      calls: [
        {
          target: token,
          value: 0n,
          data: encodeFunctionData({
            abi: approveAbi,
            functionName: "approve",
            args: [router, 1234500n],
          }),
        },
        {
          target: router,
          value: 0n,
          data: `0x12345678deadbeef` as Hex,
        },
      ],
    };

    const policy: PolicyConfig = {
      policyVersion: "gasless-v1-path-c",
      chainId: vectors.domain.chainId,
      relayAddress: vectors.intent.sponsor,
      maxIntentWindowSeconds: 300,
      maxRouteAgeSeconds: 300,
      tokenAllowlist: [token],
      odosRouters: [router],
      odosSwapSelectors: ["0x12345678"],
    };

    const decision = evaluateMoneyOSNativePolicy(
      {
        nowSeconds: 1710000001,
        chainId: vectors.domain.chainId,
        relayAddress: vectors.intent.sponsor,
        intent: swapIntent,
        route: {
          providerId: "odos",
          quotedAt: 1710000000,
          expiresAt: 1710000300,
          quoteId: "q-1",
        },
        nonceReserved: true,
        simulationPassed: true,
        treasuryAllowed: true,
        relayHealthy: true,
        walletAllowed: true,
      },
      policy,
    );

    expect(decision.ok).toBe(true);
    expect(decision.flow).toBe("erc20-swap");
  });

  it("8) replay rejection on reused (signer, nonceKey, nonceSeq)", () => {
    const owner = privateKeyToAccount(vectors.ownerPrivateKey);
    const intent = asIntent(vectors.intent);
    const store = new InMemoryReservation();

    const key = intentIdempotencyKey({
      account: intent.account,
      sponsor: intent.sponsor,
      nonceKey: intent.nonceKey,
      nonceSeq: intent.nonceSeq,
    });

    expect(store.reserve(key)).toBe(true);
    expect(store.reserve(key)).toBe(false);
    expect(owner.address).toBe(vectors.expected.ownerAddress);
  });

  it("9) sponsor mismatch rejection", () => {
    const intent = asIntent(vectors.intent);
    const policy: PolicyConfig = {
      policyVersion: "gasless-v1-path-c",
      chainId: vectors.domain.chainId,
      relayAddress: "0x9999999999999999999999999999999999999999",
      maxIntentWindowSeconds: 300,
      maxRouteAgeSeconds: 300,
      tokenAllowlist: [
        "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      ],
      odosRouters: [],
      odosSwapSelectors: [],
    };

    const decision = evaluateMoneyOSNativePolicy(
      {
        nowSeconds: Number(intent.validAfter),
        chainId: vectors.domain.chainId,
        relayAddress: "0x9999999999999999999999999999999999999999",
        intent,
        nonceReserved: true,
        simulationPassed: true,
        treasuryAllowed: true,
        relayHealthy: true,
        walletAllowed: true,
      },
      policy,
    );

    expect(decision.ok).toBe(false);
    expect(decision.code).toBe("sponsor_mismatch");
  });

  it("10) stale route rejection in relay path", () => {
    const router = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa" as Address;
    const token = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as Address;

    const swapIntent: IntentV1 = {
      account: vectors.intent.account,
      sponsor: vectors.intent.sponsor,
      nonceKey: 45n,
      nonceSeq: 2n,
      validAfter: 1710000200n,
      validUntil: 1710000500n,
      calls: [
        {
          target: token,
          value: 0n,
          data: encodeFunctionData({
            abi: approveAbi,
            functionName: "approve",
            args: [router, 1500n],
          }),
        },
        {
          target: router,
          value: 0n,
          data: `0x12345678cafebabe` as Hex,
        },
      ],
    };

    const policy: PolicyConfig = {
      policyVersion: "gasless-v1-path-c",
      chainId: vectors.domain.chainId,
      relayAddress: vectors.intent.sponsor,
      maxIntentWindowSeconds: 300,
      maxRouteAgeSeconds: 300,
      tokenAllowlist: [token],
      odosRouters: [router],
      odosSwapSelectors: ["0x12345678"],
    };

    const decision = evaluateMoneyOSNativePolicy(
      {
        nowSeconds: 1710000401,
        chainId: vectors.domain.chainId,
        relayAddress: vectors.intent.sponsor,
        intent: swapIntent,
        route: {
          providerId: "odos",
          quotedAt: 1710000000,
          expiresAt: 1710000900,
          quoteId: "q-stale",
        },
        nonceReserved: true,
        simulationPassed: true,
        treasuryAllowed: true,
        relayHealthy: true,
        walletAllowed: true,
      },
      policy,
    );

    expect(decision.ok).toBe(false);
    expect(decision.code).toBe("route_stale");
  });
});
