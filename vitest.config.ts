import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@shell": resolve(import.meta.dirname, "shell/src"),
      "@shared": resolve(import.meta.dirname, "worker/src/shared"),
    },
  },
  test: {
    environment: "jsdom",
    environmentMatchGlobs: [["worker/test/**/*.test.ts", "node"]],
    globals: true,
    include: ["worker/test/**/*.test.ts", "shell/src/**/*.test.ts"],
  },
});
