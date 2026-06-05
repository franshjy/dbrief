import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    pool: "threads",
    fileParallelism: false,
    maxWorkers: 1,
  },
});
