import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guards for the claims the agent docs make about the code.
 *
 * Documentation rots silently — that's what makes it worse than no
 * documentation. These tests convert the *structural* claims in AGENTS.md and
 * docs/change-chains.md into failures, so a change that invalidates a doc is
 * caught by the same run that catches a broken function.
 *
 * They deliberately don't check prose. A claim earns a test here only if it is
 * mechanically decidable AND its being wrong would mislead someone into an
 * incomplete change. When one of these fails, fix the doc — or, if the doc was
 * right and the code drifted, fix the code.
 */

const root = fileURLToPath(new URL("../..", import.meta.url));

function walk(dir: string, match: (f: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git" || entry === ".next") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, match));
    else if (match(entry)) out.push(full);
  }
  return out;
}

const rel = (p: string) => path.relative(root, p).replace(/\\/g, "/");

describe("agent docs — links", () => {
  const docs = [
    ...walk(path.join(root, "src"), (f) => f === "AGENTS.md"),
    ...walk(path.join(root, "docs"), (f) => f.endsWith(".md")),
    path.join(root, "AGENTS.md"),
    path.join(root, "README.md"),
  ];

  it("every doc that should exist does", () => {
    expect(docs.length).toBeGreaterThan(5);
  });

  it("resolves every relative link", () => {
    const broken: string[] = [];
    for (const doc of docs) {
      const body = readFileSync(doc, "utf8");
      for (const [, target] of body.matchAll(/\]\(([^)]+)\)/g)) {
        if (/^(https?:|#|mailto:)/.test(target)) continue;
        const resolved = path.resolve(path.dirname(doc), target.split("#")[0]);
        if (!existsSync(resolved)) broken.push(`${rel(doc)} → ${target}`);
      }
    }
    expect(broken).toEqual([]);
  });
});

describe("agent docs — the directory map in AGENTS.md", () => {
  const rootDoc = readFileSync(path.join(root, "AGENTS.md"), "utf8");

  it("names only directories that exist and carry their own AGENTS.md", () => {
    // The routing table rows look like: | `src/lib/data/` | schema, … |
    const listed = [...rootDoc.matchAll(/^\|\s*`(src\/[^`]+)`\s*\|/gm)].map((m) => m[1]);
    expect(listed.length).toBeGreaterThan(0);

    const missing = listed.filter((dir) => !existsSync(path.join(root, dir, "AGENTS.md")));
    expect(missing).toEqual([]);
  });

  it("lists every directory AGENTS.md that exists", () => {
    // A directory guide nobody is routed to is a guide nobody reads.
    const onDisk = walk(path.join(root, "src"), (f) => f === "AGENTS.md")
      .map((p) => `${rel(path.dirname(p))}/`)
      .sort();
    const listed = [...rootDoc.matchAll(/^\|\s*`(src\/[^`]+)`\s*\|/gm)].map((m) => m[1]).sort();
    expect(listed).toEqual(onDisk);
  });
});

describe("src/lib/analysis is pure", () => {
  // Claimed by src/lib/analysis/AGENTS.md and docs/change-chains.md §7. It is
  // why this layer is testable without a database, so it's worth enforcing.
  it("imports nothing from the data layer", () => {
    const offenders = walk(path.join(root, "src/lib/analysis"), (f) => f.endsWith(".ts"))
      .filter((f) => /from "@\/lib\/data/.test(readFileSync(f, "utf8")))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  // Named in src/lib/analysis/AGENTS.md and docs/change-chains.md §7. Adding a
  // test here should make the next two fail — delete the name from all three
  // places when it does.
  const documentedExceptions = ["fairness.ts"];

  it("has a test beside every module, apart from the documented exceptions", () => {
    const dir = path.join(root, "src/lib/analysis");
    const untested = readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "AGENTS.md")
      .filter((f) => !existsSync(path.join(dir, f.replace(/\.ts$/, ".test.ts"))));

    expect(
      untested.sort(),
      "A new analysis module needs a test beside it. Write the test — don't add " +
        "the file to documentedExceptions. If you added a test for one of the " +
        "exceptions, remove it here and in src/lib/analysis/AGENTS.md.",
    ).toEqual(documentedExceptions.sort());
  });

  /*
   * The prose has to agree with the array, and until now it didn't: both
   * sentences still named `contention.ts` months after its test was written,
   * and the test above passed throughout — it pins the array against the
   * filesystem and never reads the docs that quote it. A reader who trusted
   * either sentence would have believed a tested module was untested.
   *
   * So the sentence itself is the assertion. Each doc says "… except `x.ts`",
   * and the names it lists must be exactly the ones the array exempts.
   */
  it("is described the same way in both docs that name the exceptions", () => {
    // From "except" to the first period that closes the list. `.ts` inside a
    // backticked name can't end it, and anything after the period — including
    // this file's own name — is a different sentence.
    const listed = (body: string, where: string): string[] => {
      const sentence = body.match(/except\s+((?:`[\w.-]+\.ts`(?:,\s*|\s+and\s+)?)+)\./);
      expect(sentence, `${where} no longer says which modules are exempt`).not.toBeNull();
      return [...sentence![1].matchAll(/`([\w.-]+\.ts)`/g)].map((m) => m[1]).sort();
    };

    const guide = path.join(root, "src/lib/analysis/AGENTS.md");
    const chains = path.join(root, "docs/change-chains.md");
    const want = documentedExceptions.slice().sort();
    const note =
      "A doc still names a different set of untested analysis modules than " +
      "docs.test.ts exempts. Fix the sentence — or, if a module really did lose " +
      "its test, that is the bug.";

    expect(listed(readFileSync(guide, "utf8"), rel(guide)), note).toEqual(want);
    expect(listed(readFileSync(chains, "utf8"), rel(chains)), note).toEqual(want);
  });
});

describe("consumable gold is priced in exactly the documented places", () => {
  // docs/change-chains.md §5: these three must agree, and nothing but a test
  // notices when they stop agreeing. A fourth call site means the chain in that
  // doc is now wrong — update it, then update this list.
  it("has three call sites", () => {
    const documented = [
      "src/app/logs/page.tsx",
      "src/lib/analysis/comparison.ts",
      "src/lib/analysis/season.ts",
    ];

    const callers = walk(path.join(root, "src"), (f) => /\.tsx?$/.test(f) && !f.endsWith(".test.ts"))
      .filter((f) => /\bcostPerUseMap\s*\(/.test(readFileSync(f, "utf8")))
      .map(rel)
      // The module that defines it isn't a call site.
      .filter((f) => f !== "src/lib/wcl/consumable-prices.ts")
      .sort();

    expect(
      callers,
      "Consumable gold is now priced somewhere new. Adding the file to this " +
        "list is NOT the fix — first make the new site apply the same prices " +
        "and adjustments as the others, or the same raid night will read two " +
        "different ways. Then update docs/change-chains.md §5. See docs/pitfalls.md §2.",
    ).toEqual(documented.sort());
  });
});

describe("the WCL event filter is built from the curated lists", () => {
  // docs/change-chains.md §1 — the reason adding a spell id without re-importing
  // is a silent no-op. If this stops being true, that chain needs rewriting.
  it("filters server-side by the tracked id and name lists", () => {
    const src = readFileSync(path.join(root, "src/lib/wcl/fetch-report.ts"), "utf8");
    for (const list of [
      "TRACKED_CAST_IDS",
      "SCROLL_CAST_IDS",
      "COOLDOWN_CAST_IDS",
      "SAPPER_CAST_NAMES",
      "SHAMAN_TOTEM_CASTS",
    ]) {
      expect(src, `${list} no longer feeds the server-side event filter`).toContain(list);
    }
  });

  // The inverse claim, and it is load-bearing the other way: docs/change-chains.md
  // §1 and wcl/AGENTS.md both promise that curating a dispel re-grades reports
  // imported months ago. That only holds while the Dispels fetch asks for the
  // whole stream and classification happens at read time. A filterExpression
  // here would make the promise false with nothing else failing.
  it("asks for every dispel, so the curated list can classify at read time", () => {
    const src = readFileSync(path.join(root, "src/lib/wcl/fetch-report.ts"), "utf8");
    // The whole call, verbatim: three arguments and no filter. Matching loosely
    // would also match the parameter list of `fetchAllEvents` itself, which
    // names every data type including this one.
    expect(
      src,
      "the Dispels fetch changed shape — a filter here breaks read-time classification",
    ).toContain('fetchAllEvents(code, "Dispels", reportDuration)');
  });
});

describe("per-report settings use the meta-key convention", () => {
  // docs/change-chains.md §3 lists these. A new one belongs in that table.
  it("keeps every documented key in the data layer", () => {
    const db = readFileSync(path.join(root, "src/lib/data/db.ts"), "utf8");
    const chains = readFileSync(path.join(root, "docs/change-chains.md"), "utf8");
    for (const key of [
      "consumable_prices",
      "excluded_fights",
      "consumable_adjustments",
      "gold_payback",
      "raid_board",
      "guild_roster",
    ]) {
      expect(db, `meta key ${key} vanished from db.ts`).toContain(`${key}:`);
      expect(chains, `meta key ${key} is missing from the change-chains table`).toContain(key);
    }
  });
});
