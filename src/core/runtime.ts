import type { Address, Hex } from "viem";
import type { Chain } from "./types.js";
import type { Token } from "./tokens.js";

// --- Call / Execution ---

export interface CallRequest {
  to: Address;
  data?: Hex;
  value?: bigint;
  chainId: number;
}

export interface ExecutionResult {
  hash: Hex;
  chainId: number;
}

export interface ExecutionClient {
  mode: "eoa" | "smart-account" | "delegated";
  getAddress(): Address;
  send(call: CallRequest): Promise<ExecutionResult>;
  sendBatch?(calls: CallRequest[]): Promise<ExecutionResult>;
  capabilities(): {
    sponsoredGas: boolean;
    batching: boolean;
    simulation: boolean;
  };
}

// --- Read ---

export interface ReadClient {
  getBalance(params: { address: Address; chainId: number }): Promise<bigint>;
  readContract<T = unknown>(params: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
    chainId: number;
  }): Promise<T>;
}

// --- Access ---

export interface AccessAdapter {
  name: string;
  openSession(ctx: SessionContext): Promise<AccessSession>;
}

export interface AccessSession {
  kind: "local" | "social" | "hardware";
  getAddress(): Address;
}

export interface SessionContext {
  chainId: number;
  rpcUrl?: string;
}

// --- Actions ---

export interface MoneyOSAction<I = unknown, O = unknown> {
  name: string;
  description: string;
  run(input: I, ctx: ActionContext): Promise<O>;
}

export interface ActionContext {
  read: ReadClient;
  execute: ExecutionClient;
  assets: AssetRegistry;
}

// --- Registries ---

export interface AssetRegistry {
  getToken(symbol: string): Token | undefined;
  getTokenAddress(symbol: string, chainId: number): Address | undefined;
  getChain(idOrName: number | string): Chain | undefined;
  nativeTokenAddress: Address;
}

// --- Runtime ---

export interface MoneyOSRuntime {
  read: ReadClient;
  execute: ExecutionClient;
  assets: AssetRegistry;
  config: RuntimeConfig;
}

export interface RuntimeConfig {
  defaultChainId: number;
  rpcUrl?: string;
}
