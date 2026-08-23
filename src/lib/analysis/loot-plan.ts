/**
 * "Kan man lage en loot plan for alle items før raid?" — the night's drops,
 * decided before anyone is standing in front of a corpse at 22:40.
 *
 * Everything here already existed in pieces: the item cache knows what drops
 * where, the wishlists know who wants it, and contention knows who should get
 * it. What nobody could do was read all three at once, per boss, in the order
 * the raid will meet them. That is the whole feature — assembly, not new
 * judgement.
 *
 * Three answers per item, and the third is the one that saves time on the
 * night:
 *
 *   contested — open contenders, best first. Read the top two names.
 *   served    — everyone who wants it already has it. Expect a pass.
 *   unwanted  — nobody lists it at all. Decide the offspec/disenchant rule now
 *               rather than arguing about it with a raid waiting.
 *
 * The ranking is contention's, unchanged. This never re-scores anybody: a plan
 * that disagreed with the item page would be worse than no plan.
 *
 * Pure.
 */

import { TBC_RAIDS, TRASH_BOSS, bossKey } from "@/lib/constants/wow";
import type { Item, ItemContention, Quality, SlotId } from "@/lib/types";

import { compareText } from "@/lib/sort";

export interface LootPlanContender {
  characterId: string;
  name: string;
  wowClass: string;
  spec: string;
  /** 1-based among the open contenders. */
  rank?: number;
  /** The rung of the council's chain they sit on, in its own words. */
  tierLabel?: string;
  /** 0 is their BiS, 1+ a ranked fallback. */
  listRank: number;
}

export type LootPlanStatus = "contested" | "served" | "unwanted";

export interface LootPlanItem {
  /**
   * Absent for a drop only the sheet knows about. The council writes its sheet
   * in names, so a row nobody has wishlisted or won has no id anywhere — and
   * without one there is no icon, no tooltip and no item page to link to.
   */
  itemId?: number;
  name: string;
  quality?: Quality;
  icon?: string;
  slot?: SlotId;
  boss?: string;
  status: LootPlanStatus;
  /** Open contenders, best first. Empty when served or unwanted. */
  contenders: LootPlanContender[];
  /** How many are still waiting on it. */
  openCount: number;
  /** Everyone who lists it, open or not. */
  wisherCount: number;
  /** The council's written chain for this item, when the sheet covers it. */
  chain?: string;
  /** Alts who list it but don't contend, by name. */
  altWishers: string[];
  /**
   * The sheet lists this drop and the item cache has never heard of it.
   *
   * Worth saying out loud rather than folding into "nobody lists it": one is a
   * decision the council can make now, the other is a gap in the cache that a
   * backfill press closes. They look identical on the page otherwise.
   */
  sheetOnly?: boolean;
  /** The sheet's own slot wording ("Plate - Waist"), when it is all we have. */
  slotLabel?: string;
  /**
   * Set when this guild added the drop themselves — nobody else's plan has it.
   * Absent for the foundational table, which is the ordinary case and needs no
   * badge.
   */
  guildAdded?: boolean;
}

export interface LootPlanBoss {
  /** Stable identity: `bossKey`, so it survives a source spelling him differently. */
  key: string;
  boss: string;
  items: LootPlanItem[];
  /** Items with somebody still waiting — the ones worth reading out. */
  contestedCount: number;
  /**
   * How many of his drops the council has written a chain for. The plan's job
   * is to be read before a pull, and "nine of twelve covered" is the number
   * that says whether it can be.
   */
  chainCount: number;
  /** Of `items`, how many exist only on the sheet. */
  sheetOnlyCount: number;
  /**
   * The raid table names him but nothing — cache or sheet — knows a single
   * drop. Shown rather than omitted: an empty boss is a gap to go and fill,
   * and a plan that silently skipped him would read as complete.
   */
  unmapped: boolean;
  /**
   * Drops this guild has hidden from him.
   *
   * Carried even though they are, by definition, not on the plan: a hidden drop
   * has no row to un-hide from, so without this the action would be one-way and
   * an officer who hid the wrong thing would need a developer.
   */
  hidden: LootPlanHiddenDrop[];
}

export interface LootPlan {
  zone: string;
  bosses: LootPlanBoss[];
  contestedCount: number;
  servedCount: number;
  unwantedCount: number;
  /** Drop sources the raid table names that have nothing mapped to them yet. */
  unmappedCount: number;
  /** Drops the sheet names that the item cache cannot identify. */
  sheetOnlyCount: number;
}

/** Loose match, because apostrophes differ between sources. */
const loose = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Same rule the priority sheet matches item names with. */
const normalizeName = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * A zone's drop sources in the order the raid meets them, with the spelling
 * this app considers canonical.
 *
 * Keyed with `bossKey`, not this module's `loose`: the two differ on a leading
 * article, and the item cache spells Black Temple's council without one. With
 * `loose` its drops matched nothing here and sorted past Illidan.
 *
 * Trash is first and is not in `TBC_RAIDS` — that array is encounters, and a
 * log has no "Trash" fight — so it is added here, where the subject is the
 * night's drops rather than its kills.
 *
 * Anything the list doesn't name keeps its own order after the ones it does; a
 * missing boss is visible and harmless rather than dropped.
 */
function bossSpineFor(zone: string): Map<string, { order: number; label: string }> {
  const raid = TBC_RAIDS.find((r) => loose(r.name) === loose(zone));
  const spine = new Map<string, { order: number; label: string }>([
    [bossKey(TRASH_BOSS), { order: -1, label: TRASH_BOSS }],
  ]);
  (raid?.bosses ?? []).forEach((b, i) => spine.set(bossKey(b), { order: i, label: b }));
  return spine;
}

export interface LootPlanEntry {
  item: Item;
  contention: ItemContention;
  /**
   * Which boss drops it, when something better-informed than the item cache
   * knows. The drop table is the authority on boss attribution — that is what
   * makes it a drop table — and `items.source.boss` is the fallback for
   * anything it has not been told about yet.
   */
  boss?: string;
  /** This guild added it; see `LootPlanItem.guildAdded`. */
  guildAdded?: boolean;
  /**
   * What the drop table calls it, when that says more than the item's own name.
   *
   * Both Warglaives of Azzinoth ARE called "Warglaive of Azzinoth", so a plan
   * built from item names alone shows Illidan dropping the same thing twice.
   * The council's "(Main Hand)" is the only thing that tells the two rows —
   * and the two chains — apart.
   */
  displayName?: string;
}

/**
 * A drop the council's sheet names that the item cache cannot identify.
 *
 * The sheet is written in item names and most of what it lists nobody has
 * wishlisted or won, so there is no id to look anything up by. These rows are
 * the difference between "the plan shows what we have imported" and "the plan
 * shows what the boss drops" — without them an officer reads a short list and
 * has no way to tell it is short.
 */
export interface LootPlanSheetDrop {
  itemName: string;
  /** Canonical boss, already resolved from the section heading by the caller. */
  boss: string;
  chain?: string;
  slotLabel?: string;
  /** This guild added it; see `LootPlanItem.guildAdded`. */
  guildAdded?: boolean;
}

/** One drop this guild has taken off a boss. */
export interface LootPlanHiddenDrop {
  itemName: string;
  itemId?: number;
  /** Canonical boss, so restoring it names the same pair that hid it. */
  boss: string;
}

/**
 * Build the plan for one zone.
 *
 * `entries` is every item the cache attributes to the zone, with its contention
 * already computed — this module does no lookups of its own, which is what
 * keeps it pure and keeps it agreeing with the item page.
 *
 * `sheetDrops` is what the council's sheet names and the cache cannot, already
 * matched to a boss by the caller. Passing an empty array is the old behaviour.
 *
 * Every boss the raid table names appears whether or not anything maps to him.
 * That is the difference between a plan and a list of what happens to be
 * imported: an officer reading four bosses for a nine-boss raid should see the
 * five gaps, not an apparently complete page.
 */
export function buildLootPlan(
  zone: string,
  entries: LootPlanEntry[],
  sheetDrops: LootPlanSheetDrop[] = [],
  hiddenDrops: LootPlanHiddenDrop[] = [],
): LootPlan {
  const spine = bossSpineFor(zone);

  const items: LootPlanItem[] = entries.map(({ item, contention, boss, guildAdded, displayName }) => {
    const open = contention.wishers.filter((w) => !w.satisfied);
    const status: LootPlanStatus =
      contention.wishers.length === 0 ? "unwanted" : open.length === 0 ? "served" : "contested";
    return {
      itemId: item.id,
      name: displayName ?? contention.itemName,
      quality: item.quality,
      icon: item.icon,
      slot: item.slot ?? undefined,
      boss: boss ?? item.source?.boss,
      status,
      contenders: open
        .slice()
        .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
        .map((w) => ({
          characterId: w.character.id,
          name: w.character.name,
          wowClass: w.character.class,
          spec: w.character.spec,
          rank: w.rank,
          tierLabel: w.priorityTierLabel,
          listRank: w.listRank,
        })),
      openCount: open.length,
      wisherCount: contention.wishers.length,
      chain: contention.priorityRule?.chain,
      altWishers: contention.altWishers,
      guildAdded,
    };
  });

  // Sheet drops last, so a cached item always wins the name it is shown under.
  // Deduped on the name because the sheet lists an item once per section and a
  // re-paste can shadow a row (`buildPrioritySheetView` says so on its own
  // page); two identical lines on the plan would read as two drops.
  const cachedNames = new Set(items.map((i) => normalizeName(i.name)));
  for (const drop of sheetDrops) {
    const key = normalizeName(drop.itemName);
    if (cachedNames.has(key)) continue;
    cachedNames.add(key);
    items.push({
      name: drop.itemName,
      boss: drop.boss,
      // Nobody can be contending for an item no wishlist has an id for, so the
      // honest status is the same one an uncontested cached drop gets — with
      // `sheetOnly` set, because *why* nobody lists it is a different problem.
      status: "unwanted",
      contenders: [],
      openCount: 0,
      wisherCount: 0,
      chain: drop.chain,
      altWishers: [],
      sheetOnly: true,
      slotLabel: drop.slotLabel,
      guildAdded: drop.guildAdded,
    });
  }

  // Grouped by `bossKey`, never by the raw string. Two sources spelling one
  // boss differently — Wowhead's "Illidari Council" against the raid table's
  // "The Illidari Council" — would otherwise render as two cards for the same
  // pull, each showing half his drops, which is worse than either spelling.
  //
  // The heading is the raid table's wording where it has one, so the plan reads
  // in the app's own vocabulary rather than whichever import happened to land
  // first. Only a source the table doesn't know speaks for itself.
  const byBoss = new Map<string, { label: string; items: LootPlanItem[] }>();
  for (const item of items) {
    // The cache doesn't know every drop's boss. Those still belong in the plan
    // — the raid will still see them — so they group under one heading rather
    // than being dropped for the sin of an incomplete import.
    const raw = item.boss ?? "";
    const key = raw === "" ? "" : bossKey(raw);
    const group = byBoss.get(key) ?? { label: spine.get(key)?.label ?? raw, items: [] };
    group.items.push(item);
    byBoss.set(key, group);
  }

  // A boss whose only trace is a hidden drop still needs a card, or the drop
  // has nowhere to be restored from.
  const hiddenByBoss = new Map<string, LootPlanHiddenDrop[]>();
  for (const drop of hiddenDrops) {
    const key = bossKey(drop.boss);
    hiddenByBoss.set(key, [...(hiddenByBoss.get(key) ?? []), drop]);
    if (!byBoss.has(key)) {
      byBoss.set(key, { label: spine.get(key)?.label ?? drop.boss, items: [] });
    }
  }

  // Every drop source the raid table names, whether or not anything mapped to
  // it. Added after the real groups so a boss who has drops keeps them.
  //
  // Only once the zone has *something*, though. A zone nobody has imported or
  // written a sheet for is not a raid with nine gaps in it — it is a page with
  // nothing on it yet, and nine empty cards bury the one thing worth saying
  // there, which is how to fill it. `bosses` staying empty is what lets the
  // view show that instead.
  if (items.length > 0 || hiddenDrops.length > 0) {
    for (const [key, { label }] of spine) {
      if (!byBoss.has(key)) byBoss.set(key, { label, items: [] });
    }
  }

  const bosses: LootPlanBoss[] = [...byBoss]
    .map(([key, { label, items: list }]) => ({
      key,
      boss: label,
      // Contested first and most-contested at the top: that is the order an
      // officer reads them out in, and the served/unwanted tail is reference.
      // Sheet-only rows sink below cached ones of the same status: they carry
      // no icon and no contenders, so they are reference, not the read-out.
      items: list.sort(
        (a, b) =>
          rankOfStatus(a.status) - rankOfStatus(b.status) ||
          b.openCount - a.openCount ||
          Number(a.sheetOnly ?? false) - Number(b.sheetOnly ?? false) ||
          compareText(a.name, b.name),
      ),
      contestedCount: list.filter((i) => i.status === "contested").length,
      chainCount: list.filter((i) => i.chain).length,
      sheetOnlyCount: list.filter((i) => i.sheetOnly).length,
      // A boss with nothing showing but something hidden is not unmapped —
      // somebody mapped him and then took it away, which is a different state
      // and a different thing to say on the card.
      unmapped: list.length === 0 && (hiddenByBoss.get(key)?.length ?? 0) === 0,
      hidden: hiddenByBoss.get(key) ?? [],
    }))
    .sort((a, b) => {
      const ai = spine.get(a.key)?.order ?? Number.MAX_SAFE_INTEGER;
      const bi = spine.get(b.key)?.order ?? Number.MAX_SAFE_INTEGER;
      // Unattributed drops sit last, whatever they are called.
      if (a.key === "") return 1;
      if (b.key === "") return -1;
      return ai - bi || compareText(a.boss, b.boss);
    })
    ;

  return {
    zone,
    bosses,
    contestedCount: items.filter((i) => i.status === "contested").length,
    servedCount: items.filter((i) => i.status === "served").length,
    unwantedCount: items.filter((i) => i.status === "unwanted").length,
    unmappedCount: bosses.filter((b) => b.unmapped).length,
    sheetOnlyCount: items.filter((i) => i.sheetOnly).length,
  };
}

function rankOfStatus(status: LootPlanStatus): number {
  return status === "contested" ? 0 : status === "served" ? 1 : 2;
}
