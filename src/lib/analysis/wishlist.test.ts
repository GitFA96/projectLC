import { describe, expect, it } from "vitest";
import { computeWishlistRows } from "@/lib/analysis/wishlist";
import type { GearSet, LootAward, SlotId } from "@/lib/types";

/** A set with just the slots a test cares about. */
function set(kind: GearSet["kind"], slots: { slot: SlotId; itemId: number }[]): GearSet {
  return {
    id: `gs-${kind}`,
    characterId: "c1",
    kind,
    phase: kind === "wishlist" ? 3 : undefined,
    name: "set",
    source: "sixtyupgrades",
    importedAt: "2026-01-01T00:00:00.000Z",
    stats: {},
    slots: slots.map((s) => ({ ...s, itemName: `Item ${s.itemId}` })),
  } as GearSet;
}

function award(itemId: number, over: Partial<LootAward> = {}): LootAward {
  return {
    id: `aw-${itemId}`,
    raidSessionId: "rs1",
    characterId: "c1",
    rawWinnerName: "Thrainn",
    itemId,
    itemName: `Item ${itemId}`,
    awardedAt: "2026-07-12T20:00:00.000Z",
    offspec: false,
    external: false,
    ...over,
  } as LootAward;
}

const HELM = 30141;
const BELT = 30040;

describe("computeWishlistRows", () => {
  const wishlist = set("wishlist", [
    { slot: "head", itemId: HELM },
    { slot: "waist", itemId: BELT },
  ]);

  it("marks a slot equipped when the wished item is in the current set", () => {
    const rows = computeWishlistRows(wishlist, set("current", [{ slot: "head", itemId: HELM }]), []);
    expect(rows.find((r) => r.slot === "head")!.state).toBe("equipped");
    expect(rows.find((r) => r.slot === "waist")!.state).toBe("open");
  });

  it("keeps the award on the row once the item is being worn", () => {
    // The bug this guards: "equipped" used to erase the award, leaving the
    // ledger entry with no date on the row and no handle to clear it by.
    const rows = computeWishlistRows(
      wishlist,
      set("current", [{ slot: "head", itemId: HELM }]),
      [award(HELM)],
    );
    const head = rows.find((r) => r.slot === "head")!;
    expect(head.state).toBe("equipped");
    expect(head.awardId).toBe(`aw-${HELM}`);
    expect(head.awardedAt).toBe("2026-07-12T20:00:00.000Z");
  });

  it("leaves an equipped slot with no award recorded pointing at nothing", () => {
    // Gear from before loot tracking: worn, but nothing in the ledger. This is
    // the set the profile offers a "Record" button for.
    const rows = computeWishlistRows(wishlist, set("current", [{ slot: "head", itemId: HELM }]), []);
    const head = rows.find((r) => r.slot === "head")!;
    expect(head.state).toBe("equipped");
    expect(head.awardId).toBeUndefined();
  });

  it("ignores an off-spec award — it never satisfies a main-spec list", () => {
    const rows = computeWishlistRows(wishlist, undefined, [award(HELM, { offspec: true })]);
    expect(rows.find((r) => r.slot === "head")!.state).toBe("open");
  });

  it("marks a slot awarded when the item was won but isn't worn yet", () => {
    const rows = computeWishlistRows(wishlist, undefined, [award(HELM)]);
    const head = rows.find((r) => r.slot === "head")!;
    expect(head.state).toBe("awarded");
    expect(head.awardId).toBe(`aw-${HELM}`);
  });
});
