import { describe, it, expect, vi, beforeEach } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import type { ExecutionClient } from "@moneyos/core";

// --- Mock @particle-network/aa ---
//
// We don't have Particle credentials or a live bundler in the test env, so
// we mock the SDK. The mocks capture constructor args and let individual
// tests control what getAddress() resolves to and what the AA provider's
// request method does.

const mockSmartAccountGetAddress = vi.fn<() => Promise<string>>();
const mockSmartAccountSetContract = vi.fn();
const mockSmartAccountCtor = vi.fn();

const mockAaProviderRequest =
  vi.fn<(args: { method: string; params?: unknown[] }) => Promise<unknown>>();
const mockAaProviderCtor = vi.fn();

vi.mock("@particle-network/aa", () => {
  class SmartAccount {
    constructor(provider: unknown, config: unknown) {
      mockSmartAccountCtor(provider, config);
    }
    setSmartAccountContract(contract: unknown) {
      mockSmartAccountSetContract(contract);
    }
    getAddress() {
      return mockSmartAccountGetAddress();
    }
  }

  class AAWrapProvider {
    constructor(smartAccount: unknown, mode: unknown) {
      mockAaProviderCtor(smartAccount, mode);
    }
    request(args: { method: string; params?: unknown[] }) {
      return mockAaProviderRequest(args);
    }
  }

  const SendTransactionMode = {
    UserSelect: 0,
    Gasless: 1,
    UserPaidNative: 2,
  } as const;

  // The real package's CJS build exposes named symbols only via the
  // default export when loaded as ESM. Mirror that shape so the source's
  // `import aaModule from "@particle-network/aa"` path hits the same
  // structure in tests as in production.
  const moduleNamespace = { SmartAccount, AAWrapProvider, SendTransactionMode };
  return {
    default: moduleNamespace,
    ...moduleNamespace,
  };
});

// Imports must come AFTER vi.mock so the mock is applied before the module
// under test is loaded.
import { createParticleExecutor, getOwnerAddress } from "../src/index.js";

const SMART_ACCOUNT_ADDRESS =
  "0xcafebabecafebabecafebabecafebabecafebabe" as Address;

const SPONSORED_TX_HASH =
  "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" as Hex;

const OWNER_KEY = generatePrivateKey();
const OWNER_ADDRESS = privateKeyToAccount(OWNER_KEY).address;

const baseConfig = {
  chainId: 42161 as const,
  projectId: "test-project",
  clientKey: "test-client",
  appId: "test-app",
  ownerPrivateKey: OWNER_KEY,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSmartAccountGetAddress.mockResolvedValue(SMART_ACCOUNT_ADDRESS);
  mockAaProviderRequest.mockResolvedValue(SPONSORED_TX_HASH);
});

// ============================================================
// Config validation — these run before the SDK is touched.
// ============================================================

describe("createParticleExecutor — config validation", () => {
  it("rejects a non-Arbitrum chainId", async () => {
    await expect(
      createParticleExecutor({
        ...baseConfig,
        // Deliberately violating the literal type to prove runtime guard
        chainId: 1 as unknown as 42161,
      }),
    ).rejects.toThrow(/only supports Arbitrum One/);

    // SDK must not have been touched
    expect(mockSmartAccountCtor).not.toHaveBeenCalled();
  });

  it("rejects a non-gasless gasMode", async () => {
    await expect(
      createParticleExecutor({
        ...baseConfig,
        gasMode: "user-paid-native",
      }),
    ).rejects.toThrow(/only supports gasMode: "gasless"/);

    expect(mockSmartAccountCtor).not.toHaveBeenCalled();
  });

  it("rejects a non-SIMPLE accountContract", async () => {
    await expect(
      createParticleExecutor({
        ...baseConfig,
        accountContract: {
          name: "BICONOMY" as unknown as "SIMPLE",
          version: "2.0.0",
        },
      }),
    ).rejects.toThrow(/only supports SIMPLE 2\.0\.0/);
  });

  it("rejects a non-2.0.0 SIMPLE version", async () => {
    await expect(
      createParticleExecutor({
        ...baseConfig,
        accountContract: {
          name: "SIMPLE",
          version: "1.0.0" as unknown as "2.0.0",
        },
      }),
    ).rejects.toThrow(/only supports SIMPLE 2\.0\.0/);
  });

  it("accepts the minimal happy-path config", async () => {
    const executor = await createParticleExecutor(baseConfig);
    expect(executor).toBeDefined();
  });
});

// ============================================================
// Factory wiring — verify the SDK is called with the right args.
// ============================================================

describe("createParticleExecutor — SDK wiring", () => {
  it("constructs SmartAccount with projectId, clientKey, appId, and SIMPLE 2.0.0 on Arbitrum", async () => {
    await createParticleExecutor(baseConfig);

    expect(mockSmartAccountCtor).toHaveBeenCalledTimes(1);
    const [provider, config] = mockSmartAccountCtor.mock.calls[0] as [
      unknown,
      {
        projectId: string;
        clientKey: string;
        appId: string;
        aaOptions: {
          accountContracts: { SIMPLE: { version: string; chainIds: number[] }[] };
        };
      },
    ];

    expect(provider).toBeDefined();
    expect(config.projectId).toBe("test-project");
    expect(config.clientKey).toBe("test-client");
    expect(config.appId).toBe("test-app");
    expect(config.aaOptions.accountContracts.SIMPLE).toEqual([
      { version: "2.0.0", chainIds: [42161] },
    ]);
  });

  it("calls setSmartAccountContract with SIMPLE 2.0.0", async () => {
    await createParticleExecutor(baseConfig);
    expect(mockSmartAccountSetContract).toHaveBeenCalledWith({
      name: "SIMPLE",
      version: "2.0.0",
    });
  });

  it("awaits smartAccount.getAddress() and uses the result as identity", async () => {
    mockSmartAccountGetAddress.mockResolvedValueOnce(SMART_ACCOUNT_ADDRESS);

    const executor = await createParticleExecutor(baseConfig);

    expect(mockSmartAccountGetAddress).toHaveBeenCalledTimes(1);
    expect(executor.getAddress()).toBe(SMART_ACCOUNT_ADDRESS);
  });

  it("constructs AAWrapProvider in Gasless mode (mode === 1)", async () => {
    await createParticleExecutor(baseConfig);
    expect(mockAaProviderCtor).toHaveBeenCalledTimes(1);
    const [, mode] = mockAaProviderCtor.mock.calls[0];
    expect(mode).toBe(1); // SendTransactionMode.Gasless
  });

  it("builds an owner EIP-1193 provider with no-op event methods", async () => {
    await createParticleExecutor(baseConfig);
    const [provider] = mockSmartAccountCtor.mock.calls[0] as [
      {
        request: unknown;
        on: () => unknown;
        once: () => unknown;
        off: () => unknown;
        removeListener: () => unknown;
      },
    ];

    expect(typeof provider.request).toBe("function");
    // Event methods exist and return the provider (chainable) without throwing
    expect(() => provider.on()).not.toThrow();
    expect(() => provider.once()).not.toThrow();
    expect(() => provider.off()).not.toThrow();
    expect(() => provider.removeListener()).not.toThrow();
  });

  it("serves eth_accounts and eth_requestAccounts from the local owner key", async () => {
    await createParticleExecutor(baseConfig);
    const [provider] = mockSmartAccountCtor.mock.calls[0] as [
      {
        request: (args: {
          method: string;
          params?: unknown[];
        }) => Promise<unknown>;
      },
    ];

    await expect(
      provider.request({ method: "eth_accounts" }),
    ).resolves.toEqual([OWNER_ADDRESS]);
    await expect(
      provider.request({ method: "eth_requestAccounts" }),
    ).resolves.toEqual([OWNER_ADDRESS]);
  });

  it("signs personal_sign payloads locally with the owner key", async () => {
    await createParticleExecutor(baseConfig);
    const [provider] = mockSmartAccountCtor.mock.calls[0] as [
      {
        request: (args: {
          method: string;
          params?: unknown[];
        }) => Promise<unknown>;
      },
    ];

    const message = "0xdeadbeef" as Hex;
    const expected = await privateKeyToAccount(OWNER_KEY).signMessage({
      message: { raw: message },
    });

    await expect(
      provider.request({
        method: "personal_sign",
        params: [message, OWNER_ADDRESS],
      }),
    ).resolves.toBe(expected);
  });

  it("rejects if the SDK resolves an invalid smart-account address", async () => {
    mockSmartAccountGetAddress.mockResolvedValueOnce("");

    await expect(createParticleExecutor(baseConfig)).rejects.toThrow(
      /invalid smart-account address/i,
    );
  });
});

// ============================================================
// ExecutionClient contract — the thing MoneyOS actually uses.
// ============================================================

describe("ParticleExecutor — ExecutionClient contract", () => {
  it("mode is 'smart-account'", async () => {
    const executor = await createParticleExecutor(baseConfig);
    expect(executor.mode).toBe("smart-account");
  });

  it("capabilities report sponsoredGas: true, no batching, no simulation", async () => {
    const executor = await createParticleExecutor(baseConfig);
    const caps = executor.capabilities();
    expect(caps.sponsoredGas).toBe(true);
    expect(caps.batching).toBe(false);
    expect(caps.simulation).toBe(false);
  });

  it("getAddress returns the smart-account address, NOT the owner EOA", async () => {
    const executor = await createParticleExecutor(baseConfig);
    expect(executor.getAddress()).toBe(SMART_ACCOUNT_ADDRESS);
    expect(executor.getAddress()).not.toBe(OWNER_ADDRESS);
  });

  it("getAddress is synchronous and stable after factory resolves", async () => {
    const executor = await createParticleExecutor(baseConfig);
    const a = executor.getAddress();
    const b = executor.getAddress();
    expect(a).toBe(b);
    // getAddress on the SDK was only called once (during the factory)
    expect(mockSmartAccountGetAddress).toHaveBeenCalledTimes(1);
  });

  it("getOwnerAddress helper returns the owner EOA", async () => {
    const executor = await createParticleExecutor(baseConfig);
    expect(getOwnerAddress(executor)).toBe(OWNER_ADDRESS);
  });

  it("getOwnerAddress returns undefined for non-Particle executors", () => {
    const fake: ExecutionClient = {
      mode: "eoa",
      getAddress: () => OWNER_ADDRESS,
      send: async () => ({
        hash: SPONSORED_TX_HASH,
        chainId: 42161,
      }),
      capabilities: () => ({
        sponsoredGas: false,
        batching: false,
        simulation: false,
      }),
    };
    expect(getOwnerAddress(fake)).toBeUndefined();
  });
});

// ============================================================
// send() — routes through AAWrapProvider and handles errors.
// ============================================================

describe("ParticleExecutor.send()", () => {
  it("routes eth_sendTransaction through AAWrapProvider with the smart-account as from", async () => {
    const executor = await createParticleExecutor(baseConfig);

    const result = await executor.send({
      to: "0x1111111111111111111111111111111111111111" as Address,
      data: "0xabcd" as Hex,
      value: 1000000n,
      chainId: 42161,
    });

    expect(mockAaProviderRequest).toHaveBeenCalledTimes(1);
    const req = mockAaProviderRequest.mock.calls[0][0];
    expect(req.method).toBe("eth_sendTransaction");

    const tx = (req.params as unknown[])[0] as {
      from: string;
      to: string;
      data: string;
      value: string;
    };
    expect(tx.from).toBe(SMART_ACCOUNT_ADDRESS);
    expect(tx.to).toBe("0x1111111111111111111111111111111111111111");
    expect(tx.data).toBe("0xabcd");
    // value must be hex-encoded for eth_sendTransaction
    expect(tx.value).toMatch(/^0x[0-9a-fA-F]+$/);
    expect(BigInt(tx.value)).toBe(1000000n);

    expect(result.hash).toBe(SPONSORED_TX_HASH);
    expect(result.chainId).toBe(42161);
  });

  it("defaults data to '0x' and value to '0x0' when absent", async () => {
    const executor = await createParticleExecutor(baseConfig);

    await executor.send({
      to: "0x2222222222222222222222222222222222222222" as Address,
      chainId: 42161,
    });

    const req = mockAaProviderRequest.mock.calls[0][0];
    const tx = (req.params as unknown[])[0] as {
      data: string;
      value: string;
    };
    expect(tx.data).toBe("0x");
    expect(tx.value).toBe("0x0");
  });

  it("rejects a CallRequest with a non-Arbitrum chainId", async () => {
    const executor = await createParticleExecutor(baseConfig);

    await expect(
      executor.send({
        to: "0x1111111111111111111111111111111111111111" as Address,
        chainId: 1,
      }),
    ).rejects.toThrow(/only supports Arbitrum One/);

    expect(mockAaProviderRequest).not.toHaveBeenCalled();
  });

  it("rethrows SDK errors with context and does NOT fall back", async () => {
    mockAaProviderRequest.mockRejectedValueOnce(
      new Error("paymaster declined"),
    );

    const executor = await createParticleExecutor(baseConfig);

    await expect(
      executor.send({
        to: "0x1111111111111111111111111111111111111111" as Address,
        chainId: 42161,
      }),
    ).rejects.toThrow(/sponsorship may have been declined.*paymaster declined/s);
  });

  it("preserves the original error as .cause", async () => {
    const original = new Error("bundler 500");
    mockAaProviderRequest.mockRejectedValueOnce(original);

    const executor = await createParticleExecutor(baseConfig);

    try {
      await executor.send({
        to: "0x1111111111111111111111111111111111111111" as Address,
        chainId: 42161,
      });
      expect.fail("expected send() to throw");
    } catch (error) {
      expect((error as Error & { cause?: unknown }).cause).toBe(original);
    }
  });
});
