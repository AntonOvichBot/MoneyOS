import type { ExecutionClient, RuntimeConfig } from "@moneyos/core";
import {
  GaslessExecutor,
  RelayClient,
  moneyOSAccountV1Abi,
  type NonceResolverInput,
} from "@moneyos/gasless";
import { createPublicClient, http, type Account, type Address } from "viem";
import type { LocalAccount } from "viem/accounts";
import { resolveChainTransport } from "./chains.js";

export interface GaslessExecutionConfig {
  account: Address;
  sponsor: Address;
  relayUrl: string;
  nonceKey?: bigint;
  validityWindowSeconds?: number;
}

function asLocalAccount(signer: Account): LocalAccount {
  if (typeof (signer as LocalAccount).signTypedData !== "function") {
    throw new Error(
      "Gasless mode requires a local signer that can sign typed data.",
    );
  }

  return signer as LocalAccount;
}

export function createGaslessExecutionClient(params: {
  signer: Account;
  chainId: number;
  rpcUrl?: string;
  gasless: GaslessExecutionConfig;
}): ExecutionClient {
  const runtimeConfig: RuntimeConfig = {
    defaultChainId: params.chainId,
    rpcUrl: params.rpcUrl,
  };
  const { chain, rpcUrl } = resolveChainTransport(params.chainId, runtimeConfig);
  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });
  const relay = new RelayClient({
    baseUrl: params.gasless.relayUrl,
  });

  const nonceResolver = async (input: NonceResolverInput): Promise<bigint> => {
    const code = await publicClient.getCode({
      address: params.gasless.account,
    });
    if (!code || code === "0x") {
      return 0n;
    }

    return publicClient.readContract({
      address: params.gasless.account,
      abi: moneyOSAccountV1Abi,
      functionName: "getNonce",
      args: [input.signer, input.nonceKey],
    }) as Promise<bigint>;
  };

  return new GaslessExecutor({
    account: params.gasless.account,
    sponsor: params.gasless.sponsor,
    chainId: params.chainId,
    signer: asLocalAccount(params.signer),
    relay,
    nonceResolver,
    nonceKey: params.gasless.nonceKey,
    validityWindowSeconds: params.gasless.validityWindowSeconds,
  });
}
