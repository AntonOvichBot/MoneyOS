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

// Intentionally signer-agnostic in owner-only v1 relay path: replay protection is keyed by
// (account, sponsor, nonce lane). TODO(path-c): include signer once delegated-signer relay
// submissions are enabled so same nonce tuple cannot be replayed across signer classes.
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
