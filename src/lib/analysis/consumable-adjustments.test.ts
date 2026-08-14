import { describe, expect, it } from "vitest";
import {
  adjustmentGold,
  adjustmentsFor,
  addAdjustment,
  applyAdjustments,
  attributeAdjustments,
  bumpAdjustment,
  setAdjustmentNote,
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

  it("carries a reason through a press instead of splitting the line", () => {
    // The note and the ± are on one line of one panel now, so a press is not
    // silent and does not need its own entry. One correction per raider per
    // consumable is what that panel shows.
    const noted = {
      actorName: "Katzewarr",
      name: "Super Mana Potion",
      delta: 2,
      note: "client dropped mid-Vashj",
      at: "2026-08-01T00:00:00.000Z",
    };
    const list = press([noted]);
    expect(list).toHaveLength(1);
    expect(list[0].delta).toBe(3);
    expect(list[0].note).toBe("client dropped mid-Vashj");
  });

  it("drops a correction that presses back to zero", () => {
    // "+0" in the audit list would claim a change nobody is making.
    const list = press(press([]), -1);
    expect(list).toEqual([]);
  });
});

describe("bumpAdjustment, batched", () => {
  const at = "2026-08-13T20:00:00.000Z";
  const press = (
    adjustments: ConsumableAdjustment[],
    actorName: string,
    name: string,
    direction: 1 | -1 = 1,
  ) => bumpAdjustment({ adjustments, actorName, name, direction, at });

  // The gold table buffers a whole batch of presses before it writes, so each
  // press folds into the previous press's output rather than into the saved
  // list. These are the cases that only show up once a batch can stay open.

  it("keeps one entry per raider and consumable across a mixed batch", () => {
    let list: ConsumableAdjustment[] = [];
    list = press(list, "Katzewarr", "Flask of Relentless Assault", -1);
    list = press(list, "Scomb", "Haste Potion");
    list = press(list, "Katzewarr", "Scroll of Agility V", -1);
    list = press(list, "Katzewarr", "Flask of Relentless Assault", -1);
    list = press(list, "Scomb", "Haste Potion");

    expect(list).toEqual([
      { actorName: "Katzewarr", name: "Flask of Relentless Assault", delta: -2, at },
      { actorName: "Scomb", name: "Haste Potion", delta: 2, at },
      { actorName: "Katzewarr", name: "Scroll of Agility V", delta: -1, at },
    ]);
  });

  it("leaves a batch that nets out with nothing to save", () => {
    let list: ConsumableAdjustment[] = [];
    list = press(list, "Wando", "Super Sapper Charge");
    list = press(list, "Greymatter", "Dark Rune", -1);
    list = press(list, "Wando", "Super Sapper Charge", -1);
    list = press(list, "Greymatter", "Dark Rune");
    expect(list).toEqual([]);
  });

  it("carries the saved list through a batch instead of replacing it", () => {
    // The buffer is seeded from what is already saved, so an untouched raider's
    // correction has to survive a batch aimed at somebody else — the save
    // replaces the whole list, and a dropped entry would silently undo them.
    const saved: ConsumableAdjustment[] = [
      { actorName: "Wildmilky", name: "Elixir of Draenic Wisdom", delta: 2, at: "2026-08-01T00:00:00.000Z" },
    ];
    const list = press(press(saved, "Scomb", "Food"), "Scomb", "Food");
    expect(list).toContainEqual(saved[0]);
    expect(list).toHaveLength(2);
  });
});

describe("attributeAdjustments", () => {
  const then = "2026-08-01T00:00:00.000Z";
  const now = "2026-08-14T20:00:00.000Z";
  const mine = (over: Partial<ConsumableAdjustment> = {}): ConsumableAdjustment => ({
    actorName: "Katzewarr",
    name: "Flask of Relentless Assault",
    delta: -1,
    at: then,
    by: "Scomb",
    ...over,
  });

  it("stamps a correction nobody had made before", () => {
    const [entry] = attributeAdjustments({
      stored: [],
      incoming: [{ actorName: "Wando", name: "Haste Potion", delta: 2, at: then }],
      actor: "Greymatter",
      at: now,
    });
    expect(entry.by).toBe("Greymatter");
    expect(entry.at).toBe(now);
  });

  it("leaves an untouched correction with its original author", () => {
    // The save replaces the whole list, so somebody else's entry rides along in
    // every write. Restamping it would credit this officer with their work.
    const [entry] = attributeAdjustments({
      stored: [mine()],
      incoming: [mine()],
      actor: "Greymatter",
      at: now,
    });
    expect(entry.by).toBe("Scomb");
    expect(entry.at).toBe(then);
  });

  it("takes the author over when the delta moves", () => {
    const [entry] = attributeAdjustments({
      stored: [mine()],
      incoming: [mine({ delta: -3 })],
      actor: "Greymatter",
      at: now,
    });
    expect(entry.by).toBe("Greymatter");
    expect(entry.at).toBe(now);
  });

  it("takes the author over when the reason is rewritten", () => {
    const [entry] = attributeAdjustments({
      stored: [mine({ note: "client dropped" })],
      incoming: [mine({ note: "logged out at the summon" })],
      actor: "Greymatter",
      at: now,
    });
    expect(entry.by).toBe("Greymatter");
  });

  it("refuses an author the client tried to claim", () => {
    const [entry] = attributeAdjustments({
      stored: [],
      incoming: [{ actorName: "Wando", name: "Dark Rune", delta: 1, at: then, by: "Somebody Else" }],
      actor: "Greymatter",
      at: now,
    });
    expect(entry.by).toBe("Greymatter");
  });

  it("keeps a noted and an unnoted entry on one line apart", () => {
    // `bumpAdjustment` deliberately appends beside a noted correction rather
    // than merging into it, so both exist at once and must attribute separately.
    const noted = mine({ note: "pre-potted", by: "Scomb" });
    const bare = mine({ delta: -2 });
    const out = attributeAdjustments({
      stored: [noted, bare],
      incoming: [noted, { ...bare, delta: -4 }],
      actor: "Greymatter",
      at: now,
    });
    expect(out[0].by).toBe("Scomb");
    expect(out[1].by).toBe("Greymatter");
  });
});


describe("setAdjustmentNote", () => {
  const at = "2026-08-13T20:00:00.000Z";
  const base: ConsumableAdjustment[] = [
    { actorName: "Katzewarr", name: "Super Mana Potion", delta: 2, at },
    { actorName: "Wando", name: "Super Mana Potion", delta: 1, at },
  ];

  it("writes a reason against the raider's own correction", () => {
    const out = setAdjustmentNote({
      adjustments: base,
      actorName: "Katzewarr",
      name: "super mana potion",
      note: "  client dropped  ",
    });
    expect(out[0].note).toBe("client dropped");
    expect(out[1].note).toBeUndefined();
  });

  it("drops the field when the reason is cleared, rather than storing empty", () => {
    // A stored "" would differ from an entry saved without one, and
    // `attributeAdjustments` would read that difference as a fresh edit.
    const noted = setAdjustmentNote({
      adjustments: base,
      actorName: "Katzewarr",
      name: "Super Mana Potion",
      note: "typo",
    });
    const cleared = setAdjustmentNote({
      adjustments: noted,
      actorName: "Katzewarr",
      name: "Super Mana Potion",
      note: "   ",
    });
    expect("note" in cleared[0]).toBe(false);
  });

  it("writes nothing when there is no correction to explain", () => {
    const out = setAdjustmentNote({
      adjustments: base,
      actorName: "Greymatter",
      name: "Dark Rune",
      note: "pre-potted",
    });
    expect(out).toEqual(base);
  });
});

describe("addAdjustment", () => {
  const at = "2026-08-13T20:00:00.000Z";

  it("records a consumable the log never saw", () => {
    const out = addAdjustment({
      adjustments: [],
      actorName: "Katzewarr",
      name: "Flask of Relentless Assault",
      count: 1,
      note: "drunk before the pull timer",
      at,
    });
    expect(out).toEqual([
      {
        actorName: "Katzewarr",
        name: "Flask of Relentless Assault",
        delta: 1,
        note: "drunk before the pull timer",
        at,
      },
    ]);
  });

  it("folds into an existing correction rather than opening a second", () => {
    const first = addAdjustment({
      adjustments: [],
      actorName: "Katzewarr",
      name: "Dark Rune",
      count: 2,
      at,
    });
    const second = addAdjustment({
      adjustments: first,
      actorName: "katzewarr",
      name: "dark rune",
      count: 3,
      at,
    });
    expect(second).toHaveLength(1);
    expect(second[0].delta).toBe(5);
  });

  it("refuses a blank name or a zero count", () => {
    const base: ConsumableAdjustment[] = [];
    expect(addAdjustment({ adjustments: base, actorName: "W", name: "  ", count: 1, at })).toBe(base);
    expect(addAdjustment({ adjustments: base, actorName: "W", name: "Food", count: 0, at })).toBe(base);
  });
});
