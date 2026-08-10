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
   *
   * Three costs, because three different things can fill a slot:
   *
   *   `drop`        — they were handed what they asked for.
   *   `fillerDrop`  — a fallback they ranked. They settled, and are still
   *                   waiting for their pick. Defaults to `drop`; lower it to
   *                   say settling shouldn't cost as much.
   *   `offListDrop` — something never on their list at all. **Zero by council
   *                   decision (2026-08-09):** a drop nobody asked for
   *                   shouldn't weaken their claim on the one they did.
   *
   * `floor` stops the total reaching zero, because an uncontested drop should
   * still go to somebody.
   */
  slotServed: { drop: number; floor: number; fillerDrop: number; offListDrop: number };
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
  loot: {
    /**
     * Whether an alt contends for loot at all.
     *
     * Off (the default): an alt's wishlist is still a real statement of want,
     * but the council awards to the person's main, so ranking an alt among the
     * mains would put them above a raider who turns up on theirs. They're named
     * beneath the board instead of scored into it.
     *
     * On: alts rank like anyone else, with the standing multiplier deciding how
     * far behind a main they sit. That's the guild running two teams, where an
     * alt IS somebody's raiding character.
     *
     * This is participation, not display — which is why it isn't a checkbox on
     * the board. Letting alts in changes "loot owed", because the most-fed
     * contender sets the scale everyone else is measured against.
     */
    altsContend: boolean;
  };
  preparation: {
    /**
     * How much consumable coverage counts as covered.
     *
     * A flask fills both elixir slots; a battle and a guardian elixir together
     * fill the same budget, and for several specs that pair beats the flask.
     * So the question was never "do elixirs count" — it is how complete a
     * set the council expects.
     *
     *   any       — a flask, or any one elixir. What this roster does.
     *   full      — a flask, or battle AND guardian. The stricter reading.
     *   flaskOnly — only a flask. Wrong for the specs that go without one
     *               by design, kept because some guilds do run it.
     *
     * A standard, not a fact: the coverage itself is measured either way, and
     * the raid page names a half-filled set regardless of what this says.
     */
    coverage: "any" | "full" | "flaskOnly";
  };
  /**
   * The standing board — "who should we replace?".
   *
   * Separate from `weights` on purpose. That one ranks a raider for an item and
   * counts loot owed; this one weighs whether they are carrying their weight,
   * where being owed loot is not a demerit and has no business appearing.
   *
   * **These defaults are equal because the app has no opinion, not because
   * equal is right.** Whether attendance matters more than parse is the
   * council's judgement and nobody else's — set them.
   */
  roster: {
    /** Percentages, relative. A KPI a raider has no figure for drops out. */
    weights: Record<"attendance" | "performance" | "preparation", number>;
    /**
     * Below this many logged raids a raider is listed but not placed. A trial
     * with two nights doesn't belong at the bottom of a replace list beside a
     * regular who stopped turning up.
     */
    minRaids: number;
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
  slotServed: { drop: 0.4, floor: 0.35, fillerDrop: 0.4, offListDrop: 0 },
  attendance: { recentRaids: 10, weeks: 8 },
  performance: { parseMetric: "all" },
  loot: { altsContend: false },
  preparation: { coverage: "any" },
  roster: { weights: { attendance: 34, performance: 33, preparation: 33 }, minRaids: 3 },
  improvementSeverity: { high: 100, medium: 40, low: 12 },
};

/** A stored policy is always partial — anything unset falls back to the default. */
export type PolicyOverrides = {
  [K in keyof GuildPolicy]?: Partial<GuildPolicy[K]>;
};

/**
 * The policy in force. Merges one level deep, so a stored blob that only names
 * `standing.alt` leaves every other standing alone. `roster.weights` is the one
 * nested record and is merged explicitly — without that, saving a single roster
 * weight would silently reset the other two.
 */
export function resolvePolicy(overrides?: PolicyOverrides): GuildPolicy {
  if (!overrides) return DEFAULT_POLICY;
  return {
    weights: { ...DEFAULT_POLICY.weights, ...overrides.weights },
    standing: { ...DEFAULT_POLICY.standing, ...overrides.standing },
    slotServed: { ...DEFAULT_POLICY.slotServed, ...overrides.slotServed },
    attendance: { ...DEFAULT_POLICY.attendance, ...overrides.attendance },
    performance: { ...DEFAULT_POLICY.performance, ...overrides.performance },
    roster: {
      ...DEFAULT_POLICY.roster,
      ...overrides.roster,
      weights: { ...DEFAULT_POLICY.roster.weights, ...overrides.roster?.weights },
    },
    loot: { ...DEFAULT_POLICY.loot, ...overrides.loot },
    preparation: { ...DEFAULT_POLICY.preparation, ...overrides.preparation },
    improvementSeverity: {
      ...DEFAULT_POLICY.improvementSeverity,
      ...overrides.improvementSeverity,
    },
  };
}
