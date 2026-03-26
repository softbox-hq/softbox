import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  root: resolve(import.meta.dirname),
  envDir: resolve(import.meta.dirname, ".."),
  plugins: [react()],
  publicDir: resolve(import.meta.dirname, "../public"),
  server: {
    port: 4173,
  },
  build: {
    outDir: resolve(import.meta.dirname, "../dist-shell"),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@shell": resolve(import.meta.dirname, "src"),
      "@shared": resolve(import.meta.dirname, "../worker/src/shared"),
    },
  },
});
