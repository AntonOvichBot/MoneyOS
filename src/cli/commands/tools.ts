import { Command } from "commander";
import {
  createCliToolManager,
  formatToolStatusTable,
} from "../tools/manager.js";

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createAddToolCommand(
  toolManager: ReturnType<typeof createCliToolManager>,
): Command {
  return new Command("add")
    .description("Install or update a MoneyOS CLI tool into the user tool home")
    .argument("<tool>", "Tool alias or npm package spec")
    .action(async (tool: string) => {
      try {
        const entry = await toolManager.addTool(tool);
        console.log(
          `Installed ${entry.packageName}@${entry.packageVersion} as \`moneyos ${entry.commandPath.join(" ")}\`.`,
        );
      } catch (error) {
        console.error(formatError(error));
        process.exitCode = 1;
      }
    });
}

export function createRemoveToolCommand(
  toolManager: ReturnType<typeof createCliToolManager>,
): Command {
  return new Command("remove")
    .description("Remove an installed MoneyOS CLI tool from the user tool home")
    .argument("<tool>", "Installed tool name, command path, or npm package")
    .action(async (tool: string) => {
      try {
        const entry = await toolManager.removeTool(tool);
        console.log(
          `Removed ${entry.packageName} from \`moneyos ${entry.commandPath.join(" ")}\`.`,
        );
      } catch (error) {
        console.error(formatError(error));
        process.exitCode = 1;
      }
    });
}

export function createToolsCommand(
  toolManager: ReturnType<typeof createCliToolManager>,
): Command {
  return new Command("tools")
    .description("List installed MoneyOS CLI tools from the registry")
    .action(async () => {
      try {
        console.log(formatToolStatusTable(await toolManager.listTools()));
      } catch (error) {
        console.error(formatError(error));
        process.exitCode = 1;
      }
    });
}
