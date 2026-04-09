import type { Address, Hex } from "viem";

export interface MoneyOSConfig {
  /** Default chain ID (e.g. 42161 for Arbitrum) */
  chainId: number;
  /** RPC URL override. Uses public RPC if not set. */
  rpcUrl?: string;
  /** Private key for signing transactions (hex string) */
  privateKey?: Hex;
}

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

export interface SwapQuote {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  expectedOut: string;
  router: Address;
  chainId: number;
}

export interface SwapResult {
  hash: Hex;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  chainId: number;
}

export interface SwapProvider {
  name: string;
  getQuote(params: {
    chainId: number;
    tokenIn: Address;
    tokenOut: Address;
    amount: bigint;
    sender: Address;
  }): Promise<SwapQuote>;
  getCalldata(quote: SwapQuote): Promise<{ to: Address; data: Hex; value: bigint }>;
}

export interface Chain {
  id: number;
  name: string;
  rpcUrl: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  blockExplorer: string;
}
