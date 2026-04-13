import { Command } from "commander";
import {
  createCliToolManager,
  formatToolStatusTable,
  formatToolUpdateTable,
  type ToolUpdateResult,
} from "../tools/manager.js";

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatToolUpdateOutput(results: ToolUpdateResult[]): string {
  if (results.length === 0) return "No tools installed.";
  const visible = results.filter((result) => result.state !== "up-to-date");
  if (visible.length === 0) return "All installed tools are up to date.";
  return formatToolUpdateTable(visible);
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

export function createUpdateToolCommand(
  toolManager: ReturnType<typeof createCliToolManager>,
): Command {
  return new Command("update")
    .description("Update installed MoneyOS CLI tools in the user tool home")
    .argument("[tool]", "Installed tool name, command path, or npm package")
    .option("--check", "Show what would update without applying changes")
    .action(async (tool: string | undefined, options: { check?: boolean }) => {
      try {
        const results = await toolManager.updateTools({
          tool,
          check: options.check === true,
        });
        console.log(formatToolUpdateOutput(results));
        if (results.some((result) => result.state === "failed")) {
          process.exitCode = 1;
        }
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
