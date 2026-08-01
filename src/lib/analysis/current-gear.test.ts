import { describe, expect, it } from "vitest";
import { applyCurrentGearOverrides, loggedSlotOptions } from "@/lib/analysis/current-gear";
import { buildLoggedGear, type LoggedGearReport } from "@/lib/analysis/logged-gear";
import type { CurrentGearOverride, GearSet, SlotId, WclGearItem, WclPlayerFight } from "@/lib/types";

const HEAD = 0;
const RING1 = 10;
const RING2 = 11;

function pin(slot: SlotId, itemId: number, itemName: string): CurrentGearOverride {
  return {
    characterId: "c1",
    item: { slot, itemId, itemName },
    source: "logs",
    setAt: "2026-07-21T10:00:00.000Z",
  };
}

const imported: GearSet = {
  id: "gs1",
  characterId: "c1",
  kind: "current",
  name: "Katzewarr's set",
  source: "sixtyupgrades",
  importedAt: "2026-06-01T00:00:00.000Z",
  stats: { stamina: 1200 },
  slots: [
    { slot: "head", itemId: 111, itemName: "Old Helm" },
    { slot: "chest", itemId: 222, itemName: "Old Chest" },
  ],
};

describe("applyCurrentGearOverrides", () => {
  it("leaves the imported set alone when nothing is pinned", () => {
    expect(applyCurrentGearOverrides(imported, [])).toBe(imported);
    expect(applyCurrentGearOverrides(undefined, [])).toBeUndefined();
  });

  it("swaps a pinned slot in and leaves the rest of the import intact", () => {
    const merged = applyCurrentGearOverrides(imported, [pin("head", 999, "New Helm")])!;
    expect(merged.slots).toEqual([
      { slot: "head", itemId: 999, itemName: "New Helm" },
      { slot: "chest", itemId: 222, itemName: "Old Chest" },
    ]);
    // Identity and stats stay the import's — pinning moves items, not numbers.
    expect(merged.id).toBe("gs1");
    expect(merged.stats).toEqual({ stamina: 1200 });
    expect(imported.slots[0].itemId).toBe(111); // the input is not mutated
  });

  it("fills in a slot the export never covered", () => {
    const merged = applyCurrentGearOverrides(imported, [pin("trinket1", 555, "Dragonspine")])!;
    expect(merged.slots.map((s) => s.slot)).toEqual(["head", "chest", "trinket1"]);
  });

  it("stands alone as a current set when nothing was imported", () => {
    const merged = applyCurrentGearOverrides(undefined, [
      pin("feet", 777, "Boots"),
      pin("head", 999, "New Helm"),
    ])!;
    expect(merged.kind).toBe("current");
    expect(merged.source).toBe("manual");
    // Canonical slot order, not the order they happened to be pinned in.
    expect(merged.slots.map((s) => s.slot)).toEqual(["head", "feet"]);
    // No stat block: we only ever diff stats SixtyUpgrades computed.
    expect(merged.stats).toEqual({});
  });
});

/** One pull carrying just the gear a test cares about. */
function pull(fightId: number, encounterName: string, gear: Partial<WclGearItem>[]): WclPlayerFight {
  return {
    id: `f${fightId}`,
    reportCode: "code",
    fightId,
    encounterId: 1,
    encounterName,
    kill: true,
    durationMs: 120_000,
    actorName: "Katzewarr",
    characterId: "c1",
    role: "dps",
    deaths: 0,
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
    drums: 0,
    runes: 0,
    healthstones: 0,
    sappers: 0,
    missingEnchants: [],
    upkeep: [],
    gear: gear.map((g) => ({ slot: HEAD, id: 1, gems: [], ...g })) as WclGearItem[],
  } as WclPlayerFight;
}

describe("loggedSlotOptions", () => {
  const night: LoggedGearReport = {
    report: { code: "n1", title: "Night", startTime: "2026-07-20T18:00:00.000Z" },
    rows: [
      pull(1, "Hydross", [
        { slot: HEAD, id: 111, name: "Resist Helm" },
        { slot: RING1, id: 301, name: "Band of the Eternal" },
        { slot: RING2, id: 302, name: "Ring of a Thousand Marks" },
      ]),
      pull(2, "Lurker", [
        { slot: HEAD, id: 222, name: "Tier Helm" },
        { slot: RING1, id: 301, name: "Band of the Eternal" },
        { slot: RING2, id: 302, name: "Ring of a Thousand Marks" },
      ]),
    ],
  };
  const options = loggedSlotOptions(buildLoggedGear([night]));

  it("offers every item a slot held, most recently worn first", () => {
    const head = options.get("head")!;
    expect(head.map((o) => o.itemId)).toEqual([222, 111]);
    expect(head[0]).toMatchObject({ latest: true, fromPairedSlot: false });
    expect(head[0].detail).toBe("1 of 2 pulls · Lurker");
  });

  it("pools rings with their partner, own finger first and the other flagged", () => {
    // Which finger a ring sits on is arbitrary, so either is pinnable to either
    // slot — but the picker still has to say where it was actually seen.
    expect(options.get("ring1")!.map((o) => [o.itemId, o.fromPairedSlot])).toEqual([
      [301, false],
      [302, true],
    ]);
    expect(options.get("ring2")!.map((o) => [o.itemId, o.fromPairedSlot])).toEqual([
      [302, false],
      [301, true],
    ]);
    // Only the item worn on this finger can claim to be the newest reading.
    expect(options.get("ring2")!.find((o) => o.itemId === 301)!.latest).toBe(false);
  });

  it("has no entry for a slot nothing was logged in", () => {
    expect(options.has("trinket1")).toBe(false);
  });
});
