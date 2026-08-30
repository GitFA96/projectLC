import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    // scripts/ holds the build and deploy guards. They fail the build and gate
    // a release, so they are tested like anything else that can be wrong.
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.{ts,mts}"],
  },
});
