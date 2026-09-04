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
    coverage: {
      provider: "v8",
      // `text-summary` is what you read in a terminal; `json-summary` is what
      // CI uploads and what a future ratchet would compare against.
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "coverage",
      // Coverage is only interesting where a number can be acted on. Anything
      // whose body is types, constants or wiring reports 0% or 100% for reasons
      // that have nothing to do with how well it is tested, and a directory
      // full of those drowns the layers that do matter.
      include: ["src/**/*.{ts,tsx}", "scripts/**/*.mjs"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "scripts/**/*.test.{ts,mts}",
        // Type declarations and barrels: no statements to cover.
        "src/lib/types/**",
        "src/lib/types.ts",
        "src/**/*.d.ts",
        // Next's own wiring — layouts, error boundaries, the middleware — runs
        // in a browser or an edge runtime that vitest never starts.
        "src/app/**/layout.tsx",
        "src/app/**/error.tsx",
        "src/app/**/not-found.tsx",
        "src/middleware.ts",
        "src/instrumentation.ts",
      ],
      // Thresholds cover the pure layers only, at the value measured when C1
      // landed. They ratchet up, never down: raising one is a normal part of
      // adding a test; lowering one means a module lost its cover, which is the
      // thing this is here to notice. Components are deliberately absent —
      // see docs/improvement-plan.md §C1.
      // Each number is the baseline of 5 Sep 2026, floored to the integer
      // below. A glob's files are pooled, so one thinly covered new module in a
      // well-covered directory does not fail on its own — the directory has to
      // actually get worse.
      thresholds: {
        "src/lib/analysis/**": { statements: 97, branches: 88, functions: 95, lines: 98 },
        "src/lib/auth/**": { statements: 78, branches: 68, functions: 87, lines: 80 },
        "src/lib/loot/**": { statements: 95, branches: 93, functions: 96, lines: 96 },
        "src/lib/sim/**": { statements: 83, branches: 70, functions: 83, lines: 84 },
        "src/lib/wcl/normalize.ts": {
          statements: 89,
          branches: 76,
          functions: 87,
          lines: 96,
        },
      },
    },
  },
});
