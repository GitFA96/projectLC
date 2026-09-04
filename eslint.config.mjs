import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * The layer boundaries in `AGENTS.md`, as lint rather than as prose.
 *
 * `src/lib/docs.test.ts` already proves `src/lib/analysis` imports nothing from
 * the data layer, and that test stays — but it only covers one direction of one
 * layer, and it only speaks at test time. These rules cover the other two
 * directions and fail in the editor, before anything is run.
 *
 * Each group names the *reason*, because a boundary whose message is "not
 * allowed" teaches nobody why and gets an eslint-disable comment instead.
 */
const dataLayer = {
  group: ["@/lib/data/*", "!@/lib/data/repo"],
  message:
    "Pages and actions talk to @/lib/data/repo only — getRepo() / getWriteRepo() pick " +
    "the backend, and the read model serves the reads. Reaching past it couples this " +
    "file to SQLite and skips the version bump every write owes. See src/app/AGENTS.md.",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  {
    /*
     * The purity rule this layer's whole testability rests on. No data layer
     * (it would drag SQLite into every scoring test), no `next/*` (a scoring
     * function that reads a cookie or a request stops being a function of its
     * arguments), and no Warcraft Logs client — analysis takes what it needs as
     * arguments, policy included.
     */
    files: ["src/lib/analysis/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/data", "@/lib/data/*"],
              message:
                "src/lib/analysis is pure: read model in, view model out. Take what you " +
                "need as an argument (policy defaults to DEFAULT_POLICY) — importing the " +
                "data layer here is what makes this layer untestable without a database.",
            },
            {
              group: ["next", "next/*", "@/lib/wcl/client"],
              message:
                "src/lib/analysis does no I/O and knows nothing about a request. Pass " +
                "time, the viewer and fetched data in; never reach for them here.",
            },
          ],
        },
      ],
    },
  },

  {
    /*
     * A component that imports the data layer is either fetching (which server
     * components do, one level up) or borrowing a type from the wrong place.
     * It was the second one, once: `AccountRow` lived beside its query and is
     * now in `types.ts` where the other view models are.
     */
    files: ["src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/data", "@/lib/data/*"],
              message:
                "Components receive data as props — the page fetches. For a type, import " +
                "from @/lib/types; a view model that lives beside its query is how the " +
                "data layer ends up in the client bundle.",
            },
          ],
        },
      ],
    },
  },

  {
    files: ["src/app/**/*.{ts,tsx}"],
    rules: { "no-restricted-imports": ["error", { patterns: [dataLayer] }] },
  },

  {
    /*
     * The documented exception, pinned to the files that actually hold it.
     *
     * Accounts, sessions, memberships, ownership and break-glass sit **outside
     * the read model** on purpose (`src/lib/data/AGENTS.md`): they are not guild
     * data, they change on every login, and routing them through the repo would
     * either duplicate rules that exist in exactly one place or make the repo a
     * passthrough pretending to own them.
     *
     * Listing the files rather than a directory glob is the point — this is a
     * pin, not a hole. A new file that reaches for `db.ts` fails lint until
     * somebody adds it here on purpose, which is a decision worth making out
     * loud. Anything that is ordinary guild data does not belong on this list.
     */
    files: [
      "src/app/api/auth/discord/callback/route.ts",
      "src/app/guild-actions.ts",
      "src/app/roster/members/actions.ts",
      "src/app/service/break-glass-actions.ts",
      "src/app/service/page.tsx",
      "src/app/service/tenancy/actions.ts",
      "src/app/service/tenancy/page.tsx",
      "src/app/succession-actions.ts",
    ],
    rules: { "no-restricted-imports": "off" },
  },

  {
    // A test legitimately reaches for a concrete backend — that is how the
    // migration and write-contract tests build a throwaway database at all.
    files: ["**/*.test.{ts,tsx}"],
    rules: { "no-restricted-imports": "off" },
  },

  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    // Where NEXT_DIST_DIR sends a build when the dev server owns .next.
    ".next-build/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
