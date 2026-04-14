import type { Address, Hex } from "viem";

export interface IntentCallV1 {
  target: Address;
  value: bigint;
  data: Hex;
}

export interface IntentV1 {
  account: Address;
  sponsor: Address;
  nonceKey: bigint;
  nonceSeq: bigint;
  validAfter: bigint;
  validUntil: bigint;
  calls: readonly IntentCallV1[];
}

export interface IntentV1Domain {
  chainId: number;
  verifyingContract: Address;
  name?: string;
  version?: string;
}

export interface RouteFreshnessMetadataV1 {
  providerId: string;
  quotedAt: number;
  expiresAt?: number;
  quoteId?: string;
}

export const INTENT_V1_DOMAIN_NAME = "MoneyOSAccount";
export const INTENT_V1_DOMAIN_VERSION = "1";

export const UINT48_MAX = (1n << 48n) - 1n;
export const UINT64_MAX = (1n << 64n) - 1n;
export const UINT192_MAX = (1n << 192n) - 1n;
