import {
  createPublicClient,
  createWalletClient,
  http,
  type Account,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import type {
  CallRequest,
  ExecutionClient,
  ExecutionResult,
  ReadClient,
  RuntimeConfig,
} from "@moneyos/core";
import { privateKeyToManagedAccount } from "./signer.js";
import { resolveChainTransport } from "./chains.js";

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
      const { chain, rpcUrl } = resolveChainTransport(chainId, this.config);

      client = createPublicClient({
        chain,
        transport: http(rpcUrl),
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
  private publicClients: Map<number, PublicClient> = new Map();
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
    return new EOAExecutor(privateKeyToManagedAccount(privateKey), config);
  }

  private getWalletClient(chainId: number): WalletClient {
    let client = this.walletClients.get(chainId);
    if (!client) {
      const { chain, rpcUrl } = resolveChainTransport(chainId, this.config);

      client = createWalletClient({
        account: this.signer,
        chain,
        transport: http(rpcUrl),
      });
      this.walletClients.set(chainId, client);
    }
    return client;
  }

  private getPublicClient(chainId: number): PublicClient {
    let client = this.publicClients.get(chainId);
    if (!client) {
      const { chain, rpcUrl } = resolveChainTransport(chainId, this.config);

      client = createPublicClient({
        chain,
        transport: http(rpcUrl),
      });
      this.publicClients.set(chainId, client);
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

    // Wait for inclusion before resolving. Returning on broadcast makes
    // sequenced operations like "approve then swap" unsafe: the next
    // call's preflight (eth_estimateGas / eth_call) runs against the
    // latest mined block, so a still-pending approve is invisible and
    // the swap reverts at simulation time. The same broadcast-only
    // resolution also lets viem's nonce manager drift past the chain
    // when a sequenced call fails preflight, leaving the executor stuck
    // submitting nonces the chain has not yet reached.
    //
    // For an interactive CLI, slower is acceptable; ambiguous transaction
    // state is not.
    const publicClient = this.getPublicClient(call.chainId);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status !== "success") {
      throw new Error(
        `Transaction ${hash} reverted on chain ${call.chainId} (block ${receipt.blockNumber}).`,
      );
    }

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
