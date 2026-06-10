import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: ".",
    include: ["test/e2e/**/*.e2e.test.ts"],
    globals: true,
    testTimeout: 60000,
    hookTimeout: 60000,
    // Real Chrome sessions — one file at a time
    fileParallelism: false,
  },
});
