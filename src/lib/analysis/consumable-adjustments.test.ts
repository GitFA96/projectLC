import { describe, expect, it } from "vitest";
import {
  adjustmentGold,
  adjustmentsFor,
  applyAdjustments,
  bumpAdjustment,
  goldOfLines,
} from "@/lib/analysis/consumable-adjustments";
import type { ConsumableAdjustment } from "@/lib/types";

function adj(
  actorName: string,
  name: string,
  delta: number,
  note?: string,
): ConsumableAdjustment {
  return { actorName, name, delta, note, at: "2026-08-02T20:00:00.000Z" };
}

const logged = [
  { name: "Flask of Relentless Assault", count: 2 },
  { name: "Super Mana Potion", count: 4 },
  { name: "Food", count: 1 },
];

const costPerUse = {
  "Flask of Relentless Assault": 82,
  "Super Mana Potion": 2,
  Food: 0.5,
  "Haste Potion": 15,
};

describe("adjustmentsFor", () => {
  const all = [adj("Thrainn", "Food", 1), adj("Pyrelia", "Food", -1)];

  it("picks out one raider's corrections, however the name was typed", () => {
    expect(adjustmentsFor(all, "thrainn")).toHaveLength(1);
    expect(adjustmentsFor(all, "  THRAINN ")).toHaveLength(1);
    expect(adjustmentsFor(all, "Nobody")).toEqual([]);
  });
});

describe("applyAdjustments", () => {
  it("returns the logged lines untouched when nothing was adjusted", () => {
    expect(applyAdjustments(logged, [])).toEqual(logged);
  });

  it("adds uses to a consumable the log already saw", () => {
    const out = applyAdjustments(logged, [adj("x", "Flask of Relentless Assault", 1)]);
    expect(out.find((l) => l.name === "Flask of Relentless Assault")).toEqual({
      name: "Flask of Relentless Assault",
      count: 3,
      delta: 1,
    });
    // Everything else is left exactly alone, with no delta marker.
    expect(out.find((l) => l.name === "Food")).toEqual({ name: "Food", count: 1 });
  });

  it("removes uses, and drops the line entirely when it hits zero", () => {
    const out = applyAdjustments(logged, [adj("x", "Food", -1)]);
    expect(out.some((l) => l.name === "Food")).toBe(false);
    expect(out).toHaveLength(2);
  });

  it("floors a removal at zero rather than paying a refund", () => {
    // "minus five flasks" on someone with two is a mistake, not -3 flasks.
    const out = applyAdjustments(logged, [adj("x", "Flask of Relentless Assault", -5)]);
    expect(out.some((l) => l.name.startsWith("Flask"))).toBe(false);
    expect(goldOfLines(out, costPerUse)).toBeGreaterThanOrEqual(0);
  });

  it("adds a consumable the log never saw as a new line", () => {
    const out = applyAdjustments(logged, [adj("x", "Haste Potion", 2)]);
    expect(out.find((l) => l.name === "Haste Potion")).toEqual({
      name: "Haste Potion",
      count: 2,
      delta: 2,
      added: true,
    });
  });

  it("ignores a removal for something they never had", () => {
    expect(applyAdjustments(logged, [adj("x", "Haste Potion", -1)])).toEqual(logged);
  });

  it("matches the logged name regardless of case or spacing", () => {
    const out = applyAdjustments(logged, [adj("x", "  super  mana potion ", -1)]);
    expect(out.find((l) => l.name === "Super Mana Potion")!.count).toBe(3);
    // And doesn't create a second line under the typed spelling.
    expect(out).toHaveLength(3);
  });

  it("sums several corrections to the same consumable", () => {
    const out = applyAdjustments(logged, [
      adj("x", "Super Mana Potion", 2),
      adj("x", "Super Mana Potion", -1),
    ]);
    expect(out.find((l) => l.name === "Super Mana Potion")).toMatchObject({ count: 5, delta: 1 });
  });
});

describe("adjustmentGold", () => {
  it("is the signed difference the officer's edits made", () => {
    const add = applyAdjustments(logged, [adj("x", "Flask of Relentless Assault", 1)]);
    expect(adjustmentGold(logged, add, costPerUse)).toBe(82);

    const remove = applyAdjustments(logged, [adj("x", "Super Mana Potion", -2)]);
    expect(adjustmentGold(logged, remove, costPerUse)).toBe(-4);
  });

  it("is zero when nothing changed", () => {
    expect(adjustmentGold(logged, applyAdjustments(logged, []), costPerUse)).toBe(0);
  });

  it("prices a hand-added consumable nobody was logged using", () => {
    const out = applyAdjustments(logged, [adj("x", "Haste Potion", 2)]);
    expect(adjustmentGold(logged, out, costPerUse)).toBe(30);
  });
});

describe("bumpAdjustment", () => {
  const at = "2026-08-13T20:00:00.000Z";
  const press = (adjustments: ConsumableAdjustment[], direction: 1 | -1 = 1) =>
    bumpAdjustment({ adjustments, actorName: "Katzewarr", name: "Super Mana Potion", direction, at });

  it("opens a correction when the raider has none", () => {
    expect(press([])).toEqual([
      { actorName: "Katzewarr", name: "Super Mana Potion", delta: 1, at },
    ]);
  });

  it("merges repeat presses into one entry rather than a row each", () => {
    let list = press([]);
    list = press(list);
    list = press(list);
    expect(list).toHaveLength(1);
    expect(list[0].delta).toBe(3);
  });

  it("matches the raider and consumable however they're punctuated", () => {
    const list = press([
      { actorName: "katzewarr", name: "super mana potion", delta: 2, at: "2026-08-01T00:00:00.000Z" },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].delta).toBe(3);
    expect(list[0].at).toBe(at);
  });

  it("leaves somebody else's line alone", () => {
    const other = { actorName: "Scomb", name: "Super Mana Potion", delta: 2, at };
    const list = press([other]);
    expect(list).toHaveLength(2);
    expect(list).toContainEqual(other);
  });

  it("never rewrites a correction that carries a note", () => {
    // Someone explained that number. A ± press must not change what their
    // sentence refers to, so it gets its own entry beside it.
    const noted = {
      actorName: "Katzewarr",
      name: "Super Mana Potion",
      delta: 2,
      note: "client dropped mid-Vashj",
      at: "2026-08-01T00:00:00.000Z",
    };
    const list = press([noted]);
    expect(list).toContainEqual(noted);
    expect(list).toHaveLength(2);
    expect(list[1].delta).toBe(1);
  });

  it("drops a correction that presses back to zero", () => {
    // "+0" in the audit list would claim a change nobody is making.
    const list = press(press([]), -1);
    expect(list).toEqual([]);
  });
});
