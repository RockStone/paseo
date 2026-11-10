import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Keeps the plugin's tests independent of the monorepo's root vitest.config.ts, which vitest
// would otherwise find by walking up from this directory.
export default defineConfig({
  root: fileURLToPath(new URL("../..", import.meta.url)),
  test: { include: ["server/__tests__/**/*.test.ts"], environment: "node" },
});
