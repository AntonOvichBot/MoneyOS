import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, loadFileConfig } from "../src/cli/config.js";

describe("loadConfig env vars", () => {
  const envKeys = [
    "MONEYOS_PRIVATE_KEY",
    "MONEYOS_RPC_URL",
    "MONEYOS_CHAIN_ID",
  ];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of envKeys) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (saved[key] !== undefined) {
        process.env[key] = saved[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it("MONEYOS_PRIVATE_KEY overrides file config", () => {
    const pk =
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    process.env.MONEYOS_PRIVATE_KEY = pk;
    const config = loadConfig();
    expect(config.privateKey).toBe(pk);
  });

  it("MONEYOS_RPC_URL overrides file config", () => {
    process.env.MONEYOS_RPC_URL = "https://custom-rpc.example.com";
    const config = loadConfig();
    expect(config.rpcUrl).toBe("https://custom-rpc.example.com");
  });

  it("MONEYOS_CHAIN_ID accepts valid integer", () => {
    process.env.MONEYOS_CHAIN_ID = "137";
    const config = loadConfig();
    expect(config.chainId).toBe(137);
  });

  it("MONEYOS_CHAIN_ID rejects non-numeric string", () => {
    process.env.MONEYOS_CHAIN_ID = "abc";
    expect(() => loadConfig()).toThrow('Invalid MONEYOS_CHAIN_ID: "abc"');
  });

  it("MONEYOS_CHAIN_ID rejects trailing text", () => {
    process.env.MONEYOS_CHAIN_ID = "42161abc";
    expect(() => loadConfig()).toThrow(
      'Invalid MONEYOS_CHAIN_ID: "42161abc"',
    );
  });

  it("MONEYOS_CHAIN_ID rejects negative values", () => {
    process.env.MONEYOS_CHAIN_ID = "-1";
    expect(() => loadConfig()).toThrow('Invalid MONEYOS_CHAIN_ID: "-1"');
  });

  it("MONEYOS_CHAIN_ID rejects zero", () => {
    process.env.MONEYOS_CHAIN_ID = "0";
    expect(() => loadConfig()).toThrow('Invalid MONEYOS_CHAIN_ID: "0"');
  });

  it("env vars do not appear in loadFileConfig", () => {
    process.env.MONEYOS_PRIVATE_KEY =
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    process.env.MONEYOS_CHAIN_ID = "137";
    const fileConfig = loadFileConfig();
    // loadFileConfig reads only the file — env vars should not leak in
    // (privateKey would only be set if a config file exists with it)
    expect(fileConfig.privateKey).not.toBe(
      process.env.MONEYOS_PRIVATE_KEY,
    );
  });
});
