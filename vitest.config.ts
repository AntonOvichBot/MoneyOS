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
        statements: 69,
        branches: 78,
        functions: 81,
        lines: 69,
      },
    },
  },
});
