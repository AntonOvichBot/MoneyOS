import { describe, it, expect, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import {
  MoneyOS,
  createMoneyOS,
  EOAExecutor,
  ViemReadClient,
  LocalAccessAdapter,
  NATIVE_TOKEN_ADDRESS,
} from "../src/index.js";
import type {
  ExecutionClient,
  ReadClient,
  AssetRegistry,
  MoneyOSRuntime,
} from "../src/index.js";

const TEST_KEY = generatePrivateKey();

describe("EOAExecutor", () => {
  const config = { defaultChainId: 42161 };
  const executor = EOAExecutor.fromPrivateKey(TEST_KEY, config);

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

  it("fromPrivateKey matches direct Account construction", () => {
    // Parity: fromPrivateKey(pk) must yield the same address as
    // new EOAExecutor(privateKeyToAccount(pk)) — i.e. the factory is a
    // pure convenience over the Account-taking constructor.
    const account = privateKeyToAccount(TEST_KEY);
    const direct = new EOAExecutor(account, config);
    const viaFactory = EOAExecutor.fromPrivateKey(TEST_KEY, config);

    expect(direct.getAddress()).toBe(account.address);
    expect(viaFactory.getAddress()).toBe(account.address);
    expect(direct.getAddress()).toBe(viaFactory.getAddress());
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

    const executor = EOAExecutor.fromPrivateKey(TEST_KEY, {
      defaultChainId: 42161,
    });
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

// --- Runtime injection ---

function mockSmartAccountExecutor(): ExecutionClient {
  return {
    mode: "smart-account",
    getAddress: () =>
      "0xAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCd" as Address,
    send: vi.fn().mockResolvedValue({
      hash: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" as Hex,
      chainId: 42161,
    }),
    capabilities: () => ({
      sponsoredGas: true,
      batching: false,
      simulation: false,
    }),
  };
}

function mockReadClient(): ReadClient {
  return {
    getBalance: vi.fn().mockResolvedValue(0n),
    readContract: vi.fn().mockResolvedValue(0n),
  };
}

function mockAssetRegistry(): AssetRegistry {
  return {
    getToken: () => undefined,
    getTokenAddress: () => undefined,
    getChain: () => undefined,
    nativeTokenAddress: NATIVE_TOKEN_ADDRESS,
  };
}

describe("MoneyOS runtime injection", () => {
  it("accepts an injected ExecutionClient", () => {
    const executor = mockSmartAccountExecutor();
    const m = createMoneyOS({ chainId: 42161, execute: executor });

    expect(m.runtime.execute).toBe(executor);
    expect(m.runtime.execute.mode).toBe("smart-account");
    expect(m.runtime.execute.capabilities().sponsoredGas).toBe(true);
  });

  it("injected executor address is used by MoneyOS.address", () => {
    const executor = mockSmartAccountExecutor();
    const m = createMoneyOS({ chainId: 42161, execute: executor });

    expect(m.address).toBe(executor.getAddress());
  });

  it("accepts an injected ReadClient", () => {
    const read = mockReadClient();
    const executor = mockSmartAccountExecutor();
    const m = createMoneyOS({
      chainId: 42161,
      execute: executor,
      read,
    });

    expect(m.runtime.read).toBe(read);
  });

  it("accepts an injected AssetRegistry", () => {
    const assets = mockAssetRegistry();
    const executor = mockSmartAccountExecutor();
    const m = createMoneyOS({
      chainId: 42161,
      execute: executor,
      assets,
    });

    expect(m.runtime.assets).toBe(assets);
    // Injected empty registry returns undefined for everything
    expect(m.runtime.assets.getToken("USDC")).toBeUndefined();
  });

  it("uses default ReadClient and AssetRegistry when only execute is injected", () => {
    const executor = mockSmartAccountExecutor();
    const m = createMoneyOS({ chainId: 42161, execute: executor });

    expect(m.runtime.read).toBeInstanceOf(ViemReadClient);
    // Default registry still resolves real tokens
    expect(m.runtime.assets.getToken("USDC")?.symbol).toBe("USDC");
  });

  it("throws when both privateKey and execute are provided", () => {
    const executor = mockSmartAccountExecutor();
    expect(() =>
      createMoneyOS({
        chainId: 42161,
        privateKey: TEST_KEY,
        execute: executor,
      }),
    ).toThrow(/at most one of `execute`, `privateKey`, or `signer`/);
  });

  it("send() routes through the injected executor", async () => {
    const executor = mockSmartAccountExecutor();
    const m = createMoneyOS({ chainId: 42161, execute: executor });

    const result = await m.send(
      "USDC",
      "0x1111111111111111111111111111111111111111" as Address,
      "1",
    );

    // The injected executor's send was called exactly once
    expect(executor.send).toHaveBeenCalledOnce();
    // Result uses the mock hash
    expect(result.hash).toBe(
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    );
    expect(result.from).toBe(executor.getAddress());
  });

  it("native send() routes through the injected executor", async () => {
    const executor = mockSmartAccountExecutor();
    const m = createMoneyOS({ chainId: 42161, execute: executor });

    const result = await m.send(
      "ETH",
      "0x1111111111111111111111111111111111111111" as Address,
      "0.1",
    );

    expect(executor.send).toHaveBeenCalledOnce();
    const call = (executor.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // Native ETH: to is the recipient, value is set, no data
    expect(call.to).toBe("0x1111111111111111111111111111111111111111");
    expect(call.value).toBeGreaterThan(0n);
    expect(result.token).toBe("ETH");
  });
});

// --- Pre-loaded signer path ---

describe("MoneyOS signer config", () => {
  it("accepts a pre-loaded viem Account as `signer`", () => {
    const signer = privateKeyToAccount(TEST_KEY);
    const m = createMoneyOS({ chainId: 42161, signer });
    expect(m.address).toBe(signer.address);
    expect(m.runtime.execute.mode).toBe("eoa");
  });

  it("signer path and privateKey path yield the same address", () => {
    const m1 = createMoneyOS({ chainId: 42161, privateKey: TEST_KEY });
    const m2 = createMoneyOS({
      chainId: 42161,
      signer: privateKeyToAccount(TEST_KEY),
    });
    expect(m1.address).toBe(m2.address);
  });

  it("throws when both signer and privateKey are provided", () => {
    const signer = privateKeyToAccount(TEST_KEY);
    expect(() =>
      createMoneyOS({
        chainId: 42161,
        privateKey: TEST_KEY,
        signer,
      }),
    ).toThrow(/at most one of `execute`, `privateKey`, or `signer`/);
  });

  it("throws when both signer and execute are provided", () => {
    const signer = privateKeyToAccount(TEST_KEY);
    const executor = mockSmartAccountExecutor();
    expect(() =>
      createMoneyOS({
        chainId: 42161,
        signer,
        execute: executor,
      }),
    ).toThrow(/at most one of `execute`, `privateKey`, or `signer`/);
  });

  it("throws when all three of signer, privateKey, and execute are provided", () => {
    const signer = privateKeyToAccount(TEST_KEY);
    const executor = mockSmartAccountExecutor();
    expect(() =>
      createMoneyOS({
        chainId: 42161,
        privateKey: TEST_KEY,
        signer,
        execute: executor,
      }),
    ).toThrow(/execute, privateKey, signer/);
  });
});
