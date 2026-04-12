import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CLIConfig } from "../src/cli/config.js";
import { getWalletPath } from "../src/cli/config.js";
import {
  runChangePasswordCommand,
  type ChangePasswordCommandDependencies,
} from "../src/cli/commands/auth.js";
import { FileEncryptedWalletStore } from "../src/core/encrypted-wallet.js";

const TEST_PK =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

function createChangePasswordContext(params: {
  config?: CLIConfig;
  prompts?: string[];
}): {
  tmpDir: string;
  walletPath: string;
  logs: string[];
  errors: string[];
  lockCalls: Array<{ socketPath: string; tokenPath: string }>;
  deps: ChangePasswordCommandDependencies;
} {
  const tmpDir = mkdtempSync(join(tmpdir(), "moneyos-auth-change-password-"));
  const walletPath = join(tmpDir, "wallet.json");
  const logs: string[] = [];
  const errors: string[] = [];
  const lockCalls: Array<{ socketPath: string; tokenPath: string }> = [];
  const config: CLIConfig = {
    walletPath,
    ...params.config,
  };
  const prompts = [...(params.prompts ?? [])];

  const deps: ChangePasswordCommandDependencies = {
    loadFileConfig: () => config,
    getWalletPath,
    createWalletStore: (path) => new FileEncryptedWalletStore(path),
    promptHidden: async () => {
      const next = prompts.shift();
      if (next === undefined) {
        throw new Error("Unexpected password prompt.");
      }
      return next;
    },
    lockSession: async (socketPath, tokenPath) => {
      lockCalls.push({ socketPath, tokenPath });
      return true;
    },
    getSessionSocketPath: () => join(tmpDir, "session.sock"),
    getSessionTokenPath: () => join(tmpDir, "session.token"),
    log: (message) => logs.push(message),
    error: (message) => errors.push(message),
  };

  return {
    tmpDir,
    walletPath,
    logs,
    errors,
    lockCalls,
    deps,
  };
}

afterEach(() => {
  process.exitCode = undefined;
});

describe("runChangePasswordCommand", () => {
  it("changes the wallet password, locks the session, and explains backup semantics", async () => {
    const ctx = createChangePasswordContext({
      prompts: ["old secret", "new secret phrase", "new secret phrase"],
    });
    const wallet = new FileEncryptedWalletStore(ctx.walletPath);

    try {
      await wallet.save({
        privateKey: TEST_PK,
        passphrase: "old secret",
      });

      await runChangePasswordCommand(ctx.deps);

      expect(await wallet.decrypt("new secret phrase")).toBe(TEST_PK);
      await expect(wallet.decrypt("old secret")).rejects.toThrow(
        /invalid password or corrupted wallet/i,
      );
      expect(ctx.lockCalls).toHaveLength(1);
      expect(ctx.errors).toEqual([]);
      expect(ctx.logs.join("\n")).toContain("Wallet password changed.");
      expect(ctx.logs.join("\n")).toContain("Session:   locked");
      expect(ctx.logs.join("\n")).toContain(
        "Existing backup files and exported copies still require the old wallet password.",
      );
      expect(ctx.logs.join("\n")).toContain(
        "Run `moneyos backup export` to create a backup encrypted with the new wallet password.",
      );
    } finally {
      rmSync(ctx.tmpDir, { recursive: true, force: true });
    }
  });

  it("fails clearly when no wallet is configured", async () => {
    const ctx = createChangePasswordContext({
      prompts: [],
    });

    try {
      await runChangePasswordCommand(ctx.deps);

      expect(process.exitCode).toBe(1);
      expect(ctx.errors).toEqual([
        "No encrypted wallet found. Run `moneyos init` first.",
      ]);
      expect(ctx.lockCalls).toEqual([]);
    } finally {
      rmSync(ctx.tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects an empty current password without changing the wallet", async () => {
    const ctx = createChangePasswordContext({
      prompts: [""],
    });
    const wallet = new FileEncryptedWalletStore(ctx.walletPath);

    try {
      await wallet.save({
        privateKey: TEST_PK,
        passphrase: "old secret",
      });

      await runChangePasswordCommand(ctx.deps);

      expect(process.exitCode).toBe(1);
      expect(ctx.errors).toEqual(["Current wallet password cannot be empty."]);
      expect(await wallet.decrypt("old secret")).toBe(TEST_PK);
    } finally {
      rmSync(ctx.tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects a too-short new password without changing the wallet", async () => {
    const ctx = createChangePasswordContext({
      prompts: ["old secret", "short"],
    });
    const wallet = new FileEncryptedWalletStore(ctx.walletPath);

    try {
      await wallet.save({
        privateKey: TEST_PK,
        passphrase: "old secret",
      });

      await runChangePasswordCommand(ctx.deps);

      expect(process.exitCode).toBe(1);
      expect(ctx.errors).toEqual([
        "New wallet password must be at least 8 characters long.",
      ]);
      expect(await wallet.decrypt("old secret")).toBe(TEST_PK);
    } finally {
      rmSync(ctx.tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects reusing the current password", async () => {
    const ctx = createChangePasswordContext({
      prompts: ["old secret", "old secret"],
    });
    const wallet = new FileEncryptedWalletStore(ctx.walletPath);

    try {
      await wallet.save({
        privateKey: TEST_PK,
        passphrase: "old secret",
      });

      await runChangePasswordCommand(ctx.deps);

      expect(process.exitCode).toBe(1);
      expect(ctx.errors).toEqual([
        "New wallet password must differ from the current password.",
      ]);
      expect(await wallet.decrypt("old secret")).toBe(TEST_PK);
    } finally {
      rmSync(ctx.tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects confirmation mismatch without changing the wallet", async () => {
    const ctx = createChangePasswordContext({
      prompts: ["old secret", "new secret phrase", "different phrase"],
    });
    const wallet = new FileEncryptedWalletStore(ctx.walletPath);

    try {
      await wallet.save({
        privateKey: TEST_PK,
        passphrase: "old secret",
      });

      await runChangePasswordCommand(ctx.deps);

      expect(process.exitCode).toBe(1);
      expect(ctx.errors).toEqual([
        "New wallet password confirmation did not match.",
      ]);
      expect(await wallet.decrypt("old secret")).toBe(TEST_PK);
    } finally {
      rmSync(ctx.tmpDir, { recursive: true, force: true });
    }
  });
});
