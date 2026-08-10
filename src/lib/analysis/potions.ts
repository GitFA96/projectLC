/**
 * Counting potions, including the one drunk before the pull timer.
 *
 * A pre-pot is a potion. It was bought, it was consumed, and it was up for the
 * fight — so it belongs in the usage totals and in the gold, the same as one
 * drunk thirty seconds in. The app used to hold it apart as its own metric,
 * which quietly made "potions used" wrong for every hunter who opens with one.
 *
 * What a pre-pot is *not* is a verdict. TBC has no combat-gated potion
 * cooldown, so a potion is meant to line up with the cooldowns it amplifies,
 * and opening with one is usually the weaker choice — with real exceptions,
 * the hunter burst opener being the obvious one. Whether *this* spec should
 * open potted is the guide's answer and the sim's, not a tally's. So counting
 * it here is deliberately neutral: it makes the number true, and says nothing
 * about whether it was well spent.
 *
 * Pure, structurally typed, one rule in one place — the same reason
 * `preparation.ts` exists next door.
 */

/**
 * What a pre-pot is called when the log recorded that one happened but not
 * which. Reports imported before the name was captured only stored a boolean,
 * so this stands in for them rather than dropping the use entirely — a real
 * potion counted under a vague name beats a real potion not counted.
 *
 * Priced like any other consumable, and editable by an officer.
 */
export const UNNAMED_PREPOT = "Pre-pull potion";

/** The consumable facts a potion count reads. Any row carrying them works. */
export interface PotionRow {
  potions: string[];
  prepot: boolean;
  /** The pre-potted potion, when the import recorded it. */
  prepotLabel?: string;
}

/** The pre-pot as a named consumable, or undefined if there wasn't one. */
export function prepotName(row: PotionRow): string | undefined {
  if (!row.prepot) return undefined;
  return row.prepotLabel ?? UNNAMED_PREPOT;
}

/** Every potion this pull consumed, pre-pull one included. */
export function potionNames(row: PotionRow): string[] {
  const prepot = prepotName(row);
  return prepot === undefined ? row.potions : [prepot, ...row.potions];
}

/** How many potions this pull consumed. */
export function potionsUsed(row: PotionRow): number {
  return row.potions.length + (row.prepot ? 1 : 0);
}
