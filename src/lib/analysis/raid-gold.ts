import {
  adjustmentGold,
  adjustmentsFor,
  applyAdjustments,
} from "@/lib/analysis/consumable-adjustments";
import { compareText } from "@/lib/sort";
import { costPerUseMap, effectivePrice, goldOfBreakdown } from "@/lib/wcl/consumable-prices";
import { baseConsumableName } from "@/lib/wcl/consumables";
import type {
  ConsumableAdjustment,
  ConsumablePrice,
  PetSpendView,
  RaiderUsage,
} from "@/lib/types";

/**
 * What one raid night cost, per raider — the third of the three pricing sites.
 *
 * The other two are `goldPerRaid` in `comparison.ts` (a raider's career) and
 * `summarizeSeason` in `season.ts` (a phase). All three apply the same rules to
 * different inputs at different scopes, and change-chains §5 is the standing
 * warning: **a rule added to one makes the same raid night read two different
 * ways** on the raid page and the career page, and nothing catches that but a
 * test which compares them.
 *
 * This lived in `logs/page.tsx` until it moved here, which is why the plan's A4
 * could not be written: two of the three sites were in `src/lib` and the third
 * was inside a server component, where nothing could call it. Moving it changed
 * no arithmetic — `raid-gold.test.ts` pins the old expression alongside the new.
 */

export interface RaidGoldRow {
  name: string;
  /* Optional exactly as on RaiderUsage: a logged name the roster cannot place
     has neither, and still spent gold. */
  slug?: string;
  className?: string;
  /** Gold spent on consumables used during pulls. */
  inFight: number;
  /** Gold spent on what they turned up with — flasks, food, weapon buffs. */
  prep: number;
  /** Both breakdowns merged, as the log reported them, before any correction. */
  logged: { name: string; count: number }[];
}

export interface RankedRaider {
  row: RaidGoldRow;
  /** In-fight + prep + whatever the officer's corrections add or remove. */
  total: number;
  /** How many corrections stand against this raider tonight. */
  adjusted: number;
}

export interface RaidGoldView {
  /** Gold per single use, by the label a breakdown line carries. */
  costPerUse: Record<string, number>;
  /** True while nobody has priced this raid — the tables say so on screen. */
  usingDefault: boolean;
  /** One row per ITEM for the price panel, deduped past the pet suffix. */
  priceRows: { name: string; price: ConsumablePrice }[];
  /** Highest spender first; a raider who spent nothing and was not corrected is out. */
  ranked: RankedRaider[];
}

/**
 * Every consumable name this raid has to hold a price for.
 *
 * Wider than "what was used in a pull", and each addition is a bug that was
 * live once:
 *
 * - **prep breakdowns**, or a flask costs nothing;
 * - **hand-added corrections**, because an officer can add a consumable nobody
 *   was logged using, and it still costs gold;
 * - **pet lines**, for a scroll only ever seen on a pet — by definition it
 *   reached no breakdown above, so leaving it out prices it at zero, which is
 *   exactly the silence the pet card exists to break. It also puts the name in
 *   the price panel, where the officer can give it this week's real price.
 */
export function pricedNames(
  usage: RaiderUsage[],
  petSpend: PetSpendView,
  adjustments: ConsumableAdjustment[],
): Set<string> {
  const names = new Set<string>();
  for (const u of usage) {
    for (const b of u.itemBreakdown) names.add(b.name);
    for (const b of u.prepBreakdown) names.add(b.name);
  }
  for (const a of adjustments) names.add(a.name);
  for (const row of petSpend.rows) for (const line of row.lines) names.add(line.name);
  return names;
}

/**
 * The gold tab: prices, the price panel's rows, and the ranking.
 *
 * The ranking is built against the **saved** corrections and handed over in
 * that order. `GoldTable` re-prices as the officer presses ±, but deliberately
 * does not re-sort — a batch of corrections would otherwise reshuffle the table
 * mid-edit — so the order is only ever as fresh as the last save. That is the
 * point; see the note in that component.
 */
export function raidGoldView(
  usage: RaiderUsage[],
  petSpend: PetSpendView,
  overrides: Record<string, ConsumablePrice>,
  adjustments: ConsumableAdjustment[],
): RaidGoldView {
  const names = pricedNames(usage, petSpend, adjustments);
  const costPerUse = costPerUseMap(names, overrides);

  /*
   * One row per item, not per line label. A pet's scroll is listed apart in the
   * breakdowns so it can be counted and corrected apart, but it is the same
   * scroll at the same price — two rows here would let one raid hold two prices
   * for it.
   */
  const priceRows = [...new Set([...names].map(baseConsumableName))]
    .sort()
    .map((name) => ({ name, price: effectivePrice(name, overrides) }));

  const ranked = usage
    .map((u) => {
      const inFight = goldOfBreakdown(u.itemBreakdown, costPerUse);
      const prep = goldOfBreakdown(u.prepBreakdown, costPerUse);
      /*
       * Both breakdowns merged for the "includes" column. The logged usage and
       * prep columns stay as the log reported them, so the adjustment column
       * shows exactly what a person changed rather than hiding it inside a
       * bigger number.
       */
      const logged = [...u.itemBreakdown, ...u.prepBreakdown];
      const mine = adjustmentsFor(adjustments, u.name);
      const delta = adjustmentGold(logged, applyAdjustments(logged, mine), costPerUse);
      return {
        row: { name: u.name, slug: u.slug, className: u.className, inFight, prep, logged },
        total: inFight + prep + delta,
        adjusted: mine.length,
      };
    })
    // A raider who spent nothing and was corrected about nothing is not a row.
    // One who was corrected TO zero still is — somebody made that decision.
    .filter((x) => x.total > 0 || x.adjusted > 0)
    .sort((a, b) => b.total - a.total || compareText(a.row.name, b.row.name));

  return { costPerUse, usingDefault: Object.keys(overrides).length === 0, priceRows, ranked };
}

/**
 * Prices for the consumable leaderboard, which is a narrower question.
 *
 * Items used this raid — trash included — and nothing else: the leaderboard
 * ranks what was *consumed*, so a flask somebody turned up wearing is not one
 * of its rows and its price is not one of these.
 */
export function leaderboardPrices(
  usage: RaiderUsage[],
  overrides: Record<string, ConsumablePrice>,
): { costPerUse: Record<string, number>; usingDefault: boolean } {
  const names = new Set(usage.flatMap((u) => u.itemBreakdown.map((b) => b.name)));
  return {
    costPerUse: costPerUseMap(names, overrides),
    usingDefault: Object.keys(overrides).length === 0,
  };
}
