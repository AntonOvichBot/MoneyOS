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
        // Re-export/type-only facades are exercised through the concrete sources
        // they expose; covering the shim files themselves adds no signal.
        "src/core/runtime.ts",
        "src/core/tokens.ts",
        "src/core/types.ts",
      ],
      thresholds: {
        statements: 75,
        branches: 80,
        functions: 86,
        lines: 75,
      },
    },
  },
});
