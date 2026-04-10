import { describe, it, expect } from "vitest";
import { generatePrivateKey } from "viem/accounts";
import {
  MoneyOS,
  createMoneyOS,
  EOAExecutor,
  ViemReadClient,
  LocalAccessAdapter,
} from "../src/index.js";
import type {
  ExecutionClient,
  ReadClient,
  MoneyOSRuntime,
} from "../src/index.js";

const TEST_KEY = generatePrivateKey();

describe("EOAExecutor", () => {
  const config = { defaultChainId: 42161 };
  const executor = new EOAExecutor(TEST_KEY, config);

  it("implements ExecutionClient", () => {
    const client: ExecutionClient = executor;
    expect(client.mode).toBe("eoa");
  });

  it("getAddress returns deterministic address", () => {
    const addr1 = executor.getAddress();
    const addr2 = executor.getAddress();
    expect(addr1).toBe(addr2);
    expect(addr1).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("capabilities reports no sponsorship or batching", () => {
    const caps = executor.capabilities();
    expect(caps.sponsoredGas).toBe(false);
    expect(caps.batching).toBe(false);
    expect(caps.simulation).toBe(false);
  });
});

describe("ViemReadClient", () => {
  const config = { defaultChainId: 42161 };
  const reader = new ViemReadClient(config);

  it("implements ReadClient", () => {
    const client: ReadClient = reader;
    expect(client.getBalance).toBeDefined();
    expect(client.readContract).toBeDefined();
  });
});

describe("LocalAccessAdapter", () => {
  it("opens a local session with correct address", async () => {
    const adapter = new LocalAccessAdapter(TEST_KEY);
    expect(adapter.name).toBe("local");

    const session = await adapter.openSession({ chainId: 42161 });
    expect(session.kind).toBe("local");

    const executor = new EOAExecutor(TEST_KEY, { defaultChainId: 42161 });
    expect(session.getAddress()).toBe(executor.getAddress());
  });
});

describe("createMoneyOS factory", () => {
  it("returns a MoneyOS instance", () => {
    const m = createMoneyOS({ chainId: 42161, privateKey: TEST_KEY });
    expect(m).toBeInstanceOf(MoneyOS);
  });

  it("instance has working address", () => {
    const m = createMoneyOS({ chainId: 42161, privateKey: TEST_KEY });
    expect(m.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});

describe("MoneyOS.runtime", () => {
  it("exposes runtime with read, execute, assets, config", () => {
    const m = createMoneyOS({ chainId: 42161, privateKey: TEST_KEY });
    const rt: MoneyOSRuntime = m.runtime;

    expect(rt.read).toBeDefined();
    expect(rt.execute).toBeDefined();
    expect(rt.execute.mode).toBe("eoa");
    expect(rt.assets).toBeDefined();
    expect(rt.assets.nativeTokenAddress).toBeDefined();
    expect(rt.config.defaultChainId).toBe(42161);
  });

  it("runtime.execute address matches instance address", () => {
    const m = createMoneyOS({ chainId: 42161, privateKey: TEST_KEY });
    expect(m.runtime.execute.getAddress()).toBe(m.address);
  });

  it("runtime.assets resolves tokens", () => {
    const m = createMoneyOS({ chainId: 42161, privateKey: TEST_KEY });
    const usdc = m.runtime.assets.getToken("USDC");
    expect(usdc?.symbol).toBe("USDC");
    expect(m.runtime.assets.getTokenAddress("USDC", 42161)).toBeDefined();
  });
});
