import { describe, it, expect, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import {
  OnePasswordKeyStore,
  extractIds,
  buildInitTemplate,
  createInOnePassword,
  readPrivateKeyHex,
  type OpRunner,
  type OpRunResult,
} from "../src/index.js";

// --- helpers ---

/**
 * Build a mock OpRunner that returns canned results based on the first
 * argument of each call. This keeps individual tests readable.
 */
function mockRunner(
  handler: (args: string[], stdin?: string) => OpRunResult | Promise<OpRunResult>,
): OpRunner {
  return {
    run: vi.fn(async (args, options) => handler(args, options?.stdin)),
  };
}

function okResult(stdout: string, stderr = ""): OpRunResult {
  return { stdout, stderr, exitCode: 0 };
}

function failResult(exitCode: number, stderr: string): OpRunResult {
  return { stdout: "", stderr, exitCode };
}

const TEST_PK: Hex = generatePrivateKey();
const TEST_ADDRESS = privateKeyToAccount(TEST_PK).address;
const VAULT_ID = "abcd1234vault26characterid00";
const ITEM_ID = "efgh5678item26characterid000";

describe("OnePasswordKeyStore.hasKey", () => {
  it("returns true when vaultId and itemId are both set", async () => {
    const store = new OnePasswordKeyStore({
      runner: mockRunner(() => okResult("")),
      vaultId: VAULT_ID,
      itemId: ITEM_ID,
    });
    expect(await store.hasKey()).toBe(true);
  });

  it("does NOT call the runner for a cheap probe", async () => {
    const run = vi.fn();
    const runner: OpRunner = { run };
    const store = new OnePasswordKeyStore({
      runner,
      vaultId: VAULT_ID,
      itemId: ITEM_ID,
    });
    await store.hasKey();
    await store.metadata();
    expect(run).not.toHaveBeenCalled();
  });
});

describe("OnePasswordKeyStore.metadata", () => {
  it("returns kind '1password' with optional address and label", async () => {
    const store = new OnePasswordKeyStore({
      runner: mockRunner(() => okResult("")),
      vaultId: VAULT_ID,
      itemId: ITEM_ID,
      address: TEST_ADDRESS,
      label: "my wallet",
    });
    const meta = await store.metadata();
    expect(meta.kind).toBe("1password");
    expect(meta.address).toBe(TEST_ADDRESS);
    expect(meta.label).toBe("my wallet");
  });

  it("omits address and label when not configured", async () => {
    const store = new OnePasswordKeyStore({
      runner: mockRunner(() => okResult("")),
      vaultId: VAULT_ID,
      itemId: ITEM_ID,
    });
    const meta = await store.metadata();
    expect(meta.kind).toBe("1password");
    expect(meta.address).toBeUndefined();
    expect(meta.label).toBeUndefined();
  });
});

describe("OnePasswordKeyStore.loadSigner", () => {
  it("returns a viem Account for a valid private key from op read", async () => {
    const runner = mockRunner((args) => {
      expect(args).toEqual([
        "read",
        `op://${VAULT_ID}/${ITEM_ID}/private_key`,
        "--no-newline",
      ]);
      return okResult(TEST_PK);
    });
    const store = new OnePasswordKeyStore({
      runner,
      vaultId: VAULT_ID,
      itemId: ITEM_ID,
    });
    const signer = await store.loadSigner();
    expect(signer.address).toBe(TEST_ADDRESS);
  });

  it("uses the rename-proof ID-based reference format", async () => {
    // Explicit assertion: the reference must be op://<vaultId>/<itemId>/private_key,
    // not op://<title>/<title>/private_key. The design doc calls this
    // out as load-bearing.
    let seenRef: string | undefined;
    const runner = mockRunner((args) => {
      seenRef = args[1];
      return okResult(TEST_PK);
    });
    const store = new OnePasswordKeyStore({
      runner,
      vaultId: VAULT_ID,
      itemId: ITEM_ID,
    });
    await store.loadSigner();
    expect(seenRef).toBe(`op://${VAULT_ID}/${ITEM_ID}/private_key`);
  });

  it("tolerates trailing whitespace in op output", async () => {
    // Defensive: even though we pass --no-newline, the tests shouldn't
    // break if the runner surface delivers a trailing newline from
    // somewhere. `trim()` handles it.
    const runner = mockRunner(() => okResult(`${TEST_PK}\n`));
    const store = new OnePasswordKeyStore({
      runner,
      vaultId: VAULT_ID,
      itemId: ITEM_ID,
    });
    const signer = await store.loadSigner();
    expect(signer.address).toBe(TEST_ADDRESS);
  });

  it("throws when op exits non-zero (item deleted, access revoked, etc.)", async () => {
    const runner = mockRunner(() =>
      failResult(1, '[ERROR] item "efgh..." not found'),
    );
    const store = new OnePasswordKeyStore({
      runner,
      vaultId: VAULT_ID,
      itemId: ITEM_ID,
    });
    await expect(store.loadSigner()).rejects.toThrow(
      /exited with code 1.*item "efgh\.\.\." not found/,
    );
  });

  it("throws when op returns an empty value", async () => {
    const runner = mockRunner(() => okResult(""));
    const store = new OnePasswordKeyStore({
      runner,
      vaultId: VAULT_ID,
      itemId: ITEM_ID,
    });
    await expect(store.loadSigner()).rejects.toThrow(/empty value/);
  });

  it("throws when op returns something that is not a 32-byte hex key", async () => {
    const runner = mockRunner(() => okResult("not-a-hex-key"));
    const store = new OnePasswordKeyStore({
      runner,
      vaultId: VAULT_ID,
      itemId: ITEM_ID,
    });
    await expect(store.loadSigner()).rejects.toThrow(
      /not a valid 32-byte hex private key/,
    );
  });

  it("throws when the runner fails to spawn op", async () => {
    const runner: OpRunner = {
      run: vi
        .fn()
        .mockRejectedValue(
          new Error("OpRunner: failed to spawn `op`: ENOENT"),
        ),
    };
    const store = new OnePasswordKeyStore({
      runner,
      vaultId: VAULT_ID,
      itemId: ITEM_ID,
    });
    await expect(store.loadSigner()).rejects.toThrow(
      /failed to invoke `op`.*ENOENT/,
    );
  });

  it("throws on address mismatch when a cached address is configured", async () => {
    const differentAddress =
      "0x1111111111111111111111111111111111111111" as Address;
    const runner = mockRunner(() => okResult(TEST_PK));
    const store = new OnePasswordKeyStore({
      runner,
      vaultId: VAULT_ID,
      itemId: ITEM_ID,
      address: differentAddress,
    });
    await expect(store.loadSigner()).rejects.toThrow(
      /address mismatch.*may have been tampered/,
    );
  });

  it("does NOT check address when no cached address is configured", async () => {
    const runner = mockRunner(() => okResult(TEST_PK));
    const store = new OnePasswordKeyStore({
      runner,
      vaultId: VAULT_ID,
      itemId: ITEM_ID,
      // no address
    });
    const signer = await store.loadSigner();
    expect(signer.address).toBe(TEST_ADDRESS);
  });
});

// --- extractIds ---

describe("extractIds", () => {
  it("extracts { vaultId, itemId } from the nested shape", () => {
    const response = {
      id: "item26characterid0000000001",
      title: "MoneyOS key",
      vault: { id: "vault26characterid000000001" },
      category: "PASSWORD",
    };
    expect(extractIds(response)).toEqual({
      vaultId: "vault26characterid000000001",
      itemId: "item26characterid0000000001",
    });
  });

  it("extracts { vaultId, itemId } from the flat shape", () => {
    const response = {
      id: "item26characterid0000000002",
      title: "MoneyOS key",
      vault_id: "vault26characterid000000002",
    };
    expect(extractIds(response)).toEqual({
      vaultId: "vault26characterid000000002",
      itemId: "item26characterid0000000002",
    });
  });

  it("prefers nested shape when both are present", () => {
    // Extremely unlikely in practice, but defensive: if op ever returns
    // both forms, the nested form is canonical per 1Password's object model.
    const response = {
      id: "item123",
      vault: { id: "vault-nested" },
      vault_id: "vault-flat",
    };
    expect(extractIds(response).vaultId).toBe("vault-nested");
  });

  it("throws when response is not an object", () => {
    expect(() => extractIds("not an object")).toThrow(/not an object/);
    expect(() => extractIds(null)).toThrow(/not an object/);
    expect(() => extractIds(42)).toThrow(/not an object/);
  });

  it("throws when id is missing or not a string", () => {
    expect(() => extractIds({ vault: { id: "v1" } })).toThrow(
      /missing `id`/,
    );
    expect(() => extractIds({ id: 123, vault: { id: "v1" } })).toThrow(
      /missing `id`/,
    );
    expect(() => extractIds({ id: "", vault: { id: "v1" } })).toThrow(
      /missing `id`/,
    );
  });

  it("throws when neither vault.id nor vault_id is present", () => {
    expect(() => extractIds({ id: "item1" })).toThrow(
      /missing a vault identifier/,
    );
    expect(() => extractIds({ id: "item1", vault: {} })).toThrow(
      /missing a vault identifier/,
    );
    expect(() => extractIds({ id: "item1", vault_id: "" })).toThrow(
      /missing a vault identifier/,
    );
    expect(() => extractIds({ id: "item1", vault: { id: 42 } })).toThrow(
      /missing a vault identifier/,
    );
  });
});

// --- buildInitTemplate ---

describe("buildInitTemplate", () => {
  const chainId = 42161;

  it("produces a template with the three pinned fields in order", () => {
    const template = buildInitTemplate({
      privateKey: TEST_PK,
      address: TEST_ADDRESS,
      chainId,
    });

    expect(template.fields).toHaveLength(3);
    expect(template.fields[0].label).toBe("private_key");
    expect(template.fields[0].type).toBe("CONCEALED");
    expect(template.fields[0].value).toBe(TEST_PK);

    expect(template.fields[1].label).toBe("address");
    expect(template.fields[1].type).toBe("STRING");
    expect(template.fields[1].value).toBe(TEST_ADDRESS);

    expect(template.fields[2].label).toBe("chain_id");
    expect(template.fields[2].type).toBe("STRING");
    expect(template.fields[2].value).toBe("42161");
  });

  it("does NOT include a top-level tags field in the body", () => {
    // Tags go via --tags CLI flag per the design doc probe. A `tags` key
    // in the template body is probe-required and must not ship in v1.
    const template = buildInitTemplate({
      privateKey: TEST_PK,
      address: TEST_ADDRESS,
      chainId,
    });
    expect(template).not.toHaveProperty("tags");
  });

  it("uses a short-form address in the title for display", () => {
    const template = buildInitTemplate({
      privateKey: TEST_PK,
      address: TEST_ADDRESS,
      chainId,
    });
    expect(template.title).toContain(TEST_ADDRESS.slice(0, 6));
    expect(template.title).toContain(TEST_ADDRESS.slice(-4));
    expect(template.title).toContain("MoneyOS");
  });

  it("picks a category string but keeps it as an internal detail", () => {
    // Category is implementation-probe-required and must not be treated
    // as a user-facing contract. This test pins the *shape* — template has
    // a category string — without pinning the exact value.
    const template = buildInitTemplate({
      privateKey: TEST_PK,
      address: TEST_ADDRESS,
      chainId,
    });
    expect(typeof template.category).toBe("string");
    expect(template.category.length).toBeGreaterThan(0);
  });

  it("serializes to JSON safely (round-trip with no loss)", () => {
    const template = buildInitTemplate({
      privateKey: TEST_PK,
      address: TEST_ADDRESS,
      chainId,
    });
    const roundTripped = JSON.parse(JSON.stringify(template));
    expect(roundTripped).toEqual(template);
  });
});

// --- createInOnePassword ---

describe("createInOnePassword", () => {
  const chainId = 42161;

  function successResponseFor(
    vaultId: string,
    itemId: string,
  ): string {
    return JSON.stringify({
      id: itemId,
      title: "MoneyOS key",
      vault: { id: vaultId },
      category: "PASSWORD",
    });
  }

  it("invokes the runner with the correct argv and stdin", async () => {
    let capturedArgs: string[] | undefined;
    let capturedStdin: string | undefined;

    const runner = mockRunner((args, stdin) => {
      capturedArgs = args;
      capturedStdin = stdin;
      return okResult(
        successResponseFor("vault26characterid000000001", "item26characterid000000001"),
      );
    });

    await createInOnePassword({
      runner,
      privateKey: TEST_PK,
      chainId,
    });

    expect(capturedArgs).toEqual([
      "item",
      "create",
      "--format",
      "json",
      "--tags",
      "moneyos",
      "-",
    ]);
    expect(capturedStdin).toBeDefined();

    // The stdin must contain the three pinned fields — this is the
    // "secret goes over a pipe, not argv" invariant the design doc calls
    // out explicitly.
    const parsedStdin = JSON.parse(capturedStdin!);
    expect(parsedStdin.fields).toHaveLength(3);
    const labels = parsedStdin.fields.map(
      (f: { label: string }) => f.label,
    );
    expect(labels).toEqual(["private_key", "address", "chain_id"]);
    // And the private key is not in argv
    expect(capturedArgs!.some((a) => a.includes(TEST_PK))).toBe(false);
  });

  it("returns { vaultId, itemId, address } from a valid response", async () => {
    const runner = mockRunner(() =>
      okResult(
        successResponseFor("vault26characterid000000001", "item26characterid000000001"),
      ),
    );

    const result = await createInOnePassword({
      runner,
      privateKey: TEST_PK,
      chainId,
    });

    expect(result.vaultId).toBe("vault26characterid000000001");
    expect(result.itemId).toBe("item26characterid000000001");
    expect(result.address).toBe(TEST_ADDRESS);
  });

  it("throws with context when op exits non-zero", async () => {
    const runner = mockRunner(() =>
      failResult(1, "[ERROR] insufficient permissions to vault"),
    );

    await expect(
      createInOnePassword({ runner, privateKey: TEST_PK, chainId }),
    ).rejects.toThrow(
      /`op item create` exited with code 1.*insufficient permissions/,
    );
  });

  it("throws with context when op output is not valid JSON", async () => {
    const runner = mockRunner(() => okResult("not json at all"));

    await expect(
      createInOnePassword({ runner, privateKey: TEST_PK, chainId }),
    ).rejects.toThrow(/returned invalid JSON/);
  });

  it("propagates extractIds errors (missing vault identifier)", async () => {
    const runner = mockRunner(() =>
      okResult(JSON.stringify({ id: "item1", title: "oops" })),
    );

    await expect(
      createInOnePassword({ runner, privateKey: TEST_PK, chainId }),
    ).rejects.toThrow(/missing a vault identifier/);
  });

  it("wraps runner spawn errors with context", async () => {
    const runner: OpRunner = {
      run: vi
        .fn()
        .mockRejectedValue(
          new Error("OpRunner: failed to spawn `op`: ENOENT"),
        ),
    };

    await expect(
      createInOnePassword({ runner, privateKey: TEST_PK, chainId }),
    ).rejects.toThrow(/failed to invoke `op item create`.*ENOENT/);
  });

  it("handles the flat vault_id response shape", async () => {
    const runner = mockRunner(() =>
      okResult(
        JSON.stringify({
          id: "item26characterid000000002",
          vault_id: "vault26characterid000000002",
        }),
      ),
    );

    const result = await createInOnePassword({
      runner,
      privateKey: TEST_PK,
      chainId,
    });

    expect(result.vaultId).toBe("vault26characterid000000002");
    expect(result.itemId).toBe("item26characterid000000002");
  });
});

// --- readPrivateKeyHex ---

describe("readPrivateKeyHex", () => {
  it("returns the validated hex key on a successful read", async () => {
    let seenArgs: string[] | undefined;
    const runner = mockRunner((args) => {
      seenArgs = args;
      return okResult(TEST_PK);
    });

    const result = await readPrivateKeyHex({
      runner,
      vaultId: VAULT_ID,
      itemId: ITEM_ID,
    });

    expect(result).toBe(TEST_PK);
    expect(seenArgs).toEqual([
      "read",
      `op://${VAULT_ID}/${ITEM_ID}/private_key`,
      "--no-newline",
    ]);
  });

  it("uses the same rename-proof reference format as OnePasswordKeyStore", async () => {
    let seenRef: string | undefined;
    const runner = mockRunner((args) => {
      seenRef = args[1];
      return okResult(TEST_PK);
    });
    await readPrivateKeyHex({
      runner,
      vaultId: VAULT_ID,
      itemId: ITEM_ID,
    });
    expect(seenRef).toBe(`op://${VAULT_ID}/${ITEM_ID}/private_key`);
  });

  it("tolerates trailing whitespace in op output", async () => {
    const runner = mockRunner(() => okResult(`${TEST_PK}\n`));
    const result = await readPrivateKeyHex({
      runner,
      vaultId: VAULT_ID,
      itemId: ITEM_ID,
    });
    expect(result).toBe(TEST_PK);
  });

  it("throws with context when op exits non-zero", async () => {
    const runner = mockRunner(() =>
      failResult(1, "[ERROR] item not found"),
    );
    await expect(
      readPrivateKeyHex({
        runner,
        vaultId: VAULT_ID,
        itemId: ITEM_ID,
      }),
    ).rejects.toThrow(/exited with code 1.*item not found/);
  });

  it("throws when op returns an empty value", async () => {
    const runner = mockRunner(() => okResult(""));
    await expect(
      readPrivateKeyHex({
        runner,
        vaultId: VAULT_ID,
        itemId: ITEM_ID,
      }),
    ).rejects.toThrow(/empty value/);
  });

  it("throws when op returns something that is not a 32-byte hex key", async () => {
    const runner = mockRunner(() => okResult("not-a-hex-key"));
    await expect(
      readPrivateKeyHex({
        runner,
        vaultId: VAULT_ID,
        itemId: ITEM_ID,
      }),
    ).rejects.toThrow(/not a valid 32-byte hex private key/);
  });

  it("wraps spawn errors with context", async () => {
    const runner: OpRunner = {
      run: vi
        .fn()
        .mockRejectedValue(
          new Error("OpRunner: failed to spawn `op`: ENOENT"),
        ),
    };
    await expect(
      readPrivateKeyHex({
        runner,
        vaultId: VAULT_ID,
        itemId: ITEM_ID,
      }),
    ).rejects.toThrow(/failed to invoke `op`.*ENOENT/);
  });
});
