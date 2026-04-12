import { defineConfig } from "tsup";

// `@moneyos/core` is now published, but the root `moneyos` package still
// bundles it so the default SDK and CLI install stay self-contained.
const noExternal = [/^@moneyos\/core(\/.*)?$/];

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: { resolve: [/^@moneyos\/core(\/.*)?$/] },
    clean: true,
    sourcemap: true,
    noExternal,
  },
  {
    entry: { "cli/index": "src/cli/index.ts" },
    format: ["esm"],
    banner: { js: "#!/usr/bin/env node" },
    sourcemap: true,
    noExternal,
  },
]);
