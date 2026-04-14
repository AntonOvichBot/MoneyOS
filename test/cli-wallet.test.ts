import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { FileEncryptedWalletStore } from "../src/core/encrypted-wallet.js";
import {
  buildCliMoneyOSConfig,
  loadCliAddress,
} from "../src/cli/wallet.js";
import { startSessionServer } from "../src/cli/session.js";
import type { CLIConfig } from "../src/cli/config.js";
import {
  installGaslessEnvIsolationHooks,
  setDefaultGaslessEnv,
} from "./helpers/gasless-env.js";

const TEST_PK: Hex =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ALT_PK: Hex =
  "0x59c6995e998f97a5a0044966f094538e6f2f0a38d7c7d0b7e54b5f3c7f4e6a15";
const TEST_ADDRESS = privateKeyToAccount(TEST_PK).address;
const ALT_ADDRESS = privateKeyToAccount(ALT_PK).address;

installGaslessEnvIsolationHooks();

function makeSocketPath(prefix: string): string {
  const baseDir = mkdtempSync(join(tmpdir(), `${prefix}-`));
  if (process.platform === "win32") {
    return baseDir;
  }
  return baseDir;
}

describe("buildCliMoneyOSConfig", () => {
  it("does not attach execute or signer for read-only calls", async () => {
    const result = await buildCliMoneyOSConfig(
      {
        chainId: 42161,
        rpcUrl: "https://arb1.arbitrum.io/rpc",
      },
      {
        requireSigner: false,
      },
    );

    expect(result).toEqual({
      chainId: 42161,
      rpcUrl: "https://arb1.arbitrum.io/rpc",
    });
  });

  it("skips gasless env resolution for read-only calls", async () => {
    process.env.MONEYOS_GASLESS_ENABLED = "true";

    await expect(
      buildCliMoneyOSConfig(
        {
          chainId: 42161,
          rpcUrl: "https://arb1.arbitrum.io/rpc",
          gasless: { enabled: true },
        },
        {
          requireSigner: false,
        },
      ),
    ).resolves.toEqual({
      chainId: 42161,
      rpcUrl: "https://arb1.arbitrum.io/rpc",
    });
  });

  it("uses MONEYOS_PRIVATE_KEY-style input before any local wallet state", async () => {
    const result = await buildCliMoneyOSConfig(
      { chainId: 42161 },
      {
        requireSigner: true,
        envPrivateKey: ALT_PK,
      },
    );

    expect(result.chainId).toBe(42161);
    expect(result.signer?.address).toBe(ALT_ADDRESS);
    expect(result.execute).toBeUndefined();
  });

  it("builds a gasless executor when gasless mode is enabled", async () => {
    setDefaultGaslessEnv();

    const result = await buildCliMoneyOSConfig(
      {
        chainId: 42161,
        gasless: { enabled: true },
      },
      {
        requireSigner: true,
        envPrivateKey: ALT_PK,
      },
    );

    expect(result.signer).toBeUndefined();
    expect(result.execute?.mode).toBe("smart-account");
  });

  it("fails fast when gasless mode is enabled but runtime env is missing", async () => {
    process.env.MONEYOS_GASLESS_ENABLED = "true";

    await expect(
      buildCliMoneyOSConfig(
        { chainId: 42161, gasless: { enabled: true } },
        {
          requireSigner: true,
          envPrivateKey: ALT_PK,
        },
      ),
    ).rejects.toThrow(/missing required environment variables/i);
  });

  it("attaches a local session executor when unlocked", async () => {
    const baseDir = makeSocketPath("moneyos-session-test");
    const socketPath =
      process.platform === "win32"
        ? `\\\\.\\pipe\\moneyos-session-test-${Date.now()}`
        : join(baseDir, "session.sock");
    const tokenPath = join(baseDir, "session.token");
    const handle = await startSessionServer({
      type: "start",
      privateKey: TEST_PK,
      chainId: 42161,
      socketPath,
      tokenPath,
      ttlMs: 1000,
    });

    try {
      const result = await buildCliMoneyOSConfig(
        { chainId: 42161 },
        {
          requireSigner: true,
          sessionSocketPath: socketPath,
          sessionTokenPath: tokenPath,
        },
      );

      expect(result.execute?.getAddress()).toBe(TEST_ADDRESS);
      expect(result.signer).toBeUndefined();
    } finally {
      await handle.close();
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("throws if gasless is enabled but the active session is still EOA", async () => {
    setDefaultGaslessEnv();

    const baseDir = makeSocketPath("moneyos-session-gasless-mismatch");
    const socketPath =
      process.platform === "win32"
        ? `\\\\.\\pipe\\moneyos-session-gasless-mismatch-${Date.now()}`
        : join(baseDir, "session.sock");
    const tokenPath = join(baseDir, "session.token");
    const handle = await startSessionServer({
      type: "start",
      privateKey: TEST_PK,
      chainId: 42161,
      socketPath,
      tokenPath,
      ttlMs: 1000,
    });

    try {
      await expect(
        buildCliMoneyOSConfig(
          { chainId: 42161, gasless: { enabled: true } },
          {
            requireSigner: true,
            sessionSocketPath: socketPath,
            sessionTokenPath: tokenPath,
          },
        ),
      ).rejects.toThrow(/active wallet session is still using the EOA executor/i);
    } finally {
      await handle.close();
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("throws a clear locked-wallet error when the encrypted wallet exists but no session is active", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "moneyos-cli-wallet-"));
    const walletPath = join(tmpDir, "wallet.json");
    const store = new FileEncryptedWalletStore(walletPath);

    try {
      await store.save({
        privateKey: TEST_PK,
        passphrase: "secret passphrase",
      });

      await expect(
        buildCliMoneyOSConfig(
          { chainId: 42161 },
          { requireSigner: true, walletPath },
        ),
      ).rejects.toThrow(/wallet is locked/i);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("throws a clear error for the removed 1Password-backed model", async () => {
    const removedConfig = {
      keyStore: {
        kind: "1password",
      },
    } as CLIConfig;

    await expect(
      buildCliMoneyOSConfig(removedConfig, { requireSigner: true }),
    ).rejects.toThrow(
      /no longer supports the old 1Password-backed private-key storage path/i,
    );
  });
});

describe("loadCliAddress", () => {
  it("derives the encrypted-wallet address locally without needing unlock", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "moneyos-cli-address-"));
    const walletPath = join(tmpDir, "wallet.json");
    const store = new FileEncryptedWalletStore(walletPath);

    try {
      await store.save({
        privateKey: TEST_PK,
        passphrase: "secret passphrase",
      });

      const result = await loadCliAddress({}, { walletPath });

      expect(result).toEqual({
        kind: "wallet-file",
        address: TEST_ADDRESS,
        source: "encrypted-wallet",
      });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("uses env input for read-only address resolution", async () => {
    const result = await loadCliAddress({}, { envPrivateKey: TEST_PK });
    expect(result).toEqual({
      kind: "env",
      address: TEST_ADDRESS,
      source: "env",
    });
  });

  it("throws a clear error for legacy plaintext configs", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "moneyos-cli-address-legacy-"));
    const walletPath = join(tmpDir, "wallet.json");

    try {
    await expect(
      loadCliAddress({
        privateKey: TEST_PK,
      }, { walletPath }),
    ).rejects.toThrow(/plaintext local wallet configs are no longer used/i);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("throws a clear error for the removed 1Password-backed model", async () => {
    const removedConfig = {
      keyStore: {
        kind: "1password",
      },
    } as CLIConfig;

    await expect(loadCliAddress(removedConfig)).rejects.toThrow(
      /no longer supports the old 1Password-backed private-key storage path/i,
    );
  });
});
