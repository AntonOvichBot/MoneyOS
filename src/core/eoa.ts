import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  type Chain as ViemChain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum, mainnet, polygon } from "viem/chains";
import { getChain } from "@moneyos/core";
import type {
  CallRequest,
  ExecutionClient,
  ExecutionResult,
  ReadClient,
  RuntimeConfig,
} from "@moneyos/core";

const viemChainMap: Record<number, ViemChain> = {
  42161: arbitrum,
  1: mainnet,
  137: polygon,
};

function getViemChain(chainId: number): ViemChain | undefined {
  return viemChainMap[chainId];
}

// --- Read ---

export class ViemReadClient implements ReadClient {
  private clients: Map<number, PublicClient> = new Map();
  private config: RuntimeConfig;

  constructor(config: RuntimeConfig) {
    this.config = config;
  }

  private getClient(chainId: number): PublicClient {
    let client = this.clients.get(chainId);
    if (!client) {
      const chain = getViemChain(chainId);
      const chainInfo = getChain(chainId);
      const rpcUrl =
        chainId === this.config.defaultChainId
          ? this.config.rpcUrl
          : undefined;

      client = createPublicClient({
        chain,
        transport: http(rpcUrl ?? chainInfo?.rpcUrl),
      });
      this.clients.set(chainId, client);
    }
    return client;
  }

  async getBalance(params: {
    address: Address;
    chainId: number;
  }): Promise<bigint> {
    const client = this.getClient(params.chainId);
    return client.getBalance({ address: params.address });
  }

  async readContract<T = unknown>(params: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
    chainId: number;
  }): Promise<T> {
    const client = this.getClient(params.chainId);
    return client.readContract({
      address: params.address,
      abi: params.abi,
      functionName: params.functionName,
      args: params.args,
    }) as Promise<T>;
  }
}

// --- Execute ---

export class EOAExecutor implements ExecutionClient {
  readonly mode = "eoa" as const;
  private privateKey: Hex;
  private walletClients: Map<number, WalletClient> = new Map();
  private config: RuntimeConfig;
  private cachedAddress: Address | undefined;

  constructor(privateKey: Hex, config: RuntimeConfig) {
    this.privateKey = privateKey;
    this.config = config;
  }

  private getWalletClient(chainId: number): WalletClient {
    let client = this.walletClients.get(chainId);
    if (!client) {
      const account = privateKeyToAccount(this.privateKey);
      const chain = getViemChain(chainId);
      const chainInfo = getChain(chainId);
      const rpcUrl =
        chainId === this.config.defaultChainId
          ? this.config.rpcUrl
          : undefined;

      client = createWalletClient({
        account,
        chain,
        transport: http(rpcUrl ?? chainInfo?.rpcUrl),
      });
      this.walletClients.set(chainId, client);
    }
    return client;
  }

  getAddress(): Address {
    if (!this.cachedAddress) {
      this.cachedAddress = privateKeyToAccount(this.privateKey).address;
    }
    return this.cachedAddress;
  }

  async send(call: CallRequest): Promise<ExecutionResult> {
    const walletClient = this.getWalletClient(call.chainId);
    const hash = await walletClient.sendTransaction({
      account: walletClient.account!,
      to: call.to,
      data: call.data,
      value: call.value ?? 0n,
      chain: walletClient.chain,
    });
    return { hash, chainId: call.chainId };
  }

  capabilities() {
    return {
      sponsoredGas: false,
      batching: false,
      simulation: false,
    };
  }
}
