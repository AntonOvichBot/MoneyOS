export { chains, defaultChain, getChain } from "@moneyos/core";

import type { Chain as ViemChain } from "viem";
import { arbitrum, mainnet, polygon } from "viem/chains";

const viemChainMap: Record<number, ViemChain> = {
  42161: arbitrum,
  1: mainnet,
  137: polygon,
};

export function getViemChain(chainId: number): ViemChain | undefined {
  return viemChainMap[chainId];
}
