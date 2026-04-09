import {
  createPublicClient,
  createWalletClient,
  http,
  formatUnits,
  parseUnits,
  type Address,
  type Chain as ViemChain,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum, mainnet, polygon } from "viem/chains";
import type {
  MoneyOSConfig,
  Balance,
  SendResult,
  SwapProvider,
  SwapResult,
} from "./types.js";
import { getChain, defaultChain } from "./chains.js";
import { getToken, getTokenAddress } from "./tokens.js";

const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    name: "symbol",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
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

const viemChains: Record<number, ViemChain> = {
  42161: arbitrum,
  1: mainnet,
  137: polygon,
};

export class MoneyOS {
  private config: MoneyOSConfig;
  private publicClients: Map<number, PublicClient> = new Map();
  private walletClient: WalletClient | undefined;

  constructor(config: MoneyOSConfig) {
    this.config = {
      ...config,
      chainId: config.chainId ?? defaultChain.id,
    };
  }

  private getPublicClient(chainId?: number): PublicClient {
    const id = chainId ?? this.config.chainId;
    let client = this.publicClients.get(id);
    if (!client) {
      const chain = viemChains[id];
      const chainInfo = getChain(id);
      const rpcUrl =
        id === this.config.chainId ? this.config.rpcUrl : undefined;

      client = createPublicClient({
        chain,
        transport: http(rpcUrl ?? chainInfo?.rpcUrl),
      });
      this.publicClients.set(id, client);
    }
    return client;
  }

  private getWalletClient(): WalletClient {
    if (!this.walletClient) {
      if (!this.config.privateKey) {
        throw new Error(
          "No private key configured. Set privateKey in MoneyOS config.",
        );
      }
      const account = privateKeyToAccount(this.config.privateKey);
      const chain = viemChains[this.config.chainId];
      const chainInfo = getChain(this.config.chainId);
      this.walletClient = createWalletClient({
        account,
        chain,
        transport: http(this.config.rpcUrl ?? chainInfo?.rpcUrl),
      });
    }
    return this.walletClient;
  }

  get address(): Address {
    if (!this.config.privateKey) {
      throw new Error("No private key configured.");
    }
    return privateKeyToAccount(this.config.privateKey).address;
  }

  async balance(
    token: string,
    options?: { address?: Address; chainId?: number },
  ): Promise<Balance> {
    const chainId = options?.chainId ?? this.config.chainId;
    const account = options?.address ?? this.address;
    const client = this.getPublicClient(chainId);

    if (token.toUpperCase() === "ETH") {
      const raw = await client.getBalance({ address: account });
      return {
        token: "ETH",
        symbol: "ETH",
        amount: formatUnits(raw, 18),
        rawAmount: raw,
        decimals: 18,
        chainId,
      };
    }

    const tokenAddress = getTokenAddress(token, chainId);
    if (!tokenAddress) {
      throw new Error(`Token ${token} not found on chain ${chainId}`);
    }

    const tokenInfo = getToken(token)!;
    const raw = await client.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [account],
    });

    return {
      token: tokenInfo.name,
      symbol: tokenInfo.symbol,
      amount: formatUnits(raw, tokenInfo.decimals),
      rawAmount: raw,
      decimals: tokenInfo.decimals,
      chainId,
    };
  }

  async send(
    token: string,
    to: Address,
    amount: string,
    options?: { chainId?: number },
  ): Promise<SendResult> {
    const chainId = options?.chainId ?? this.config.chainId;
    const walletClient = this.getWalletClient();
    const from = this.address;

    if (token.toUpperCase() === "ETH") {
      const value = parseUnits(amount, 18);
      const account = privateKeyToAccount(this.config.privateKey!);
      const hash = await walletClient.sendTransaction({
        account,
        to,
        value,
        chain: viemChains[chainId],
      });
      return { hash, from, to, amount, token: "ETH", chainId };
    }

    const tokenAddress = getTokenAddress(token, chainId);
    if (!tokenAddress) {
      throw new Error(`Token ${token} not found on chain ${chainId}`);
    }

    const tokenInfo = getToken(token)!;
    const value = parseUnits(amount, tokenInfo.decimals);
    const client = this.getPublicClient(chainId);

    const { request } = await client.simulateContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [to, value],
      account: privateKeyToAccount(this.config.privateKey!),
    });

    const hash = await walletClient.writeContract(request);
    return { hash, from, to, amount, token: tokenInfo.symbol, chainId };
  }

  async swap(
    tokenIn: string,
    tokenOut: string,
    amount: string,
    provider: SwapProvider,
    options?: { chainId?: number; slippage?: number },
  ): Promise<SwapResult> {
    const chainId = options?.chainId ?? this.config.chainId;
    const walletClient = this.getWalletClient();
    const client = this.getPublicClient(chainId);
    const sender = this.address;

    const tokenInAddress = getTokenAddress(tokenIn, chainId);
    const tokenOutAddress = getTokenAddress(tokenOut, chainId);
    if (!tokenInAddress) {
      throw new Error(`Token ${tokenIn} not found on chain ${chainId}`);
    }
    if (!tokenOutAddress) {
      throw new Error(`Token ${tokenOut} not found on chain ${chainId}`);
    }

    const tokenInInfo = getToken(tokenIn)!;
    const amountWei = parseUnits(amount, tokenInInfo.decimals);

    const quote = await provider.getQuote({
      chainId,
      tokenIn: tokenInAddress,
      tokenOut: tokenOutAddress,
      amount: amountWei,
      sender,
      slippage: options?.slippage,
    });

    const calldata = await provider.getCalldata(quote);

    const currentAllowance = await client.readContract({
      address: tokenInAddress,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [sender, calldata.to],
    });

    if (currentAllowance < amountWei) {
      const account = privateKeyToAccount(this.config.privateKey!);
      const { request: approveRequest } = await client.simulateContract({
        address: tokenInAddress,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [calldata.to, amountWei],
        account,
      });
      await walletClient.writeContract(approveRequest);
    }

    const account = privateKeyToAccount(this.config.privateKey!);
    const hash = await walletClient.sendTransaction({
      account,
      to: calldata.to,
      data: calldata.data,
      value: calldata.value,
      chain: viemChains[chainId],
    });

    const tokenOutInfo = getToken(tokenOut)!;
    return {
      hash,
      tokenIn: tokenInInfo.symbol,
      tokenOut: tokenOutInfo.symbol,
      amountIn: amount,
      amountOut: formatUnits(BigInt(quote.expectedOut), tokenOutInfo.decimals),
      chainId,
    };
  }
}
