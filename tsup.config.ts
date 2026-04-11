import { defineConfig } from "tsup";

// `@moneyos/core` is an internal workspace package, not published to npm.
// We bundle it into the public `moneyos` package so installs are self-contained
// and consumers never have to know `@moneyos/core` exists.
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
