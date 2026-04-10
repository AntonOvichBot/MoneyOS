import { describe, it, expect } from "vitest";
import {
  chains,
  defaultChain,
  getChain,
  getToken,
  getTokenAddress,
  tokens,
  NATIVE_TOKEN_ADDRESS,
} from "../src/index.js";

describe("chains", () => {
  it("default chain is Arbitrum", () => {
    expect(defaultChain.id).toBe(42161);
    expect(defaultChain.name).toBe("Arbitrum One");
  });

  it("getChain by id", () => {
    expect(getChain(42161)?.name).toBe("Arbitrum One");
    expect(getChain(1)?.name).toBe("Ethereum");
    expect(getChain(137)?.name).toBe("Polygon");
    expect(getChain(999)).toBeUndefined();
  });

  it("getChain by name (case-insensitive)", () => {
    expect(getChain("arbitrum")?.id).toBe(42161);
    expect(getChain("Ethereum")?.id).toBe(1);
    expect(getChain("POLYGON")?.id).toBe(137);
  });

  it("Polygon native currency is POL", () => {
    const polygon = getChain(137)!;
    expect(polygon.nativeCurrency.symbol).toBe("POL");
  });
});

describe("tokens", () => {
  it("getToken is case-insensitive", () => {
    expect(getToken("usdc")?.symbol).toBe("USDC");
    expect(getToken("USDC")?.symbol).toBe("USDC");
    expect(getToken("Usdc")?.symbol).toBe("USDC");
  });

  it("ETH is native on Arbitrum and Ethereum, not Polygon", () => {
    expect(getTokenAddress("ETH", 42161)).toBe(NATIVE_TOKEN_ADDRESS);
    expect(getTokenAddress("ETH", 1)).toBe(NATIVE_TOKEN_ADDRESS);
    expect(getTokenAddress("ETH", 137)).toBeUndefined();
  });

  it("POL is native on Polygon only", () => {
    expect(getTokenAddress("POL", 137)).toBe(NATIVE_TOKEN_ADDRESS);
    expect(getTokenAddress("POL", 42161)).toBeUndefined();
    expect(getTokenAddress("POL", 1)).toBeUndefined();
  });

  it("RYZE is only on Arbitrum", () => {
    expect(getTokenAddress("RYZE", 42161)).toBeDefined();
    expect(getTokenAddress("RYZE", 1)).toBeUndefined();
    expect(getTokenAddress("RYZE", 137)).toBeUndefined();
  });

  it("USDC has addresses on all chains", () => {
    expect(getTokenAddress("USDC", 42161)).toBeDefined();
    expect(getTokenAddress("USDC", 1)).toBeDefined();
    expect(getTokenAddress("USDC", 137)).toBeDefined();
  });

  it("unknown token returns undefined", () => {
    expect(getToken("FAKE")).toBeUndefined();
    expect(getTokenAddress("FAKE", 42161)).toBeUndefined();
  });
});

describe("MoneyOS constructor", () => {
  it("creates instance with default chain", async () => {
    const { MoneyOS } = await import("../src/index.js");
    const m = new MoneyOS({ chainId: 42161 });
    expect(m).toBeDefined();
  });

  it("throws when accessing address without any signing configuration", async () => {
    const { MoneyOS } = await import("../src/index.js");
    const m = new MoneyOS({ chainId: 42161 });
    expect(() => m.address).toThrow("No signing account configured");
  });
});
