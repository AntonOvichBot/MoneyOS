import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Command } from "commander";
import { createProgram, isEntrypointPath } from "../src/cli/index.js";
import type { ToolRegistryEntry } from "../src/cli/tools/manager.js";

function createEmptyToolManager(): NonNullable<Parameters<typeof createProgram>[0]>["toolManager"] {
  return {
    getRegistryEntries(): ToolRegistryEntry[] {
      return [];
    },
    mountInstalledToolCommands(_program: Command): void {
      // No installed tools in this test.
    },
    async addTool(): Promise<ToolRegistryEntry> {
      throw new Error("not used");
    },
    async removeTool(): Promise<ToolRegistryEntry> {
      throw new Error("not used");
    },
    async updateTools() {
      return [];
    },
    async listTools() {
      return [];
    },
  };
}

describe("root cli surface", () => {
  it("does not expose the swap command", () => {
    const commandNames = createProgram({
      toolManager: createEmptyToolManager(),
    }).commands.map((command) => command.name());
    expect(commandNames).not.toContain("swap");
    expect(commandNames).toContain("update");
  });

  it("exposes --all on the balance command with an optional token argument", () => {
    const program = createProgram({ toolManager: createEmptyToolManager() });
    const balance = program.commands.find((c) => c.name() === "balance");
    expect(balance, "balance command should exist").toBeDefined();
    const options = balance!.options.map((o) => o.long);
    expect(options).toContain("--all");
    // The positional token argument must be optional so `balance --all`
    // is accepted by commander.
    const tokenArg = balance!.registeredArguments.find(
      (a) => a.name() === "token",
    );
    expect(tokenArg, "balance should declare a token argument").toBeDefined();
    expect(tokenArg!.required).toBe(false);
  });

  it("treats symlinked npm bin paths as the cli entrypoint", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "moneyos-cli-entrypoint-"));
    const modulePath = new URL("../src/cli/index.ts", import.meta.url);
    const symlinkPath = join(tempDir, "moneyos");

    try {
      symlinkSync(fileURLToPath(modulePath), symlinkPath);
      expect(isEntrypointPath(symlinkPath, modulePath.href)).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
