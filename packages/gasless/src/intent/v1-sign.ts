import type { LocalAccount } from "viem/accounts";
import { recoverTypedDataAddress, type Address, type Hex } from "viem";
import {
  INTENT_V1_DOMAIN_NAME,
  INTENT_V1_DOMAIN_VERSION,
  type IntentV1,
  type IntentV1Domain,
} from "./v1-types.js";
import { hashIntentV1 } from "./v1-hash.js";

const INTENT_TYPES = {
  Call: [
    { name: "target", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
  ],
  IntentV1: [
    { name: "account", type: "address" },
    { name: "sponsor", type: "address" },
    { name: "nonceKey", type: "uint192" },
    { name: "nonceSeq", type: "uint64" },
    { name: "validAfter", type: "uint48" },
    { name: "validUntil", type: "uint48" },
    { name: "calls", type: "Call[]" },
  ],
} as const;

function asSafeNumber(value: bigint, field: string): number {
  const asNumber = Number(value);
  if (!Number.isSafeInteger(asNumber)) {
    throw new Error(`${field} exceeds JS safe integer range`);
  }

  return asNumber;
}

function toTypedIntentMessage(intent: IntentV1) {
  return {
    account: intent.account,
    sponsor: intent.sponsor,
    nonceKey: intent.nonceKey,
    nonceSeq: intent.nonceSeq,
    validAfter: asSafeNumber(intent.validAfter, "validAfter"),
    validUntil: asSafeNumber(intent.validUntil, "validUntil"),
    calls: intent.calls,
  } as const;
}

function resolveDomain(domain: IntentV1Domain) {
  return {
    name: domain.name ?? INTENT_V1_DOMAIN_NAME,
    version: domain.version ?? INTENT_V1_DOMAIN_VERSION,
    chainId: BigInt(domain.chainId),
    verifyingContract: domain.verifyingContract,
  } as const;
}

export async function signIntentV1(
  account: LocalAccount,
  intent: IntentV1,
  domain: IntentV1Domain,
): Promise<Hex> {
  return account.signTypedData({
    domain: resolveDomain(domain),
    types: INTENT_TYPES,
    primaryType: "IntentV1",
    message: toTypedIntentMessage(intent),
  });
}

export async function recoverIntentV1Signer(
  intent: IntentV1,
  signature: Hex,
  domain: IntentV1Domain,
): Promise<Address> {
  return recoverTypedDataAddress({
    domain: resolveDomain(domain),
    types: INTENT_TYPES,
    primaryType: "IntentV1",
    message: toTypedIntentMessage(intent),
    signature,
  });
}

export async function createIntentV1SignedPayload(
  account: LocalAccount,
  intent: IntentV1,
  domain: IntentV1Domain,
): Promise<{
  intent: IntentV1;
  signature: Hex;
  digest: Hex;
  signer: Address;
}> {
  const signature = await signIntentV1(account, intent, domain);
  const signer = await recoverIntentV1Signer(intent, signature, domain);
  const digest = hashIntentV1(intent, domain);

  return {
    intent,
    signature,
    digest,
    signer,
  };
}
