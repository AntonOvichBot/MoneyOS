import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Address } from "viem";
import { getAddress, isAddress } from "viem";
import { getContactsPath } from "./config.js";

/**
 * Local, per-user address book stored at `~/.moneyos/contacts.json`.
 *
 * Flat `name → address` mapping. No shared namespace, no network access, no
 * resolver abstraction — see issue #89. Names are case-sensitive.
 */
export type ContactsFile = Record<string, Address>;

const NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

export function validateContactName(name: string): string {
  if (typeof name !== "string") {
    throw new Error("Contact name must be a string.");
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error("Contact name cannot be empty.");
  }
  if (trimmed.includes(":")) {
    throw new Error(
      "Contact name cannot contain ':' (reserved for future resolver prefixes).",
    );
  }
  if (!NAME_PATTERN.test(trimmed)) {
    throw new Error(
      "Contact name may only contain letters, numbers, dots, dashes, and underscores.",
    );
  }
  if (isAddress(trimmed)) {
    throw new Error("Contact name cannot look like an Ethereum address.");
  }
  return trimmed;
}

export function validateContactAddress(address: string): Address {
  if (typeof address !== "string" || !isAddress(address)) {
    throw new Error(`"${address}" is not a valid Ethereum address.`);
  }
  return getAddress(address);
}

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

function shouldEnforcePosixPermissions(): boolean {
  return process.platform !== "win32";
}

function hasOwn(record: ContactsFile, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, name);
}

export function loadContacts(path: string = getContactsPath()): ContactsFile {
  if (!existsSync(path)) {
    return {};
  }

  const raw = readFileSync(path, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Contacts file at ${path} is not valid JSON.`);
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Contacts file at ${path} must be a JSON object.`);
  }

  return parsed as ContactsFile;
}

export function saveContacts(
  contacts: ContactsFile,
  path: string = getContactsPath(),
): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  }
  writeFileSync(path, `${JSON.stringify(contacts, null, 2)}\n`, {
    mode: FILE_MODE,
  });
  // `writeFileSync`'s `mode` option only applies on create. Enforce the mode
  // explicitly on overwrite so the file never drifts back to 0644, matching
  // the pattern used in src/cli/session.ts for the session token.
  if (shouldEnforcePosixPermissions()) {
    chmodSync(path, FILE_MODE);
  }
}

export interface SavedContact {
  name: string;
  address: Address;
}

export function setContact(
  name: string,
  address: string,
  path?: string,
): SavedContact {
  const normalizedName = validateContactName(name);
  const normalizedAddress = validateContactAddress(address);
  const contacts = loadContacts(path);
  contacts[normalizedName] = normalizedAddress;
  saveContacts(contacts, path);
  return { name: normalizedName, address: normalizedAddress };
}

export function removeContact(name: string, path?: string): boolean {
  const normalizedName = validateContactName(name);
  const contacts = loadContacts(path);
  if (!hasOwn(contacts, normalizedName)) {
    return false;
  }
  delete contacts[normalizedName];
  saveContacts(contacts, path);
  return true;
}

export function listContacts(path?: string): SavedContact[] {
  const contacts = loadContacts(path);
  return Object.entries(contacts)
    .map(([name, address]) => ({ name, address: address as Address }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Look up a name in the local contacts file.
 *
 * Returns `undefined` if the name is not found. Does not throw on bad input —
 * callers are expected to handle missing contacts as "not a contact, try
 * something else."
 *
 * Uses an own-property check so names that collide with Object prototype
 * members (e.g. `toString`, `constructor`) do not silently resolve to
 * inherited values.
 */
export function resolveContact(
  name: string,
  path?: string,
): Address | undefined {
  if (typeof name !== "string" || name.length === 0) {
    return undefined;
  }
  const contacts = loadContacts(path);
  if (!hasOwn(contacts, name)) {
    return undefined;
  }
  return contacts[name];
}
