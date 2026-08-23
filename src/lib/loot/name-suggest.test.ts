import { describe, expect, it } from "vitest";

import { boundedDistance, suggestNames, tolerance } from "@/lib/loot/name-suggest";
import { normalizeItemName } from "@/lib/loot/priority-sheet";

const candidate = (label: string, rank = 0) => ({
  key: normalizeItemName(label),
  label,
  rank,
});

describe("boundedDistance", () => {
  it("counts single edits", () => {
    expect(boundedDistance("judgment", "judgement", 4)).toBe(1);
    expect(boundedDistance("belt", "belt", 4)).toBe(0);
  });

  it("gives up rather than computing a distance it will not use", () => {
    // The contract is "at most max, or something larger" — not an exact answer
    // beyond the bound. Callers only ever compare against max.
    expect(boundedDistance("belt", "antonidasaegis", 2)).toBeGreaterThan(2);
  });
});

describe("tolerance", () => {
  it("is stricter on short names than long ones", () => {
    // One wrong letter in "Belt" is a different item; one wrong letter in a
    // thirty-character name is a typo.
    expect(tolerance("belt")).toBe(1);
    expect(tolerance(normalizeItemName("Antonidas's Aegis of Rapt Concentration"))).toBeGreaterThan(1);
  });
});

describe("suggestNames", () => {
  it("offers the guild's real misspellings", () => {
    // Both taken from this guild's own P3 sheet against the resolved items.
    expect(
      suggestNames(normalizeItemName("Hammer of Judgment"), [
        candidate("Hammer of Judgement"),
        candidate("Hammer of the Naaru"),
      ])[0].label,
    ).toBe("Hammer of Judgement");

    expect(
      suggestNames(normalizeItemName("Antonidas' Aegis of Rapt Concentration"), [
        candidate("Antonidas's Aegis of Rapt Concentration"),
      ])[0].label,
    ).toBe("Antonidas's Aegis of Rapt Concentration");
  });

  it("never offers an exact match — there was no question", () => {
    expect(suggestNames(normalizeItemName("Belt"), [candidate("Belt")])).toEqual([]);
  });

  it("prefers the closer name, then the caller's ranking", () => {
    const hits = suggestNames(normalizeItemName("Boots of the Divine Light"), [
      // Same distance; rank decides. Callers rank same-boss above same-zone.
      candidate("Boots of the Divine Might", 1),
      candidate("Boots of the Divine Sight", 0),
    ]);
    expect(hits[0].label).toBe("Boots of the Divine Sight");
  });

  it("stays quiet rather than guessing at an unrelated name", () => {
    // The whole point of exact matching elsewhere is that a plausible wrong
    // answer is worse than none. A suggestion list is allowed to be empty.
    expect(suggestNames(normalizeItemName("Belt of Deep Shadow"), [
      candidate("Warglaive of Azzinoth"),
      candidate("Cowl of Benevolence"),
    ])).toEqual([]);
  });

  it("returns nothing for an empty query", () => {
    expect(suggestNames("", [candidate("Belt")])).toEqual([]);
  });

  it("caps how many it offers", () => {
    const hits = suggestNames(normalizeItemName("Belts"), [
      candidate("Belt"),
      candidate("Bolts"),
      candidate("Belta"),
      candidate("Beltz"),
    ], 2);
    expect(hits).toHaveLength(2);
  });
});
