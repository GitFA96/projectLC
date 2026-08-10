import type { Phase } from "@/lib/types";

/**
 * "Marked off-spec, but they asked for it."
 *
 * An award flagged off-spec that nevertheless delivers something on the
 * winner's own wishlist is one of two things, and the app cannot tell which:
 * a Gargul paste whose off-spec column was wrong, or a raider who genuinely
 * took their own BiS on off-spec priority. The difference matters — an
 * off-spec award satisfies no wishlist slot and costs nothing in loot owed —
 * so it is put in front of the officer rather than decided here. The fix is
 * the off-spec toggle in the award editor, which is a person's call.
 *
 * Tier tokens are where this shows up most: a token that buys a piece from
 * their list is a match the ledger could not previously see at all.
 */
export function OffSpecConflict({
  offspec,
  matched,
  phases,
  redeemsTo,
}: {
  offspec: boolean;
  matched: boolean;
  phases: Phase[];
  /** Set when a token was won: the wishlisted piece it buys. */
  redeemsTo?: { itemId: number; itemName: string };
}) {
  if (!offspec || !matched) return null;
  const list = phases.length > 0 ? `${phases.map((p) => `P${p}`).join(", ")} list` : "wishlist";
  return (
    <span
      className="text-[11px] leading-tight text-warn-ink"
      title={
        redeemsTo
          ? `This token buys ${redeemsTo.itemName}, which is on their ${list}. Either the off-spec flag is wrong or they took it on off-spec priority — edit the award to settle it.`
          : `This item is on their ${list}. Either the off-spec flag is wrong or they took it on off-spec priority — edit the award to settle it.`
      }
    >
      {redeemsTo ? `buys ${redeemsTo.itemName} — check` : "on their list — check"}
    </span>
  );
}
