import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    // Vitest's default is 5 s, and nothing here is measuring elapsed time — the
    // slowest test in the suite takes ~350 ms on an idle machine. What that
    // default actually measures is contention: the database-backed files run
    // 4× slower under the full suite than alone, and twice now a run that was
    // ~40% slower than baseline has failed one test and passed on every rerun
    // (the name was never captured; six clean runs at baseline speed since).
    // 20 s keeps that headroom without hiding a genuine hang.
    testTimeout: 20_000,
    hookTimeout: 20_000,
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
      /*
       * Floors for the pure layers, and only those — components are
       * deliberately absent; see docs/improvement-plan.md §C1.
       *
       * Each number started as the value measured on 5 Sep 2026, floored to the
       * integer below, and ratchets up from there: raising one is a normal part
       * of adding a test, and lowering one means a layer lost cover, which is
       * the thing this exists to notice. A number here is therefore a floor,
       * never a standard — 77% of `auth`'s branches is where that layer *is*,
       * not where anyone decided it should stop.
       *
       * A glob's files are pooled, so a thinly covered new module in a
       * well-covered directory does not fail on its own; the directory has to
       * actually get worse.
       */
      thresholds: {
        "src/lib/analysis/**": { statements: 97, branches: 88, functions: 95, lines: 98 },
        "src/lib/auth/**": { statements: 86, branches: 77, functions: 90, lines: 88 },
        "src/lib/loot/**": { statements: 95, branches: 93, functions: 96, lines: 96 },
        "src/lib/sim/**": { statements: 94, branches: 82, functions: 93, lines: 96 },
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
