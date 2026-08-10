import { describe, expect, it } from "vitest";
import { computeWishlistRows, matchAwardToWishlists } from "@/lib/analysis/wishlist";
import { tokenRedemptions } from "@/lib/items/tier-tokens";
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

describe("armor tokens", () => {
  // The token that buys HELM. Nothing about the ids says so — the edge comes
  // off Wowhead's vendor listing and is stored on the piece.
  const TOKEN = 30242;
  const redemptions = tokenRedemptions([
    { id: HELM, redeemsFrom: TOKEN },
    { id: BELT },
  ]);
  const wishlist = set("wishlist", [
    { slot: "head", itemId: HELM },
    { slot: "waist", itemId: BELT },
  ]);

  it("satisfies the slot the moment the token is won", () => {
    // The walk to the Shattrath vendor is the raider's errand, not a loot
    // decision — the council settled this: the slot is served at the boss.
    const rows = computeWishlistRows(wishlist, undefined, [award(TOKEN)], [], redemptions);
    const head = rows.find((r) => r.slot === "head")!;
    expect(head.state).toBe("awarded");
    expect(head.awardId).toBe(`aw-${TOKEN}`);
  });

  it("says what was actually handed over, because the ledger names the token", () => {
    const rows = computeWishlistRows(wishlist, undefined, [award(TOKEN)], [], redemptions);
    expect(rows.find((r) => r.slot === "head")!.awardedVia).toEqual({
      itemId: TOKEN,
      itemName: `Item ${TOKEN}`,
    });
    // Won as the piece itself: nothing to explain.
    const direct = computeWishlistRows(wishlist, undefined, [award(HELM)], [], redemptions);
    expect(direct.find((r) => r.slot === "head")!.awardedVia).toBeUndefined();
  });

  it("does not spill onto the other slots the token could have bought", () => {
    const rows = computeWishlistRows(wishlist, undefined, [award(TOKEN)], [], redemptions);
    expect(rows.find((r) => r.slot === "waist")!.state).toBe("open");
  });

  it("leaves an off-spec token award where an off-spec award has always sat", () => {
    const rows = computeWishlistRows(
      wishlist,
      undefined,
      [award(TOKEN, { offspec: true })],
      [],
      redemptions,
    );
    expect(rows.find((r) => r.slot === "head")!.state).toBe("open");
  });

  it("changes nothing until the mapping has been backfilled", () => {
    const rows = computeWishlistRows(wishlist, undefined, [award(TOKEN)], []);
    expect(rows.find((r) => r.slot === "head")!.state).toBe("open");
  });
});

describe("matchAwardToWishlists", () => {
  const TOKEN = 30242;
  const redemptions = tokenRedemptions([{ id: HELM, redeemsFrom: TOKEN }]);
  const wishlist = set("wishlist", [{ slot: "head", itemId: HELM }]);

  it("counts a token as a match, and names the piece it buys", () => {
    // The name is the whole point of reporting it separately: an officer
    // looking at an off-spec token win needs to see what they'd have got.
    const match = matchAwardToWishlists(award(TOKEN), [wishlist], redemptions);
    expect(match.matched).toBe(true);
    expect(match.phases).toEqual([3]);
    expect(match.redeemsTo).toEqual({ itemId: HELM, itemName: `Item ${HELM}` });
  });

  it("leaves redeemsTo empty when they won the item itself", () => {
    const match = matchAwardToWishlists(award(HELM), [wishlist], redemptions);
    expect(match.matched).toBe(true);
    expect(match.redeemsTo).toBeUndefined();
  });

  it("does not match a token nobody's list has a piece for", () => {
    const other = set("wishlist", [{ slot: "waist", itemId: BELT }]);
    expect(matchAwardToWishlists(award(TOKEN), [other], redemptions).matched).toBe(false);
  });
});
