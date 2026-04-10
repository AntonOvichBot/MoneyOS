import {
  createPublicClient,
  createWalletClient,
  http,
  nonceManager,
  type Account,
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
  private signer: Account;
  private walletClients: Map<number, WalletClient> = new Map();
  private config: RuntimeConfig;

  constructor(signer: Account, config: RuntimeConfig) {
    this.signer = signer;
    this.config = config;
  }

  /**
   * Convenience factory: build an EOAExecutor from a raw private key.
   * Equivalent to `new EOAExecutor(privateKeyToAccount(privateKey), config)`.
   * Kept as a helper so the common "I have a hex key" path stays one line
   * while the constructor itself takes a viem `Account` to accommodate
   * future keystore-backed signers (hardware, KMS, MPC).
   *
   * Attach viem's nonce manager so back-to-back live transactions use a
   * pending-aware nonce source instead of relying on RPC fill behavior.
   */
  static fromPrivateKey(privateKey: Hex, config: RuntimeConfig): EOAExecutor {
    return new EOAExecutor(
      privateKeyToAccount(privateKey, { nonceManager }),
      config,
    );
  }

  private getWalletClient(chainId: number): WalletClient {
    let client = this.walletClients.get(chainId);
    if (!client) {
      const chain = getViemChain(chainId);
      const chainInfo = getChain(chainId);
      const rpcUrl =
        chainId === this.config.defaultChainId
          ? this.config.rpcUrl
          : undefined;

      client = createWalletClient({
        account: this.signer,
        chain,
        transport: http(rpcUrl ?? chainInfo?.rpcUrl),
      });
      this.walletClients.set(chainId, client);
    }
    return client;
  }

  getAddress(): Address {
    return this.signer.address;
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
