import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getSqliteRepo } from "@/lib/data/sqlite-repo";
import { dropWrites } from "./drops";
import { gearWrites } from "./gear";
import { governanceWrites } from "./governance";
import { guildWrites } from "./guild";
import { itemWrites } from "./items";
import { lootWrites } from "./loot";
import { plannerWrites } from "./planner";
import { priorityWrites } from "./priority";
import { readMethods } from "./reads";
import { rosterWrites } from "./roster";
import { wclWrites } from "./wcl";

/**
 * That the repo is assembled from these files and only these files.
 *
 * B4 split one 1,500-line object literal into ten, and a spread hides the one
 * mistake that split can make. TypeScript is happy to spread two objects that
 * both define `setGuildPolicy`; the later one wins and the earlier is dead
 * code, callable from nowhere, still passing its own tests. A method that goes
 * *missing* is loud — `getSqliteRepo(): WriteRepo` will not compile — but a
 * method defined twice is silent, and the copy that loses can be the one
 * somebody just edited.
 *
 * `write-contract.test.ts` asks whether every write bumps `data_version`; this
 * asks whether the write that runs is the one you were reading.
 */

const MODULES: Record<string, object> = {
  gear: gearWrites,
  roster: rosterWrites,
  loot: lootWrites,
  drops: dropWrites,
  priority: priorityWrites,
  items: itemWrites,
  wcl: wclWrites,
  planner: plannerWrites,
  governance: governanceWrites,
  guild: guildWrites,
};

describe("the write modules", () => {
  it("define no method twice", () => {
    const homes = new Map<string, string[]>();
    for (const [file, methods] of Object.entries(MODULES)) {
      for (const name of Object.keys(methods)) {
        homes.set(name, [...(homes.get(name) ?? []), file]);
      }
    }
    const shared = [...homes]
      .filter(([, files]) => files.length > 1)
      .map(([name, files]) => `${name}: ${files.join(", ")}`)
      .sort();
    expect(
      shared,
      "Two files define the same write. getSqliteRepo() spreads them in order, so one of the " +
        "two is dead — and nothing else says which. Delete the copy that lost.",
    ).toEqual([]);
  });

  it("shadow none of the reads", () => {
    // Writes are spread after `readMethods`, so a name collision replaces a
    // read with a write of the same name and every page reading it changes.
    // `satisfies Partial<Writes>` refuses this at compile time; this is the
    // same claim at run time, for the day that clause is loosened.
    const reads = new Set(Object.keys(readMethods));
    const collisions = Object.values(MODULES)
      .flatMap((m) => Object.keys(m))
      .filter((name) => reads.has(name))
      .sort();
    expect(collisions, "a write module redefines a method that reads.ts already provides").toEqual(
      [],
    );
  });

  it("are the whole repo — the root composes and defines nothing", () => {
    // Identity, not names: a method written inline at the root under a name a
    // module already owns keeps every name list matching, and is exactly the
    // edit that would make a module's copy dead without saying so.
    const composed = getSqliteRepo() as unknown as Record<string, unknown>;
    const source = new Map<string, unknown>();
    for (const from of [readMethods, ...Object.values(MODULES)]) {
      for (const [name, fn] of Object.entries(from)) source.set(name, fn);
    }
    const names = Object.keys(composed);
    expect(names.length, "the repo lost most of its surface, or this stopped reading it").toBeGreaterThan(100);
    expect(
      names.filter((n) => composed[n] !== source.get(n)).sort(),
      "getSqliteRepo() is handing out a method that is not the one its module defines. The root " +
        "composes; a method written there answers instead of the file somebody will go and edit.",
    ).toEqual([]);
    expect([...source.keys()].filter((n) => !(n in composed)).sort()).toEqual([]);
  });
});

describe("nothing reaches past the composition root", () => {
  /*
   * `getSqliteRepo()` is the surface. A page or an action importing
   * `sqlite-repo/loot` directly would get the writes without the reads and
   * without the doc that says what a write owes the caches — and would keep
   * working, which is why this is a test rather than a convention.
   *
   * `src/lib/auth/enforcement.test.ts` and A5's lint rules decide who may
   * import the data layer at all. This decides which of its doors they use.
   */
  it("is imported only by sqlite-repo.ts and its own siblings", () => {
    const root = path.resolve(__dirname, "../../../..");
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
        if (rel === "src/lib/data/sqlite-repo.ts") continue;
        if (rel.startsWith("src/lib/data/sqlite-repo/")) continue;
        if (/from "[^"]*sqlite-repo\/[^"]+"/.test(readFileSync(full, "utf8"))) offenders.push(rel);
      }
    }
    expect(
      offenders.sort(),
      "import getSqliteRepo() from @/lib/data/sqlite-repo instead — a domain file on its own is " +
        "half a repo",
    ).toEqual([]);
  });
});
