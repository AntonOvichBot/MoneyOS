import { describe, it, expect } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CLIConfig } from "../src/cli/config.js";
import { FileEncryptedWalletStore } from "../src/core/encrypted-wallet.js";
import {
  resolveWalletStatus,
  formatWalletStatus,
  type ResolvedWalletStatus,
} from "../src/cli/wallet-status.js";
import { keystoreCommand } from "../src/cli/commands/keystore.js";

const TEST_PK: Hex = generatePrivateKey();
const TEST_ADDRESS = privateKeyToAccount(TEST_PK).address;

describe("resolveWalletStatus", () => {
  it("returns kind='none' when no wallet exists", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "moneyos-wallet-status-"));
    const walletPath = join(tmpDir, "wallet.json");

    try {
      const status = await resolveWalletStatus({}, walletPath);
      expect(status.kind).toBe("none");
      expect(status.walletPath).toBe(walletPath);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns encrypted/ready for a valid wallet file", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "moneyos-wallet-status-"));
    const walletPath = join(tmpDir, "wallet.json");
    const store = new FileEncryptedWalletStore(walletPath);

    try {
      await store.save({
        privateKey: TEST_PK,
        passphrase: "secret passphrase",
      });

      const status = await resolveWalletStatus({}, walletPath);
      expect(status.kind).toBe("encrypted");
      expect(status.address).toBe(TEST_ADDRESS);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns invalid when the encrypted wallet file is malformed", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "moneyos-wallet-status-"));
    const walletPath = join(tmpDir, "wallet.json");

    try {
      writeFileSync(walletPath, "{bad json");
      const status = await resolveWalletStatus({}, walletPath);
      expect(status.kind).toBe("invalid");
      expect(status.reason).toBeDefined();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns legacy for old plaintext configs", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "moneyos-wallet-status-"));
    const walletPath = join(tmpDir, "wallet.json");

    try {
      const status = await resolveWalletStatus(
        {
          privateKey: TEST_PK,
        },
        walletPath,
      );
      expect(status.kind).toBe("legacy");
      expect(status.address).toBe(TEST_ADDRESS);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns unsupported for the removed 1Password-backed model", async () => {
    const removedConfig = {
      keyStore: {
        kind: "1password",
        address: TEST_ADDRESS,
      },
    } as CLIConfig;
    const status = await resolveWalletStatus(removedConfig, "/fake/wallet.json");
    expect(status.kind).toBe("unsupported");
    expect(status.address).toBe(TEST_ADDRESS);
    expect(status.reason).toMatch(
      /no longer supports the old 1Password-backed private-key storage path/i,
    );
  });
});

describe("formatWalletStatus", () => {
  function baseStatus(
    overrides: Partial<ResolvedWalletStatus>,
  ): ResolvedWalletStatus {
    return {
      kind: "encrypted",
      walletPath: "/fake/home/.moneyos/wallet.json",
      ...overrides,
    };
  }

  it("formats encrypted wallets clearly", () => {
    const output = formatWalletStatus(
      baseStatus({
        address: TEST_ADDRESS,
      }),
    );
    expect(output).toContain("Wallet:    encrypted local wallet");
    expect(output).toContain(`Address:   ${TEST_ADDRESS}`);
    expect(output).toContain("Status:    ready");
  });

  it("formats legacy configs clearly", () => {
    const output = formatWalletStatus(
      baseStatus({
        kind: "legacy",
        address: TEST_ADDRESS,
        reason: "upgrade required",
      }),
    );
    expect(output).toContain("Wallet:    legacy plaintext config");
    expect(output).toMatch(/Status:\s+upgrade required/);
  });

  it("formats invalid wallets with the underlying reason", () => {
    const output = formatWalletStatus(
      baseStatus({
        kind: "invalid",
        reason: "bad json",
      }),
    );
    expect(output).toMatch(/Status:\s+invalid — bad json/);
  });

  it("formats none with a clear init pointer", () => {
    const output = formatWalletStatus({
      kind: "none",
      walletPath: "/fake/home/.moneyos/wallet.json",
    });
    expect(output).toContain("Wallet:    (none)");
    expect(output).toMatch(/Status:\s+no wallet configured/);
  });
});

describe("keystoreCommand wiring", () => {
  it("registers a 'status' subcommand", () => {
    expect(keystoreCommand.name()).toBe("keystore");
    const status = keystoreCommand.commands.find(
      (c) => c.name() === "status",
    );
    expect(status).toBeDefined();
  });

  it("does not register a 'migrate' subcommand anymore", () => {
    const migrate = keystoreCommand.commands.find(
      (c) => c.name() === "migrate",
    );
    expect(migrate).toBeUndefined();
  });
});
