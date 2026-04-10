import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  loadFileConfig,
  saveConfig,
  type CLIConfig,
} from "../src/cli/config.js";
import {
  buildCliMoneyOSConfig,
  loadCliAddress,
  loadCliSigner,
} from "../src/cli/wallet.js";

const TEST_PK: Hex =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ALT_PK: Hex =
  "0x59c6995e998f97a5a0044966f094538e6f2f0a38d7c7d0b7e54b5f3c7f4e6a15";
const TEST_ADDRESS = privateKeyToAccount(TEST_PK).address;
const ALT_ADDRESS = privateKeyToAccount(ALT_PK).address;

describe("loadCliSigner", () => {
  it("uses MONEYOS_PRIVATE_KEY-style input before file config", async () => {
    const result = await loadCliSigner(
      { privateKey: ALT_PK },
      { envPrivateKey: TEST_PK },
    );

    expect(result.kind).toBe("env");
    expect(result.address).toBe(TEST_ADDRESS);
    expect((result.signer as any).nonceManager).toBeDefined();
  });

  it("loads the file path through FileKeyStore", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "moneyos-cli-wallet-"));
    const configPath = join(tmpDir, "config.json");

    try {
      saveConfig(
        {
          chainId: 42161,
          privateKey: TEST_PK,
        },
        configPath,
      );

      const result = await loadCliSigner(loadFileConfig(configPath), {
        configPath,
      });

      expect(result.kind).toBe("file");
      expect(result.address).toBe(TEST_ADDRESS);
      expect((result.signer as any).nonceManager).toBeDefined();
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

    await expect(loadCliSigner(removedConfig)).rejects.toThrow(
      /no longer supports the old 1Password-backed private-key storage path/i,
    );
  });
});

describe("buildCliMoneyOSConfig", () => {
  it("does not attach a signer for read-only calls", async () => {
    const result = await buildCliMoneyOSConfig(
      {
        chainId: 42161,
        rpcUrl: "https://arb1.arbitrum.io/rpc",
        privateKey: TEST_PK,
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

  it("attaches a signer when a command needs wallet access", async () => {
    const result = await buildCliMoneyOSConfig(
      { chainId: 42161 },
      {
        requireSigner: true,
        envPrivateKey: ALT_PK,
      },
    );

    expect(result.chainId).toBe(42161);
    expect(result.signer?.address).toBe(ALT_ADDRESS);
  });
});

describe("loadCliAddress", () => {
  it("derives the file-path address locally without loading a signer", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "moneyos-cli-address-"));
    const configPath = join(tmpDir, "config.json");

    try {
      saveConfig(
        {
          chainId: 42161,
          privateKey: TEST_PK,
        },
        configPath,
      );

      const result = await loadCliAddress(loadFileConfig(configPath), {
        configPath,
      });

      expect(result).toEqual({
        kind: "file",
        address: TEST_ADDRESS,
        source: "local-file",
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
