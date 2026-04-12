import { describe, expect, it } from "vitest";

describe("public cli tool contract module", () => {
  it("loads without side effects", async () => {
    await expect(import("../src/cli-tool.js")).resolves.toBeTypeOf("object");
  });
});
