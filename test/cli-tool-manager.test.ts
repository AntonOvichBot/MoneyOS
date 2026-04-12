import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProgram } from "../src/cli/index.js";
import type { MoneyOSCliTool } from "../src/cli-tool.js";
import {
  createCliToolManager,
  type CliToolModuleLoader,
  type CliToolPackageManager,
  type LoadedInstalledTool,
  type ToolHomePaths,
  type ToolRegistryEntry,
} from "../src/cli/tools/manager.js";

interface CatalogRecord {
  version: string;
  cliTool: unknown;
}

function parsePackageSpec(spec: string): {
  packageName: string;
  version?: string;
} {
  if (spec.startsWith("@")) {
    const slashIndex = spec.indexOf("/");
    const versionIndex = spec.indexOf("@", slashIndex + 1);
    if (versionIndex === -1) {
      return { packageName: spec };
    }
    return {
      packageName: spec.slice(0, versionIndex),
      version: spec.slice(versionIndex + 1),
    };
  }

  const versionIndex = spec.indexOf("@");
  if (versionIndex === -1) {
    return { packageName: spec };
  }

  return {
    packageName: spec.slice(0, versionIndex),
    version: spec.slice(versionIndex + 1),
  };
}

function readDependencies(paths: ToolHomePaths): Record<string, string> {
  return (
    JSON.parse(readFileSync(paths.packageJsonPath, "utf8")) as {
      dependencies?: Record<string, string>;
    }
  ).dependencies ?? {};
}

function writeDependencies(
  paths: ToolHomePaths,
  dependencies: Record<string, string>,
): void {
  writeFileSync(
    paths.packageJsonPath,
    `${JSON.stringify(
      {
        name: "moneyos-tools",
        private: true,
        dependencies,
      },
      null,
      2,
    )}\n`,
  );
}

function createFakeCliTool(params: {
  name: string;
  commandPath: string[];
  description?: string;
  onCreate?: (ctx: unknown) => void;
  onInvoke?: (...args: string[]) => void | Promise<void>;
}): MoneyOSCliTool {
  return {
    version: 1,
    name: params.name,
    commandPath: params.commandPath,
    description: params.description ?? `${params.name} description`,
    createCommand(ctx): Command {
      params.onCreate?.(ctx);
      return new Command(params.commandPath[params.commandPath.length - 1])
        .argument("[args...]")
        .action(async (args: string[]) => {
          await params.onInvoke?.(...args);
        });
    },
  };
}

function createHarness(catalog: Record<string, CatalogRecord>): {
  paths: ToolHomePaths;
  packageManager: CliToolPackageManager;
  moduleLoader: CliToolModuleLoader;
  installs: string[];
  uninstalls: string[];
  installed: Map<string, LoadedInstalledTool>;
  cleanup: () => void;
} {
  const rootDir = mkdtempSync(join(tmpdir(), "moneyos-tool-home-"));
  const paths: ToolHomePaths = {
    rootDir,
    packageJsonPath: join(rootDir, "package.json"),
    registryPath: join(rootDir, "registry.json"),
  };

  writeDependencies(paths, {});
  writeFileSync(paths.registryPath, "[]\n");

  const installs: string[] = [];
  const uninstalls: string[] = [];
  const installed = new Map<string, LoadedInstalledTool>();

  const packageManager: CliToolPackageManager = {
    async install(managerPaths, spec) {
      installs.push(spec);
      const { packageName, version } = parsePackageSpec(spec);
      const record = catalog[packageName];
      if (!record) {
        throw new Error(`Unknown package ${packageName}`);
      }

      const dependencies = readDependencies(managerPaths);
      dependencies[packageName] = version ?? record.version;
      writeDependencies(managerPaths, dependencies);

      installed.set(packageName, {
        packageName,
        packageVersion: version ?? record.version,
        cliTool: record.cliTool as MoneyOSCliTool,
      });
    },
    async uninstall(managerPaths, packageName) {
      uninstalls.push(packageName);
      const dependencies = readDependencies(managerPaths);
      delete dependencies[packageName];
      writeDependencies(managerPaths, dependencies);
      installed.delete(packageName);
    },
  };

  const moduleLoader: CliToolModuleLoader = {
    async loadInstalledTool(_managerPaths, packageName) {
      const loaded = installed.get(packageName);
      if (!loaded) {
        throw new Error(`Package ${packageName} is missing from the fake tool home.`);
      }
      return loaded;
    },
  };

  return {
    paths,
    packageManager,
    moduleLoader,
    installs,
    uninstalls,
    installed,
    cleanup: () => {
      rmSync(rootDir, { recursive: true, force: true });
    },
  };
}

describe("cli tool manager", () => {
  let cleanupCallbacks: Array<() => void>;

  beforeEach(() => {
    cleanupCallbacks = [];
  });

  function registerHarness(catalog: Record<string, CatalogRecord>) {
    const harness = createHarness(catalog);
    cleanupCallbacks.push(harness.cleanup);
    return harness;
  }

  afterEach(() => {
    for (const cleanup of cleanupCallbacks) {
      cleanup();
    }
  });

  it("moneyos add swap installs @moneyos/swap into the tool home registry", async () => {
    const harness = registerHarness({
      "@moneyos/swap": {
        version: "0.1.0",
        cliTool: createFakeCliTool({
          name: "swap",
          commandPath: ["swap"],
        }),
      },
    });

    const manager = createCliToolManager({
      paths: harness.paths,
      packageManager: harness.packageManager,
      moduleLoader: harness.moduleLoader,
      cliContext: {
        getRuntime: vi.fn(),
      },
    });

    const entry = await manager.addTool("swap");

    expect(harness.installs).toEqual(["@moneyos/swap"]);
    expect(entry).toMatchObject({
      packageName: "@moneyos/swap",
      packageVersion: "0.1.0",
      commandPath: ["swap"],
    });
    expect(manager.getRegistryEntries()).toHaveLength(1);
  });

  it("moneyos remove swap removes the installed package and registry entry", async () => {
    const harness = registerHarness({
      "@moneyos/swap": {
        version: "0.1.0",
        cliTool: createFakeCliTool({
          name: "swap",
          commandPath: ["swap"],
        }),
      },
    });

    const manager = createCliToolManager({
      paths: harness.paths,
      packageManager: harness.packageManager,
      moduleLoader: harness.moduleLoader,
      cliContext: {
        getRuntime: vi.fn(),
      },
    });

    await manager.addTool("swap");
    const removed = await manager.removeTool("swap");

    expect(removed.packageName).toBe("@moneyos/swap");
    expect(harness.uninstalls).toEqual(["@moneyos/swap"]);
    expect(manager.getRegistryEntries()).toEqual([]);
  });

  it("re-adding an installed tool refreshes the registry instead of duplicating it", async () => {
    const catalog = {
      "@moneyos/swap": {
        version: "0.1.0",
        cliTool: createFakeCliTool({
          name: "swap",
          commandPath: ["swap"],
        }),
      },
    };
    const harness = registerHarness(catalog);

    const manager = createCliToolManager({
      paths: harness.paths,
      packageManager: harness.packageManager,
      moduleLoader: harness.moduleLoader,
      cliContext: {
        getRuntime: vi.fn(),
      },
    });

    await manager.addTool("swap");
    catalog["@moneyos/swap"].version = "0.2.0";
    await manager.addTool("swap");

    const entries = manager.getRegistryEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.packageVersion).toBe("0.2.0");
  });

  it("moneyos tools lists installed tools from registry metadata", async () => {
    const harness = registerHarness({
      "@moneyos/swap": {
        version: "0.1.0",
        cliTool: createFakeCliTool({
          name: "swap",
          commandPath: ["swap"],
        }),
      },
    });

    const manager = createCliToolManager({
      paths: harness.paths,
      packageManager: harness.packageManager,
      moduleLoader: harness.moduleLoader,
      cliContext: {
        getRuntime: vi.fn(),
      },
    });

    await manager.addTool("swap");

    await expect(manager.listTools()).resolves.toEqual([
      expect.objectContaining({
        packageName: "@moneyos/swap",
        packageVersion: "0.1.0",
        commandPath: ["swap"],
        state: "ok",
      }),
    ]);
  });

  it("install fails on a reserved command collision and rolls back the package", async () => {
    const harness = registerHarness({
      "@moneyos/auth-tool": {
        version: "0.1.0",
        cliTool: createFakeCliTool({
          name: "auth-tool",
          commandPath: ["auth"],
        }),
      },
    });

    const manager = createCliToolManager({
      paths: harness.paths,
      packageManager: harness.packageManager,
      moduleLoader: harness.moduleLoader,
      cliContext: {
        getRuntime: vi.fn(),
      },
    });

    await expect(manager.addTool("@moneyos/auth-tool")).rejects.toThrow(
      /reserved root command collision/i,
    );
    expect(harness.uninstalls).toEqual(["@moneyos/auth-tool"]);
    expect(manager.getRegistryEntries()).toEqual([]);
  });

  it("install fails on command-path collision with another installed tool", async () => {
    const harness = registerHarness({
      "@moneyos/swap": {
        version: "0.1.0",
        cliTool: createFakeCliTool({
          name: "swap",
          commandPath: ["swap"],
        }),
      },
      "@moneyos/other-swap": {
        version: "1.0.0",
        cliTool: createFakeCliTool({
          name: "other-swap",
          commandPath: ["swap"],
        }),
      },
    });

    const manager = createCliToolManager({
      paths: harness.paths,
      packageManager: harness.packageManager,
      moduleLoader: harness.moduleLoader,
      cliContext: {
        getRuntime: vi.fn(),
      },
    });

    await manager.addTool("swap");
    await expect(manager.addTool("@moneyos/other-swap")).rejects.toThrow(
      /command path swap collides/i,
    );
    expect(harness.uninstalls).toContain("@moneyos/other-swap");
    expect(manager.getRegistryEntries()).toHaveLength(1);
  });

  it("root CLI startup registers tool stubs from registry metadata without eager-loading packages", async () => {
    const onLoad = vi.fn();
    const harness = registerHarness({
      "@moneyos/swap": {
        version: "0.1.0",
        cliTool: createFakeCliTool({
          name: "swap",
          commandPath: ["swap"],
        }),
      },
    });
    const moduleLoader: CliToolModuleLoader = {
      async loadInstalledTool(paths, packageName) {
        onLoad();
        return harness.moduleLoader.loadInstalledTool(paths, packageName);
      },
    };

    const manager = createCliToolManager({
      paths: harness.paths,
      packageManager: harness.packageManager,
      moduleLoader,
      cliContext: {
        getRuntime: vi.fn(),
      },
    });

    await manager.addTool("swap");
    onLoad.mockClear();

    const program = createProgram({ toolManager: manager });
    expect(program.commands.map((command) => command.name())).toContain("swap");
    expect(onLoad).not.toHaveBeenCalled();
  });

  it("invoking a tool command lazy-loads the package on demand", async () => {
    const onInvoke = vi.fn();
    const harness = registerHarness({
      "@moneyos/swap": {
        version: "0.1.0",
        cliTool: createFakeCliTool({
          name: "swap",
          commandPath: ["swap"],
          onInvoke,
        }),
      },
    });
    const onLoad = vi.fn();
    const moduleLoader: CliToolModuleLoader = {
      async loadInstalledTool(paths, packageName) {
        onLoad();
        return harness.moduleLoader.loadInstalledTool(paths, packageName);
      },
    };

    const manager = createCliToolManager({
      paths: harness.paths,
      packageManager: harness.packageManager,
      moduleLoader,
      cliContext: {
        getRuntime: vi.fn(),
      },
    });

    await manager.addTool("swap");
    onLoad.mockClear();

    const program = createProgram({ toolManager: manager });
    await program.parseAsync(["node", "moneyos", "swap", "1", "USDC", "ETH"]);

    expect(onLoad).toHaveBeenCalledOnce();
    expect(onInvoke).toHaveBeenCalledWith("1", "USDC", "ETH");
  });

  it("missing moneyosCliTool export fails install cleanly", async () => {
    const harness = registerHarness({
      "@moneyos/broken-tool": {
        version: "0.1.0",
        cliTool: createFakeCliTool({
          name: "broken",
          commandPath: ["broken"],
        }),
      },
    });
    const moduleLoader: CliToolModuleLoader = {
      async loadInstalledTool() {
        throw new Error("Package @moneyos/broken-tool does not export `moneyosCliTool`.");
      },
    };

    const manager = createCliToolManager({
      paths: harness.paths,
      packageManager: harness.packageManager,
      moduleLoader,
      cliContext: {
        getRuntime: vi.fn(),
      },
    });

    await expect(manager.addTool("@moneyos/broken-tool")).rejects.toThrow(
      /does not export `moneyosCliTool`/i,
    );
    expect(manager.getRegistryEntries()).toEqual([]);
  });

  it("incompatible moneyosCliTool.version fails install cleanly", async () => {
    const harness = registerHarness({
      "@moneyos/versioned-tool": {
        version: "0.1.0",
        cliTool: createFakeCliTool({
          name: "versioned",
          commandPath: ["versioned"],
        }),
      },
    });
    const moduleLoader: CliToolModuleLoader = {
      async loadInstalledTool() {
        throw new Error(
          "Package @moneyos/versioned-tool exports unsupported moneyosCliTool.version 2. Expected 1.",
        );
      },
    };

    const manager = createCliToolManager({
      paths: harness.paths,
      packageManager: harness.packageManager,
      moduleLoader,
      cliContext: {
        getRuntime: vi.fn(),
      },
    });

    await expect(manager.addTool("@moneyos/versioned-tool")).rejects.toThrow(
      /unsupported moneyosCliTool\.version 2/i,
    );
    expect(manager.getRegistryEntries()).toEqual([]);
  });

  it("tools receive MoneyOSCliContext rather than the root Commander program", async () => {
    const receivedContext: unknown[] = [];
    const cliContext = {
      getRuntime: vi.fn(),
    };
    const harness = registerHarness({
      "@moneyos/swap": {
        version: "0.1.0",
        cliTool: createFakeCliTool({
          name: "swap",
          commandPath: ["swap"],
          onCreate: (ctx) => {
            receivedContext.push(ctx);
          },
        }),
      },
    });

    const manager = createCliToolManager({
      paths: harness.paths,
      packageManager: harness.packageManager,
      moduleLoader: harness.moduleLoader,
      cliContext,
    });

    await manager.addTool("swap");

    const program = createProgram({ toolManager: manager });
    await program.parseAsync(["node", "moneyos", "swap"]);

    expect(receivedContext).toHaveLength(1);
    expect(receivedContext[0]).toBe(cliContext);
    expect(receivedContext[0]).not.toBe(program);
  });

  it("one broken installed tool does not prevent root CLI startup", async () => {
    const harness = registerHarness({
      "@moneyos/swap": {
        version: "0.1.0",
        cliTool: createFakeCliTool({
          name: "swap",
          commandPath: ["swap"],
        }),
      },
    });
    const onLoad = vi.fn();
    const moduleLoader: CliToolModuleLoader = {
      async loadInstalledTool() {
        onLoad();
        throw new Error("broken tool");
      },
    };

    const manager = createCliToolManager({
      paths: harness.paths,
      packageManager: harness.packageManager,
      moduleLoader,
      cliContext: {
        getRuntime: vi.fn(),
      },
    });

    const registryEntry: ToolRegistryEntry = {
      packageName: "@moneyos/swap",
      packageVersion: "0.1.0",
      toolVersion: 1,
      name: "swap",
      commandPath: ["swap"],
      description: "Swap tokens",
    };
    writeFileSync(
      harness.paths.registryPath,
      `${JSON.stringify([registryEntry], null, 2)}\n`,
    );

    const program = createProgram({ toolManager: manager });

    expect(program.commands.map((command) => command.name())).toEqual(
      expect.arrayContaining(["init", "auth", "swap"]),
    );
    expect(onLoad).not.toHaveBeenCalled();
  });
});
