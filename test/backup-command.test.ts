import { describe, expect, it } from "vitest";
import { getBackupExportPasswordGuidance } from "../src/cli/commands/backup.js";

describe("backup export guidance", () => {
  it("states that exports reuse the wallet password", () => {
    const message = getBackupExportPasswordGuidance();

    expect(message).toMatch(/same wallet password/i);
    expect(message).toMatch(/restore/i);
    expect(message).toMatch(/does not store or sync it/i);
  });
});
