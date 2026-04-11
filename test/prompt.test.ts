import { describe, expect, it } from "vitest";
import { promptHidden } from "../src/cli/prompt.js";

describe("promptHidden", () => {
  it("refuses to run without a local tty", async () => {
    await expect(promptHidden("Wallet password: ")).rejects.toThrow(
      /local terminal/i,
    );
  });
});
