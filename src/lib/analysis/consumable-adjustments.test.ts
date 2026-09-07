import { describe, expect, it } from "vitest";
import {
  ADJUSTMENT_LIMITS,
  ADJUSTMENTS_FILE_KIND,
  adjustmentGold,
  adjustmentsFor,
  addAdjustment,
  applyAdjustments,
  attributeAdjustments,
  bumpAdjustment,
  exportAdjustments,
  mergeImportedAdjustments,
  parseAdjustmentsFile,
  setAdjustmentNote,
  goldOfLines,
  countChanges,
  groupLines,
  raiderBreakdown,
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
describe("groupLines", () => {
  const priced = (name: string, count: number, cost: number, over = {}) => ({
    name,
    count,
    cost,
    ...over,
  });

  it("puts each line under its family, in the curated order", () => {
    const groups = groupLines([
      priced("Food", 1, 0.5),
      priced("Super Mana Potion", 4, 2),
      priced("Flask of Relentless Assault", 2, 82),
    ]);
    // Flasks before potions before food, whatever order the lines arrived in.
    expect(groups.map((g) => g.label)).toEqual(["Flasks", "Potions", "Food"]);
    expect(groups.map((g) => g.lines.map((l) => l.name))).toEqual([
      ["Flask of Relentless Assault"],
      ["Super Mana Potion"],
      ["Food"],
    ]);
  });

  it("keeps the order the lines arrived in, inside a family", () => {
    // The sort upstream is frozen against the saved adjustments so a press
    // cannot move a line past its neighbour; grouping must not undo that.
    const groups = groupLines([
      priced("Super Mana Potion", 4, 2),
      priced("Haste Potion", 1, 15),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].lines.map((l) => l.name)).toEqual(["Super Mana Potion", "Haste Potion"]);
  });

  it("drops families nobody used, rather than showing an empty heading", () => {
    const groups = groupLines([priced("Food", 1, 0.5)]);
    expect(groups.map((g) => g.group)).toEqual(["food"]);
  });

  it("carries the price and the officer's note through", () => {
    const [group] = groupLines([priced("Haste Potion", 2, 15, { delta: 2, note: "used on the run back" })]);
    expect(group.lines[0]).toMatchObject({ cost: 15, delta: 2, note: "used on the run back" });
  });

  it("has nothing to show for a raider who used nothing", () => {
    expect(groupLines([])).toEqual([]);
  });
});

describe("raiderBreakdown", () => {
  const of = (over: Partial<Parameters<typeof raiderBreakdown>[0]> = {}) =>
    raiderBreakdown({ logged, actorName: "Kazrak", saved: [], pending: [], costPerUse, ...over });

  it("prices and groups a raider's logged lines", () => {
    const { groups, corrections, delta } = of();
    expect(groups.map((g) => g.label)).toEqual(["Flasks", "Potions", "Food"]);
    expect(corrections).toBe(0);
    expect(delta).toBe(0);
  });

  it("charges the pending count and reports what it cost", () => {
    const { groups, corrections, delta } = of({ pending: [adj("Kazrak", "Haste Potion", 2)] });
    const potions = groups.find((g) => g.group === "potion")!;
    expect(potions.lines.find((l) => l.name === "Haste Potion")).toMatchObject({
      count: 2,
      delta: 2,
      added: true,
    });
    expect(corrections).toBe(1);
    expect(delta).toBe(30);
  });

  /*
   * The rule the panel is built on, and the one worth a test of its own: the
   * ORDER comes from `saved`, the COUNTS from `pending`. A line that reshuffled
   * on every press would be unusable — the officer is comparing lines while
   * they work — and a number that sat still while its neighbours moved would be
   * the one thing on screen contradicting itself.
   */
  it("freezes the order against the saved batch while the counts follow the presses", () => {
    const saved: ConsumableAdjustment[] = [];
    // Enough Haste Potions to be the most expensive line by far.
    const pending = [adj("Kazrak", "Haste Potion", 40)];
    const { groups } = raiderBreakdown({ logged, actorName: "Kazrak", saved, pending, costPerUse });
    const potions = groups.find((g) => g.group === "potion")!;

    // 600g of Haste Potion, and it still sits behind the 8g of mana potions,
    // because nothing has been saved yet.
    expect(potions.lines.map((l) => l.name)).toEqual(["Super Mana Potion", "Haste Potion"]);
    expect(potions.lines.find((l) => l.name === "Haste Potion")!.count).toBe(40);
  });

  it("re-sorts once the batch is saved", () => {
    const both = [adj("Kazrak", "Haste Potion", 40)];
    const { groups } = raiderBreakdown({
      logged,
      actorName: "Kazrak",
      saved: both,
      pending: both,
      costPerUse,
    });
    const potions = groups.find((g) => g.group === "potion")!;
    expect(potions.lines.map((l) => l.name)).toEqual(["Haste Potion", "Super Mana Potion"]);
  });

  it("hides a line the raid prices at nothing, unless somebody touched it", () => {
    const free = { ...costPerUse, Food: 0 };
    const names = (pending: ConsumableAdjustment[]) =>
      raiderBreakdown({ logged, actorName: "Kazrak", saved: [], pending, costPerUse: free })
        .groups.flatMap((g) => g.lines.map((l) => l.name));

    // A free line is noise; a free line an officer corrected is a statement.
    expect(names([])).not.toContain("Food");
    expect(names([adj("Kazrak", "Food", 1)])).toContain("Food");
  });

  it("reads only the adjustments belonging to this raider", () => {
    const { corrections, delta } = of({ pending: [adj("Melige", "Haste Potion", 2)] });
    expect(corrections).toBe(0);
    expect(delta).toBe(0);
  });

  it("carries the officer's reason back onto the line it belongs to", () => {
    const { groups } = of({ pending: [adj("Kazrak", "Super Mana Potion", -1, "died holding it")] });
    const line = groups.flatMap((g) => g.lines).find((l) => l.name === "Super Mana Potion");
    expect(line?.note).toBe("died holding it");
  });

  it("finds the note even when the adjustment's name is spaced differently", () => {
    // `applyAdjustments` matches on a normalized name, so a doubled space folds
    // into the logged line and the row shows a correction. Matching the note
    // any more loosely than that would show the correction with its reason
    // silently missing — which is the half an officer wrote down on purpose.
    const { groups } = of({
      pending: [adj("Kazrak", "Super  Mana   Potion", -1, "died holding it")],
    });
    const line = groups.flatMap((g) => g.lines).find((l) => l.name === "Super Mana Potion");
    expect(line?.delta).toBe(-1);
    expect(line?.note).toBe("died holding it");
  });
});

describe("countChanges", () => {
  it("counts nothing when the batch matches what is saved", () => {
    const saved = [adj("Kazrak", "Haste Potion", 2)];
    expect(countChanges(saved, [...saved])).toBe(0);
  });

  it("counts an entry added, one dropped, and one moved off its saved delta", () => {
    const saved = [adj("Kazrak", "Haste Potion", 2), adj("Melige", "Food", 1)];
    const pending = [adj("Kazrak", "Haste Potion", 5), adj("Thrainn", "Super Mana Potion", 1)];
    // Kazrak moved, Melige's was dropped, Thrainn's is new.
    expect(countChanges(saved, pending)).toBe(3);
  });

  it("counts a batch that presses + and − back to nothing as nothing", () => {
    // Counting presses would say two. There is nothing to save.
    const saved = [adj("Kazrak", "Haste Potion", 2)];
    expect(countChanges(saved, [adj("Kazrak", "Haste Potion", 2)])).toBe(0);
  });

  it("treats writing a reason as a change, and as two", () => {
    // The note is part of the key, so a correction that gains one reads as the
    // old entry dropped and a new one added. That is the honest count for a
    // batch the officer still has to save, and it errs upward — which is the
    // safe direction for a number whose job is to stop somebody navigating away.
    const saved = [adj("Kazrak", "Haste Potion", 2)];
    expect(countChanges(saved, [adj("Kazrak", "Haste Potion", 2, "on the run back")])).toBe(2);
  });

  it("cannot be fooled by a note that runs into the next field", () => {
    /*
     * The key joins three arbitrary strings — a raider's name, a consumable's
     * name and an officer's free text — so the separator has to be something
     * nobody can type. These two collide under any printable one:
     *
     *     "Haste Potion"   + "x y"
     *     "Haste Potion x" + "y"
     *
     * With a space between the fields both are "kazrak haste potion x y", the
     * second correction lands on the first one's key at the same delta, and the
     * batch reports NOTHING to save while holding a replacement the officer
     * made on purpose.
     */
    const saved = [adj("Kazrak", "Haste Potion", 1, "x y")];
    const pending = [adj("Kazrak", "Haste Potion x", 1, "y")];
    // One dropped, one added.
    expect(countChanges(saved, pending)).toBe(2);
  });

  it("ignores case and padding, the way every other matcher here does", () => {
    const saved = [adj("Kazrak", "Haste Potion", 2)];
    expect(countChanges(saved, [adj("  kazrak ", " HASTE POTION ", 2)])).toBe(0);
  });
});

describe("exportAdjustments", () => {
  it("names itself, the night it came from, and when it was written", () => {
    const file = exportAdjustments({
      code: "abc123",
      adjustments: [adj("Thrainn", "Flask of Relentless Assault", 1, "before the pull timer")],
      at: "2026-09-07T18:00:00.000Z",
    });
    expect(file.kind).toBe(ADJUSTMENTS_FILE_KIND);
    expect(file.version).toBe(1);
    expect(file.code).toBe("abc123");
    expect(file.exportedAt).toBe("2026-09-07T18:00:00.000Z");
    expect(file.adjustments).toHaveLength(1);
  });

  it("carries the author and the timestamp, or an export is lossy", () => {
    const stored: ConsumableAdjustment = {
      actorName: "Thrainn",
      name: "Food",
      delta: 1,
      by: "Vaelen",
      at: "2026-08-02T20:00:00.000Z",
    };
    const [out] = exportAdjustments({
      code: "abc123",
      adjustments: [stored],
      at: "2026-09-07T18:00:00.000Z",
    }).adjustments;
    expect(out.by).toBe("Vaelen");
    expect(out.at).toBe("2026-08-02T20:00:00.000Z");
  });

  it("copies rather than aliasing, so the buffer can go on being edited", () => {
    const source = [adj("Thrainn", "Food", 1)];
    const file = exportAdjustments({ code: "abc123", adjustments: source, at: "now" });
    source[0].delta = 99;
    expect(file.adjustments[0].delta).toBe(1);
  });
});

describe("parseAdjustmentsFile", () => {
  const at = "2026-09-07T18:00:00.000Z";

  it("reads back exactly what it wrote", () => {
    const adjustments = [
      adj("Thrainn", "Flask of Relentless Assault", 1, "before the pull timer"),
      adj("Pyrelia", "Super Mana Potion", -2),
    ];
    const file = exportAdjustments({ code: "abc123", adjustments, at });
    const back = parseAdjustmentsFile(JSON.parse(JSON.stringify(file)), at);
    expect(back?.code).toBe("abc123");
    expect(back?.skipped).toBe(0);
    // `adj` writes `note: undefined` for an unnoted correction; the parser drops
    // the key entirely, which is how the server stores it.
    expect(back?.adjustments).toEqual([
      {
        actorName: "Thrainn",
        name: "Flask of Relentless Assault",
        delta: 1,
        note: "before the pull timer",
        at: adjustments[0].at,
      },
      { actorName: "Pyrelia", name: "Super Mana Potion", delta: -2, at: adjustments[1].at },
    ]);
  });

  it("reads a bare array, so a list somebody assembled by hand works", () => {
    const back = parseAdjustmentsFile([{ actorName: "Thrainn", name: "Food", delta: 1, at }], at);
    expect(back?.adjustments).toHaveLength(1);
    expect(back?.code).toBeUndefined();
  });

  it("is null for anything that isn't a list of corrections", () => {
    expect(parseAdjustmentsFile(null, at)).toBeNull();
    expect(parseAdjustmentsFile(42, at)).toBeNull();
    expect(parseAdjustmentsFile("[]", at)).toBeNull();
    // The prices file — the other thing an officer might pick by mistake.
    expect(parseAdjustmentsFile({ "Super Mana Potion": { gold: 30, charges: 5 } }, at)).toBeNull();
  });

  it("skips what the server would refuse, and counts it", () => {
    const back = parseAdjustmentsFile(
      [
        { actorName: "Thrainn", name: "Food", delta: 1, at },
        // Zero corrects nothing.
        { actorName: "Thrainn", name: "Food", delta: 0, at },
        { actorName: "Thrainn", name: "Food", delta: 1.5, at },
        { actorName: "Thrainn", name: "Food", delta: "1", at },
        { actorName: "", name: "Food", delta: 1, at },
        { actorName: "Thrainn", name: "   ", delta: 1, at },
        { actorName: "T".repeat(61), name: "Food", delta: 1, at },
        { actorName: "Thrainn", name: "F".repeat(81), delta: 1, at },
        null,
        "nope",
      ],
      at,
    );
    expect(back?.adjustments).toHaveLength(1);
    expect(back?.skipped).toBe(9);
  });

  it("truncates a long note but keeps the correction, and drops a long author", () => {
    const back = parseAdjustmentsFile(
      [
        {
          actorName: "Thrainn",
          name: "Food",
          delta: 1,
          note: "x".repeat(400),
          by: "y".repeat(81),
          at,
        },
      ],
      at,
    );
    // The prose is the expendable half — the correction it explains is not.
    expect(back?.adjustments[0].note).toHaveLength(200);
    expect(back?.adjustments[0].by).toBeUndefined();
    expect(back?.skipped).toBe(0);
  });

  it("stamps the import time on an entry with no usable one of its own", () => {
    const back = parseAdjustmentsFile([{ actorName: "Thrainn", name: "Food", delta: 1 }], at);
    expect(back?.adjustments[0].at).toBe(at);
  });
});

describe("mergeImportedAdjustments", () => {
  const known = ["Thrainn", "Pyrelia"];

  it("re-importing a night's own export changes nothing", () => {
    const current = [adj("Thrainn", "Food", 2, "held it"), adj("Pyrelia", "Super Mana Potion", -1)];
    const { adjustments, applied, absent } = mergeImportedAdjustments({
      current,
      imported: current.map((a) => ({ ...a })),
      knownActors: known,
    });
    expect(adjustments).toEqual(current);
    expect(applied).toBe(2);
    expect(absent).toBe(0);
  });

  it("replaces a pair rather than adding to it — a doubled correction is the trap", () => {
    const { adjustments } = mergeImportedAdjustments({
      current: [adj("Thrainn", "Food", 2)],
      imported: [adj("Thrainn", "Food", 3, "counted again")],
      knownActors: known,
    });
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].delta).toBe(3);
    expect(adjustments[0].note).toBe("counted again");
  });

  it("leaves a pair the file is silent about alone", () => {
    const { adjustments } = mergeImportedAdjustments({
      current: [adj("Thrainn", "Food", 2), adj("Pyrelia", "Haste Potion", 1)],
      imported: [adj("Thrainn", "Food", 5)],
      knownActors: known,
    });
    expect(adjustments.map((a) => [a.actorName, a.delta])).toEqual([
      ["Thrainn", 5],
      ["Pyrelia", 1],
    ]);
  });

  it("keeps a replaced correction in its place and puts a new one on the end", () => {
    const { adjustments } = mergeImportedAdjustments({
      current: [adj("Thrainn", "Food", 1), adj("Pyrelia", "Haste Potion", 1)],
      imported: [adj("Pyrelia", "Super Mana Potion", 2), adj("Thrainn", "Food", 9)],
      knownActors: known,
    });
    expect(adjustments.map((a) => a.name)).toEqual(["Food", "Haste Potion", "Super Mana Potion"]);
    expect(adjustments[0].delta).toBe(9);
  });

  it("sums a split pair instead of losing half of it", () => {
    // The shape old data comes in: one noted entry, one not, both stored.
    const { adjustments, applied } = mergeImportedAdjustments({
      current: [],
      imported: [adj("Thrainn", "Food", 2, "pre-pull"), adj("Thrainn", "Food", 3)],
      knownActors: known,
    });
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].delta).toBe(5);
    expect(adjustments[0].note).toBe("pre-pull");
    expect(applied).toBe(1);
  });

  it("never removes a standing correction, even when the file's entries cancel", () => {
    const { adjustments, applied } = mergeImportedAdjustments({
      current: [adj("Thrainn", "Food", 4)],
      imported: [adj("Thrainn", "Food", 2, "a"), adj("Thrainn", "Food", -2)],
      knownActors: known,
    });
    expect(adjustments).toEqual([adj("Thrainn", "Food", 4)]);
    expect(applied).toBe(0);
  });

  it("drops raiders this raid never had, and counts them", () => {
    const { adjustments, applied, absent } = mergeImportedAdjustments({
      current: [],
      imported: [adj("Thrainn", "Food", 1), adj("Gorlok", "Food", 1), adj("Ysolde", "Food", 1)],
      knownActors: known,
    });
    expect(adjustments.map((a) => a.actorName)).toEqual(["Thrainn"]);
    expect(applied).toBe(1);
    expect(absent).toBe(2);
  });

  it("matches raiders and consumables the way every other matcher here does", () => {
    const { adjustments, absent } = mergeImportedAdjustments({
      current: [adj("Thrainn", "Super Mana Potion", 1)],
      imported: [adj("  thrainn ", " SUPER  MANA   POTION ", 7)],
      knownActors: known,
    });
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].delta).toBe(7);
    expect(absent).toBe(0);
  });

  it("adds a consumable the raid never logged — that is what an addition is for", () => {
    // Names are deliberately NOT filtered against the raid: a flask drunk
    // before the pull timer appears in no breakdown, and recording it is the
    // whole reason corrections exist.
    const { adjustments, applied } = mergeImportedAdjustments({
      current: [],
      imported: [adj("Thrainn", "Nightmare Seed", 1, "used on the run back")],
      knownActors: known,
    });
    expect(adjustments).toHaveLength(1);
    expect(applied).toBe(1);
  });
});

describe("a night's corrections survive a round trip through a file", () => {
  /*
   * The promise the two buttons make, asserted end to end rather than in
   * halves: export a raid, hand the file straight back, and the batch has
   * nothing to save. Each piece passing on its own does not give you this —
   * `JSON.stringify` drops an absent note, the parser re-reads a name with its
   * own trimming, and the merge matches on a third rule again. Any one of them
   * disagreeing shows up here as a badge offering to save corrections that are
   * already stored, which is exactly the thing an officer cannot tell apart
   * from real unsaved work.
   */
  it("leaves the batch clean", () => {
    const saved = [
      adj("Thrainn", "Flask of Relentless Assault", 1, "drunk before the pull timer"),
      adj("Pyrelia", "Super Mana Potion", -2),
      { actorName: "Kazrak", name: "Food", delta: 3, by: "Vaelen", at: "2026-08-02T20:00:00.000Z" },
    ];
    const at = "2026-09-07T18:00:00.000Z";

    const file = exportAdjustments({ code: "abc123", adjustments: saved, at });
    const read = parseAdjustmentsFile(JSON.parse(JSON.stringify(file)), at);
    const { adjustments, applied, absent } = mergeImportedAdjustments({
      current: saved,
      imported: read?.adjustments ?? [],
      knownActors: ["Thrainn", "Pyrelia", "Kazrak"],
    });

    expect(applied).toBe(3);
    expect(absent).toBe(0);
    expect(countChanges(saved, adjustments)).toBe(0);
    // And the gold it prices out is the same gold, which is what the card shows.
    expect(applyAdjustments(logged, adjustmentsFor(adjustments, "Thrainn"))).toEqual(
      applyAdjustments(logged, adjustmentsFor(saved, "Thrainn")),
    );
  });

  it("carries a standing correction onto a different night", () => {
    // The reason the file records `code` but does not enforce it: "Thrainn
    // always drinks his flask before the pull timer" is true every week.
    const lastWeek = [adj("Thrainn", "Flask of Relentless Assault", 1, "before the pull timer")];
    const file = exportAdjustments({ code: "lastweek", adjustments: lastWeek, at: "then" });
    const read = parseAdjustmentsFile(JSON.parse(JSON.stringify(file)), "now");

    const { adjustments, applied, absent } = mergeImportedAdjustments({
      current: [adj("Pyrelia", "Haste Potion", 2)],
      imported: read?.adjustments ?? [],
      // Thrainn raided again; the rest of last week's list did not.
      knownActors: ["Thrainn", "Pyrelia"],
    });

    expect(read?.code).toBe("lastweek");
    expect(applied).toBe(1);
    expect(absent).toBe(0);
    // This week's own correction is untouched, last week's is now beside it.
    expect(adjustments.map((a) => a.actorName)).toEqual(["Pyrelia", "Thrainn"]);
  });
});

describe("ADJUSTMENT_LIMITS", () => {
  it("is what the parser actually enforces, both sides of each edge", () => {
    /*
     * The point of the constant is that the server's gate and this parser read
     * one number. That the gate reads it is a fact about `logs/actions.ts`,
     * which is a server action and cannot be imported here — so what is pinned
     * here is the other half: raising a limit without touching the parser can
     * no longer pass silently, because these assertions are written against the
     * constant rather than against 60, 80 and 200.
     */
    const at = "2026-09-07T18:00:00.000Z";
    const of = (over: Record<string, unknown>) =>
      parseAdjustmentsFile([{ actorName: "Thrainn", name: "Food", delta: 1, at, ...over }], at);

    expect(of({ actorName: "T".repeat(ADJUSTMENT_LIMITS.actorName) })?.skipped).toBe(0);
    expect(of({ actorName: "T".repeat(ADJUSTMENT_LIMITS.actorName + 1) })?.skipped).toBe(1);
    expect(of({ name: "F".repeat(ADJUSTMENT_LIMITS.name) })?.skipped).toBe(0);
    expect(of({ name: "F".repeat(ADJUSTMENT_LIMITS.name + 1) })?.skipped).toBe(1);
    expect(of({ by: "V".repeat(ADJUSTMENT_LIMITS.by) })?.adjustments[0].by).toHaveLength(
      ADJUSTMENT_LIMITS.by,
    );
    expect(of({ by: "V".repeat(ADJUSTMENT_LIMITS.by + 1) })?.adjustments[0].by).toBeUndefined();
    // Prose, so it is cut rather than costing the correction its place.
    expect(of({ note: "x".repeat(ADJUSTMENT_LIMITS.note + 50) })?.adjustments[0].note).toHaveLength(
      ADJUSTMENT_LIMITS.note,
    );
  });
});
