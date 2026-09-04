/**
 * A character as the council reads them: wishlists, attendance, and the
 * summary every roster row is built from.
 *
 * Part of `@/lib/types`, which re-exports every one of these — import from
 * there, not from this file, so a type moving between domains costs nothing.
 */

import type { Phase, SlotId } from "@/lib/constants/wow";
import type { ProfessionGap } from "@/lib/analysis/professions";
import type { Character, CharacterComment, CurrentGearOverride, GearSet, Item, LootAward, RaidSession, SlotItem } from "./entities";
import type { PerformanceSummary } from "./performance";

/* Derived view models (computed, never stored) */

export type WishlistSlotState = "awarded" | "equipped" | "open";

export interface WishlistRow {
  slot: SlotId;
  wished: SlotItem;
  /** What the character currently has in that slot (undefined when no current set). */
  current?: SlotItem;
  state: WishlistSlotState;
  /** Set when state === "awarded". */
  awardedAt?: string;
  /** The loot award that satisfied the slot — the handle for undoing it. */
  awardId?: string;
  /**
   * What was actually handed over, when it wasn't this item: the armor token
   * that buys it. The slot counts as served the moment the token is won —
   * the walk to the Shattrath vendor is the raider's errand, not a loot
   * decision — but the ledger says "Helm of the Vanquished Champion" and the
   * row has to be able to say so too.
   */
  awardedVia?: { itemId: number; itemName: string };
  /**
   * What they'd take for this slot instead, in their own order. Empty when
   * nobody has recorded a fallback — which is different from "they'd take
   * nothing else", and the UI says so.
   */
  alternatives: { itemId: number; itemName?: string; rank: number; note?: string }[];
}

export interface WishlistCompletion {
  satisfied: number;
  total: number;
  pct: number; // 0..100, rounded
}

export interface StatDeltaRow {
  key: string;
  label: string;
  current: number;
  target: number;
  delta: number;
}

export interface AwardWishlistMatch {
  matched: boolean;
  phases: Phase[];
  /**
   * When the award was an armor token: the wishlisted piece it buys. Present
   * only when the token route is what made this a match, so an officer reading
   * an off-spec token award can see the piece it would have bought.
   */
  redeemsTo?: { itemId: number; itemName: string };
}

/** A loot award joined with everything the UI needs to render a ledger row. */
export interface AwardWithContext {
  award: LootAward;
  session: RaidSession;
  sessionPhase?: Phase;
  character?: Character;
  item?: Item;
  wishlist: AwardWishlistMatch;
}

/**
 * Raid attendance derived from imported Warcraft Logs reports (one report =
 * one raid night). The fair denominator is "raids since their first logged
 * appearance" — reports from before someone joined don't count against them.
 * Pull coverage measures presence within attended nights (late join / early
 * leave); the recent window is the last 10 tracked raids.
 */
export interface AttendanceSummary {
  /** All imported reports, for context ("never in any of N logged raids"). */
  raidsTotal: number;
  raidsAttended: number;
  /** Reports since (and including) their first appearance — the denominator. */
  raidsTracked: number;
  raidPct: number;
  /** Report start of their first logged appearance; undefined when never seen. */
  firstSeenAt?: string;
  recentAttended: number;
  recentTotal: number;
  recentPct: number;
  pullsAttended: number;
  /** Total boss pulls of the reports they attended. */
  pullsTotal: number;
  pullPct: number;
  /**
   * Per-reset check ("did they raid that week with this character?"), **the
   * recent window only** — the last `policy.attendance.weeks` raid weeks (EU
   * reset, Wednesday) the guild logged, newest last.
   *
   * A fixed-width strip, which is what the loot table's dots need: one dot per
   * week on a row that must not grow with a raider's history. The whole record
   * is `allWeeks`.
   */
  weeks: AttendanceWeek[];
  /** Attended, non-excused weeks **of the recent window**. */
  weeksAttended: number;
  /** Non-excused weeks of the recent window — that window's denominator. */
  weeksTracked: number;
  /** Weeks of the recent window marked excused (shown, counted neither way). */
  weeksExcused: number;
  /**
   * Every reset week the guild logged since this character first appeared —
   * the whole record, oldest first, untruncated.
   *
   * Separate from `weeks` rather than replacing it because the two have
   * different jobs: the profile answers "what is their record", the loot table
   * answers "how have they been lately" in a row of fixed width.
   */
  allWeeks: AttendanceWeek[];
  /** Attended, non-excused weeks across the whole record. */
  allWeeksAttended: number;
  /** Non-excused weeks across the whole record — the all-time denominator. */
  allWeeksTracked: number;
  /**
   * The figure this guild judges attendance on, resolved once from
   * `policy.attendance.basis` so every surface shows the same number.
   *
   * Without it each page picked its own denominator and a raider could read
   * 92% on their profile, 100% on the loot sheet and a third figure on the
   * board — all correct, all describing the same weeks. `undefined` when there
   * is nothing to count yet, which is not the same as zero.
   */
  scoreBasis: "raid" | "week";
  scorePct?: number;
  scoreAttended: number;
  scoreTracked: number;
}

export interface AttendanceWeek {
  /** ISO date of the reset Wednesday opening the week. */
  start: string;
  attended: boolean;
  /** Imported guild reports in that week. */
  reports: number;
  /** Officer-marked excused absence — neither attended nor missed for the markup. */
  excused: boolean;
  /**
   * Which tier the guild was raiding that week, by zone rather than by date —
   * the same rule awards and sessions use, so a week is read one way across the
   * app. A week that touched two tiers takes the higher one; `undefined` when
   * no log that week named a zone the phase map knows.
   */
  phase?: Phase;
}

export interface CharacterSummary {
  character: Character;
  /** Wishlist completion per phase that has an imported wishlist. */
  completionByPhase: { phase: Phase; completion: WishlistCompletion }[];
  totalAwards: number;
  activePhaseAwards: number;
  offspecAwards: number;
  lastAwardAt?: string;
  hasCurrentGear: boolean;
  /** Undefined until at least one Warcraft Logs report is imported. */
  attendance?: AttendanceSummary;
  /** Spec from their most recent logged pulls — may disagree with the roster entry. */
  loggedSpec?: string;
  /** Resolved name of this alt's main (when status "alt" and the link is valid). */
  mainCharacterName?: string;
  /** Names of characters that list this one as their main (this char is a main). */
  altNames?: string[];
  /**
   * A profession their logs prove and the roster doesn't record — the prompt to
   * go and set it. Undefined nearly always, and means "nothing to say": the
   * logs can only ever prove Engineering, and only from a thrown sapper.
   */
  professionGap?: ProfessionGap;
}

export interface PhaseWishlistView {
  phase: Phase;
  set: GearSet;
  rows: WishlistRow[];
  completion: WishlistCompletion;
  statDeltas: StatDeltaRow[];
}

export interface CharacterBundle {
  character: Character;
  /** The imported current set with any pinned slots already applied. */
  current?: GearSet;
  wishlists: PhaseWishlistView[];
  awards: AwardWithContext[];
  summary: CharacterSummary;
  /** Officer comment log, newest first. */
  comments: CharacterComment[];
  /** The slots an officer pinned by hand — which parts of `current` aren't the import. */
  currentOverrides: CurrentGearOverride[];
  /** The imported set as it was exported, before pinning. Undefined when nothing was imported. */
  importedCurrent?: GearSet;
  /** The off-spec kit's pinned slots — empty unless an off-spec is recorded. */
  offSpecOverrides: CurrentGearOverride[];
  /** Those pins as a set. Never merged into `current`: loot is judged on the main spec. */
  offSpecCurrent?: GearSet;
}

/**
 * The raiding record a contender is judged on — one lookup per character.
 * Both fields are whole rollups rather than the three scored numbers, so the
 * council can open a contender and read what the score was actually built from
 * (recent form, gear-adjusted parse, which half of "prepared" they miss).
 */
export interface RaiderMetrics {
  attendance?: AttendanceSummary;
  /** Rollup over every logged pull of their career — parse and prep come from here. */
  career?: PerformanceSummary;
  /** ≈ gold per raid on consumables at default prices. Context, never scored. */
  goldPerRaid?: number;
}
