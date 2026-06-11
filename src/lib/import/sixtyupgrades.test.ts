import { describe, expect, it } from "vitest";
import { parseSixtyUpgradesExport } from "@/lib/import/sixtyupgrades";

function ok(text: string) {
  const result = parseSixtyUpgradesExport(text);
  if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`);
  return result.parsed;
}

describe("parseSixtyUpgradesExport", () => {
  it("parses the canonical shape", () => {
    const parsed = ok(
      JSON.stringify({
        name: "P2 wishlist",
        character: { name: "Thrainn", class: "Warrior", spec: "Protection" },
        stats: { stamina: 920, defenseRating: 401 },
        slots: [
          { slot: "head", itemId: 30243, itemName: "Helm of the Vanquished Defender" },
          { slot: "mainHand", itemId: 28749, itemName: "King's Defender", enchant: { name: "Mongoose" } },
        ],
      }),
    );
    expect(parsed.setName).toBe("P2 wishlist");
    expect(parsed.character?.name).toBe("Thrainn");
    expect(parsed.slots).toHaveLength(2);
    expect(parsed.slots[1].enchant?.name).toBe("Mongoose");
    expect(parsed.stats).toEqual({ stamina: 920, defenseRating: 401 });
    expect(parsed.warnings).toEqual([]);
  });

  it("maps slot-name aliases and nested item fields", () => {
    const parsed = ok(
      JSON.stringify({
        slots: [
          { slot: "Helm", item: { id: 30243, name: "Helm of the Vanquished Defender" } },
          { slot: "Finger 1", item: { id: 29283, name: "Violet Signet" } },
          { slot: "main hand", item: { id: 28749, name: "King's Defender" } },
          { slot: "Shoulders", itemId: "30055", itemName: "Shoulderpads of the Stranger" },
        ],
      }),
    );
    expect(parsed.slots.map((s) => s.slot)).toEqual(["head", "ring1", "mainHand", "shoulder"]);
    expect(parsed.slots[3].itemId).toBe(30055); // numeric string coerced
  });

  it("unwraps a multi-set export and warns", () => {
    const parsed = ok(
      JSON.stringify({
        sets: [
          { name: "A", slots: [{ slot: "head", itemId: 1, itemName: "X" }] },
          { name: "B", slots: [{ slot: "head", itemId: 2, itemName: "Y" }] },
        ],
      }),
    );
    expect(parsed.setName).toBe("A");
    expect(parsed.warnings.some((w) => w.includes("2 sets"))).toBe(true);
  });

  it("skips invalid slot entries with a warning instead of failing", () => {
    const parsed = ok(
      JSON.stringify({
        stats: { stamina: 100 },
        slots: [
          { slot: "head", itemId: 30243, itemName: "Valid" },
          { slot: "nonsense-slot", itemId: 1, itemName: "Bad slot" },
          { slot: "chest" }, // no item
        ],
      }),
    );
    expect(parsed.slots).toHaveLength(1);
    expect(parsed.warnings).toHaveLength(2);
  });

  it("drops duplicate slots, keeps the first", () => {
    const parsed = ok(
      JSON.stringify({
        slots: [
          { slot: "head", itemId: 1, itemName: "First" },
          { slot: "head", itemId: 2, itemName: "Second" },
        ],
      }),
    );
    expect(parsed.slots).toHaveLength(1);
    expect(parsed.slots[0].itemId).toBe(1);
    expect(parsed.warnings.some((w) => w.includes("Duplicate"))).toBe(true);
  });

  it("ignores non-numeric stats with a warning", () => {
    const parsed = ok(
      JSON.stringify({
        stats: { stamina: 100, weird: "high" },
        slots: [{ slot: "head", itemId: 1, itemName: "X" }],
      }),
    );
    expect(parsed.stats).toEqual({ stamina: 100 });
    expect(parsed.warnings.some((w) => w.includes("weird"))).toBe(true);
  });

  it("rejects non-JSON and JSON without slots", () => {
    expect(parseSixtyUpgradesExport("not json").ok).toBe(false);
    expect(parseSixtyUpgradesExport('{"foo": 1}').ok).toBe(false);
    expect(parseSixtyUpgradesExport('{"slots": []}').ok).toBe(false);
  });
});
