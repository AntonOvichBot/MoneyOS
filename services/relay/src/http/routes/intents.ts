import { intentIdempotencyKey } from "@moneyos/gasless";
import type { PolicyConfig, PolicyInput } from "../../policy/types.js";
import { evaluateMoneyOSNativePolicy } from "../../policy/moneyos-native-policy.js";
import type { SimulateResult } from "../../gates/simulate.js";

export interface ExecuteIntentRequest {
  intent: PolicyInput["intent"];
  signature: `0x${string}`;
  route?: PolicyInput["route"];
}

export interface ExecuteIntentDependencies {
  policy: PolicyConfig;
  relayAddress: string;
  nowSeconds: () => number;
  reserveNonce: (input: PolicyInput["intent"], idempotencyKey?: `0x${string}`) => Promise<boolean>;
  simulate: (input: ExecuteIntentRequest) => Promise<SimulateResult>;
  treasuryGate: (input: ExecuteIntentRequest) => Promise<boolean>;
  walletGate: (input: ExecuteIntentRequest) => Promise<boolean>;
  relayHealthy: () => Promise<boolean>;
}

export interface ExecuteIntentResponse {
  status: "accepted" | "rejected";
  submissionId: string;
  reason?: string;
  policyCode?: string;
  revertReason?: string;
}

export async function evaluateExecuteIntent(
  request: ExecuteIntentRequest,
  deps: ExecuteIntentDependencies,
): Promise<ExecuteIntentResponse> {
  const submissionId = intentIdempotencyKey({
    account: request.intent.account as `0x${string}`,
    sponsor: request.intent.sponsor as `0x${string}`,
    nonceKey: request.intent.nonceKey,
    nonceSeq: request.intent.nonceSeq,
  });

  const nowSeconds = deps.nowSeconds();
  const relayHealthy = await deps.relayHealthy();

  const preflight = evaluateMoneyOSNativePolicy(
    {
      nowSeconds,
      chainId: deps.policy.chainId,
      relayAddress: deps.relayAddress,
      intent: request.intent,
      route: request.route,
      nonceReserved: true,
      simulationPassed: true,
      treasuryAllowed: true,
      walletAllowed: true,
      relayHealthy,
    },
    deps.policy,
  );

  if (!preflight.ok) {
    return {
      status: "rejected",
      submissionId,
      reason: preflight.reason,
      policyCode: preflight.code,
    };
  }

  const [simulation, treasuryAllowed, walletAllowed] = await Promise.all([
    deps.simulate(request),
    deps.treasuryGate(request),
    deps.walletGate(request),
  ]);

  let nonceReserved = false;
  if (simulation.ok) {
    nonceReserved = await deps.reserveNonce(request.intent, submissionId);
  }

  const decision = evaluateMoneyOSNativePolicy(
    {
      nowSeconds,
      chainId: deps.policy.chainId,
      relayAddress: deps.relayAddress,
      intent: request.intent,
      route: request.route,
      nonceReserved,
      simulationPassed: simulation.ok,
      treasuryAllowed,
      walletAllowed,
      relayHealthy,
    },
    deps.policy,
  );

  if (!decision.ok) {
    return {
      status: "rejected",
      submissionId,
      reason: decision.reason,
      policyCode: decision.code,
      revertReason:
        decision.code === "simulation_failed" && !simulation.ok
          ? simulation.revertReason
          : undefined,
    };
  }

  return {
    status: "accepted",
    submissionId,
    policyCode: decision.code,
  };
}
