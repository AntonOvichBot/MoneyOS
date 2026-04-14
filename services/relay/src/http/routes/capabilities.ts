import type { PolicyConfig } from "../../policy/types.js";

export function relayCapabilities(policy: PolicyConfig) {
  return {
    policyVersion: policy.policyVersion,
    chainId: policy.chainId,
    sponsorAddress: policy.relayAddress,
    supports: [
      "native-send",
      "erc20-send",
      "native-swap",
      "erc20-swap",
    ],
  };
}
