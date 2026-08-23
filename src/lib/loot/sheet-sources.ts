/**
 * Reading the priority sheet's section headings as a drop table.
 *
 * The council writes its sheet boss by boss — `### Teron Gorefiend`, then every
 * item he drops. That heading is a statement about where loot comes from, and
 * until now nothing read it as one: the sheet's parser kept it only to group
 * rows on the page, while the loot plan asked the item cache the same question
 * and got silence for 64 of the guild's own P3 drops.
 *
 * This turns one into the other. It invents nothing — a heading either names a
 * boss `TBC_RAIDS` already knows, or names a zone's trash, or yields nothing at
 * all. That last case is the important one: `items.source.zone` is what puts a
 * drop on a raid's loot plan, so a confident wrong zone is worse than a blank an
 * officer fills in by hand.
 *
 * The answer is always the raid table's **own** spelling, never the heading's.
 * A sheet that says "Kazrogal" and a cache that says "Kaz'rogal" must group
 * together, and the way to guarantee that is for neither to be the authority on
 * how the name is written.
 *
 * Pure.
 */

import { TBC_RAIDS, TRASH_BOSS, bossKey, raidOfBoss } from "@/lib/constants/wow";

/** Where a heading says its items drop. */
export interface SheetSource {
  zone: string;
  boss: string;
}

/** Zone keys are looser than boss keys — no article rule, just case and punctuation. */
const zoneKey = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The raid a trash heading belongs to.
 *
 * Headings name the raid the way people say it, which is rarely the way the
 * table spells it: "Hyjal Trash" against "Mount Hyjal", "BT Trash" against the
 * short name. So containment either way counts as a match — but **only one**
 * raid may match, or the heading is ambiguous and gets nothing. An empty key
 * matches nothing, which is what stops a bare "Trash" from claiming the first
 * raid in the table.
 */
function zoneOfTrashHeading(heading: string): string | undefined {
  const key = zoneKey(heading.replace(/\btrash\b/i, ""));
  if (!key) return undefined;
  const hits = TBC_RAIDS.filter((raid) => {
    const name = zoneKey(raid.name);
    const short = zoneKey(raid.short);
    return name === key || short === key || name.includes(key) || key.includes(name);
  });
  return hits.length === 1 ? hits[0].name : undefined;
}

/**
 * A section heading as a drop source, or nothing.
 *
 * Bosses are tried first: a heading that names one is unambiguous, whatever
 * else it contains. Only then is it read as trash, so a hypothetical boss with
 * "Trash" in his name would still be himself.
 */
export function sheetSectionSource(heading: string): SheetSource | undefined {
  const raid = raidOfBoss(heading);
  if (raid) {
    const key = bossKey(heading);
    const boss = raid.bosses.find((b) => bossKey(b) === key);
    if (boss) return { zone: raid.name, boss };
  }
  if (/\btrash\b/i.test(heading)) {
    const zone = zoneOfTrashHeading(heading);
    if (zone) return { zone, boss: TRASH_BOSS };
  }
  return undefined;
}
