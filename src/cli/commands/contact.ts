import { Command } from "commander";
import { listContacts, removeContact, setContact } from "../contacts.js";

export const contactCommand = new Command("contact").description(
  "Manage the local contacts address book",
);

contactCommand
  .command("set")
  .description("Add or overwrite a contact")
  .argument("<name>", "Contact name (e.g. dad)")
  .argument("<address>", "Ethereum address (0x...)")
  .action((name: string, address: string) => {
    try {
      const saved = setContact(name, address);
      console.log(`Saved contact ${saved.name} → ${saved.address}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  });

contactCommand
  .command("list")
  .description("List all saved contacts")
  .action(() => {
    try {
      const entries = listContacts();
      if (entries.length === 0) {
        console.log(
          'No contacts saved. Add one with "moneyos contact set <name> <address>".',
        );
        return;
      }
      const width = Math.max(...entries.map((e) => e.name.length));
      for (const { name, address } of entries) {
        console.log(`${name.padEnd(width)}  ${address}`);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  });

contactCommand
  .command("remove")
  .description("Remove a saved contact")
  .argument("<name>", "Contact name to remove")
  .action((name: string) => {
    try {
      const removed = removeContact(name);
      if (!removed) {
        console.error(`No contact named "${name}".`);
        process.exitCode = 1;
        return;
      }
      console.log(`Removed contact ${name}.`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  });
