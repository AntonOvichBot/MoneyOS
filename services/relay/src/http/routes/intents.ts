import type { PolicyConfig, PolicyInput } from "../../policy/types.js";
import { evaluateMoneyOSNativePolicy } from "../../policy/moneyos-native-policy.js";

export interface ExecuteIntentRequest {
  intent: PolicyInput["intent"];
  signature: `0x${string}`;
  route?: PolicyInput["route"];
}

export interface ExecuteIntentDependencies {
  policy: PolicyConfig;
  relayAddress: string;
  nowSeconds: () => number;
  reserveNonce: (input: PolicyInput["intent"]) => Promise<boolean>;
  simulate: (input: ExecuteIntentRequest) => Promise<boolean>;
  treasuryGate: (input: ExecuteIntentRequest) => Promise<boolean>;
  walletGate: (input: ExecuteIntentRequest) => Promise<boolean>;
  relayHealthy: () => Promise<boolean>;
}

export interface ExecuteIntentResponse {
  status: "accepted" | "rejected";
  submissionId?: string;
  reason?: string;
  policyCode?: string;
}

export async function evaluateExecuteIntent(
  request: ExecuteIntentRequest,
  deps: ExecuteIntentDependencies,
): Promise<ExecuteIntentResponse> {
  const [nonceReserved, simulationPassed, treasuryAllowed, walletAllowed, relayHealthy] =
    await Promise.all([
      deps.reserveNonce(request.intent),
      deps.simulate(request),
      deps.treasuryGate(request),
      deps.walletGate(request),
      deps.relayHealthy(),
    ]);

  const decision = evaluateMoneyOSNativePolicy(
    {
      nowSeconds: deps.nowSeconds(),
      chainId: deps.policy.chainId,
      relayAddress: deps.relayAddress,
      intent: request.intent,
      route: request.route,
      nonceReserved,
      simulationPassed,
      treasuryAllowed,
      walletAllowed,
      relayHealthy,
    },
    deps.policy,
  );

  if (!decision.ok) {
    return {
      status: "rejected",
      reason: decision.reason,
      policyCode: decision.code,
    };
  }

  return {
    status: "accepted",
    submissionId: `${request.intent.account}:${request.intent.nonceKey.toString()}:${request.intent.nonceSeq.toString()}`,
    policyCode: decision.code,
  };
}
