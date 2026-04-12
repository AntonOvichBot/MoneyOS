import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockLoadConfig,
  mockGetToolHomeDir,
  mockGetToolHomePackageJsonPath,
  mockGetToolRegistryPath,
} = vi.hoisted(() => ({
  mockLoadConfig: vi.fn(() => ({})),
  mockGetToolHomeDir: vi.fn(),
  mockGetToolHomePackageJsonPath: vi.fn(),
  mockGetToolRegistryPath: vi.fn(),
}));

vi.mock("../src/cli/config.js", () => ({
  loadConfig: mockLoadConfig,
  getToolHomeDir: mockGetToolHomeDir,
  getToolHomePackageJsonPath: mockGetToolHomePackageJsonPath,
  getToolRegistryPath: mockGetToolRegistryPath,
}));

import { createCliToolManager } from "../src/cli/tools/manager.js";

describe("cli tool manager default paths", () => {
  let rootDir: string;
  let packageJsonPath: string;
  let registryPath: string;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), "moneyos-default-paths-"));
    packageJsonPath = join(rootDir, "package.json");
    registryPath = join(rootDir, "registry.json");
    mockGetToolHomeDir.mockReturnValue(rootDir);
    mockGetToolHomePackageJsonPath.mockReturnValue(packageJsonPath);
    mockGetToolRegistryPath.mockReturnValue(registryPath);
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("creates the configured tool home when no paths are injected", () => {
    const manager = createCliToolManager();

    expect(manager.getRegistryEntries()).toEqual([]);
    expect(
      JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
        dependencies?: Record<string, string>;
      },
    ).toMatchObject({
      dependencies: {
        "@moneyos/core": "^0.1.0",
        viem: "^2.45.1",
      },
    });
  });
});
