import { describe, expect, it } from "vitest";
import {
  alternativesFor,
  rankLabel,
  rankOf,
  renumber,
  type WishlistAlternative,
} from "@/lib/analysis/wishlist-alternatives";

const alt = (over: Partial<WishlistAlternative> & { itemId: number; rank: number }): WishlistAlternative => ({
  characterId: "c1",
  phase: 3,
  slot: "waist",
  ...over,
});

describe("alternativesFor", () => {
  const list = [
    alt({ itemId: 200, rank: 2 }),
    alt({ itemId: 100, rank: 1 }),
    alt({ itemId: 300, rank: 1, slot: "head" }),
    alt({ itemId: 400, rank: 1, phase: 4 }),
    alt({ itemId: 500, rank: 1, characterId: "c2" }),
  ];

  it("returns one slot's fallbacks, best first", () => {
    expect(alternativesFor(list, "c1", 3, "waist").map((a) => a.itemId)).toEqual([100, 200]);
  });

  it("keeps slots, phases and characters apart", () => {
    expect(alternativesFor(list, "c1", 3, "head").map((a) => a.itemId)).toEqual([300]);
    expect(alternativesFor(list, "c1", 4, "waist").map((a) => a.itemId)).toEqual([400]);
    expect(alternativesFor(list, "c2", 3, "waist").map((a) => a.itemId)).toEqual([500]);
  });

  it("breaks a tied rank by item id, so the order is total", () => {
    const tied = [alt({ itemId: 900, rank: 1 }), alt({ itemId: 800, rank: 1 })];
    expect(alternativesFor(tied, "c1", 3, "waist").map((a) => a.itemId)).toEqual([800, 900]);
  });
});

describe("rankOf", () => {
  const list = [alt({ itemId: 100, rank: 1 }), alt({ itemId: 200, rank: 2 })];
  const base = { characterId: "c1", phase: 3 as const, slot: "waist" as const, wishedItemId: 50 };

  it("calls the imported wishlist item BiS", () => {
    expect(rankOf(list, { ...base, itemId: 50 })).toBe(0);
  });

  it("reads a fallback's stored rank", () => {
    expect(rankOf(list, { ...base, itemId: 100 })).toBe(1);
    expect(rankOf(list, { ...base, itemId: 200 })).toBe(2);
  });

  it("is undefined for an item they don't want", () => {
    expect(rankOf(list, { ...base, itemId: 999 })).toBeUndefined();
  });

  it("still ranks fallbacks when the slot has no imported item", () => {
    expect(rankOf(list, { ...base, wishedItemId: undefined, itemId: 100 })).toBe(1);
  });
});

describe("rankLabel", () => {
  it("names the ranks an officer reads", () => {
    expect(rankLabel(0)).toBe("BiS");
    expect(rankLabel(1)).toBe("2nd choice");
    expect(rankLabel(2)).toBe("3rd choice");
    expect(rankLabel(3)).toBe("4th choice");
  });

  it("handles the teens, which the naive rule gets wrong", () => {
    expect(rankLabel(10)).toBe("11th choice");
    expect(rankLabel(11)).toBe("12th choice");
    expect(rankLabel(12)).toBe("13th choice");
  });
});

describe("renumber", () => {
  it("makes ranks dense and 1-based in the order given", () => {
    expect(renumber([{ itemId: 3 }, { itemId: 1 }, { itemId: 2 }])).toEqual([
      { itemId: 3, rank: 1 },
      { itemId: 1, rank: 2 },
      { itemId: 2, rank: 3 },
    ]);
  });

  it("closes the gap a deletion leaves", () => {
    // 1st and 3rd survive a middle delete; they must become 1 and 2.
    expect(renumber([{ itemId: 10 }, { itemId: 30 }])).toEqual([
      { itemId: 10, rank: 1 },
      { itemId: 30, rank: 2 },
    ]);
  });
});
