import type { WriteRepo } from "@/lib/data/repo";
import { getGearSetById } from "./sqlite-repo/model";
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
 * the database's data_version changes, which every mutation bumps. At guild
 * scale a full rebuild is ~1ms, so correctness wins over cleverness.
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

export { getGearSetById };
