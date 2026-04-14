import { encodeAbiParameters, keccak256, type Hex } from "viem";
import type { Address } from "viem";

export interface NonceLaneKey {
  signer: Address;
  nonceKey: bigint;
}

export interface IntentReservationKey {
  account: Address;
  sponsor: Address;
  nonceKey: bigint;
  nonceSeq: bigint;
}

export function nonceLaneReservationKey(params: NonceLaneKey): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "uint192" },
      ],
      [params.signer, params.nonceKey],
    ),
  );
}

export function intentIdempotencyKey(params: IntentReservationKey): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "uint192" },
        { type: "uint64" },
      ],
      [params.account, params.sponsor, params.nonceKey, params.nonceSeq],
    ),
  );
}
