import { describe, expect, it } from "vitest";
import { averageItemLevel, buildPreparedness } from "@/lib/analysis/preparedness";
import { DEFAULT_POLICY } from "@/lib/analysis/policy";
import type { WclPlayerFight, WclPlayerOffPull } from "@/lib/types";

/* Labels curated in wcl/consumables.ts — the same strings ingest stores. */
const BATTLE = "Elixir of Major Agility";
const GUARDIAN = "Elixir of Draenic Wisdom";
const FLASK = "Flask of Relentless Assault";

type Gear = WclPlayerFight["gear"];

const gearItem = (slot: number, over: Partial<Gear[number]> = {}): Gear[number] => ({
  slot,
  id: 28000 + slot,
  ilvl: 120,
  gems: [],
  ...over,
});

const row = (over: Partial<WclPlayerFight> = {}): WclPlayerFight => ({
  id: `r|${over.fightId ?? 1}|${over.actorName ?? "Aizaizbaby"}`,
  reportCode: "r",
  fightId: 1,
  encounterId: 623,
  encounterName: "Lady Vashj",
  kill: true,
  durationMs: 300_000,
  actorName: "Aizaizbaby",
  characterId: null,
  role: "dps",
  deaths: 0,
  deathTimes: [],
  elixirs: [],
  scrolls: [],
  food: false,
  weaponBuff: false,
  prepot: false,
  potions: [],
  otherCasts: [],
  extras: [],
  cooldowns: [],
  castTimes: [],
  upkeep: [],
  drums: 0,
  runes: 0,
  healthstones: 0,
  sappers: 0,
  missingEnchants: [],
  gear: [],
  talents: [],
  ...over,
});

const build = (
  rows: WclPlayerFight[],
  slugs: [string, string][] = [],
  offPull: WclPlayerOffPull[] = [],
) => buildPreparedness({ rows, slugByActor: new Map(slugs), offPull, policy: DEFAULT_POLICY });

const offPullFor = (
  actorName: string,
  petConsumables: { name: string; atMs?: number; fightId?: number }[],
): WclPlayerOffPull => ({
  id: `r|${actorName.toLowerCase()}`,
  reportCode: "r",
  actorName,
  characterId: null,
  potions: [],
  otherCasts: [],
  drums: 0,
  runes: 0,
  healthstones: 0,
  sappers: 0,
  petConsumables,
});

describe("averageItemLevel", () => {
  it("leaves shirt and tabard out — they are worn and say nothing about gear", () => {
    const gear = [
      gearItem(0, { ilvl: 130 }),
      gearItem(1, { ilvl: 130 }),
      // Shirt and tabard, both level 1. Counted, they would halve the answer.
      gearItem(3, { ilvl: 1 }),
      gearItem(18, { ilvl: 1 }),
    ];
    expect(averageItemLevel(gear)).toBe(130);
  });

  it("keeps one decimal — whole numbers put half a roster on the same value", () => {
    expect(averageItemLevel([gearItem(0, { ilvl: 130 }), gearItem(1, { ilvl: 133 })])).toBe(131.5);
  });

  it("ignores slots with no item level rather than counting them as zero", () => {
    expect(averageItemLevel([gearItem(0, { ilvl: 130 }), gearItem(1, { ilvl: undefined })])).toBe(130);
  });

  it("has no answer for a pull that carried no gear snapshot", () => {
    expect(averageItemLevel([])).toBeUndefined();
  });
});

describe("buildPreparedness", () => {
  it("sorts raiders by name, not by how prepared they were", () => {
    const view = build([
      row({ actorName: "Wando" }),
      row({ actorName: "Aizaizbaby", flask: FLASK, food: true }),
      row({ actorName: "Mahla" }),
    ]);
    expect(view.rows.map((r) => r.name)).toEqual(["Aizaizbaby", "Mahla", "Wando"]);
  });

  it("keeps one entry per pull, in pull order", () => {
    const view = build([
      row({ fightId: 3 }),
      row({ fightId: 1 }),
      row({ fightId: 2 }),
    ]);
    expect(view.rows[0].pulls.map((p) => p.fightId)).toEqual([1, 2, 3]);
  });

  it("leaves out pulls a raider was not on, rather than blanking them", () => {
    const view = build([
      row({ fightId: 1, actorName: "Wando" }),
      row({ fightId: 2, actorName: "Wando" }),
      row({ fightId: 2, actorName: "Mahla" }),
    ]);
    const mahla = view.rows.find((r) => r.name === "Mahla");
    expect(mahla?.pulls.map((p) => p.fightId)).toEqual([2]);
  });

  it("reads prepared through isPrepared — coverage AND food, never one of them", () => {
    const view = build([
      row({ fightId: 1, flask: FLASK, food: true }),
      row({ fightId: 2, flask: FLASK, food: false }),
      row({ fightId: 3, food: true }),
    ]);
    expect(view.rows[0].pulls.map((p) => p.prepared)).toEqual([true, false, false]);
  });

  it("grades the elixir budget as a fact and names the empty half", () => {
    const view = build([
      row({ fightId: 1, flask: FLASK }),
      row({ fightId: 2, elixirs: [BATTLE, GUARDIAN] }),
      row({ fightId: 3, elixirs: [BATTLE] }),
      row({ fightId: 4 }),
    ]);
    const pulls = view.rows[0].pulls;
    expect(pulls.map((p) => p.grade)).toEqual(["flask", "full", "partial", "none"]);
    expect(pulls[2].missingSlot).toBe("guardianElixir");
  });

  it("recovers a food that names its own buff, the same way the rest of the app does", () => {
    // Skullfish Soup applies "Enlightened", not "Well Fed" — the row's own
    // boolean is false and `extras` is where the truth is.
    const view = build([row({ food: false, extras: ["Enlightened"] })]);
    expect(view.rows[0].pulls[0].food).toBe(true);
  });

  it("counts enchanted slots against the expected total", () => {
    const view = build([row({ missingEnchants: ["Chest", "Wrist"] })]);
    const pull = view.rows[0].pulls[0];
    expect(pull.enchanted).toBe(view.enchantSlots - 2);
    expect(pull.missingEnchants).toEqual(["Chest", "Wrist"]);
  });

  it("counts every gem across the worn set", () => {
    const view = build([
      row({
        gear: [
          gearItem(0, { gems: [{ id: 1 }, { id: 2 }] }),
          gearItem(5, { gems: [{ id: 3 }] }),
          gearItem(9),
        ],
      }),
    ]);
    expect(view.rows[0].pulls[0].gems).toBe(3);
  });

  it("reports BOTH weapons, main hand first — a rogue poisons each one", () => {
    const view = build([
      row({ gear: [gearItem(15, { temp: 2643 }), gearItem(16, { temp: 2641 })] }),
    ]);
    expect(view.rows[0].pulls[0].weaponEnchants).toEqual([
      { hand: "main", id: 2643 },
      { hand: "off", id: 2641 },
    ]);
  });

  it("names which hand is buffed when only one is", () => {
    const mainOnly = build([row({ gear: [gearItem(15, { temp: 2628 }), gearItem(16)] })]);
    expect(mainOnly.rows[0].pulls[0].weaponEnchants).toEqual([{ hand: "main", id: 2628 }]);

    const offOnly = build([row({ gear: [gearItem(15), gearItem(16, { temp: 2641 })] })]);
    expect(offOnly.rows[0].pulls[0].weaponEnchants).toEqual([{ hand: "off", id: 2641 }]);
  });

  it("is empty when neither weapon carried one", () => {
    expect(build([row({ gear: [gearItem(15), gearItem(16)] })]).rows[0].pulls[0].weaponEnchants)
      .toEqual([]);
  });

  it("reads item level from the most-worn gear, not from one odd pull", () => {
    /*
     * Lurker is spawned by fishing, so that pull catches raiders holding a
     * level 30 rod. The snapshot is honest; reading it as "how geared are
     * they" is not. Seen on this guild's logs 29 times with a fishing lure on
     * the rod and 13 more without one.
     */
    const realWeapon = gearItem(15, { id: 30902, ilvl: 141 });
    const rod = gearItem(15, { id: 25978, ilvl: 60, temp: 266 });
    const view = build([
      row({ fightId: 1, encounterName: "Hydross", gear: [realWeapon, gearItem(0, { ilvl: 141 })] }),
      row({ fightId: 2, encounterName: "Hydross", gear: [realWeapon, gearItem(0, { ilvl: 141 })] }),
      // The fishing pull is last, which is what the old "latest pull" read.
      row({ fightId: 3, encounterName: "The Lurker Below", gear: [rod, gearItem(0, { ilvl: 141 })] }),
    ]);
    expect(view.rows[0].ilvl).toBe(141);
    // The pull itself still tells the truth about that pull.
    expect(view.rows[0].pulls[2].ilvl).toBe(100.5);
  });

  it("names the weapons a raider swapped between, most-worn first", () => {
    const view = build([
      row({ fightId: 1, encounterName: "Hydross", gear: [gearItem(15, { id: 30902, ilvl: 141, name: "Blue Weapon" })] }),
      row({ fightId: 2, encounterName: "Vashj", gear: [gearItem(15, { id: 30902, ilvl: 141, name: "Blue Weapon" })] }),
      row({ fightId: 3, encounterName: "The Lurker Below", gear: [gearItem(15, { id: 25978, ilvl: 60, name: "Fishing Pole" })] }),
    ]);
    const swaps = view.rows[0].weaponSwaps;
    expect(swaps).toHaveLength(1);
    expect(swaps[0].label).toBe("Main hand");
    expect(swaps[0].items.map((i) => i.name)).toEqual(["Blue Weapon", "Fishing Pole"]);
    expect(swaps[0].items[0].pulls).toBe(2);
    // The evidence rides along, so an officer can see it was the Lurker pull.
    expect(swaps[0].items[1].encounters).toEqual(["The Lurker Below"]);
  });

  it("says nothing about a raider who used one weapon all night", () => {
    const view = build([
      row({ fightId: 1, gear: [gearItem(15, { id: 30902 })] }),
      row({ fightId: 2, gear: [gearItem(15, { id: 30902 })] }),
    ]);
    expect(view.rows[0].weaponSwaps).toEqual([]);
  });

  it("reports each hand's swaps separately", () => {
    const view = build([
      row({ fightId: 1, gear: [gearItem(15, { id: 1 }), gearItem(16, { id: 10 })] }),
      row({ fightId: 2, gear: [gearItem(15, { id: 2 }), gearItem(16, { id: 10 })] }),
    ]);
    expect(view.rows[0].weaponSwaps.map((s) => s.label)).toEqual(["Main hand"]);
  });

  it("splits what went on the pet into food and scrolls, counting repeats", () => {
    const view = build(
      [row({ actorName: "Huntigo" })],
      [],
      [
        offPullFor("Huntigo", [
          { name: "Kibler's Bits", atMs: 100 },
          { name: "Scroll of Agility V", atMs: 200 },
          { name: "Kibler's Bits", atMs: 300 },
        ]),
      ],
    );
    expect(view.rows[0].pet?.food).toEqual([["Kibler's Bits", 2]]);
    expect(view.rows[0].pet?.scrolls).toEqual([["Scroll of Agility V", 1]]);
  });

  it("leaves the pet absent when nothing was logged, rather than saying it went unfed", () => {
    /*
     * The distinction the column depends on. Warcraft Logs types hunter pets,
     * shaman totems, treants and Shadowfiend identically, so "owns a feedable
     * pet" is not derivable — and a cross against a raider would be an
     * accusation the log cannot support.
     */
    expect(build([row({ actorName: "Goku" })]).rows[0].pet).toBeUndefined();
    expect(
      build([row({ actorName: "Goku" })], [], [offPullFor("Goku", [])]).rows[0].pet,
    ).toBeUndefined();
  });

  it("matches the pet record to its raider by name, case aside", () => {
    const view = build(
      [row({ actorName: "Huntigo" })],
      [],
      [offPullFor("huntigo", [{ name: "Kibler's Bits" }])],
    );
    expect(view.rows[0].pet?.food).toEqual([["Kibler's Bits", 1]]);
  });

  it("keeps one raider's pet off another's row", () => {
    const view = build(
      [row({ actorName: "Huntigo" }), row({ actorName: "Melige" })],
      [],
      [offPullFor("Huntigo", [{ name: "Kibler's Bits" }])],
    );
    expect(view.rows.find((r) => r.name === "Huntigo")?.pet).toBeDefined();
    expect(view.rows.find((r) => r.name === "Melige")?.pet).toBeUndefined();
  });

  it("keeps pet applications in the order they happened, with their pull", () => {
    /*
     * The point of storing the timing at all. A night's total shown against one
     * pull reads as a bug — "Kibler's Bits ×3" on a single boss — and the fix
     * is not a smaller number but a better question: what landed here, and how
     * much came earlier.
     */
    const view = build(
      [row({ actorName: "Risbexwx", fightId: 13 })],
      [],
      [
        offPullFor("Risbexwx", [
          { name: "Kibler's Bits", atMs: 900, fightId: 62 },
          { name: "Kibler's Bits", atMs: 100 },
          { name: "Scroll of Agility II", atMs: 500, fightId: 13 },
        ]),
      ],
    );
    const pet = view.rows[0].pet!;
    expect(pet.applications.map((a) => a.atMs)).toEqual([100, 500, 900]);
    // Between-pulls feeding carries no fight, which is not a gap in the data.
    expect(pet.applications[0].fightId).toBeUndefined();
    expect(pet.applications[1].fightId).toBe(13);
    // The night's totals are unchanged by the new detail.
    expect(pet.food).toEqual([["Kibler's Bits", 2]]);
    expect(pet.scrolls).toEqual([["Scroll of Agility II", 1]]);
  });

  it("still totals a pet record imported before the timing existed", () => {
    // A bare string is how those rows parse — name and nothing else.
    const view = build(
      [row({ actorName: "Huntigo" })],
      [],
      [offPullFor("Huntigo", [{ name: "Kibler's Bits" }, { name: "Kibler's Bits" }])],
    );
    expect(view.rows[0].pet?.food).toEqual([["Kibler's Bits", 2]]);
    expect(view.rows[0].pet?.applications).toHaveLength(2);
  });

  it("records the temp enchant seen on each weapon separately", () => {
    /*
     * An off-set weapon that never gets an oil is invisible when the enchant is
     * read off whichever weapon was in hand at the last pull.
     */
    const view = build([
      row({ fightId: 1, gear: [gearItem(15, { id: 30902, temp: 2628 })] }),
      row({ fightId: 2, gear: [gearItem(15, { id: 30902, temp: 2628 })] }),
      row({ fightId: 3, gear: [gearItem(15, { id: 25978 })] }),
    ]);
    const items = view.rows[0].weaponSwaps[0].items;
    expect(items[0].tempEnchantIds).toEqual([2628]);
    expect(items[1].tempEnchantIds).toEqual([]);
  });

  it("marks a pull that carried no gear snapshot, so an empty set reads as unknown", () => {
    const withGear = build([row({ gear: [gearItem(0)] })]).rows[0].pulls[0];
    const without = build([row({ gear: [] })]).rows[0].pulls[0];
    expect(withGear.hasGear).toBe(true);
    expect(without.hasGear).toBeUndefined();
    expect(without.ilvl).toBeUndefined();
  });

  it("carries the roster slug through, so a matched raider can be linked", () => {
    const view = build([row({ actorName: "Wando" })], [["wando", "wando"]]);
    expect(view.rows[0].slug).toBe("wando");
  });

  it("leaves the slug off a name nobody on the roster owns", () => {
    expect(build([row({ actorName: "Somepug" })]).rows[0].slug).toBeUndefined();
  });

  it("takes class and spec from the raider's latest pull", () => {
    const view = build([
      row({ fightId: 1, className: "Druid", spec: "Balance" }),
      row({ fightId: 2, className: "Druid", spec: "Restoration" }),
    ]);
    expect(view.rows[0].spec).toBe("Restoration");
  });

  it("respects a stricter coverage policy without changing the graded fact", () => {
    const rows = [row({ elixirs: [BATTLE], food: true })];
    const lenient = buildPreparedness({
      rows,
      slugByActor: new Map(),
      policy: DEFAULT_POLICY,
    });
    const strict = buildPreparedness({
      rows,
      slugByActor: new Map(),
      policy: { ...DEFAULT_POLICY, preparation: { ...DEFAULT_POLICY.preparation, coverage: "full" } },
    });
    // The same half-filled set: still "partial" either way, but only one of
    // them clears the bar. Fact and standard stay separate.
    expect(lenient.rows[0].pulls[0].grade).toBe("partial");
    expect(strict.rows[0].pulls[0].grade).toBe("partial");
    expect(lenient.rows[0].pulls[0].prepared).toBe(true);
    expect(strict.rows[0].pulls[0].prepared).toBe(false);
  });
});
