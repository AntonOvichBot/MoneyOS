export interface PolicyCall {
  target: string;
  value: bigint;
  data: `0x${string}`;
}

export interface PolicyIntentV1 {
  account: string;
  sponsor: string;
  nonceKey: bigint;
  nonceSeq: bigint;
  validAfter: bigint;
  validUntil: bigint;
  calls: readonly PolicyCall[];
}

export interface PolicyRouteMetadata {
  providerId: string;
  quotedAt: number;
  expiresAt?: number;
  quoteId?: string;
}

export interface PolicyConfig {
  policyVersion: string;
  chainId: number;
  relayAddress: string;
  maxIntentWindowSeconds: number;
  maxRouteAgeSeconds: number;
  tokenAllowlist: string[];
  odosRouters: string[];
  odosSwapSelectors: `0x${string}`[];
}

export interface PolicyInput {
  nowSeconds: number;
  chainId: number;
  relayAddress: string;
  intent: PolicyIntentV1;
  route?: PolicyRouteMetadata;
  nonceReserved: boolean;
  simulationPassed: boolean;
  treasuryAllowed: boolean;
  relayHealthy: boolean;
  walletAllowed: boolean;
}

export interface PolicyDecision {
  ok: boolean;
  code: string;
  reason: string;
  flow?: "native-send" | "erc20-send" | "native-swap" | "erc20-swap";
}
