import type { Address, Hex } from "viem";
import { createPublicClient, http } from "viem";

import { deriveAccountAddressFromFactory } from "./smart-account.js";

export interface GaslessNetworkDefaults {
  chainId: number;
  relayUrl: string;
  sponsor: Address;
  factory: Address;
  salt: Hex;
  rpcUrl: string;
}

export const MONEYOS_GASLESS_ACCOUNT_FACTORY_SALT =
  "0x661dc84e663a6c53a7d8c503cd081a8242171c4ee21f5f559d01e1b71d9a8de1" as Hex;

export const ARBITRUM_MAINNET_GASLESS_DEFAULTS: GaslessNetworkDefaults = {
  chainId: 42161,
  relayUrl: "https://anton-2-1-1.tail9b8c50.ts.net:8443",
  sponsor: "0x689c78B4DBa64A88A0dC03a579D01681F52C5A73",
  factory: "0xACBc69bA5B4ae4e709C6DD472c11DEA12CF8B2A9",
  salt: MONEYOS_GASLESS_ACCOUNT_FACTORY_SALT,
  rpcUrl: "https://arb1.arbitrum.io/rpc",
};

export function getGaslessNetworkDefaults(
  chainId: number,
): GaslessNetworkDefaults | undefined {
  if (chainId === ARBITRUM_MAINNET_GASLESS_DEFAULTS.chainId) {
    return ARBITRUM_MAINNET_GASLESS_DEFAULTS;
  }
  return undefined;
}

export async function deriveDefaultGaslessAccount(params: {
  chainId: number;
  owner: Address;
  rpcUrl?: string;
}): Promise<Address | undefined> {
  const defaults = getGaslessNetworkDefaults(params.chainId);
  if (!defaults) {
    return undefined;
  }

  const publicClient = createPublicClient({
    transport: http(params.rpcUrl ?? defaults.rpcUrl),
  });

  return deriveAccountAddressFromFactory(publicClient, {
    factory: defaults.factory,
    owner: params.owner,
    salt: defaults.salt,
  });
}
