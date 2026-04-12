import type { Address, Hex } from "viem";
import { NATIVE_TOKEN_ADDRESS } from "@moneyos/core";
import type { SwapProvider, SwapQuote } from "../types.js";

const ZERO_EX_API = "https://api.0x.org";
const ZERO_EX_API_VERSION = "v2";
const ZERO_EX_NATIVE_TOKEN_ADDRESS =
  "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as Address;
const DEFAULT_SLIPPAGE_PERCENT = 1;

interface ZeroExTransaction {
  to: Address;
  data: Hex;
  value: bigint;
}

interface ZeroExQuoteResponse {
  allowanceTarget?: string;
  buyAmount: string;
  issues?: {
    allowance?: {
      actual: string;
      spender: string;
    } | null;
  };
  transaction: {
    to: string;
    data: string;
    value: string;
  };
}

interface ZeroExQuote extends SwapQuote {
  transaction: ZeroExTransaction;
}

export class ZeroExProvider implements SwapProvider<ZeroExQuote> {
  name = "0x";
  private readonly apiKey: string;

  constructor(options: { apiKey: string }) {
    if (!options?.apiKey?.trim()) {
      throw new Error("ZeroExProvider requires apiKey");
    }

    this.apiKey = options.apiKey;
  }

  private createHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "0x-api-key": this.apiKey,
      "0x-version": ZERO_EX_API_VERSION,
    };
  }

  private toZeroExAddress(address: Address): Address {
    return sameAddress(address, NATIVE_TOKEN_ADDRESS)
      ? ZERO_EX_NATIVE_TOKEN_ADDRESS
      : address;
  }

  private toSlippageBps(slippage?: number): string {
    const percent = slippage ?? DEFAULT_SLIPPAGE_PERCENT;
    if (!Number.isFinite(percent) || percent < 0) {
      throw new Error("ZeroExProvider slippage must be a non-negative number");
    }

    return Math.round(percent * 100).toString();
  }

  async getQuote(params: {
    chainId: number;
    tokenIn: Address;
    tokenOut: Address;
    amount: bigint;
    sender: Address;
    slippage?: number;
  }): Promise<ZeroExQuote> {
    const searchParams = new URLSearchParams({
      chainId: params.chainId.toString(),
      sellToken: this.toZeroExAddress(params.tokenIn),
      buyToken: this.toZeroExAddress(params.tokenOut),
      sellAmount: params.amount.toString(),
      taker: params.sender,
      slippageBps: this.toSlippageBps(params.slippage),
    });

    const response = await fetch(
      `${ZERO_EX_API}/swap/allowance-holder/quote?${searchParams.toString()}`,
      {
        headers: this.createHeaders(),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`0x quote failed: ${response.status} ${text}`);
    }

    const data = (await response.json()) as ZeroExQuoteResponse;
    const transaction = {
      to: data.transaction.to as Address,
      data: data.transaction.data as Hex,
      value: BigInt(data.transaction.value),
    } satisfies ZeroExTransaction;

    const allowanceTarget = (data.allowanceTarget ??
      data.issues?.allowance?.spender ??
      transaction.to) as Address;

    if (!sameAddress(allowanceTarget, transaction.to)) {
      throw new Error(
        "0x AllowanceHolder quote returned a distinct allowance target; current executeSwap() only supports approve and swap against the same address",
      );
    }

    return {
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amountIn: params.amount.toString(),
      expectedOut: data.buyAmount,
      chainId: params.chainId,
      transaction,
    };
  }

  async getCalldata(
    quote: ZeroExQuote,
  ): Promise<{ to: Address; data: Hex; value: bigint }> {
    return quote.transaction;
  }
}

function sameAddress(left: Address, right: Address): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
