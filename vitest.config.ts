import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    // Quietens node:sqlite's ExperimentalWarning, which every worker that opens
    // a database would otherwise print. See the file for what it does not touch.
    setupFiles: ["./vitest.setup.ts"],
    // scripts/ holds the build and deploy guards. They fail the build and gate
    // a release, so they are tested like anything else that can be wrong.
    // .claude/hooks/ holds the session guards, which refuse a command that
    // would take the dev server down or write the live database — same
    // argument: something that can say no has to be tested on when it says it.
    include: [
      "src/**/*.test.{ts,tsx}",
      "scripts/**/*.test.{ts,mts}",
      ".claude/hooks/**/*.test.mjs",
    ],
  },
});
