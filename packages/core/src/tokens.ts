import type { Address } from "viem";

export interface Token {
  symbol: string;
  name: string;
  decimals: number;
  addresses: Record<number, Address>;
}

export const NATIVE_TOKEN_ADDRESS =
  "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as Address;

export const tokens: Record<string, Token> = {
  ETH: {
    symbol: "ETH",
    name: "Ether",
    decimals: 18,
    addresses: {
      42161: NATIVE_TOKEN_ADDRESS,
      1: NATIVE_TOKEN_ADDRESS,
    },
  },
  POL: {
    symbol: "POL",
    name: "POL",
    decimals: 18,
    addresses: {
      137: NATIVE_TOKEN_ADDRESS,
    },
  },
  USDC: {
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    addresses: {
      42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      137: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    },
  },
  USDT: {
    symbol: "USDT",
    name: "Tether USD",
    decimals: 6,
    addresses: {
      42161: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
      1: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      137: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    },
  },
  RYZE: {
    symbol: "RYZE",
    name: "RYZE",
    decimals: 18,
    addresses: {
      42161: "0x7712da72127d5dD213B621497D6E4899d5989e5C",
    },
  },
};

export function getToken(symbol: string): Token | undefined {
  return tokens[symbol.toUpperCase()];
}

export function getTokenAddress(
  symbol: string,
  chainId: number,
): Address | undefined {
  return getToken(symbol)?.addresses[chainId];
}

/**
 * Return the built-in tokens that have an address on the given chain.
 *
 * Order matches declaration order in the `tokens` record so callers get
 * stable output. Tokens that are not registered on `chainId` are omitted.
 */
export function listTokens(chainId: number): Token[] {
  return Object.values(tokens).filter(
    (token) => token.addresses[chainId] !== undefined,
  );
}
