import type { Phase, SlotId } from "@/lib/types";

/**
 * "If my BiS doesn't drop, I'll take this."
 *
 * The wishlist stays a whole imported gear set — that is what SixtyUpgrades
 * exports and what the stat comparison needs — so this sits beside it rather
 * than replacing it. The set names the BiS; these name the fallbacks, in the
 * raider's own order.
 *
 * Why the council cares: without it, "already served this slot" can't tell a
 * raider who got their BiS from one who took a filler and is still waiting.
 * Those are different people at 22:40 and the app currently reads them the
 * same.
 *
 * Pure.
 */

export interface WishlistAlternative {
  characterId: string;
  phase: Phase;
  slot: SlotId;
  itemId: number;
  itemName?: string;
  /** 1 is the first fallback. The imported BiS is rank 0 and never stored. */
  rank: number;
  note?: string;
}

/** One slot's fallbacks, best first. */
export function alternativesFor(
  alternatives: WishlistAlternative[],
  characterId: string,
  phase: Phase,
  slot: SlotId,
): WishlistAlternative[] {
  return alternatives
    .filter((a) => a.characterId === characterId && a.phase === phase && a.slot === slot)
    .sort((a, b) => a.rank - b.rank || a.itemId - b.itemId);
}

/**
 * Where an item sits on a raider's list for its slot: 0 for the imported BiS,
 * then the stored ranks. Undefined when they don't want it at all.
 *
 * Deliberately takes the wishlist's own item rather than looking it up, so this
 * stays pure and one caller can't disagree with another about what BiS means.
 */
export function rankOf(
  alternatives: WishlistAlternative[],
  opts: {
    characterId: string;
    phase: Phase;
    slot: SlotId;
    /** The item the imported wishlist names for this slot, when it names one. */
    wishedItemId?: number;
    itemId: number;
  },
): number | undefined {
  if (opts.wishedItemId !== undefined && opts.itemId === opts.wishedItemId) return 0;
  const match = alternativesFor(alternatives, opts.characterId, opts.phase, opts.slot).find(
    (a) => a.itemId === opts.itemId,
  );
  return match?.rank;
}

/** "BiS" / "2nd choice" / "3rd choice" — how a rank reads to an officer. */
export function rankLabel(rank: number): string {
  if (rank <= 0) return "BiS";
  const nth = rank + 1;
  const suffix = nth % 100 >= 11 && nth % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][nth % 10] ?? "th";
  return `${nth}${suffix} choice`;
}

/**
 * Renumber a slot's fallbacks to 1..n in the order given.
 *
 * Ranks are stored rather than derived from array position, so a single insert
 * or delete doesn't have to rewrite every row — but they must stay dense and
 * ordered, or "2nd choice" starts meaning nothing. Callers pass the intended
 * order; this makes it canonical.
 */
export function renumber(items: { itemId: number }[]): { itemId: number; rank: number }[] {
  return items.map((item, i) => ({ itemId: item.itemId, rank: i + 1 }));
}
