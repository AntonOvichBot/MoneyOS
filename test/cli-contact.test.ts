import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setContact: vi.fn(),
  listContacts: vi.fn(),
  removeContact: vi.fn(),
  resolveContact: vi.fn(),
}));

vi.mock("../src/cli/contacts.js", () => ({
  setContact: mocks.setContact,
  listContacts: mocks.listContacts,
  removeContact: mocks.removeContact,
  resolveContact: mocks.resolveContact,
}));

import { resolveSendRecipient } from "../src/cli/commands/send.js";

const ADDRESS_ONE = "0x689c78B4DBa64A88A0dC03a579D01681F52C5A73" as const;
const ADDRESS_TWO = "0xACBc69bA5B4ae4e709C6DD472c11DEA12CF8B2A9" as const;

describe("contact command", () => {
  let consoleLog: ReturnType<typeof vi.spyOn>;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    mocks.setContact.mockReset();
    mocks.listContacts.mockReset();
    mocks.removeContact.mockReset();
    mocks.resolveContact.mockReset();
    process.exitCode = undefined;
    consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLog.mockRestore();
    consoleError.mockRestore();
  });

  it("set saves and reports the new contact", async () => {
    mocks.setContact.mockReturnValue({ name: "dad", address: ADDRESS_ONE });
    const { contactCommand } = await import("../src/cli/commands/contact.js");
    contactCommand.exitOverride();

    await contactCommand.parseAsync(["node", "contact", "set", "dad", ADDRESS_ONE]);

    expect(mocks.setContact).toHaveBeenCalledWith("dad", ADDRESS_ONE);
    expect(consoleLog).toHaveBeenCalledWith(
      `Saved contact dad → ${ADDRESS_ONE}`,
    );
  });

  it("set surfaces validation errors and exits non-zero", async () => {
    mocks.setContact.mockImplementation(() => {
      throw new Error("Contact name cannot be empty.");
    });
    const { contactCommand } = await import("../src/cli/commands/contact.js");
    contactCommand.exitOverride();

    await contactCommand.parseAsync([
      "node",
      "contact",
      "set",
      "  ",
      ADDRESS_ONE,
    ]);

    expect(consoleError).toHaveBeenCalledWith("Contact name cannot be empty.");
    expect(process.exitCode).toBe(1);
  });

  it("list prints a friendly message when empty", async () => {
    mocks.listContacts.mockReturnValue([]);
    const { contactCommand } = await import("../src/cli/commands/contact.js");
    contactCommand.exitOverride();

    await contactCommand.parseAsync(["node", "contact", "list"]);

    expect(consoleLog).toHaveBeenCalledWith(
      'No contacts saved. Add one with "moneyos contact set <name> <address>".',
    );
  });

  it("list prints entries aligned on name width", async () => {
    mocks.listContacts.mockReturnValue([
      { name: "alpha", address: ADDRESS_ONE },
      { name: "Mike", address: ADDRESS_TWO },
    ]);
    const { contactCommand } = await import("../src/cli/commands/contact.js");
    contactCommand.exitOverride();

    await contactCommand.parseAsync(["node", "contact", "list"]);

    expect(consoleLog).toHaveBeenCalledWith(`alpha  ${ADDRESS_ONE}`);
    expect(consoleLog).toHaveBeenCalledWith(`Mike   ${ADDRESS_TWO}`);
  });

  it("remove reports success when a contact was removed", async () => {
    mocks.removeContact.mockReturnValue(true);
    const { contactCommand } = await import("../src/cli/commands/contact.js");
    contactCommand.exitOverride();

    await contactCommand.parseAsync(["node", "contact", "remove", "dad"]);

    expect(mocks.removeContact).toHaveBeenCalledWith("dad");
    expect(consoleLog).toHaveBeenCalledWith("Removed contact dad.");
  });

  it("remove reports and exits non-zero when no matching contact exists", async () => {
    mocks.removeContact.mockReturnValue(false);
    const { contactCommand } = await import("../src/cli/commands/contact.js");
    contactCommand.exitOverride();

    await contactCommand.parseAsync(["node", "contact", "remove", "ghost"]);

    expect(consoleError).toHaveBeenCalledWith('No contact named "ghost".');
    expect(process.exitCode).toBe(1);
  });
});

describe("resolveSendRecipient", () => {
  let consoleLog: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mocks.resolveContact.mockReset();
    consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLog.mockRestore();
  });

  it("returns raw addresses unchanged and does not log a resolution line", () => {
    const result = resolveSendRecipient(ADDRESS_ONE);

    expect(result).toBe(ADDRESS_ONE);
    expect(mocks.resolveContact).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
  });

  it("resolves a known contact name and logs the resolution line", () => {
    mocks.resolveContact.mockReturnValue(ADDRESS_ONE);

    const result = resolveSendRecipient("dad");

    expect(mocks.resolveContact).toHaveBeenCalledWith("dad");
    expect(result).toBe(ADDRESS_ONE);
    expect(consoleLog).toHaveBeenCalledWith(`Resolved dad → ${ADDRESS_ONE}`);
  });

  it("throws a clear error when the input is neither an address nor a contact", () => {
    mocks.resolveContact.mockReturnValue(undefined);

    expect(() => resolveSendRecipient("ghost")).toThrow(
      /Could not resolve "ghost"/,
    );
  });
});
