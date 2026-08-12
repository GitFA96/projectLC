import { isSpecTag, matchesSpecTag } from "@/lib/loot/spec-tags";
import type { Character } from "@/lib/types";

/**
 * A council's written priority chain — "Resto Shaman = Healing Priest > Holy
 * Paladin > Resto Druid" — as something a ranking can use.
 *
 * `>` separates tiers, `=` joins equals inside one. A contender lands in the
 * FIRST tier they satisfy; the metric score then only ever breaks ties inside
 * that tier. That's the order a council actually works in: the sheet decides
 * who's eligible before anyone argues about attendance.
 *
 * Tokens that aren't spec tags — "Major 2pc/4pc completion", "Set completion",
 * "Quest Item" — are kept and displayed but never match anybody. They're
 * judgement calls the sheet is asking a human to make, and inventing a rule for
 * them would be worse than showing them the words and letting them decide.
 */

/** One rung: the tags at equal priority, plus whatever couldn't be interpreted. */
export interface PriorityTier {
  /** Tags as written, in source order. */
  tags: string[];
  /** True when no tag on this rung is one the app can evaluate. */
  manual: boolean;
}

export interface PriorityChain {
  /** Highest priority first. Empty when the sheet says nothing. */
  tiers: PriorityTier[];
  /** The chain exactly as an officer typed it — what the UI shows and edits. */
  source: string;
}

export function parsePriorityChain(source: string): PriorityChain {
  const tiers = source
    .split(">")
    .map((rung) => rung.split("=").map((t) => t.trim()).filter(Boolean))
    .filter((tags) => tags.length > 0)
    .map((tags) => ({ tags, manual: !tags.some(isSpecTag) }));
  return { tiers, source: source.trim() };
}

export interface TierMatch {
  /** 0-based; lower wins. Undefined when the chain names nobody they satisfy. */
  index?: number;
  /** The tier's own words, for the badge: "Warlock = Mage" or "MS". */
  label?: string;
  /** The tier is a judgement call ("Set completion") rather than a spec rule. */
  manual?: boolean;
}

/**
 * Where a contender sits on the chain. Tiers the app can't evaluate are
 * skipped over rather than swallowing everybody — a "Set completion" rung
 * shouldn't silently promote the whole raid.
 */
export function tierFor(chain: PriorityChain, character: Character): TierMatch {
  for (const [index, tier] of chain.tiers.entries()) {
    if (tier.manual) continue;
    if (tier.tags.some((tag) => matchesSpecTag(character, tag))) {
      return { index, label: tier.tags.join(" = "), manual: false };
    }
  }
  return {};
}

/** Tiers a human has to rule on, in order — surfaced above the table. */
export function manualTiers(chain: PriorityChain): string[] {
  return chain.tiers.filter((t) => t.manual).map((t) => t.tags.join(" = "));
}
