import { PHASE_ITEM_LEVEL_FLOOR } from "@/lib/constants/wow";
import type { Item, Phase, Quality } from "@/lib/types";

/**
 * Which socketed gems are worth replacing.
 *
 * A gem's quality is the whole signal. TBC cuts come in three grades of the
 * same stat — uncommon, rare, epic — and the difference is pure item budget,
 * so a green gem is a straight, uncontroversial upgrade for anybody at any
 * point in the expansion. That's the first rule, and it needs no context:
 * **an uncommon gem is always flagged.**
 *
 * Rare gems are the interesting case, and the rule has two conditions rather
 * than one. Epic cuts don't exist before phase 3, so through phases 1–2 a rare
 * gem IS the right answer and flagging it would be telling raiders to buy
 * something they can't. And even once they exist, nobody re-gems a piece
 * they're about to replace. So: **a rare gem is flagged once epic cuts are
 * available, and only in current-tier gear** — the item they'll still be
 * wearing next month, where the epic cut pays for itself.
 *
 * "Current-tier" is read from the item's own level against the active phase's
 * floor (see PHASE_ITEM_LEVEL_FLOOR), because a log's gear snapshot carries an
 * item level for every piece and the item cache knows a phase for almost none.
 * Where the cache DOES know a phase, that wins — it's a fact rather than a
 * threshold.
 *
 * Everything else is left alone. An epic gem is done, and a gem whose quality
 * nothing knows yet gets no verdict at all: the item cache fills in over time,
 * and "we haven't looked it up" must never render as "this is fine".
 */

export type GemVerdict =
  /** A better cut of the same gem is available and worth buying. */
  | "upgrade"
  /** Nothing better to move to. */
  | "current"
  /** Quality unknown — no claim either way. */
  | "unknown";

export interface GemGrade {
  gemId: number;
  quality?: Quality;
  verdict: GemVerdict;
  /** Why it's flagged, for the tooltip. Set only on "upgrade". */
  reason?: string;
}

/** Qualities that are always beaten by a rare cut of the same gem. */
const BELOW_RARE = new Set<Quality>(["poor", "common", "uncommon"]);

/**
 * The phase epic gem cuts become obtainable. Before it there is nothing above
 * a rare cut to move to, so the rare-gem rule stays silent no matter how good
 * the gear is — the flag has to name a purchase the raider can actually make.
 */
export const EPIC_GEM_PHASE = 3;

/**
 * Is this piece from the guild's current tier — the gear worth investing in?
 *
 * A known phase from the item cache is authoritative. Otherwise the item level
 * decides, against a floor the previous tier can't reach.
 */
export function isCurrentTierItem(
  item: { ilvl?: number; phase?: Phase },
  activePhase: Phase,
): boolean {
  if (item.phase !== undefined) return item.phase >= activePhase;
  if (item.ilvl === undefined) return false;
  return item.ilvl >= PHASE_ITEM_LEVEL_FLOOR[activePhase];
}

export interface GradeGemInput {
  gemId: number;
  /** The gem's cached entry — quality is the only field that matters. */
  cached?: Item;
  /** The item it's socketed into: its level from the log, its phase from the cache. */
  item: { ilvl?: number; phase?: Phase };
  activePhase: Phase;
}

export function gradeGem({ gemId, cached, item, activePhase }: GradeGemInput): GemGrade {
  const quality = cached?.quality;
  if (quality === undefined) return { gemId, verdict: "unknown" };

  if (BELOW_RARE.has(quality)) {
    return {
      gemId,
      quality,
      verdict: "upgrade",
      reason: "Uncommon cut — the rare version of the same gem is a straight upgrade, in any slot.",
    };
  }

  if (quality === "rare" && activePhase >= EPIC_GEM_PHASE && isCurrentTierItem(item, activePhase)) {
    return {
      gemId,
      quality,
      verdict: "upgrade",
      reason: `Rare cut in phase ${activePhase} gear — epic cuts are available now, and this piece is worth the investment.`,
    };
  }

  return { gemId, quality, verdict: "current" };
}

/** What a whole gear snapshot's gems add up to — the line above the table. */
export interface GemSummary {
  /** Gems whose quality is known. */
  graded: number;
  /** Uncommon cuts, anywhere. */
  uncommon: number;
  /** Rare cuts sitting in current-tier gear. */
  rareInCurrentTier: number;
  /** Gems with no cached quality — counted, never judged. */
  unknown: number;
}

export function summarizeGems(grades: GemGrade[]): GemSummary {
  const summary: GemSummary = { graded: 0, uncommon: 0, rareInCurrentTier: 0, unknown: 0 };
  for (const grade of grades) {
    if (grade.verdict === "unknown") {
      summary.unknown++;
      continue;
    }
    summary.graded++;
    if (grade.verdict !== "upgrade") continue;
    if (grade.quality === "rare") summary.rareInCurrentTier++;
    else summary.uncommon++;
  }
  return summary;
}

/** Grade every gem in a worn-gear snapshot. */
export function gradeWornGems(
  gear: { ilvl?: number; id: number; gems: { id: number }[] }[],
  itemsById: Map<number, Item>,
  activePhase: Phase,
): GemGrade[] {
  return gear.flatMap((worn) =>
    worn.gems.map((gem) =>
      gradeGem({
        gemId: gem.id,
        cached: itemsById.get(gem.id),
        item: { ilvl: worn.ilvl, phase: itemsById.get(worn.id)?.phase },
        activePhase,
      }),
    ),
  );
}
