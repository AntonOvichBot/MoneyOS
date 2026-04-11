import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { version } from "../src/cli/version.js";

type PackageJson = {
  version: string;
};

describe("cli version", () => {
  it("matches the package version", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as PackageJson;

    expect(version).toBe(packageJson.version);
  });
});
