import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProgram } from "../src/cli/index.js";
import type { MoneyOSCliTool } from "../src/cli-tool.js";
import {
  createCliToolManager,
  formatToolStatusTable,
  type ToolRegistryEntry,
} from "../src/cli/tools/manager.js";

type ToolHomePaths = {
  rootDir: string;
  packageJsonPath: string;
  registryPath: string;
};

type LoadedInstalledTool = {
  packageName: string;
  packageVersion: string;
  cliTool: unknown;
};

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
    createCommand(ctx) {
      params.onCreate?.(ctx);
      return new ctx.Command(params.commandPath[params.commandPath.length - 1])
        .argument("[args...]")
        .action(async (args: string[]) => {
          await params.onInvoke?.(...args);
        });
    },
  };
}

function createHarness(catalog: Record<string, CatalogRecord>): {
  paths: ToolHomePaths;
  packageManager: {
    install(paths: ToolHomePaths, spec: string): Promise<void>;
    uninstall(paths: ToolHomePaths, packageName: string): Promise<void>;
  };
  moduleLoader: (paths: ToolHomePaths, packageName: string) => Promise<LoadedInstalledTool>;
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

  const packageManager = {
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

  const moduleLoader = async (_managerPaths: ToolHomePaths, packageName: string) => {
    const loaded = installed.get(packageName);
    if (!loaded) {
      throw new Error(`Package ${packageName} is missing from the fake tool home.`);
    }
    return loaded;
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
        Command,
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
        Command,
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
        Command,
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
        Command,
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
        Command,
        getRuntime: vi.fn(),
      },
    });

    await expect(manager.addTool("@moneyos/auth-tool")).rejects.toThrow(
      /reserved root command collision/i,
    );
    expect(harness.uninstalls).toEqual(["@moneyos/auth-tool"]);
    expect(manager.getRegistryEntries()).toEqual([]);
  });

  it("existing tool homes migrate shared dependency versions on access", () => {
    const harness = registerHarness({});
    writeDependencies(harness.paths, {
      "@moneyos/core": "^0.1.0",
      viem: "^2.45.1",
    });

    const manager = createCliToolManager({
      paths: harness.paths,
      packageManager: harness.packageManager,
      moduleLoader: harness.moduleLoader,
      sharedToolHomeDependencies: {
        "@moneyos/core": "^0.2.0",
        viem: "^2.50.0",
      },
      cliContext: {
        Command,
        getRuntime: vi.fn(),
      },
    });

    expect(readDependencies(harness.paths)).toEqual({
      "@moneyos/core": "^0.1.0",
      viem: "^2.45.1",
    });

    expect(manager.getRegistryEntries()).toEqual([]);
    expect(readDependencies(harness.paths)).toEqual({
      "@moneyos/core": "^0.2.0",
      viem: "^2.50.0",
    });
  });

  it("new root commands become reserved without updating manager code", async () => {
    const harness = registerHarness({
      "@moneyos/portfolio-tool": {
        version: "0.1.0",
        cliTool: createFakeCliTool({
          name: "portfolio",
          commandPath: ["portfolio"],
        }),
      },
    });

    const manager = createCliToolManager({
      paths: harness.paths,
      packageManager: harness.packageManager,
      moduleLoader: harness.moduleLoader,
      cliContext: {
        Command,
        getRuntime: vi.fn(),
      },
    });

    const program = new Command();
    program.addCommand(new Command("portfolio"));
    manager.mountInstalledToolCommands(program);

    await expect(manager.addTool("@moneyos/portfolio-tool")).rejects.toThrow(
      /reserved root command collision for portfolio/i,
    );
    expect(harness.uninstalls).toEqual(["@moneyos/portfolio-tool"]);
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
        Command,
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
    const moduleLoader = async (paths: ToolHomePaths, packageName: string) => {
      onLoad();
      return harness.moduleLoader(paths, packageName);
    };

    const manager = createCliToolManager({
      paths: harness.paths,
      packageManager: harness.packageManager,
      moduleLoader,
      cliContext: {
        Command,
        getRuntime: vi.fn(),
      },
    });

    await manager.addTool("swap");
    onLoad.mockClear();

    const program = createProgram({ toolManager: manager });
    expect(program.commands.map((command) => command.name())).toContain("swap");
    expect(onLoad).not.toHaveBeenCalled();
  });

  it("loads an installed tool directly from the tool home filesystem", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "moneyos-real-tool-home-"));
    cleanupCallbacks.push(() => {
      rmSync(rootDir, { recursive: true, force: true });
    });
    const paths: ToolHomePaths = {
      rootDir,
      packageJsonPath: join(rootDir, "package.json"),
      registryPath: join(rootDir, "registry.json"),
    };

    writeDependencies(paths, {
      "@moneyos/fake-tool": "1.2.3",
    });
    writeFileSync(
      paths.registryPath,
      `${JSON.stringify(
        [
          {
            packageName: "@moneyos/fake-tool",
            packageVersion: "1.2.3",
            toolVersion: 1,
            name: "fake",
            commandPath: ["fake"],
            description: "Fake tool",
          },
        ],
        null,
        2,
      )}\n`,
    );

    const packageDir = join(rootDir, "node_modules", "@moneyos", "fake-tool");
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      join(packageDir, "package.json"),
      `${JSON.stringify(
        {
          name: "@moneyos/fake-tool",
          version: "1.2.3",
          type: "module",
          exports: "./index.js",
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      join(packageDir, "index.js"),
      `export const moneyosCliTool = {
  version: 1,
  name: "fake",
  commandPath: ["fake"],
  description: "Fake tool",
  createCommand(ctx) {
    return new ctx.Command("fake").action(async () => {});
  }
};
`,
    );

    const manager = createCliToolManager({
      paths,
      cliContext: {
        Command,
        getRuntime: vi.fn(),
      },
    });

    const program = createProgram({ toolManager: manager });
    expect(program.commands.map((command) => command.name())).toContain("fake");
    await expect(
      program.parseAsync(["node", "moneyos", "fake"]),
    ).resolves.toBe(program);
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
    const moduleLoader = async (paths: ToolHomePaths, packageName: string) => {
      onLoad();
      return harness.moduleLoader(paths, packageName);
    };

    const manager = createCliToolManager({
      paths: harness.paths,
      packageManager: harness.packageManager,
      moduleLoader,
      cliContext: {
        Command,
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

  it("runtime errors from installed tool commands pass through unwrapped", async () => {
    const harness = registerHarness({
      "@moneyos/swap": {
        version: "0.1.0",
        cliTool: createFakeCliTool({
          name: "swap",
          commandPath: ["swap"],
          onInvoke: async () => {
            throw new Error("insufficient funds");
          },
        }),
      },
    });

    const manager = createCliToolManager({
      paths: harness.paths,
      packageManager: harness.packageManager,
      moduleLoader: harness.moduleLoader,
      cliContext: {
        Command,
        getRuntime: vi.fn(),
      },
    });

    await manager.addTool("swap");

    const program = createProgram({ toolManager: manager });

    const error = await program
      .parseAsync(["node", "moneyos", "swap", "1", "USDC", "ETH"])
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("insufficient funds");
    expect((error as Error).message).not.toMatch(/Installed tool swap is broken/i);
  });

  it("load errors while invoking installed tool commands are wrapped with repair guidance", async () => {
    const harness = registerHarness({
      "@moneyos/swap": {
        version: "0.1.0",
        cliTool: createFakeCliTool({
          name: "swap",
          commandPath: ["swap"],
        }),
      },
    });
    const moduleLoader = async () => {
      throw new Error("missing compiled entrypoint");
    };

    const manager = createCliToolManager({
      paths: harness.paths,
      packageManager: harness.packageManager,
      moduleLoader,
      cliContext: {
        Command,
        getRuntime: vi.fn(),
      },
    });

    writeFileSync(
      harness.paths.registryPath,
      `${JSON.stringify([
        {
          packageName: "@moneyos/swap",
          packageVersion: "0.1.0",
          toolVersion: 1,
          name: "swap",
          commandPath: ["swap"],
          description: "Swap tokens",
        },
      ], null, 2)}\n`,
    );

    const program = createProgram({ toolManager: manager });

    await expect(
      program.parseAsync(["node", "moneyos", "swap", "1", "USDC", "ETH"]),
    ).rejects.toThrow(
      /Installed tool swap is broken: missing compiled entrypoint\. Run `moneyos add @moneyos\/swap` to repair it or `moneyos remove @moneyos\/swap` to uninstall it\./i,
    );
  });

  it("createCommand failures are treated as broken installed tools", async () => {
    const harness = registerHarness({
      "@moneyos/swap": {
        version: "0.1.0",
        cliTool: createFakeCliTool({
          name: "swap",
          commandPath: ["swap"],
          onCreate: () => {
            throw new Error("invalid tool wiring");
          },
        }),
      },
    });

    const manager = createCliToolManager({
      paths: harness.paths,
      packageManager: harness.packageManager,
      moduleLoader: harness.moduleLoader,
      cliContext: {
        Command,
        getRuntime: vi.fn(),
      },
    });

    await manager.addTool("swap");

    const program = createProgram({ toolManager: manager });

    await expect(
      program.parseAsync(["node", "moneyos", "swap", "1", "USDC", "ETH"]),
    ).rejects.toThrow(
      /Installed tool swap is broken: invalid tool wiring\. Run `moneyos add @moneyos\/swap` to repair it or `moneyos remove @moneyos\/swap` to uninstall it\./i,
    );
  });

  it("mounts nested command paths under shared parent groups", async () => {
    const onInvoke = vi.fn();
    const harness = registerHarness({
      "@sebbank/moneyos-bank": {
        version: "1.0.0",
        cliTool: createFakeCliTool({
          name: "seb",
          commandPath: ["bank", "seb"],
          onInvoke,
        }),
      },
    });

    const manager = createCliToolManager({
      paths: harness.paths,
      packageManager: harness.packageManager,
      moduleLoader: harness.moduleLoader,
      cliContext: {
        Command,
        getRuntime: vi.fn(),
      },
    });

    await manager.addTool("@sebbank/moneyos-bank");

    const program = createProgram({ toolManager: manager });
    const bankCommand = program.commands.find((command) => command.name() === "bank");

    expect(bankCommand?.commands.map((command) => command.name())).toContain("seb");

    await program.parseAsync(["node", "moneyos", "bank", "seb", "accounts"]);

    expect(onInvoke).toHaveBeenCalledWith("accounts");
  });

  it("help output from an installed tool does not fail the root cli", async () => {
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
        Command,
        getRuntime: vi.fn(),
      },
    });

    process.exitCode = undefined;
    await manager.addTool("swap");

    const program = createProgram({ toolManager: manager });
    await program.parseAsync(["node", "moneyos", "swap", "--help"]);

    expect(process.exitCode).toBeUndefined();
  });

  it("invoking a broken installed tool surfaces the repair guidance", async () => {
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
        Command,
        getRuntime: vi.fn(),
      },
    });

    await manager.addTool("swap");
    harness.installed.set("@moneyos/swap", {
      packageName: "@moneyos/swap",
      packageVersion: "0.2.0",
      cliTool: createFakeCliTool({
        name: "swap",
        commandPath: ["swap"],
      }),
    });

    const program = createProgram({ toolManager: manager });

    await expect(
      program.parseAsync(["node", "moneyos", "swap", "1", "USDC", "ETH"]),
    ).rejects.toThrow(/Run `moneyos add @moneyos\/swap` to repair it/i);
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
    const moduleLoader = async () => {
      throw new Error("Package @moneyos/broken-tool does not export `moneyosCliTool`.");
    };

    const manager = createCliToolManager({
      paths: harness.paths,
      packageManager: harness.packageManager,
      moduleLoader,
      cliContext: {
        Command,
        getRuntime: vi.fn(),
      },
    });

    await expect(manager.addTool("@moneyos/broken-tool")).rejects.toThrow(
      /does not export `moneyosCliTool`/i,
    );
    expect(manager.getRegistryEntries()).toEqual([]);
  });

  it("invalid moneyosCliTool exports fail install cleanly", async () => {
    const harness = registerHarness({
      "@moneyos/invalid-tool": {
        version: "0.1.0",
        cliTool: {},
      },
    });
    const moduleLoader = async () => ({
      packageName: "@moneyos/invalid-tool",
      packageVersion: "0.1.0",
      cliTool: {
        version: 1,
        name: "invalid",
        commandPath: ["bad path"],
        description: "Invalid command path",
      },
    });

    const manager = createCliToolManager({
      paths: harness.paths,
      packageManager: harness.packageManager,
      moduleLoader,
      cliContext: {
        Command,
        getRuntime: vi.fn(),
      },
    });

    await expect(manager.addTool("@moneyos/invalid-tool")).rejects.toThrow(
      /exports an invalid `moneyosCliTool`/i,
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
    const moduleLoader = async () => {
      throw new Error(
        "Package @moneyos/versioned-tool exports unsupported moneyosCliTool.version 2. Expected 1.",
      );
    };

    const manager = createCliToolManager({
      paths: harness.paths,
      packageManager: harness.packageManager,
      moduleLoader,
      cliContext: {
        Command,
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
      Command,
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

  it("listTools reports registry conflicts and broken installs without crashing", async () => {
    const harness = registerHarness({
      "@moneyos/swap": {
        version: "0.1.0",
        cliTool: createFakeCliTool({
          name: "swap",
          commandPath: ["swap"],
        }),
      },
      "@sebbank/moneyos-bank": {
        version: "1.0.0",
        cliTool: createFakeCliTool({
          name: "seb",
          commandPath: ["bank", "seb"],
        }),
      },
    });

    const manager = createCliToolManager({
      paths: harness.paths,
      packageManager: harness.packageManager,
      moduleLoader: harness.moduleLoader,
      cliContext: {
        Command,
        getRuntime: vi.fn(),
      },
    });

    writeFileSync(
      harness.paths.registryPath,
      `${JSON.stringify(
        [
          {
            packageName: "@moneyos/swap",
            packageVersion: "0.1.0",
            toolVersion: 1,
            name: "swap",
            commandPath: ["swap"],
            description: "Swap tokens",
          },
          {
            packageName: "@moneyos/swap-route",
            packageVersion: "0.1.0",
            toolVersion: 1,
            name: "swap-route",
            commandPath: ["swap", "route"],
            description: "Nested swap route",
          },
          {
            packageName: "@sebbank/moneyos-bank",
            packageVersion: "1.0.0",
            toolVersion: 1,
            name: "seb",
            commandPath: ["bank", "seb"],
            description: "SEB bank",
          },
        ],
        null,
        2,
      )}\n`,
    );

    const tools = await manager.listTools();

    expect(tools).toEqual([
      expect.objectContaining({
        packageName: "@sebbank/moneyos-bank",
        state: "broken",
      }),
      expect.objectContaining({
        packageName: "@moneyos/swap",
        state: "conflict",
      }),
      expect.objectContaining({
        packageName: "@moneyos/swap-route",
        state: "conflict",
      }),
    ]);
  });

  it("formats tool status tables for empty and problematic registries", () => {
    expect(formatToolStatusTable([])).toBe("No tools installed.");
    expect(
      formatToolStatusTable([
        {
          packageName: "@moneyos/swap",
          packageVersion: "0.1.0",
          toolVersion: 1,
          name: "swap",
          commandPath: ["swap"],
          description: "Swap tokens",
          state: "broken",
          problems: ["installed metadata does not match registry"],
        },
      ]),
    ).toContain("installed metadata does not match registry");
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
    const moduleLoader = async () => {
      onLoad();
      throw new Error("broken tool");
    };

    const manager = createCliToolManager({
      paths: harness.paths,
      packageManager: harness.packageManager,
      moduleLoader,
      cliContext: {
        Command,
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

  it("malformed tool registries do not crash root cli startup", () => {
    const harness = registerHarness({});
    const manager = createCliToolManager({
      paths: harness.paths,
      packageManager: harness.packageManager,
      moduleLoader: harness.moduleLoader,
      cliContext: {
        Command,
        getRuntime: vi.fn(),
      },
    });

    writeFileSync(harness.paths.registryPath, "{}\n");

    expect(() => createProgram({ toolManager: manager })).not.toThrow();
  });
});
