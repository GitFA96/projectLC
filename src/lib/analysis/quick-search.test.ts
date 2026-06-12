import { describe, expect, it } from "vitest";
import { rankItemMatches, type QuickSearchItem } from "@/lib/analysis/quick-search";

function item(name: string, over: Partial<QuickSearchItem> = {}): QuickSearchItem {
  return { itemId: name.length * 1000 + (over.openCount ?? 0), name, wisherCount: 0, openCount: 0, awardCount: 0, ...over };
}

const ITEMS: QuickSearchItem[] = [
  item("Gorehowl", { itemId: 28773, wisherCount: 2, openCount: 1 }),
  item("Dragonspine Trophy", { itemId: 28830, wisherCount: 3, openCount: 2 }),
  item("Talon of Azshara", { itemId: 28757 }),
  item("Tsunami Talisman", { itemId: 30627, wisherCount: 1, openCount: 1 }),
  item("Helm of the Vanquished Defender", { itemId: 30243, wisherCount: 2, openCount: 2 }),
  item("Helm of the Vanquished Hero", { itemId: 30244, wisherCount: 1, openCount: 0 }),
];

describe("rankItemMatches", () => {
  it("requires at least two characters", () => {
    expect(rankItemMatches(ITEMS, "")).toEqual([]);
    expect(rankItemMatches(ITEMS, "g")).toEqual([]);
  });

  it("prefers name-start over word-start over substring matches", () => {
    const names = rankItemMatches(ITEMS, "ta").map((i) => i.name);
    // "Talon..." starts with the query; "Tsunami Talisman" matches a word start.
    expect(names[0]).toBe("Talon of Azshara");
    expect(names).toContain("Tsunami Talisman");
  });

  it("breaks ties by open demand — the contested item first", () => {
    const helms = rankItemMatches(ITEMS, "helm of the");
    expect(helms.map((i) => i.itemId)).toEqual([30243, 30244]);
  });

  it("matches all tokens regardless of order", () => {
    expect(rankItemMatches(ITEMS, "vanquished helm")).toHaveLength(2);
    expect(rankItemMatches(ITEMS, "trophy dragon").map((i) => i.itemId)).toEqual([28830]);
    expect(rankItemMatches(ITEMS, "helm azshara")).toEqual([]);
  });

  it("caps the result list", () => {
    const many = Array.from({ length: 30 }, (_, i) => item(`Sword ${i}`, { itemId: i + 1 }));
    expect(rankItemMatches(many, "sword")).toHaveLength(8);
  });
});
