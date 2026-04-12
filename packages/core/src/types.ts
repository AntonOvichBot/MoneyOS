import type { Address, Hex } from "viem";

export interface Balance {
  token: string;
  symbol: string;
  amount: string;
  rawAmount: bigint;
  decimals: number;
  chainId: number;
}

export interface SendResult {
  hash: Hex;
  from: Address;
  to: Address;
  amount: string;
  token: string;
  chainId: number;
}

export interface Chain {
  id: number;
  name: string;
  rpcUrl: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  blockExplorer: string;
}
