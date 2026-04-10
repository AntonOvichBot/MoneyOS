import {
  formatUnits,
  parseUnits,
  encodeFunctionData,
  type Address,
} from "viem";
import type {
  MoneyOSConfig,
  Balance,
  SendResult,
  SwapProvider,
  SwapResult,
  ReadClient,
  ExecutionClient,
  AssetRegistry,
  MoneyOSRuntime,
  RuntimeConfig,
} from "@moneyos/core";
import {
  getChain,
  defaultChain,
  getToken,
  getTokenAddress,
  NATIVE_TOKEN_ADDRESS,
} from "@moneyos/core";
import { ViemReadClient, EOAExecutor } from "./eoa.js";
import { executeSwap } from "../tools/swap.js";

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
] as const;

class DefaultAssetRegistry implements AssetRegistry {
  readonly nativeTokenAddress = NATIVE_TOKEN_ADDRESS;
  getToken = getToken;
  getTokenAddress = getTokenAddress;
  getChain = getChain;
}

export class MoneyOS {
  private read: ReadClient;
  private executor: ExecutionClient | undefined;
  private assets: AssetRegistry;
  private runtimeConfig: RuntimeConfig;

  constructor(config: MoneyOSConfig) {
    if (config.execute && config.privateKey) {
      throw new Error(
        "MoneyOSConfig: pass either `execute` or `privateKey`, not both. `execute` overrides the default EOA path.",
      );
    }

    this.runtimeConfig = {
      defaultChainId: config.chainId ?? defaultChain.id,
      rpcUrl: config.rpcUrl,
    };

    this.read = config.read ?? new ViemReadClient(this.runtimeConfig);
    this.assets = config.assets ?? new DefaultAssetRegistry();

    if (config.execute) {
      this.executor = config.execute;
    } else if (config.privateKey) {
      this.executor = new EOAExecutor(config.privateKey, this.runtimeConfig);
    }
  }

  get runtime(): MoneyOSRuntime {
    return {
      read: this.read,
      execute: this.requireExecutor(),
      assets: this.assets,
      config: this.runtimeConfig,
    };
  }

  get address(): Address {
    return this.requireExecutor().getAddress();
  }

  private requireExecutor(): ExecutionClient {
    if (!this.executor) {
      throw new Error(
        "No private key configured. Set privateKey in MoneyOS config.",
      );
    }
    return this.executor;
  }

  async balance(
    token: string,
    options?: { address?: Address; chainId?: number },
  ): Promise<Balance> {
    const chainId = options?.chainId ?? this.runtimeConfig.defaultChainId;
    const account = options?.address ?? this.address;

    const tokenAddress = this.assets.getTokenAddress(token, chainId);
    if (!tokenAddress) {
      throw new Error(`Token ${token} not found on chain ${chainId}`);
    }

    const tokenInfo = this.assets.getToken(token)!;

    if (tokenAddress === NATIVE_TOKEN_ADDRESS) {
      const raw = await this.read.getBalance({ address: account, chainId });
      return {
        token: tokenInfo.name,
        symbol: tokenInfo.symbol,
        amount: formatUnits(raw, tokenInfo.decimals),
        rawAmount: raw,
        decimals: tokenInfo.decimals,
        chainId,
      };
    }

    const raw = await this.read.readContract<bigint>({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [account],
      chainId,
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
    const execute = this.requireExecutor();
    const chainId = options?.chainId ?? this.runtimeConfig.defaultChainId;
    const from = execute.getAddress();

    const tokenAddress = this.assets.getTokenAddress(token, chainId);
    if (!tokenAddress) {
      throw new Error(`Token ${token} not found on chain ${chainId}`);
    }

    const tokenInfo = this.assets.getToken(token)!;
    const value = parseUnits(amount, tokenInfo.decimals);

    if (tokenAddress === NATIVE_TOKEN_ADDRESS) {
      const result = await execute.send({ to, value, chainId });
      return {
        hash: result.hash,
        from,
        to,
        amount,
        token: tokenInfo.symbol,
        chainId,
      };
    }

    const data = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [to, value],
    });

    const result = await execute.send({ to: tokenAddress, data, chainId });
    return {
      hash: result.hash,
      from,
      to,
      amount,
      token: tokenInfo.symbol,
      chainId,
    };
  }

  async swap(
    tokenIn: string,
    tokenOut: string,
    amount: string,
    provider: SwapProvider,
    options?: { chainId?: number; slippage?: number },
  ): Promise<SwapResult> {
    const execute = this.requireExecutor();
    const chainId = options?.chainId ?? this.runtimeConfig.defaultChainId;

    return executeSwap(
      { tokenIn, tokenOut, amount, provider, chainId, slippage: options?.slippage },
      { read: this.read, execute, assets: this.assets },
    );
  }
}
