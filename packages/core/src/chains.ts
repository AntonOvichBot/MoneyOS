import type { Chain } from "./types.js";

export const chains: Record<string, Chain> = {
  arbitrum: {
    id: 42161,
    name: "Arbitrum One",
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    blockExplorer: "https://arbiscan.io",
  },
  ethereum: {
    id: 1,
    name: "Ethereum",
    rpcUrl: "https://ethereum-rpc.publicnode.com",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    blockExplorer: "https://etherscan.io",
  },
  polygon: {
    id: 137,
    name: "Polygon",
    rpcUrl: "https://polygon-bor-rpc.publicnode.com",
    nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
    blockExplorer: "https://polygonscan.com",
  },
};

export const defaultChain = chains.arbitrum;

export function getChain(idOrName: number | string): Chain | undefined {
  if (typeof idOrName === "number") {
    return Object.values(chains).find((c) => c.id === idOrName);
  }
  return chains[idOrName.toLowerCase()];
}
