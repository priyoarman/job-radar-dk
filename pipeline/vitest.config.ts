import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only look for tests in the test/ folder, never in src/.
    include: ["test/**/*.test.ts"],
    // Plain Node environment: the pipeline has no browser or DOM.
    environment: "node",
  },
});
