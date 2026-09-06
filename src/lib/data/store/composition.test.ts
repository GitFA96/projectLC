import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadSeedStore } from "@/lib/data/seed-data";
import { MEMOIZED_VIEWS, createRepoFromStore } from "@/lib/data/store";
import { buildContext } from "./context";
import { characterViews } from "./characters";
import { dashboardView } from "./dashboard";
import { dropViews } from "./drops";
import { governanceViews } from "./governance";
import { itemViews } from "./items";
import { logViews } from "./logs";
import { lootViews } from "./loot";
import { settingViews } from "./settings";

/**
 * That the read model is assembled from these files and only these files.
 *
 * B5 split one 2,000-line closure into a context and eight view builders, and a
 * spread hides the mistake that split can make: two files may both define
 * `getDashboard`, the later one wins, and the earlier is dead code that still
 * passes every test written against it. A method that goes *missing* will not
 * compile — `createRepoFromStore(): Repo` sees to that — but a method defined
 * twice is silent, and the copy that loses can be the one somebody just edited.
 *
 * `golden-verdicts.test.ts` asks whether the numbers moved; this asks whether
 * the code producing them is the code you were reading.
 */

const MODULES: Record<string, (ctx: ReturnType<typeof buildContext>) => object> = {
  characters: characterViews,
  loot: lootViews,
  drops: dropViews,
  items: itemViews,
  logs: logViews,
  governance: governanceViews,
  dashboard: dashboardView,
  settings: settingViews,
};

const ctx = buildContext(loadSeedStore(), {});
const built = Object.fromEntries(Object.entries(MODULES).map(([k, f]) => [k, f(ctx)]));

describe("the view builders", () => {
  it("define no method twice", () => {
    const homes = new Map<string, string[]>();
    for (const [file, views] of Object.entries(built)) {
      for (const name of Object.keys(views)) homes.set(name, [...(homes.get(name) ?? []), file]);
    }
    const shared = [...homes]
      .filter(([, files]) => files.length > 1)
      .map(([name, files]) => `${name}: ${files.join(", ")}`)
      .sort();
    expect(
      shared,
      "Two files define the same view. createRepoFromStore spreads them in order, so one of the " +
        "two is dead — and nothing else says which. Delete the copy that lost.",
    ).toEqual([]);
  });

  it("are the whole repo, name for name", () => {
    // The missing direction belongs to the compiler: dropping a view from a
    // builder fails `createRepoFromStore(): Repo` with the name in the message.
    // What is checked here is the other way — a name on the repo that no
    // builder claims.
    const composed = Object.keys(createRepoFromStore(loadSeedStore(), {}));
    const claimed = new Set(Object.values(built).flatMap((v) => Object.keys(v)));
    expect(composed.length, "the repo lost most of its surface, or this stopped reading it").toBeGreaterThan(
      50,
    );
    expect(composed.filter((n) => !claimed.has(n)).sort()).toEqual([]);
    expect([...claimed].filter((n) => !composed.includes(n)).sort()).toEqual([]);
    // Every memoized name has to be a real view, or `memoizeViews` wraps
    // something that is not there and the list is a lie about the cache.
    expect([...MEMOIZED_VIEWS].filter((n) => !claimed.has(n))).toEqual([]);
  });

  it("are all the root does — it composes, and defines nothing", () => {
    /*
     * Read off the source, because the claim is about what is written rather
     * than what is reachable. A view written inline in `createRepoFromStore`
     * under a name a builder already owns leaves every name list above
     * matching, and is exactly the edit that makes a builder's copy dead
     * without saying so.
     *
     * Identity cannot make this claim: each `createRepoFromStore` call builds
     * its own context, so its methods are new closures every time.
     */
    const source = readFileSync(path.resolve(import.meta.dirname, "../store.ts"), "utf8");
    const body = /const repo: Repo = \{\n([\s\S]*?)\n {2}\};/.exec(source);
    expect(body, "createRepoFromStore no longer composes the way this test reads it").not.toBeNull();
    const strays = (body?.[1] ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "" && !/^\.\.\.[A-Za-z]+\(ctx\),$/.test(l));
    expect(
      strays,
      "createRepoFromStore holds something other than a spread of a view builder. A method " +
        "written here answers instead of the file somebody will go and edit.",
    ).toEqual([]);
  });
});

describe("the context", () => {
  it("offers only what a view names", () => {
    /*
     * `buildContext` returns the shared indexes and helpers; everything else
     * stays a closure inside it. That line is the whole reason the file is
     * readable — a helper no view calls is plumbing between two other helpers,
     * and putting it on the context invites a view to reach for it.
     *
     * Checked against the source rather than at runtime, because "is named" is
     * the claim: a member nothing mentions has already leaked.
     *
     * Only the `const { … } = ctx` lines count. Searching whole files would
     * pass a member whose sole mention is a comment — a leak with prose in
     * front of it is still a leak, and one sentence is all it would take.
     */
    const dir = path.resolve(import.meta.dirname);
    const taken = new Set(
      readdirSync(dir)
        .filter((f) => f.endsWith(".ts") && f !== "context.ts" && !f.endsWith(".test.ts"))
        .flatMap((f) => [...readFileSync(path.join(dir, f), "utf8").matchAll(/const \{([^}]*)\} = ctx;/g)])
        .flatMap((m) => m[1].split(",").map((n) => n.trim()))
        .filter(Boolean),
    );
    expect(taken.size, "no view builder destructures its context the way this test reads it").toBeGreaterThan(
      10,
    );
    const unused = Object.keys(ctx)
      .filter((name) => !taken.has(name))
      .sort();
    expect(
      unused,
      "buildContext returns something no view builder names. Leave it a closure inside " +
        "buildContext instead — the context is what the views share, not everything that exists.",
    ).toEqual([]);
  });
});

describe("nothing reaches past createRepoFromStore", () => {
  it("imports a view builder only from store.ts and its own siblings", () => {
    // A caller that imported `lootViews` directly would get the loot half of a
    // read model with none of the memoization and none of the other domains,
    // and it would work — which is why this is a test and not a convention.
    const root = path.resolve(import.meta.dirname, "../../../..");
    const offenders: string[] = [];
    const stack = [path.join(root, "src"), path.join(root, "scripts")];
    while (stack.length > 0) {
      const dir = stack.pop() as string;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
          continue;
        }
        if (!/\.(ts|tsx|mjs)$/.test(entry.name)) continue;
        const rel = path.relative(root, full).split(path.sep).join("/");
        if (rel === "src/lib/data/store.ts") continue;
        if (rel.startsWith("src/lib/data/store/")) continue;
        if (/from "[^"]*data\/store\/[^"]+"/.test(readFileSync(full, "utf8"))) offenders.push(rel);
      }
    }
    expect(
      offenders.sort(),
      "import createRepoFromStore from @/lib/data/store instead — one domain is a fraction of a " +
        "read model",
    ).toEqual([]);
  });
});
