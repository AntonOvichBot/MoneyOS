import type { Address, Hex } from "viem";
import type { SwapProvider, SwapQuote } from "../core/types.js";

const ODOS_API = "https://api.odos.xyz";

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

  async getQuote(params: {
    chainId: number;
    tokenIn: Address;
    tokenOut: Address;
    amount: bigint;
    sender: Address;
    slippage?: number;
  }): Promise<SwapQuote & { pathId: string }> {
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
            tokenAddress: params.tokenIn,
            amount: params.amount.toString(),
          },
        ],
        outputTokens: [
          {
            tokenAddress: params.tokenOut,
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
    };
  }

  async getCalldata(
    quote: SwapQuote & { pathId: string },
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
        userAddr: quote.tokenIn,
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
