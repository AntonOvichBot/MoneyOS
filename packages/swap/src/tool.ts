import {
  formatUnits,
  parseUnits,
  encodeFunctionData,
  type Address,
} from "viem";
import type {
  ActionContext,
  CallRequest,
  MoneyOSAction,
} from "@moneyos/core";
import type { SwapProvider, SwapResult } from "./types.js";

export interface InsufficientBalanceErrorOptions {
  symbol: string;
  address: Address;
  need: string;
  have: string;
}

export class InsufficientBalanceError extends Error {
  readonly symbol: string;
  readonly address: Address;
  readonly need: string;
  readonly have: string;

  constructor(options: InsufficientBalanceErrorOptions) {
    super(
      `Insufficient ${options.symbol} balance on ${options.address}: need ${options.need}, have ${options.have}.`,
    );
    this.name = "InsufficientBalanceError";
    this.symbol = options.symbol;
    this.address = options.address;
    this.need = options.need;
    this.have = options.have;
  }
}

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
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export interface SwapInput<P extends SwapProvider = SwapProvider> {
  tokenIn: string;
  tokenOut: string;
  amount: string;
  provider: P;
  chainId: number;
  slippage?: number;
}

export async function executeSwap<P extends SwapProvider>(
  input: SwapInput<P>,
  ctx: ActionContext,
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
  const isNativeIn = tokenInAddress === assets.nativeTokenAddress;

  const currentBalance = isNativeIn
    ? await read.getBalance({ address: sender, chainId })
    : await read.readContract<bigint>({
      address: tokenInAddress,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [sender],
      chainId,
    });

  if (currentBalance < amountWei) {
    throw new InsufficientBalanceError({
      symbol: tokenInInfo.symbol,
      address: sender,
      need: formatUnits(amountWei, tokenInInfo.decimals),
      have: formatUnits(currentBalance, tokenInInfo.decimals),
    });
  }

  const quote = await provider.getQuote({
    chainId,
    tokenIn: tokenInAddress,
    tokenOut: tokenOutAddress,
    amount: amountWei,
    sender,
    slippage,
  });

  const calldata = await provider.getCalldata(quote);

  const swapCall: CallRequest = {
    to: calldata.to,
    data: calldata.data,
    value: isNativeIn ? amountWei : calldata.value,
    chainId,
  };

  const canBatch =
    typeof execute.sendBatch === "function" && execute.capabilities().batching;

  function buildApproveCall(): CallRequest {
    const approveData = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "approve",
      args: [calldata.to, amountWei],
    });
    return { to: tokenInAddress!, data: approveData, chainId };
  }

  let result;
  if (isNativeIn) {
    // Native-in swap is a single call; no approve possible or needed.
    result = await execute.send(swapCall);
  } else if (canBatch) {
    // Batching executors (e.g. gasless smart-account). The relay policy
    // only sponsors the [approve, swap] batch shape for ERC-20-in, with
    // no allowed 1-call "swap with existing allowance" shape. Submit the
    // exact-amount approve unconditionally so the batch always matches
    // policy regardless of prior allowance state. The extra approve is
    // explicitly permitted (policy forbids only uint256.max amounts).
    result = await execute.sendBatch!([buildApproveCall(), swapCall]);
  } else {
    // Non-batching executor (EOA). No relay shape constraint here, so
    // keep the cheaper allowance-gated path: only approve when needed.
    const currentAllowance = await read.readContract<bigint>({
      address: tokenInAddress,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [sender, calldata.to],
      chainId,
    });
    if (currentAllowance < amountWei) {
      await execute.send(buildApproveCall());
    }
    result = await execute.send(swapCall);
  }

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
  run: executeSwap,
};

export function createSwapTool() {
  return {
    name: "swap" as const,
    version: "0.1.0",
    actions: { swap: swapAction },
  };
}
