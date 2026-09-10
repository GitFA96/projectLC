import type { WriteRepo } from "@/lib/data/repo";
import { readMethods } from "./sqlite-repo/reads";
import { dropWrites } from "./sqlite-repo/drops";
import { gearWrites } from "./sqlite-repo/gear";
import { governanceWrites } from "./sqlite-repo/governance";
import { guildWrites } from "./sqlite-repo/guild";
import { itemWrites } from "./sqlite-repo/items";
import { lootWrites } from "./sqlite-repo/loot";
import { plannerWrites } from "./sqlite-repo/planner";
import { priorityWrites } from "./sqlite-repo/priority";
import { rosterWrites } from "./sqlite-repo/roster";
import { wclWrites } from "./sqlite-repo/wcl";

/**
 * SQLite-backed repository. Reads go through the same derived read model as
 * the seed backend (createRepoFromStore); the model is rebuilt lazily whenever
 * the database's data_version changes, which every mutation bumps.
 *
 * **A full rebuild is not cheap** — measured 10 Sep 2026 on this guild's own
 * database (1.8k items, 8.8k logged pull rows): ~0.9s to load and zod-parse the
 * rows, ~0.9s more for the derived views the first reader touches. Every write
 * therefore costs the *next* page load about 1.7s, and that is the deliberate
 * trade: one rebuild per write, against a read model that cannot be stale.
 * Correctness still wins, but the number is seconds, not the ~1ms this comment
 * used to claim — so **never reach for `loadStore()` to answer a question**.
 * Doing that per request is what made every page in the app take 1.5s.
 *
 * The methods live in `sqlite-repo/`, one file per domain; this composes them.
 * Nothing else may import those files — `getSqliteRepo()` is the whole surface,
 * and `repo.ts` is the boundary a page is allowed to see.
 *
 * **Every write ends `bumpDataVersion(db)` inside its transaction**, or it
 * commits to disk and stays invisible until the process restarts. The action
 * that called it then needs `refreshAfterWrite()` for Next's own cache. Two
 * caches, two silent failures — change-chains §4, and `write-contract.test.ts`
 * holds each method to it. The planner's boards are the deliberate exception
 * and say why in place.
 */
export function getSqliteRepo(): WriteRepo {
  return {
    ...readMethods,
    ...gearWrites,
    ...rosterWrites,
    ...lootWrites,
    ...dropWrites,
    ...priorityWrites,
    ...itemWrites,
    ...wclWrites,
    ...plannerWrites,
    ...governanceWrites,
    ...guildWrites,
  };
}
