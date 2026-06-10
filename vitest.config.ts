import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: ".",
    include: ["test/**/*.test.ts"],
    // E2E suite launches real Chrome — opt in with: npx vitest run --config vitest.e2e.config.ts
    exclude: ["**/node_modules/**", "test/e2e/**"],
    globals: true,
  },
});
