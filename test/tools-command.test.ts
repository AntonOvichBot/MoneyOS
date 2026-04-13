import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolRegistryEntry } from "../src/cli/tools/manager.js";
import { createCliToolManager } from "../src/cli/tools/manager.js";
import {
  createAddToolCommand,
  createRemoveToolCommand,
  createUpdateToolCommand,
  createToolsCommand,
} from "../src/cli/commands/tools.js";

const swapEntry: ToolRegistryEntry = {
  packageName: "@moneyos/swap",
  packageVersion: "0.1.0",
  toolVersion: 1,
  name: "swap",
  commandPath: ["swap"],
  description: "Swap tokens",
};

const updatedSwapEntry: ToolRegistryEntry = {
  ...swapEntry,
  packageVersion: "0.2.0",
};

function createToolManagerMock(overrides: Partial<ReturnType<typeof createCliToolManager>> = {}) {
  return {
    getRegistryEntries() {
      return [];
    },
    mountInstalledToolCommands() {
      // Not needed in these command-level tests.
    },
    async addTool() {
      return swapEntry;
    },
    async removeTool() {
      return swapEntry;
    },
    async updateTools() {
      return [];
    },
    async listTools() {
      return [];
    },
    ...overrides,
  } as ReturnType<typeof createCliToolManager>;
}

describe("root tool commands", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it("moneyos add logs the installed tool surface", async () => {
    const toolManager = createToolManagerMock({
      addTool: vi.fn().mockResolvedValue(swapEntry),
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await createAddToolCommand(toolManager).parseAsync(["node", "add", "swap"]);

    expect(toolManager.addTool).toHaveBeenCalledWith("swap");
    expect(log).toHaveBeenCalledWith(
      "Installed @moneyos/swap@0.1.0 as `moneyos swap`.",
    );
    expect(process.exitCode).toBeUndefined();
  });

  it("moneyos add reports non-Error failures without throwing", async () => {
    const toolManager = createToolManagerMock({
      addTool: vi.fn().mockRejectedValue("install failed"),
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await createAddToolCommand(toolManager).parseAsync(["node", "add", "swap"]);

    expect(error).toHaveBeenCalledWith("install failed");
    expect(process.exitCode).toBe(1);
  });

  it("moneyos remove logs the removed tool surface", async () => {
    const toolManager = createToolManagerMock({
      removeTool: vi.fn().mockResolvedValue(swapEntry),
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await createRemoveToolCommand(toolManager).parseAsync(["node", "remove", "swap"]);

    expect(toolManager.removeTool).toHaveBeenCalledWith("swap");
    expect(log).toHaveBeenCalledWith(
      "Removed @moneyos/swap from `moneyos swap`.",
    );
  });

  it("moneyos remove reports Error failures without throwing", async () => {
    const toolManager = createToolManagerMock({
      removeTool: vi.fn().mockRejectedValue(new Error("remove failed")),
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await createRemoveToolCommand(toolManager).parseAsync(["node", "remove", "swap"]);

    expect(error).toHaveBeenCalledWith("remove failed");
    expect(process.exitCode).toBe(1);
  });

  it("moneyos update forwards the optional target and --check flag", async () => {
    const toolManager = createToolManagerMock({
      updateTools: vi.fn().mockResolvedValue([
        {
          current: swapEntry,
          next: updatedSwapEntry,
          state: "would-update",
        },
      ]),
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await createUpdateToolCommand(toolManager).parseAsync([
      "node",
      "update",
      "swap",
      "--check",
    ]);

    expect(toolManager.updateTools).toHaveBeenCalledWith({
      tool: "swap",
      check: true,
    });
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("would-update"),
    );
    expect(process.exitCode).toBeUndefined();
  });

  it("moneyos update exits 1 when any tool update failed", async () => {
    const toolManager = createToolManagerMock({
      updateTools: vi.fn().mockResolvedValue([
        {
          current: swapEntry,
          next: updatedSwapEntry,
          state: "failed",
          reason: "registry conflict",
        },
      ]),
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await createUpdateToolCommand(toolManager).parseAsync(["node", "update"]);

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("registry conflict"),
    );
    expect(process.exitCode).toBe(1);
  });

  it("moneyos update reports manager errors without throwing", async () => {
    const toolManager = createToolManagerMock({
      updateTools: vi.fn().mockRejectedValue(new Error("npm view failed")),
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await createUpdateToolCommand(toolManager).parseAsync(["node", "update"]);

    expect(error).toHaveBeenCalledWith("npm view failed");
    expect(process.exitCode).toBe(1);
  });

  it("moneyos tools prints the formatted installed tool table", async () => {
    const toolManager = createToolManagerMock({
      listTools: vi.fn().mockResolvedValue([
        {
          ...swapEntry,
          state: "broken",
          problems: ["installed metadata does not match registry"],
        },
      ]),
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await createToolsCommand(toolManager).parseAsync(["node", "tools"]);

    expect(toolManager.listTools).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("installed metadata does not match registry"),
    );
  });
});
