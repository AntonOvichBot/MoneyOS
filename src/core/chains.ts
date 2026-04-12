export { chains, defaultChain, getChain } from "@moneyos/core";

import type { Chain as ViemChain } from "viem";
import { arbitrum, mainnet, polygon } from "viem/chains";
import { getChain as getCoreChain, type RuntimeConfig } from "@moneyos/core";

const viemChainMap: Record<number, ViemChain> = {
  42161: arbitrum,
  1: mainnet,
  137: polygon,
};

export function getViemChain(chainId: number): ViemChain | undefined {
  return viemChainMap[chainId];
}

function getSupportedChainLabel(chainId: number): string {
  const chain = getCoreChain(chainId);
  return chain ? `${chainId} (${chain.name})` : String(chainId);
}

function unsupportedChainError(chainId: number): Error {
  const supported = Object.keys(viemChainMap)
    .map(Number)
    .sort((a, b) => a - b)
    .map(getSupportedChainLabel)
    .join(", ");

  return new Error(
    `Unsupported chain ${chainId}. Supported chains: ${supported}.`,
  );
}

export function resolveChainTransport(
  chainId: number,
  config: RuntimeConfig,
): { chain: ViemChain; rpcUrl: string } {
  const chain = getViemChain(chainId);
  const chainInfo = getCoreChain(chainId);
  if (!chain || !chainInfo) {
    throw unsupportedChainError(chainId);
  }

  return {
    chain,
    rpcUrl:
      chainId === config.defaultChainId && config.rpcUrl
        ? config.rpcUrl
        : chainInfo.rpcUrl,
  };
}
