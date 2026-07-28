import { SLOT_FAMILIES, STAT_LABELS, STAT_ORDER } from "@/lib/constants/wow";
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

    const award = onSpecAwards
      .filter((a) => a.itemId === wished.itemId)
      .sort((a, b) => a.awardedAt.localeCompare(b.awardedAt))[0];

    return {
      slot: wished.slot,
      wished,
      current: currentBySlot.get(wished.slot),
      state: equippedMatch ? "equipped" : award ? "awarded" : "open",
      awardedAt: !equippedMatch && award ? award.awardedAt : undefined,
      awardId: !equippedMatch && award ? award.id : undefined,
    } satisfies WishlistRow;
  });
}

export function computeCompletion(rows: WishlistRow[]): WishlistCompletion {
  const satisfied = rows.filter((r) => r.state !== "open").length;
  const total = rows.length;
  return { satisfied, total, pct: total === 0 ? 0 : Math.round((satisfied / total) * 100) };
}

/** Which of the character's wishlists (by phase) contain the awarded item? */
export function matchAwardToWishlists(
  award: LootAward,
  wishlists: GearSet[],
): AwardWishlistMatch {
  const phases = wishlists
    .filter((w) => w.kind === "wishlist" && w.slots.some((s) => s.itemId === award.itemId))
    .map((w) => w.phase)
    .filter((p): p is Phase => p !== undefined)
    .sort((a, b) => a - b);
  return { matched: phases.length > 0, phases };
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
