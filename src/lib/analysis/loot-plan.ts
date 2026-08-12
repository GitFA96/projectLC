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

import { TBC_RAIDS } from "@/lib/constants/wow";
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
  itemId: number;
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
}

export interface LootPlanBoss {
  boss: string;
  items: LootPlanItem[];
  /** Items with somebody still waiting — the ones worth reading out. */
  contestedCount: number;
}

export interface LootPlan {
  zone: string;
  bosses: LootPlanBoss[];
  contestedCount: number;
  servedCount: number;
  unwantedCount: number;
}

/** Loose match, because apostrophes differ between sources. */
const loose = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Boss order for a zone, from the curated raid list. Anything the list doesn't
 * name keeps its own order after the ones it does — a missing boss is visible
 * and harmless rather than dropped.
 */
function bossOrderFor(zone: string): Map<string, number> {
  const raid = TBC_RAIDS.find((r) => loose(r.name) === loose(zone));
  return new Map((raid?.bosses ?? []).map((b, i) => [loose(b), i]));
}

export interface LootPlanEntry {
  item: Item;
  contention: ItemContention;
}

/**
 * Build the plan for one zone.
 *
 * `entries` is every item the cache attributes to the zone, with its contention
 * already computed — this module does no lookups of its own, which is what
 * keeps it pure and keeps it agreeing with the item page.
 */
export function buildLootPlan(zone: string, entries: LootPlanEntry[]): LootPlan {
  const order = bossOrderFor(zone);

  const items: LootPlanItem[] = entries.map(({ item, contention }) => {
    const open = contention.wishers.filter((w) => !w.satisfied);
    const status: LootPlanStatus =
      contention.wishers.length === 0 ? "unwanted" : open.length === 0 ? "served" : "contested";
    return {
      itemId: item.id,
      name: contention.itemName,
      quality: item.quality,
      icon: item.icon,
      slot: item.slot ?? undefined,
      boss: item.source?.boss,
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
    };
  });

  const byBoss = new Map<string, LootPlanItem[]>();
  for (const item of items) {
    // The cache doesn't know every drop's boss. Those still belong in the plan
    // — the raid will still see them — so they group under one heading rather
    // than being dropped for the sin of an incomplete import.
    const key = item.boss ?? "";
    byBoss.set(key, [...(byBoss.get(key) ?? []), item]);
  }

  const bosses: LootPlanBoss[] = [...byBoss]
    .map(([boss, list]) => ({
      boss,
      // Contested first and most-contested at the top: that is the order an
      // officer reads them out in, and the served/unwanted tail is reference.
      items: list.sort(
        (a, b) =>
          rankOfStatus(a.status) - rankOfStatus(b.status) ||
          b.openCount - a.openCount ||
          compareText(a.name, b.name),
      ),
      contestedCount: list.filter((i) => i.status === "contested").length,
    }))
    .sort((a, b) => {
      const ai = order.get(loose(a.boss)) ?? Number.MAX_SAFE_INTEGER;
      const bi = order.get(loose(b.boss)) ?? Number.MAX_SAFE_INTEGER;
      // Unattributed drops sit last, whatever they are called.
      if (a.boss === "") return 1;
      if (b.boss === "") return -1;
      return ai - bi || compareText(a.boss, b.boss);
    });

  return {
    zone,
    bosses,
    contestedCount: items.filter((i) => i.status === "contested").length,
    servedCount: items.filter((i) => i.status === "served").length,
    unwantedCount: items.filter((i) => i.status === "unwanted").length,
  };
}

function rankOfStatus(status: LootPlanStatus): number {
  return status === "contested" ? 0 : status === "served" ? 1 : 2;
}
