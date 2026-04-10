import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
import type { OpRunner } from "../src/core/op-runner.js";

const TEST_PK: Hex =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ALT_PK: Hex =
  "0x59c6995e998f97a5a0044966f094538e6f2f0a38d7c7d0b7e54b5f3c7f4e6a15";
const TEST_ADDRESS = privateKeyToAccount(TEST_PK).address;
const ALT_ADDRESS = privateKeyToAccount(ALT_PK).address;
const VAULT_ID = "vault26characterid000000001";
const ITEM_ID = "item26characterid000000001";

describe("loadCliSigner", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "moneyos-cli-wallet-"));
    configPath = join(tmpDir, "config.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("uses MONEYOS_PRIVATE_KEY-style input before configured backends", async () => {
    const runner: OpRunner = {
      run: vi.fn(),
    };
    const config: CLIConfig = {
      privateKey: ALT_PK,
      keyStore: {
        kind: "1password",
        vaultId: VAULT_ID,
        itemId: ITEM_ID,
      },
    };

    const result = await loadCliSigner(config, {
      envPrivateKey: TEST_PK,
      runner,
    });

    expect(result.kind).toBe("env");
    expect(result.address).toBe(TEST_ADDRESS);
    expect((result.signer as any).nonceManager).toBeDefined();
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("loads the legacy file path through FileKeyStore", async () => {
    saveConfig(
      {
        chainId: 42161,
        privateKey: TEST_PK,
        keyStore: { kind: "file" },
      },
      configPath,
    );
    const config = loadFileConfig(configPath);

    const result = await loadCliSigner(config, { configPath });

    expect(result.kind).toBe("file");
    expect(result.address).toBe(TEST_ADDRESS);
    expect((result.signer as any).nonceManager).toBeDefined();
  });

  it("loads the transitional 1Password-compatible path through OnePasswordKeyStore", async () => {
    let seenArgs: string[] | undefined;
    const runner: OpRunner = {
      run: vi.fn(async (args: string[]) => {
        seenArgs = args;
        return {
          exitCode: 0,
          stdout: TEST_PK,
          stderr: "",
        };
      }),
    };
    const config: CLIConfig = {
      chainId: 42161,
      keyStore: {
        kind: "1password",
        vaultId: VAULT_ID,
        itemId: ITEM_ID,
        address: TEST_ADDRESS,
      },
    };

    const result = await loadCliSigner(config, { runner });

    expect(result.kind).toBe("1password");
    expect(result.address).toBe(TEST_ADDRESS);
    expect((result.signer as any).nonceManager).toBeDefined();
    expect(seenArgs).toEqual([
      "read",
      `op://${VAULT_ID}/${ITEM_ID}/private_key`,
      "--no-newline",
    ]);
  });

  it("throws a friendly error for a broken 1Password config", async () => {
    const config: CLIConfig = {
      keyStore: {
        kind: "1password",
        vaultId: VAULT_ID,
      },
    };

    await expect(loadCliSigner(config)).rejects.toThrow(
      /missing vaultId or itemId/i,
    );
  });
});

describe("buildCliMoneyOSConfig", () => {
  it("does not load a signer for read-only calls with an explicit address", async () => {
    const runner: OpRunner = {
      run: vi.fn(async () => {
        throw new Error("runner should not be called");
      }),
    };
    const config: CLIConfig = {
      chainId: 1,
      rpcUrl: "https://arb1.arbitrum.io/rpc",
      keyStore: {
        kind: "1password",
        vaultId: VAULT_ID,
        itemId: ITEM_ID,
        address: TEST_ADDRESS,
      },
    };

    const result = await buildCliMoneyOSConfig(config, {
      chainId: 42161,
      requireSigner: false,
      runner,
    });

    expect(result).toEqual({
      chainId: 42161,
      rpcUrl: "https://arb1.arbitrum.io/rpc",
    });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("attaches a signer when a command needs wallet access", async () => {
    const config: CLIConfig = {
      chainId: 42161,
    };

    const result = await buildCliMoneyOSConfig(config, {
      requireSigner: true,
      envPrivateKey: ALT_PK,
    });

    expect(result.chainId).toBe(42161);
    expect(result.signer?.address).toBe(ALT_ADDRESS);
  });
});

describe("loadCliAddress", () => {
  it("uses cached 1Password address metadata without calling op", async () => {
    const runner: OpRunner = {
      run: vi.fn(async () => {
        throw new Error("runner should not be called");
      }),
    };
    const config: CLIConfig = {
      keyStore: {
        kind: "1password",
        vaultId: VAULT_ID,
        itemId: ITEM_ID,
        address: TEST_ADDRESS,
      },
    };

    const result = await loadCliAddress(config, { runner });

    expect(result).toEqual({
      kind: "1password",
      address: TEST_ADDRESS,
      source: "config-cache",
    });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("falls back to signer loading for 1Password configs with no cached address", async () => {
    let seenArgs: string[] | undefined;
    const runner: OpRunner = {
      run: vi.fn(async (args: string[]) => {
        seenArgs = args;
        return {
          exitCode: 0,
          stdout: TEST_PK,
          stderr: "",
        };
      }),
    };
    const config: CLIConfig = {
      keyStore: {
        kind: "1password",
        vaultId: VAULT_ID,
        itemId: ITEM_ID,
      },
    };

    const result = await loadCliAddress(config, { runner });

    expect(result).toEqual({
      kind: "1password",
      address: TEST_ADDRESS,
      source: "signer",
    });
    expect(seenArgs).toEqual([
      "read",
      `op://${VAULT_ID}/${ITEM_ID}/private_key`,
      "--no-newline",
    ]);
  });

  it("derives the file-path address locally without loading a signer", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "moneyos-cli-address-"));
    const configPath = join(tmpDir, "config.json");

    try {
      saveConfig(
        {
          chainId: 42161,
          privateKey: TEST_PK,
          keyStore: { kind: "file" },
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
});
