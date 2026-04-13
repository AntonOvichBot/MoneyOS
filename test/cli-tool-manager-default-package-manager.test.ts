import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

const { mockSpawn } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: mockSpawn,
}));

import { createCliToolManager } from "../src/cli/tools/manager.js";

describe("cli tool manager default npm wrappers", () => {
  let rootDir: string;
  let paths: {
    rootDir: string;
    packageJsonPath: string;
    registryPath: string;
  };

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), "moneyos-default-tool-home-"));
    paths = {
      rootDir,
      packageJsonPath: join(rootDir, "package.json"),
      registryPath: join(rootDir, "registry.json"),
    };
    writeFileSync(
      paths.packageJsonPath,
      `${JSON.stringify(
        {
          name: "moneyos-tools",
          private: true,
          dependencies: {
            "@moneyos/core": "^0.1.0",
            viem: "^2.45.1",
          },
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(paths.registryPath, "[]\n");
    mockSpawn.mockReset();
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it("uses npm install and uninstall inside the tool home", async () => {
    mockSpawn.mockImplementation((command: string, args: string[], options: { cwd?: string; stdio?: string }) => {
      const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
      child.stderr = new EventEmitter();

      queueMicrotask(() => {
        child.stderr.emit("data", "npm notice test output");
        const packageJson = JSON.parse(readFileSync(paths.packageJsonPath, "utf8")) as {
          dependencies?: Record<string, string>;
        };
        packageJson.dependencies ??= {};

        if (args[0] === "install") {
          packageJson.dependencies["@moneyos/swap"] = "0.1.0";
        } else if (args[0] === "uninstall") {
          delete packageJson.dependencies["@moneyos/swap"];
        }

        writeFileSync(paths.packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
        child.emit("close", 0);
      });

      expect(command).toBe("npm");
      expect(options).toMatchObject({
        cwd: rootDir,
        stdio: "pipe",
      });
      return child;
    });

    const manager = createCliToolManager({
      paths,
      moduleLoader: async () => ({
        packageName: "@moneyos/swap",
        packageVersion: "0.1.0",
        cliTool: {
          version: 1,
          name: "swap",
          commandPath: ["swap"],
          description: "Swap tokens",
          createCommand(ctx: { Command: typeof Command }) {
            return new ctx.Command("swap");
          },
        },
      }),
      cliContext: {
        Command,
        getRuntime: vi.fn(),
      },
    });

    await expect(manager.addTool("swap")).resolves.toMatchObject({
      packageName: "@moneyos/swap",
      packageVersion: "0.1.0",
    });
    await expect(manager.removeTool("swap")).resolves.toMatchObject({
      packageName: "@moneyos/swap",
    });

    expect(mockSpawn).toHaveBeenNthCalledWith(
      1,
      "npm",
      ["install", "--save-exact", "--no-fund", "--no-audit", "@moneyos/swap"],
      expect.objectContaining({ cwd: rootDir, stdio: "pipe" }),
    );
    expect(mockSpawn).toHaveBeenNthCalledWith(
      2,
      "npm",
      ["uninstall", "--no-fund", "--no-audit", "@moneyos/swap"],
      expect.objectContaining({ cwd: rootDir, stdio: "pipe" }),
    );
  });

  it("stages @latest inspection outside the real tool home for update --check", async () => {
    writeFileSync(
      paths.packageJsonPath,
      `${JSON.stringify(
        {
          name: "moneyos-tools",
          private: true,
          dependencies: {
            "@moneyos/core": "^0.1.0",
            viem: "^2.45.1",
            "@moneyos/swap": "0.1.0",
          },
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      paths.registryPath,
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
        ],
        null,
        2,
      )}\n`,
    );

    mockSpawn.mockImplementation((command: string, args: string[], options: { cwd?: string; stdio?: string }) => {
      const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
      child.stderr = new EventEmitter();

      queueMicrotask(() => {
        child.stderr.emit("data", "npm notice staged update check");
        if (args[0] === "install" && args[4] === "@moneyos/swap@latest") {
          const packageJsonPath = join(options.cwd!, "package.json");
          const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
            dependencies?: Record<string, string>;
          };
          packageJson.dependencies ??= {};
          packageJson.dependencies["@moneyos/swap"] = "0.2.0";
          writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
        }
        child.emit("close", 0);
      });

      expect(command).toBe("npm");
      expect(options).toMatchObject({
        stdio: "pipe",
      });
      return child;
    });

    const manager = createCliToolManager({
      paths,
      moduleLoader: async (managerPaths) => ({
        packageName: "@moneyos/swap",
        packageVersion: managerPaths.rootDir === rootDir ? "0.1.0" : "0.2.0",
        cliTool: {
          version: 1,
          name: "swap",
          commandPath: ["swap"],
          description: "Swap tokens",
          createCommand(ctx: { Command: typeof Command }) {
            return new ctx.Command("swap");
          },
        },
      }),
      cliContext: {
        Command,
        getRuntime: vi.fn(),
      },
    });

    await expect(manager.updateTools({ check: true })).resolves.toEqual([
      expect.objectContaining({
        state: "would-update",
        current: expect.objectContaining({
          packageVersion: "0.1.0",
        }),
        next: expect.objectContaining({
          packageVersion: "0.2.0",
        }),
      }),
    ]);

    expect(mockSpawn).toHaveBeenCalledOnce();
    expect(mockSpawn).toHaveBeenCalledWith(
      "npm",
      ["install", "--save-exact", "--no-fund", "--no-audit", "@moneyos/swap@latest"],
      expect.objectContaining({
        stdio: "pipe",
      }),
    );
    expect((mockSpawn.mock.calls[0] as [string, string[], { cwd?: string }])[2].cwd).not.toBe(rootDir);
    expect(
      (
        JSON.parse(readFileSync(paths.packageJsonPath, "utf8")) as {
          dependencies?: Record<string, string>;
        }
      ).dependencies?.["@moneyos/swap"],
    ).toBe("0.1.0");
  });
});
