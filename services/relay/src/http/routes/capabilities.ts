import type { PolicyConfig } from "../../policy/types.js";

export function relayCapabilities(policy: PolicyConfig) {
  const supports = ["native-send", "erc20-send"];
  const swapEnabled = policy.odosRouters.length > 0 && policy.odosSwapSelectors.length > 0;

  if (swapEnabled) {
    supports.push("native-swap", "erc20-swap");
  }

  return {
    policyVersion: policy.policyVersion,
    chainId: policy.chainId,
    sponsorAddress: policy.relayAddress,
    supports,
  };
}
