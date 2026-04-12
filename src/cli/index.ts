import { Command } from "commander";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initCommand } from "./commands/init.js";
import { balanceCommand } from "./commands/balance.js";
import { sendCommand } from "./commands/send.js";
import { keystoreCommand } from "./commands/keystore.js";
import { authCommand } from "./commands/auth.js";
import { backupCommand } from "./commands/backup.js";
import {
  createAddToolCommand,
  createRemoveToolCommand,
  createToolsCommand,
} from "./commands/tools.js";
import { runSessionDaemonProcess } from "./session.js";
import {
  createCliToolManager,
  type CliToolManager,
} from "./tools/manager.js";
import { version } from "./version.js";

export interface CreateProgramOptions {
  toolManager?: CliToolManager;
}

export function createProgram(options: CreateProgramOptions = {}): Command {
  const program = new Command();
  const toolManager = options.toolManager ?? createCliToolManager();

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
  program.addCommand(createAddToolCommand(toolManager));
  program.addCommand(createRemoveToolCommand(toolManager));
  program.addCommand(createToolsCommand(toolManager));
  toolManager.mountInstalledToolCommands(program);
  program
    .command("__session-daemon", { hidden: true })
    .action(async () => {
      await runSessionDaemonProcess();
    });

  return program;
}

function resolveEntrypointPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

export function isEntrypointPath(cliEntry: string | undefined, moduleUrl: string): boolean {
  return typeof cliEntry === "string"
    && resolveEntrypointPath(cliEntry) === fileURLToPath(moduleUrl);
}

if (isEntrypointPath(process.argv[1], import.meta.url)) {
  void createProgram().parseAsync(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
