import {
  formatUnits,
  parseUnits,
  encodeFunctionData,
} from "viem";
import type {
  ReadClient,
  ExecutionClient,
  AssetRegistry,
  MoneyOSAction,
  SwapProvider,
  SwapResult,
} from "@moneyos/core";

const ERC20_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export interface SwapInput {
  tokenIn: string;
  tokenOut: string;
  amount: string;
  provider: SwapProvider;
  chainId: number;
  slippage?: number;
}

async function executeSwap(
  input: SwapInput,
  ctx: { read: ReadClient; execute: ExecutionClient; assets: AssetRegistry },
): Promise<SwapResult> {
  const { tokenIn, tokenOut, amount, provider, chainId, slippage } = input;
  const { read, execute, assets } = ctx;
  const sender = execute.getAddress();

  const tokenInAddress = assets.getTokenAddress(tokenIn, chainId);
  const tokenOutAddress = assets.getTokenAddress(tokenOut, chainId);
  if (!tokenInAddress) {
    throw new Error(`Token ${tokenIn} not found on chain ${chainId}`);
  }
  if (!tokenOutAddress) {
    throw new Error(`Token ${tokenOut} not found on chain ${chainId}`);
  }

  const tokenInInfo = assets.getToken(tokenIn)!;
  const amountWei = parseUnits(amount, tokenInInfo.decimals);

  const quote = await provider.getQuote({
    chainId,
    tokenIn: tokenInAddress,
    tokenOut: tokenOutAddress,
    amount: amountWei,
    sender,
    slippage,
  });

  const calldata = await provider.getCalldata(quote);
  const isNativeIn = tokenInAddress === assets.nativeTokenAddress;

  if (!isNativeIn) {
    const currentAllowance = await read.readContract<bigint>({
      address: tokenInAddress,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [sender, calldata.to],
      chainId,
    });

    if (currentAllowance < amountWei) {
      const approveData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [calldata.to, amountWei],
      });
      await execute.send({ to: tokenInAddress, data: approveData, chainId });
    }
  }

  const result = await execute.send({
    to: calldata.to,
    data: calldata.data,
    value: isNativeIn ? amountWei : calldata.value,
    chainId,
  });

  const tokenOutInfo = assets.getToken(tokenOut)!;
  return {
    hash: result.hash,
    tokenIn: tokenInInfo.symbol,
    tokenOut: tokenOutInfo.symbol,
    amountIn: amount,
    amountOut: formatUnits(BigInt(quote.expectedOut), tokenOutInfo.decimals),
    chainId,
  };
}

export const swapAction: MoneyOSAction<SwapInput, SwapResult> = {
  name: "swap",
  description: "Swap tokens via a DEX provider",
  run: (input, ctx) => executeSwap(input, ctx),
};

export function createSwapTool() {
  return {
    name: "swap" as const,
    version: "0.1.0",
    actions: { swap: swapAction },
  };
}
