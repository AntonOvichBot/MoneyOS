import {
  concat,
  encodeAbiParameters,
  hashTypedData,
  keccak256,
  toBytes,
  type Hex,
} from "viem";
import {
  INTENT_V1_DOMAIN_NAME,
  INTENT_V1_DOMAIN_VERSION,
  type IntentCallV1,
  type IntentV1,
  type IntentV1Domain,
} from "./v1-types.js";

const EIP712_DOMAIN_TYPE =
  "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)";
const CALL_TYPE = "Call(address target,uint256 value,bytes data)";
const INTENT_V1_TYPE =
  "IntentV1(address account,address sponsor,uint192 nonceKey,uint64 nonceSeq,uint48 validAfter,uint48 validUntil,Call[] calls)Call(address target,uint256 value,bytes data)";

export const EIP712_DOMAIN_TYPEHASH = keccak256(toBytes(EIP712_DOMAIN_TYPE));
export const CALL_TYPEHASH = keccak256(toBytes(CALL_TYPE));
export const INTENT_V1_TYPEHASH = keccak256(toBytes(INTENT_V1_TYPE));

export function hashIntentCallV1(call: IntentCallV1): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "address" },
        { type: "uint256" },
        { type: "bytes32" },
      ],
      [CALL_TYPEHASH, call.target, call.value, keccak256(call.data)],
    ),
  );
}

export function hashIntentCallsV1(calls: readonly IntentCallV1[]): Hex {
  if (calls.length === 0) {
    return keccak256("0x");
  }

  return keccak256(concat(calls.map(hashIntentCallV1)));
}

export function intentV1DomainSeparator(domain: IntentV1Domain): Hex {
  const nameHash = keccak256(toBytes(domain.name ?? INTENT_V1_DOMAIN_NAME));
  const versionHash = keccak256(toBytes(domain.version ?? INTENT_V1_DOMAIN_VERSION));

  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
      ],
      [
        EIP712_DOMAIN_TYPEHASH,
        nameHash,
        versionHash,
        BigInt(domain.chainId),
        domain.verifyingContract,
      ],
    ),
  );
}

function asSafeNumber(value: bigint, field: string): number {
  const asNumber = Number(value);
  if (!Number.isSafeInteger(asNumber)) {
    throw new Error(`${field} exceeds JS safe integer range`);
  }

  return asNumber;
}

export function hashIntentStructV1(intent: IntentV1): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "address" },
        { type: "address" },
        { type: "uint192" },
        { type: "uint64" },
        { type: "uint48" },
        { type: "uint48" },
        { type: "bytes32" },
      ],
      [
        INTENT_V1_TYPEHASH,
        intent.account,
        intent.sponsor,
        intent.nonceKey,
        intent.nonceSeq,
        asSafeNumber(intent.validAfter, "validAfter"),
        asSafeNumber(intent.validUntil, "validUntil"),
        hashIntentCallsV1(intent.calls),
      ],
    ),
  );
}

export function hashIntentV1(intent: IntentV1, domain: IntentV1Domain): Hex {
  const domainSeparator = intentV1DomainSeparator(domain);
  const structHash = hashIntentStructV1(intent);

  return keccak256(concat(["0x1901", domainSeparator, structHash]));
}

export function hashIntentV1TypedData(intent: IntentV1, domain: IntentV1Domain): Hex {
  return hashTypedData({
    domain: {
      name: domain.name ?? INTENT_V1_DOMAIN_NAME,
      version: domain.version ?? INTENT_V1_DOMAIN_VERSION,
      chainId: BigInt(domain.chainId),
      verifyingContract: domain.verifyingContract,
    },
    types: {
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
    },
    primaryType: "IntentV1",
    message: {
      ...intent,
      validAfter: asSafeNumber(intent.validAfter, "validAfter"),
      validUntil: asSafeNumber(intent.validUntil, "validUntil"),
    },
  });
}

export function selectorFromCalldata(data: Hex): Hex {
  if (data.length < 10) {
    return "0x00000000";
  }

  return data.slice(0, 10) as Hex;
}

