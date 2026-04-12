import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      all: true,
      reporter: ["text", "json-summary", "lcov"],
      include: ["src/**/*.ts"],
      exclude: [
        "test/**",
        "dist/**",
        "coverage/**",
        "src/cli/index.ts",
        "src/core/runtime.ts",
        "src/core/tokens.ts",
        "src/core/types.ts",
      ],
      thresholds: {
        statements: 72.8,
        branches: 78.6,
        functions: 86,
        lines: 72.8,
      },
    },
  },
});
