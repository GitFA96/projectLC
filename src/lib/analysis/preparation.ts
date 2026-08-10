/**
 * What "prepared" means — in one place, because it is policy.
 *
 * Two different questions were being asked with one word, and the naming had
 * drifted far enough to be actively misleading: a helper called `isPrepared`
 * tested flask-or-elixir and never looked at food, while `preparedPct` two
 * modules away meant flask-or-elixir AND food. Both were then written out
 * inline in a third and a fourth place. Four copies of two rules is how the
 * raid page and the career page end up disagreeing about the same night — the
 * trap AGENTS.md already documents for consumable gold.
 *
 * So the names now sit on the rules they describe:
 *
 *   elixirCoverage         — what the raider actually had up, as a fact.
 *   hasConsumableCoverage  — whether that clears the bar the council set.
 *   isPrepared             — coverage AND food. This is the one that feeds the
 *                            loot-priority score.
 *
 * The fact and the standard are deliberately separate. "Battle elixir, no
 * guardian" is true regardless of what the council decides it's worth, and the
 * raid page should be able to say it either way.
 *
 * Pure, and structurally typed rather than taking a `WclPlayerFight`, so a
 * component holding a partial row can ask the same question the analysis does
 * instead of re-deriving it.
 */

import { DEFAULT_POLICY, type GuildPolicy } from "@/lib/analysis/policy";
import { elixirCategoryOf, isFoodLabel, type ElixirSlot } from "@/lib/wcl/consumables";

/** The consumable facts a preparation check reads. Any row carrying them works. */
export interface PreparationRow {
  flask?: string;
  elixirs: string[];
  food: boolean;
  /**
   * Off-slot consumables at the pull. Read only to find a food the curated list
   * learned about after this row was imported — see `hasFood`.
   */
  extras?: string[];
}

/**
 * How much of the elixir budget a raider actually covered.
 *
 * A flask fills both slots at once; two elixirs — one battle, one guardian —
 * fill the same budget, and for several specs that pair is the stronger
 * choice. So "flask" and "full" are equally complete, and the interesting case
 * is `partial`: one slot up, one slot empty, which reads as covered under a
 * flat flask-or-elixir check.
 */
export type CoverageGrade =
  /** A flask — both slots at once. */
  | "flask"
  /** Battle and guardian both up. */
  | "full"
  /** One slot filled, one empty. */
  | "partial"
  /** Nothing. */
  | "none";

export interface ElixirCoverage {
  grade: CoverageGrade;
  battle?: string;
  guardian?: string;
  /**
   * Elixirs the curated list doesn't name a slot for — matched by the import's
   * name-pattern fallback. Kept rather than assumed into a slot: they're the
   * reason `missing` can be absent on a partial.
   */
  unclassified: string[];
  /**
   * The empty slot, when we can name it. Absent on a partial that also carries
   * an unclassified elixir, because that elixir may well be the missing half
   * and saying otherwise would invent a gap.
   */
  missing?: ElixirSlot;
}

/**
 * What the raider had up, as a fact — no policy involved.
 *
 * A flask short-circuits: it occupies both slots, so the elixirs list beneath
 * it (a leftover from a pre-pull swap, usually) can't make the night less
 * covered than it is.
 */
export function elixirCoverage(row: PreparationRow): ElixirCoverage {
  if (row.flask !== undefined) return { grade: "flask", unclassified: [] };

  let battle: string | undefined;
  let guardian: string | undefined;
  const unclassified: string[] = [];
  for (const label of row.elixirs) {
    const slot = elixirCategoryOf(label);
    if (slot === "battleElixir") battle ??= label;
    else if (slot === "guardianElixir") guardian ??= label;
    else unclassified.push(label);
  }

  if (battle !== undefined && guardian !== undefined) {
    return { grade: "full", battle, guardian, unclassified };
  }
  if (battle === undefined && guardian === undefined) {
    return unclassified.length > 0
      ? { grade: "partial", unclassified }
      : { grade: "none", unclassified: [] };
  }
  return {
    grade: "partial",
    battle,
    guardian,
    unclassified,
    // An unclassified elixir might be the missing half. Don't name a gap we
    // can't prove — the label is there for an officer to read instead.
    missing:
      unclassified.length > 0
        ? undefined
        : battle === undefined
          ? "battleElixir"
          : "guardianElixir",
  };
}

/**
 * Whether that coverage clears the council's bar.
 *
 * The bar is a standard, not a fact, which is why it reads from policy. The
 * default is `any` — one elixir counts — because that is how this roster
 * actually plays and changing it silently would move most of them at once.
 * `full` is the stricter reading: a flask, or both elixir slots.
 */
export function hasConsumableCoverage(
  row: PreparationRow,
  rule: GuildPolicy["preparation"] = DEFAULT_POLICY.preparation,
): boolean {
  const grade = elixirCoverage(row).grade;
  switch (rule.coverage) {
    case "flaskOnly":
      return grade === "flask";
    case "full":
      return grade === "flask" || grade === "full";
    case "any":
      return grade !== "none";
  }
}

/**
 * Were they fed?
 *
 * The boolean first, then the off-slot list. Ingest reduces a food aura to
 * `food: true` and keeps no label, so a food curated *after* a report was
 * imported leaves nothing behind but its name in `extras` — Skullfish Soup
 * applies "Enlightened" rather than "Well Fed" and spent 84 pulls filed as an
 * off-slot curiosity while its eaters read as unfed.
 *
 * Checking both means curating a food fixes the past as well as the future.
 * Every reader of "was this raider fed" goes through here for the same reason
 * `isPrepared` exists at all: two places asking it two ways is how the raid
 * page and the career page start disagreeing about the same night.
 */
export function hasFood(row: PreparationRow): boolean {
  if (row.food) return true;
  return row.extras?.some(isFoodLabel) ?? false;
}

/** Coverage and food both up — the composite the loot-priority score reads. */
export function isPrepared(
  row: PreparationRow,
  rule: GuildPolicy["preparation"] = DEFAULT_POLICY.preparation,
): boolean {
  return hasConsumableCoverage(row, rule) && hasFood(row);
}
