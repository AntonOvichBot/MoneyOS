import type { Address, Hex } from "viem";

export interface SwapQuote {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: string;
  expectedOut: string;
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

export interface SwapProvider<Q extends SwapQuote = SwapQuote> {
  name: string;
  getQuote(params: {
    chainId: number;
    tokenIn: Address;
    tokenOut: Address;
    amount: bigint;
    sender: Address;
    slippage?: number;
  }): Promise<Q>;
  getCalldata(quote: Q): Promise<{ to: Address; data: Hex; value: bigint }>;
}
