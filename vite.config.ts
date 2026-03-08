/// <reference types="vitest" />
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [solidPlugin()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    target: "esnext",
  },
  worker: {
    format: "es",
  },
  optimizeDeps: {
    exclude: ["brotli-wasm"],
  },
  assetsInclude: ["**/*.wasm"],
  test: {
    environment: "jsdom",
    globals: true,
    exclude: [
      "node_modules",
      "dist",
      "src/__tests__/integration.test.ts",
    ],
  },
});
