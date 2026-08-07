import type { LootPriorityWeights } from "@/lib/types";
import type { CharacterStatus } from "@/lib/constants/wow";

/**
 * The numbers that encode a judgement, in one place the council can reach.
 *
 * Everything here was a constant in a source file. That was fine while they
 * were placeholders; it stopped being fine the moment officers started using
 * the output to decide who gets loot and who gets benched. A weighting nobody
 * can change is not the guild's policy, it is the author's — so the rule is:
 * **if changing a number changes a verdict, it belongs in here.**
 *
 * Two things deliberately stay in code, because they are honesty rather than
 * policy and no guild should get to switch them off:
 *
 *   - A factor with no data drops out of the average instead of scoring zero.
 *   - The score orders a list and shows its work. It never awards anything.
 *
 * Defaults below reproduce the previous constants exactly, so adopting this
 * changes no number anywhere until an officer edits one.
 */
export interface GuildPolicy {
  /** How much each factor counts once the priority sheet's spec order ties. */
  weights: LootPriorityWeights;
  /**
   * Roster standing as a multiplier: a category, not a percentage. A main with
   * mediocre metrics should still outrank an alt with perfect ones — by how
   * much is the argument, and it's the council's.
   */
  standing: Record<CharacterStatus, number>;
  /**
   * The penalty for having already been handed something for this slot.
   * `drop` is how much a fully-served slot family costs; `floor` stops it
   * reaching zero, because an uncontested drop should still go to somebody.
   */
  slotServed: { drop: number; floor: number };
  /** What "recent" means when reading attendance. */
  attendance: {
    /** How many of the most recent logged raids the recent figure covers. */
    recentRaids: number;
    /** How many reset weeks the weekly dots show. */
    weeks: number;
  };
  performance: {
    /**
     * Which percentile the performance factor scores on.
     *
     * "all" is the raw parse — closest to "what did we get out of them".
     * "bracket" is the ilvl-bracket percentile — closer to "are they playing
     * well", because it compares them against raiders in comparable gear. They
     * answer different questions and the council picks which one loot rides on.
     *
     * A raider with no figure for the chosen metric still drops out of the
     * average rather than scoring zero, so switching can never invent a verdict.
     */
    parseMetric: "all" | "bracket";
  };
  preparation: {
    /**
     * Whether a single battle elixir counts as consumable coverage, or only a
     * flask does. Many raiders — hunters especially — run one elixir rather
     * than a flask; whether that is "prepared" is a standard, not a fact.
     */
    elixirCounts: boolean;
  };
  /**
   * Relative weight of each severity when ordering the raid's improvements
   * list worst-first. Ordering only — nothing here feeds a loot score.
   */
  improvementSeverity: { high: number; medium: number; low: number };
}

export const DEFAULT_POLICY: GuildPolicy = {
  weights: { attendance: 35, lootDebt: 30, performance: 20, preparation: 15 },
  standing: { main: 1, alt: 0.7, inactive: 0.4, pug: 0.25 },
  slotServed: { drop: 0.4, floor: 0.35 },
  attendance: { recentRaids: 10, weeks: 8 },
  performance: { parseMetric: "all" },
  preparation: { elixirCounts: true },
  improvementSeverity: { high: 100, medium: 40, low: 12 },
};

/** A stored policy is always partial — anything unset falls back to the default. */
export type PolicyOverrides = {
  [K in keyof GuildPolicy]?: Partial<GuildPolicy[K]>;
};

/**
 * The policy in force. Merges one level deep, which is all the shape needs:
 * every group is a flat record of numbers or booleans, so a stored blob that
 * only names `standing.alt` leaves every other standing alone.
 */
export function resolvePolicy(overrides?: PolicyOverrides): GuildPolicy {
  if (!overrides) return DEFAULT_POLICY;
  return {
    weights: { ...DEFAULT_POLICY.weights, ...overrides.weights },
    standing: { ...DEFAULT_POLICY.standing, ...overrides.standing },
    slotServed: { ...DEFAULT_POLICY.slotServed, ...overrides.slotServed },
    attendance: { ...DEFAULT_POLICY.attendance, ...overrides.attendance },
    performance: { ...DEFAULT_POLICY.performance, ...overrides.performance },
    preparation: { ...DEFAULT_POLICY.preparation, ...overrides.preparation },
    improvementSeverity: {
      ...DEFAULT_POLICY.improvementSeverity,
      ...overrides.improvementSeverity,
    },
  };
}
