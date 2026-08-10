import { SLOT_FAMILIES, STAT_LABELS, STAT_ORDER } from "@/lib/constants/wow";
import { NO_TOKEN_REDEMPTIONS, type TokenRedemptions } from "@/lib/items/tier-tokens";
import type { WishlistAlternative } from "@/lib/analysis/wishlist-alternatives";
import type {
  AwardWishlistMatch,
  GearSet,
  LootAward,
  Phase,
  SlotId,
  StatBlock,
  StatDeltaRow,
  WishlistCompletion,
  WishlistRow,
} from "@/lib/types";
import { prettifyKey } from "@/lib/utils";

/** Rings/trinkets are interchangeable pairs — compare by family multiset, never by slot index. */
function familyKey(slot: SlotId): string {
  return SLOT_FAMILIES[slot] ?? slot;
}

/**
 * Compute the per-slot status of a wishlist against current gear and loot awards.
 * - "equipped": the wished item is in the current set (within the slot family)
 * - "awarded": an on-spec loot award exists for the wished item
 * - "open": neither
 * Returns one row per wishlist slot (callers filter for display; completion uses all rows).
 */
export function computeWishlistRows(
  wishlist: GearSet,
  current: GearSet | undefined,
  characterAwards: LootAward[],
  /** The raider's stored fallbacks for this phase, any slot. */
  alternatives: WishlistAlternative[] = [],
  /**
   * Lets a won armor token satisfy the tier piece it buys. Defaulted to the
   * empty lookup, where every item delivers only itself — which is how this
   * behaved before tokens were modelled.
   */
  redemptions: TokenRedemptions = NO_TOKEN_REDEMPTIONS,
): WishlistRow[] {
  const currentByFamily = new Map<string, { itemId: number; used: boolean }[]>();
  for (const slot of current?.slots ?? []) {
    const key = familyKey(slot.slot);
    const list = currentByFamily.get(key) ?? [];
    list.push({ itemId: slot.itemId, used: false });
    currentByFamily.set(key, list);
  }
  const currentBySlot = new Map(current?.slots.map((s) => [s.slot, s]) ?? []);
  const onSpecAwards = characterAwards.filter((a) => !a.offspec);

  return wishlist.slots.map((wished) => {
    const family = currentByFamily.get(familyKey(wished.slot)) ?? [];
    const equippedMatch = family.find((c) => !c.used && c.itemId === wished.itemId);
    if (equippedMatch) equippedMatch.used = true;

    // A token counts: it is won at the boss, and it buys nothing else. What it
    // is NOT is interchangeable with the piece — winning the piece some other
    // way never satisfies a wishlist row asking for the token, and `delivers`
    // only runs the one direction.
    const award = onSpecAwards
      .filter((a) => redemptions.delivers(a.itemId, wished.itemId))
      .sort((a, b) => a.awardedAt.localeCompare(b.awardedAt))[0];

    return {
      slot: wished.slot,
      wished,
      current: currentBySlot.get(wished.slot),
      // Being worn is the stronger statement about the slot, so it wins the
      // state — but the award still travels with the row. Dropping it once the
      // item was equipped left the loot record with nothing pointing at it:
      // no date to read, and no handle to correct or clear it by.
      state: equippedMatch ? "equipped" : award ? "awarded" : "open",
      awardedAt: award?.awardedAt,
      awardId: award?.id,
      awardedVia:
        award && award.itemId !== wished.itemId
          ? { itemId: award.itemId, itemName: award.itemName }
          : undefined,
      alternatives: alternatives
        .filter((a) => a.slot === wished.slot)
        .sort((a, b) => a.rank - b.rank || a.itemId - b.itemId)
        .map((a) => ({ itemId: a.itemId, itemName: a.itemName, rank: a.rank, note: a.note })),
    } satisfies WishlistRow;
  });
}

export function computeCompletion(rows: WishlistRow[]): WishlistCompletion {
  const satisfied = rows.filter((r) => r.state !== "open").length;
  const total = rows.length;
  return { satisfied, total, pct: total === 0 ? 0 : Math.round((satisfied / total) * 100) };
}

/**
 * Which of the character's wishlists (by phase) contain the awarded item —
 * counting an armor token as the piece on their list that it buys.
 *
 * The token case is reported separately in `redeemsTo`, because it is the one
 * an officer may need to act on: an award flagged off-spec that nevertheless
 * buys something the winner asked for is either a mis-flagged import or a
 * raider who took their own BiS on off-spec priority, and only a person can
 * say which.
 */
export function matchAwardToWishlists(
  award: LootAward,
  wishlists: GearSet[],
  redemptions: TokenRedemptions = NO_TOKEN_REDEMPTIONS,
): AwardWishlistMatch {
  const listed = wishlists.filter((w) => w.kind === "wishlist");
  const phases = listed
    .filter((w) => w.slots.some((s) => redemptions.delivers(award.itemId, s.itemId)))
    .map((w) => w.phase)
    .filter((p): p is Phase => p !== undefined)
    .sort((a, b) => a - b);
  const redeemed = listed
    .flatMap((w) => w.slots)
    .find((s) => s.itemId !== award.itemId && redemptions.delivers(award.itemId, s.itemId));
  return {
    matched: phases.length > 0,
    phases,
    redeemsTo: redeemed ? { itemId: redeemed.itemId, itemName: redeemed.itemName } : undefined,
  };
}

/**
 * "Upcoming stats": pure diff of two SixtyUpgrades-computed stat blocks.
 * We never compute stats ourselves. Known keys ordered via STAT_META,
 * unknown keys appended (prettified) so nothing an export contains is lost.
 */
export function computeStatDeltas(
  current: StatBlock | undefined,
  target: StatBlock,
): StatDeltaRow[] {
  const keys = [...new Set([...Object.keys(current ?? {}), ...Object.keys(target)])];
  keys.sort((a, b) => {
    const ai = STAT_ORDER.get(a) ?? Number.MAX_SAFE_INTEGER;
    const bi = STAT_ORDER.get(b) ?? Number.MAX_SAFE_INTEGER;
    return ai === bi ? a.localeCompare(b) : ai - bi;
  });
  return keys.map((key) => {
    const cur = current?.[key] ?? 0;
    const tgt = target[key] ?? 0;
    return {
      key,
      label: STAT_LABELS.get(key) ?? prettifyKey(key),
      current: cur,
      target: tgt,
      delta: tgt - cur,
    };
  });
}
