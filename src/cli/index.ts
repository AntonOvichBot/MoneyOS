import { Command } from "commander";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initCommand } from "./commands/init.js";
import { balanceCommand } from "./commands/balance.js";
import { sendCommand } from "./commands/send.js";
import { keystoreCommand } from "./commands/keystore.js";
import { authCommand } from "./commands/auth.js";
import { backupCommand } from "./commands/backup.js";
import { runSessionDaemonProcess } from "./session.js";
import { version } from "./version.js";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("moneyos")
    .description("The operating system for money")
    .version(version);

  program.addCommand(initCommand);
  program.addCommand(balanceCommand);
  program.addCommand(sendCommand);
  program.addCommand(keystoreCommand);
  program.addCommand(authCommand);
  program.addCommand(backupCommand);
  program
    .command("__session-daemon", { hidden: true })
    .action(async () => {
      await runSessionDaemonProcess();
    });

  return program;
}

const cliEntry = process.argv[1];
const isEntrypoint =
  typeof cliEntry === "string"
  && resolve(cliEntry) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  void createProgram().parseAsync(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
