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

// --- MoneyOS Config ---

/**
 * Configuration for a MoneyOS instance.
 *
 * Two construction modes:
 *
 * 1. Default EOA: pass `privateKey`. A default EOAExecutor and ViemReadClient
 *    are created for you.
 *
 * 2. Injected runtime: pass `execute` (and optionally `read` / `assets`) to
 *    plug in custom implementations — e.g. a gasless smart-account executor
 *    or a custom read client. Any part you do not inject falls back to the
 *    default.
 *
 * `privateKey` and `execute` are mutually exclusive — passing both throws.
 */
export interface MoneyOSConfig {
  /** Default chain ID (e.g. 42161 for Arbitrum). */
  chainId: number;
  /** RPC URL override. Uses public RPC if not set. */
  rpcUrl?: string;
  /** Private key for signing transactions (hex string). Creates a default EOAExecutor. Mutually exclusive with `execute`. */
  privateKey?: Hex;
  /** Inject a custom ExecutionClient (e.g. a gasless smart-account executor). Mutually exclusive with `privateKey`. */
  execute?: ExecutionClient;
  /** Inject a custom ReadClient. Defaults to ViemReadClient. */
  read?: ReadClient;
  /** Inject a custom AssetRegistry. Defaults to the built-in registry. */
  assets?: AssetRegistry;
}
