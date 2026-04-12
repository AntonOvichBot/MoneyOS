import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createProgram, isEntrypointPath } from "../src/cli/index.js";

describe("root cli surface", () => {
  it("does not expose the swap command", () => {
    const commandNames = createProgram().commands.map((command) => command.name());
    expect(commandNames).not.toContain("swap");
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
