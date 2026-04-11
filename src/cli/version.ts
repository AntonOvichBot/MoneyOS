import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const packageJsonPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../package.json",
);

type PackageJson = {
  version: string;
};

export const version = (JSON.parse(
  readFileSync(packageJsonPath, "utf8"),
) as PackageJson).version;
