import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listContacts,
  loadContacts,
  removeContact,
  resolveContact,
  saveContacts,
  setContact,
  validateContactAddress,
  validateContactName,
} from "../src/cli/contacts.js";

const ADDRESS_ONE = "0x689c78B4DBa64A88A0dC03a579D01681F52C5A73" as const;
const ADDRESS_ONE_LOWER = ADDRESS_ONE.toLowerCase();
const ADDRESS_TWO = "0xACBc69bA5B4ae4e709C6DD472c11DEA12CF8B2A9" as const;

describe("validateContactName", () => {
  it("accepts simple ascii names", () => {
    expect(validateContactName("dad")).toBe("dad");
    expect(validateContactName("Mike.Smith")).toBe("Mike.Smith");
    expect(validateContactName("alice_42")).toBe("alice_42");
    expect(validateContactName("red-cross")).toBe("red-cross");
  });

  it("trims surrounding whitespace", () => {
    expect(validateContactName("  dad  ")).toBe("dad");
  });

  it("rejects empty and whitespace-only names", () => {
    expect(() => validateContactName("")).toThrow(/cannot be empty/i);
    expect(() => validateContactName("   ")).toThrow(/cannot be empty/i);
  });

  it("rejects names containing reserved ':' prefix separator", () => {
    expect(() => validateContactName("ens:alice")).toThrow(/':'/);
  });

  it("rejects names with disallowed characters", () => {
    expect(() => validateContactName("has space")).toThrow(
      /letters, numbers, dots, dashes, and underscores/i,
    );
    expect(() => validateContactName("emoji😀")).toThrow(
      /letters, numbers, dots, dashes, and underscores/i,
    );
  });

  it("rejects names that look like Ethereum addresses", () => {
    expect(() => validateContactName(ADDRESS_ONE)).toThrow(
      /cannot look like an Ethereum address/i,
    );
  });
});

describe("validateContactAddress", () => {
  it("returns checksummed address for valid input", () => {
    expect(validateContactAddress(ADDRESS_ONE)).toBe(ADDRESS_ONE);
  });

  it("normalizes all-lowercase addresses to their checksum form", () => {
    expect(validateContactAddress(ADDRESS_ONE_LOWER)).toBe(ADDRESS_ONE);
  });

  it("rejects non-address input", () => {
    expect(() => validateContactAddress("not-an-address")).toThrow(
      /not a valid Ethereum address/i,
    );
    expect(() => validateContactAddress("0x1234")).toThrow(
      /not a valid Ethereum address/i,
    );
  });
});

describe("contacts file I/O", () => {
  let tmpDir: string;
  let contactsPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "moneyos-contacts-"));
    contactsPath = join(tmpDir, "contacts.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty object when file does not exist", () => {
    expect(loadContacts(contactsPath)).toEqual({});
  });

  it("round-trips through save + load", () => {
    const input = { dad: ADDRESS_ONE, alice: ADDRESS_TWO };
    saveContacts(input, contactsPath);
    expect(loadContacts(contactsPath)).toEqual(input);
  });

  it("writes the file with 0600 permissions on POSIX", () => {
    if (process.platform === "win32") return;
    saveContacts({ dad: ADDRESS_ONE }, contactsPath);
    const { statSync } = require("node:fs") as typeof import("node:fs");
    const mode = statSync(contactsPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("enforces 0600 permissions on overwrite when the file already exists with looser mode", () => {
    // Regression: writeFileSync's `mode` option only applies on create, so an
    // existing 0644 contacts file would stay 0644 after every save. We now
    // chmod to 0600 explicitly after write.
    if (process.platform === "win32") return;
    const { chmodSync, statSync } = require("node:fs") as typeof import("node:fs");
    writeFileSync(contactsPath, "{}\n", { mode: 0o644 });
    chmodSync(contactsPath, 0o644);
    expect(statSync(contactsPath).mode & 0o777).toBe(0o644);

    saveContacts({ dad: ADDRESS_ONE }, contactsPath);

    expect(statSync(contactsPath).mode & 0o777).toBe(0o600);
  });

  it("rejects malformed JSON files", () => {
    writeFileSync(contactsPath, "not json{", { mode: 0o600 });
    expect(() => loadContacts(contactsPath)).toThrow(/not valid JSON/i);
  });

  it("rejects non-object top-level JSON", () => {
    writeFileSync(contactsPath, "[1, 2, 3]", { mode: 0o600 });
    expect(() => loadContacts(contactsPath)).toThrow(/must be a JSON object/i);
  });

  it("creates the parent directory if missing", () => {
    const nestedPath = join(tmpDir, "nested", "contacts.json");
    saveContacts({ dad: ADDRESS_ONE }, nestedPath);
    expect(existsSync(nestedPath)).toBe(true);
  });
});

describe("setContact / removeContact / listContacts / resolveContact", () => {
  let tmpDir: string;
  let contactsPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "moneyos-contacts-ops-"));
    contactsPath = join(tmpDir, "contacts.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("set persists a contact with a checksummed address", () => {
    const saved = setContact("dad", ADDRESS_ONE_LOWER, contactsPath);
    expect(saved).toEqual({ name: "dad", address: ADDRESS_ONE });
    expect(JSON.parse(readFileSync(contactsPath, "utf-8"))).toEqual({
      dad: ADDRESS_ONE,
    });
  });

  it("set overwrites an existing contact of the same name", () => {
    setContact("dad", ADDRESS_ONE, contactsPath);
    setContact("dad", ADDRESS_TWO, contactsPath);
    expect(loadContacts(contactsPath)).toEqual({ dad: ADDRESS_TWO });
  });

  it("remove returns false when the contact does not exist", () => {
    expect(removeContact("ghost", contactsPath)).toBe(false);
  });

  it("remove deletes an existing contact and returns true", () => {
    setContact("dad", ADDRESS_ONE, contactsPath);
    expect(removeContact("dad", contactsPath)).toBe(true);
    expect(loadContacts(contactsPath)).toEqual({});
  });

  it("list returns entries sorted alphabetically", () => {
    setContact("zeta", ADDRESS_ONE, contactsPath);
    setContact("alpha", ADDRESS_TWO, contactsPath);
    setContact("Mike", ADDRESS_ONE, contactsPath);

    const entries = listContacts(contactsPath);
    expect(entries.map((e) => e.name)).toEqual(["alpha", "Mike", "zeta"]);
  });

  it("resolve returns the address for a known name", () => {
    setContact("dad", ADDRESS_ONE, contactsPath);
    expect(resolveContact("dad", contactsPath)).toBe(ADDRESS_ONE);
  });

  it("resolve returns undefined for an unknown name", () => {
    expect(resolveContact("ghost", contactsPath)).toBeUndefined();
  });

  it("resolve is case-sensitive", () => {
    setContact("dad", ADDRESS_ONE, contactsPath);
    expect(resolveContact("DAD", contactsPath)).toBeUndefined();
  });

  it("resolve does not fall through to Object prototype members", () => {
    // Regression: plain `contacts[name]` would return Object.prototype.toString
    // for an empty contacts file, silently resolving "toString" as a contact.
    expect(resolveContact("toString", contactsPath)).toBeUndefined();
    expect(resolveContact("constructor", contactsPath)).toBeUndefined();
    expect(resolveContact("hasOwnProperty", contactsPath)).toBeUndefined();
  });

  it("remove returns false for Object prototype member names", () => {
    // Regression: `name in contacts` would pick up inherited members and
    // report a successful remove for contacts that were never saved.
    expect(removeContact("toString", contactsPath)).toBe(false);
    expect(removeContact("constructor", contactsPath)).toBe(false);
  });

  it("set validates the name before saving", () => {
    expect(() => setContact("has space", ADDRESS_ONE, contactsPath)).toThrow();
    expect(existsSync(contactsPath)).toBe(false);
  });

  it("set validates the address before saving", () => {
    expect(() => setContact("dad", "not-an-address", contactsPath)).toThrow(
      /not a valid Ethereum address/i,
    );
    expect(existsSync(contactsPath)).toBe(false);
  });
});
