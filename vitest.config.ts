/** Defines Vitest unit and opt-in integration test settings. */

import { defineConfig } from "vitest/config";

const includeIntegrationTests = Boolean(process.env.RUN_INTEGRATION_TESTS);

export default defineConfig({
  css: {
    postcss: {},
  },
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: includeIntegrationTests ? [] : ["tests/integration/**"],
    environment: "node",
    css: false,
  },
});
