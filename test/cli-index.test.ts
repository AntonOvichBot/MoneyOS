import { describe, expect, it } from "vitest";
import { createProgram } from "../src/cli/index.js";

describe("root cli surface", () => {
  it("does not expose the swap command", () => {
    const commandNames = createProgram().commands.map((command) => command.name());
    expect(commandNames).not.toContain("swap");
  });
});
