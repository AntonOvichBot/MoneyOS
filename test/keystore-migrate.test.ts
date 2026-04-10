import { describe, it, expect } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import type { CLIConfig } from "../src/cli/config.js";
import {
  validateMigrationPreconditions,
  buildMigrationConfig,
  buildReverseMigrationConfig,
  keystoreCommand,
  type ResolvedStatus,
  type MigrationResult,
} from "../src/cli/commands/keystore.js";

const CONFIG_PATH = "/fake/home/.moneyos/config.json";
const TEST_PK: Hex = generatePrivateKey();
const TEST_ADDRESS = privateKeyToAccount(TEST_PK).address;

function fileReady(overrides: Partial<ResolvedStatus> = {}): ResolvedStatus {
  return {
    kind: "file",
    state: "ready",
    address: TEST_ADDRESS,
    configPath: CONFIG_PATH,
    ...overrides,
  };
}

const VAULT_ID = "vault26characterid000000001";
const ITEM_ID = "item26characterid000000001";
const MIGRATION_RESULT: MigrationResult = {
  vaultId: VAULT_ID,
  itemId: ITEM_ID,
  address: TEST_ADDRESS,
};

// --- validateMigrationPreconditions ---

describe("validateMigrationPreconditions (--to 1password)", () => {
  it("accepts a file-backed config with a ready key", () => {
    const result = validateMigrationPreconditions(fileReady(), "1password");
    expect(result.ok).toBe(true);
  });

  it("rejects a file-backed config with no key", () => {
    const status: ResolvedStatus = {
      kind: "file",
      state: "empty",
      configPath: CONFIG_PATH,
    };
    const result = validateMigrationPreconditions(status, "1password");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/no private key to migrate/);
    }
  });

  it("rejects a file-backed config with a malformed key", () => {
    const status: ResolvedStatus = {
      kind: "file",
      state: "invalid",
      configPath: CONFIG_PATH,
      reason: "invalid hex string",
    };
    const result = validateMigrationPreconditions(status, "1password");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/source private key is invalid/);
      expect(result.reason).toMatch(/invalid hex string/);
    }
  });

  it("rejects a config that is already on 1Password", () => {
    const status: ResolvedStatus = {
      kind: "1password",
      state: "configured",
      vaultId: VAULT_ID,
      itemId: ITEM_ID,
      configPath: CONFIG_PATH,
    };
    const result = validateMigrationPreconditions(status, "1password");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(
        /already using the current 1Password-compatible path/,
      );
    }
  });

  it("rejects a broken 1password config with the same 'already there' reason", () => {
    // Even if the 1p config is invalid, migrating TO 1p again is not the
    // right fix — the user should repair or re-init.
    const status: ResolvedStatus = {
      kind: "1password",
      state: "invalid",
      vaultId: VAULT_ID,
      configPath: CONFIG_PATH,
      reason: "missing vaultId or itemId",
    };
    const result = validateMigrationPreconditions(status, "1password");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(
        /already using the current 1Password-compatible path/,
      );
    }
  });

  it("rejects an empty config with a pointer to `moneyos init`", () => {
    const status: ResolvedStatus = {
      kind: "none",
      state: "empty",
      configPath: CONFIG_PATH,
    };
    const result = validateMigrationPreconditions(status, "1password");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/no wallet configured/);
      expect(result.reason).toMatch(/moneyos init/);
    }
  });
});

describe("validateMigrationPreconditions (--to file)", () => {
  it("accepts a 1password/configured backend", () => {
    const status: ResolvedStatus = {
      kind: "1password",
      state: "configured",
      vaultId: VAULT_ID,
      itemId: ITEM_ID,
      address: TEST_ADDRESS,
      configPath: CONFIG_PATH,
    };
    const result = validateMigrationPreconditions(status, "file");
    expect(result.ok).toBe(true);
  });

  it("rejects a file-backed config (already there)", () => {
    const result = validateMigrationPreconditions(fileReady(), "file");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/already using the file path/);
    }
  });

  it("rejects a file/empty config with the same 'already there' reason", () => {
    // file/empty counts as "already on file" for --to file — the right
    // fix is `moneyos init`, not migration.
    const status: ResolvedStatus = {
      kind: "file",
      state: "empty",
      configPath: CONFIG_PATH,
    };
    const result = validateMigrationPreconditions(status, "file");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/already using the file path/);
    }
  });

  it("rejects a 1password/invalid config with the underlying reason", () => {
    const status: ResolvedStatus = {
      kind: "1password",
      state: "invalid",
      vaultId: VAULT_ID,
      configPath: CONFIG_PATH,
      reason: "missing vaultId or itemId",
    };
    const result = validateMigrationPreconditions(status, "file");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/source 1Password-compatible config is invalid/);
      expect(result.reason).toMatch(/missing vaultId or itemId/);
    }
  });

  it("rejects an empty config with a pointer to `moneyos init`", () => {
    const status: ResolvedStatus = {
      kind: "none",
      state: "empty",
      configPath: CONFIG_PATH,
    };
    const result = validateMigrationPreconditions(status, "file");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/no wallet configured/);
      expect(result.reason).toMatch(/moneyos init/);
    }
  });
});

// --- buildReverseMigrationConfig ---

describe("buildReverseMigrationConfig", () => {
  const existing: CLIConfig = {
    chainId: 42161,
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    keyStore: {
      kind: "1password",
      vaultId: VAULT_ID,
      itemId: ITEM_ID,
      address: TEST_ADDRESS,
      label: "migrated wallet",
    },
  };

  it("drops the keyStore descriptor entirely", () => {
    const result = buildReverseMigrationConfig(existing, TEST_PK);
    expect(result.keyStore).toBeUndefined();
  });

  it("sets the privateKey at the root", () => {
    const result = buildReverseMigrationConfig(existing, TEST_PK);
    expect(result.privateKey).toBe(TEST_PK);
  });

  it("preserves chainId and rpcUrl from the existing config", () => {
    const result = buildReverseMigrationConfig(existing, TEST_PK);
    expect(result.chainId).toBe(42161);
    expect(result.rpcUrl).toBe("https://arb1.arbitrum.io/rpc");
  });

  it("ignores any stale existing.privateKey and always uses the retrieved key", () => {
    // Transitional state: existing config already has a privateKey
    // (e.g. from a prior --keep-file-copy forward migration). The
    // retrieved key from 1Password wins — it's the authoritative source
    // at the time of reverse migration.
    const otherKey = generatePrivateKey();
    const transitionalExisting: CLIConfig = {
      ...existing,
      privateKey: otherKey,
    };
    const result = buildReverseMigrationConfig(
      transitionalExisting,
      TEST_PK,
    );
    expect(result.privateKey).toBe(TEST_PK);
    expect(result.privateKey).not.toBe(otherKey);
    expect(result.keyStore).toBeUndefined();
  });
});

// --- buildMigrationConfig ---

describe("buildMigrationConfig", () => {
  const existing: CLIConfig = {
    chainId: 42161,
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    privateKey: TEST_PK,
  };

  it("removes the legacy privateKey by default", () => {
    const result = buildMigrationConfig(existing, MIGRATION_RESULT);
    expect(result.privateKey).toBeUndefined();
  });

  it("writes the 1password keyStore with stable IDs and cached address", () => {
    const result = buildMigrationConfig(existing, MIGRATION_RESULT);
    expect(result.keyStore?.kind).toBe("1password");
    expect(result.keyStore?.vaultId).toBe(VAULT_ID);
    expect(result.keyStore?.itemId).toBe(ITEM_ID);
    expect(result.keyStore?.address).toBe(TEST_ADDRESS);
  });

  it("preserves chainId and rpcUrl from the existing config", () => {
    const result = buildMigrationConfig(existing, MIGRATION_RESULT);
    expect(result.chainId).toBe(42161);
    expect(result.rpcUrl).toBe("https://arb1.arbitrum.io/rpc");
  });

  it("keeps the privateKey when --keep-file-copy is set", () => {
    const result = buildMigrationConfig(existing, MIGRATION_RESULT, {
      keepFileCopy: true,
    });
    expect(result.privateKey).toBe(TEST_PK);
    expect(result.keyStore?.kind).toBe("1password");
  });

  it("does NOT set privateKey when --keep-file-copy is set but existing had no privateKey (defensive)", () => {
    // This shouldn't happen in practice — the precondition check gates
    // on file/ready which implies privateKey is set — but the helper is
    // pure so it needs to handle arbitrary inputs defensively.
    const noKeyExisting: CLIConfig = { chainId: 42161 };
    const result = buildMigrationConfig(
      noKeyExisting,
      MIGRATION_RESULT,
      { keepFileCopy: true },
    );
    expect(result.privateKey).toBeUndefined();
  });

  it("wipes any stale keyStore descriptor from the existing config", () => {
    // Transitional state: existing config already has a 1password
    // keyStore descriptor (perhaps from a prior failed migration). The
    // new migration result must fully replace it, not merge with it.
    const transitionalExisting: CLIConfig = {
      chainId: 42161,
      privateKey: TEST_PK,
      keyStore: {
        kind: "1password",
        vaultId: "stale-vault",
        itemId: "stale-item",
        address: ("0x" + "1".repeat(40)) as Address,
        label: "stale label",
      },
    };
    const result = buildMigrationConfig(
      transitionalExisting,
      MIGRATION_RESULT,
    );
    expect(result.keyStore?.vaultId).toBe(VAULT_ID);
    expect(result.keyStore?.itemId).toBe(ITEM_ID);
    expect(result.keyStore?.address).toBe(TEST_ADDRESS);
    expect(result.keyStore?.label).toBeUndefined();
  });
});

// --- Commander wiring sanity ---

describe("keystoreCommand migrate wiring", () => {
  it("registers a 'migrate' subcommand", () => {
    const migrate = keystoreCommand.commands.find(
      (c) => c.name() === "migrate",
    );
    expect(migrate).toBeDefined();
  });

  it("'migrate' subcommand exposes all expected flags", () => {
    const migrate = keystoreCommand.commands.find(
      (c) => c.name() === "migrate",
    );
    const optionNames = migrate!.options.map((o) => o.long);
    expect(optionNames).toContain("--to");
    expect(optionNames).toContain("--keep-file-copy");
    expect(optionNames).toContain("--yes");
    expect(optionNames).toContain("--delete-1password-item");
    expect(optionNames).toContain("--op-binary");
  });

  it("'migrate' marks --to as required", () => {
    const migrate = keystoreCommand.commands.find(
      (c) => c.name() === "migrate",
    );
    const to = migrate!.options.find((o) => o.long === "--to");
    expect(to?.required).toBe(true);
  });
});
