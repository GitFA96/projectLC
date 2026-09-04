/**
 * Who should get the item, and the arithmetic behind saying so.
 *
 * The weights and everything else that encodes a judgement live in
 * `analysis/policy.ts`, not here — these are the shapes that carry the answer.
 *
 * Part of `@/lib/types`, which re-exports every one of these — import from
 * there, not from this file, so a type moving between domains costs nothing.
 */

import type { Phase, Quality, SlotId } from "@/lib/constants/wow";
import type { AwardWithContext, RaiderMetrics } from "./roster";
import type { Character, Item, SlotItem } from "./entities";

export type LootPriorityFactorKey = "attendance" | "lootDebt" | "performance" | "preparation";

/** The council's weighting, editable in the app. Values are percentages. */
export type LootPriorityWeights = Record<LootPriorityFactorKey, number>;

/**
 * One item's spec priority chain — the council's sheet, as data. Seeded from
 * the guild's markdown sheet and overridable per item in the app.
 */
export interface ItemPriorityRule {
  /** The name the rule is filed under (matching is by normalized name). */
  itemName: string;
  /** The chain as written: "Hunter > DPS Warrior > MS > OS". */
  chain: string;
  /** Parsed rungs, highest priority first. */
  tiers: { tags: string[]; manual: boolean }[];
  note?: string;
  /** The seeded sheet, or an officer's edit on top of it. */
  origin: "sheet" | "officer";
  /** Sheet section the rule came from (the boss), when seeded. */
  source?: string;
  /**
   * The phase whose sheet an officer's edit was written against. Absent on a
   * seeded rule, which is already reached through a phase's sheet.
   */
  phase?: number;
}

/** One component of a priority score, with the evidence behind it. */
export interface LootPriorityFactor {
  key: LootPriorityFactorKey;
  label: string;
  weight: number;
  /** 0..100. Undefined means no data — the factor drops out rather than scoring 0. */
  score?: number;
  /** "12 of 14 logged raids", "no on-spec loot this phase" — what the number is. */
  detail: string;
}

/**
 * A multiplier applied to the weighted mean, for things that are categorical
 * rather than a percentage: roster standing, and whether this raider has
 * already been handed something for this slot.
 */
export interface LootPriorityAdjustment {
  key: "standing" | "slotServed";
  label: string;
  multiplier: number;
  note: string;
}

export interface LootPriority {
  /** 0..100 after adjustments; undefined when no factor had any data to go on. */
  score?: number;
  factors: LootPriorityFactor[];
  /** Applied to the weighted mean in order. Empty means nothing pulled them down. */
  adjustments: LootPriorityAdjustment[];
}

/** One item a contender has already been handed — the loot panel's evidence. */
export interface ContenderAward {
  itemId: number;
  itemName: string;
  awardedAt: string;
  offspec: boolean;
  /** The slot it fills, when the cache or a wishlist knows. */
  slot?: SlotId;
  /** It lands in the contested item's slot family — "they just got a belt". */
  sameSlot: boolean;
  /**
   * Where this item sat on their own list: 0 their pick, 1+ a ranked fallback.
   * The slot-served penalty reads it, because being handed a filler is not the
   * same as being served.
   */
  listRank?: number;
  /**
   * We had a list to check and this wasn't on it — they were handed something
   * nobody asked for. Distinct from both fields being absent, which means
   * there was no list to check and we can't say either way.
   */
  notListed?: boolean;
}

export interface ContentionWisher {
  character: Character;
  phases: Phase[];
  /**
   * Where this item sits on their list for its slot: 0 is the imported BiS,
   * 1 the first ranked fallback, and so on.
   *
   * Shown, never scored. The council decided the BiS-versus-second-choice call
   * is too situational to encode, so the badge informs the argument and the
   * item's notes carry it.
   */
  listRank: number;
  /** What they currently have in the item's slot family. */
  currentInSlot: SlotItem[];
  satisfied: boolean;
  onSpecAwardsActivePhase: number;
  /** Everything they've been handed this phase, newest first. */
  awardsThisPhase: ContenderAward[];
  /** On-spec awards across every phase — the long view next to the phase count. */
  totalOnSpecAwards: number;
  /**
   * Which rung of the item's priority chain they sit on — 0 is the top. The
   * sheet decides eligibility before any metric is consulted, so this leads
   * the sort and the score only ever breaks ties inside a tier. Undefined when
   * the chain names nobody they satisfy (or there's no chain at all).
   */
  priorityTier?: number;
  /** That rung's own words, for the badge: "Hunter" or "Resto Shaman = Healing Priest". */
  priorityTierLabel?: string;
  /** Where the council should rank them. Undefined once they're satisfied. */
  priority?: LootPriority;
  /** 1-based position among the unsatisfied contenders, best first. */
  rank?: number;
  /** The raiding record behind `priority`, for the columns next to it. */
  metrics?: RaiderMetrics;
}

export interface ItemContention {
  item?: Item;
  itemId: number;
  itemName: string;
  wishers: ContentionWisher[];
  awards: AwardWithContext[];
  openCount: number;
  /** Alts that list the item. Never ranked — noted so the want isn't invisible. */
  altWishers: string[];
  /** The council's spec priority for this item, when the sheet covers it. */
  priorityRule?: ItemPriorityRule;
  /** Rungs a human has to rule on ("Set completion") — shown, never applied. */
  manualTiers: string[];
}

export interface FairnessEntry {
  character: Character;
  onSpec: number;
  offSpec: number;
}

/** Award distribution for one scope: a single phase, or "all" raids tracked. */
export interface FairnessGroup {
  phase: Phase | "all";
  entries: FairnessEntry[];
}

/** One row of the /items index: cached + wishlisted + awarded items with demand counts. */
export interface ItemDemand {
  itemId: number;
  name: string;
  quality?: Quality;
  icon?: string;
  slot?: SlotId | null;
  source?: { zone: string; boss?: string };
  phase?: Phase;
  wisherCount: number;
  openCount: number;
  awardCount: number;
  lastAwardedAt?: string;
}
