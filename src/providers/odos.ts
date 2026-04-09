import type { Address, Hex } from "viem";
import type { SwapProvider, SwapQuote } from "../core/types.js";
import { NATIVE_TOKEN_ADDRESS } from "../core/tokens.js";

const ODOS_API = "https://api.odos.xyz";
const ODOS_NATIVE_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

interface OdosQuoteResponse {
  pathId: string;
  outAmounts: string[];
  outValues: number[];
}

interface OdosAssembleResponse {
  transaction: {
    to: string;
    data: string;
    value: string;
  };
}

export class OdosProvider implements SwapProvider {
  name = "odos";
  private apiKey?: string;

  constructor(options?: { apiKey?: string }) {
    this.apiKey = options?.apiKey;
  }

  private toOdosAddress(address: Address): Address {
    return address === NATIVE_TOKEN_ADDRESS ? ODOS_NATIVE_ADDRESS : address;
  }

  async getQuote(params: {
    chainId: number;
    tokenIn: Address;
    tokenOut: Address;
    amount: bigint;
    sender: Address;
    slippage?: number;
  }): Promise<SwapQuote & { pathId: string; sender: Address }> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(`${ODOS_API}/sor/quote/v2`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        chainId: params.chainId,
        inputTokens: [
          {
            tokenAddress: this.toOdosAddress(params.tokenIn),
            amount: params.amount.toString(),
          },
        ],
        outputTokens: [
          {
            tokenAddress: this.toOdosAddress(params.tokenOut),
            proportion: 1,
          },
        ],
        userAddr: params.sender,
        slippageLimitPercent: params.slippage ?? 1,
        referralCode: 0,
        compact: true,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Odos quote failed: ${response.status} ${text}`);
    }

    const data = (await response.json()) as OdosQuoteResponse;

    return {
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amountIn: params.amount.toString(),
      expectedOut: data.outAmounts[0],
      router: "" as Address,
      chainId: params.chainId,
      pathId: data.pathId,
      sender: params.sender,
    };
  }

  async getCalldata(
    quote: SwapQuote & { pathId: string; sender: Address },
  ): Promise<{ to: Address; data: Hex; value: bigint }> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(`${ODOS_API}/sor/assemble`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        userAddr: quote.sender,
        pathId: quote.pathId,
        simulate: false,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Odos assemble failed: ${response.status} ${text}`);
    }

    const data = (await response.json()) as OdosAssembleResponse;

    return {
      to: data.transaction.to as Address,
      data: data.transaction.data as Hex,
      value: BigInt(data.transaction.value),
    };
  }
}
