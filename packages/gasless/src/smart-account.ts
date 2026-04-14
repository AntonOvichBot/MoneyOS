import type { PublicClient, Address, Hex } from "viem";
import { getCreate2Address, keccak256, toHex } from "viem";
import { moneyOSAccountFactoryV1Abi } from "./contracts/abi/moneyos-account-factory-v1.js";

export interface ComputeAccountAddressParams {
  factory: Address;
  owner: Address;
  salt: Hex;
}

export async function deriveAccountAddressFromFactory(
  publicClient: PublicClient,
  params: ComputeAccountAddressParams,
): Promise<Address> {
  return publicClient.readContract({
    address: params.factory,
    abi: moneyOSAccountFactoryV1Abi,
    functionName: "computeAccountAddress",
    args: [params.owner, params.salt],
  });
}

export function computeAccountAddressOffline(params: {
  factory: Address;
  salt: Hex;
  initCodeHash: Hex;
}): Address {
  return getCreate2Address({
    from: params.factory,
    salt: params.salt,
    bytecodeHash: params.initCodeHash,
  });
}

export function computeAccountInitCodeHash(
  accountCreationCode: Hex,
  owner: Address,
): Hex {
  return keccak256(`${accountCreationCode}${owner.slice(2).padStart(64, "0")}` as Hex);
}

export function toCreate2Salt(value: string | bigint): Hex {
  if (typeof value === "bigint") {
    return toHex(value, { size: 32 });
  }

  return keccak256(toHex(value));
}
