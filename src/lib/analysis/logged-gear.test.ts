import { describe, expect, it } from "vitest";
import { buildLoggedGear, encounterSummary, type LoggedGearReport } from "@/lib/analysis/logged-gear";
import type { WclGearItem, WclPlayerFight } from "@/lib/types";

const HEAD = 0;
const TRINKET = 12;

/** One pull with just the gear a test cares about. */
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
    deathTimes: [],
    elixirs: [],
    lateConsumables: [],
    scrolls: [],
    food: false,
    weaponBuff: false,
    prepot: false,
    potions: [],
    otherCasts: [],
    extras: [],
    cooldowns: [],
    castTimes: [],
    dispels: [],
    interrupts: [],
    drums: 0,
    runes: 0,
    healthstones: 0,
    sappers: 0,
    missingEnchants: [],
    upkeep: [],
    gear: gear.map((g) => ({ slot: HEAD, id: 1, gems: [], ...g })) as WclGearItem[],
    talents: [],
  } as WclPlayerFight;
}

function report(code: string, startTime: string, rows: WclPlayerFight[]): LoggedGearReport {
  return { report: { code, title: `Raid ${code}`, startTime }, rows };
}

describe("buildLoggedGear", () => {
  // Two nights: a resist helm came out for one boss on the newer night, and the
  // trinket swapped between them.
  const nights = [
    report("newer", "2026-07-20T18:00:00.000Z", [
      pull(1, "Hydross", [
        { slot: HEAD, id: 111, name: "Resist Helm" },
        { slot: TRINKET, id: 900 },
      ]),
      pull(2, "Lurker", [
        { slot: HEAD, id: 222, name: "Tier Helm", enchant: 3003, gems: [{ id: 24027 }] },
        { slot: TRINKET, id: 900 },
      ]),
    ]),
    report("older", "2026-07-13T18:00:00.000Z", [
      pull(1, "Gruul", [
        { slot: HEAD, id: 222, name: "Tier Helm", enchant: 2999 },
        { slot: TRINKET, id: 800 },
      ]),
    ]),
  ];
  const view = buildLoggedGear(nights);

  it("lists every item a slot held, most recently worn first", () => {
    const head = view.slots.find((s) => s.index === HEAD)!;
    expect(head.options.map((o) => o.itemId)).toEqual([222, 111]);
    // Pull 2 of the newer night is the latest snapshot, so the tier helm is
    // what they're wearing now — even though the resist helm has a lower fight id.
    expect(head.options[0]).toMatchObject({ current: true, pulls: 2 });
    expect(head.options[1]).toMatchObject({ current: false, pulls: 1 });
  });

  it("takes the enchant and gems from the most recent pull wearing the item", () => {
    // Not printed anywhere — this is what the item's Wowhead tooltip renders,
    // so it has to be the newest reading rather than the oldest.
    const helm = view.slots.find((s) => s.index === HEAD)!.options[0];
    expect(helm.enchantId).toBe(3003); // not 2999, the older night's reading
    expect(helm.gems).toEqual([{ id: 24027 }]);
  });

  it("records where each option was worn", () => {
    const helm = view.slots.find((s) => s.index === HEAD)!.options[0];
    expect(encounterSummary(helm)).toBe("Gruul · Lurker");
    expect(helm.lastSeen).toMatchObject({ code: "newer", encounterName: "Lurker" });
  });

  it("counts pulls per slot so a share can be stated honestly", () => {
    expect(view.pulls).toBe(3);
    expect(view.slots.find((s) => s.index === TRINKET)!.slotPulls).toBe(3);
    expect(view.reports.map((r) => [r.code, r.pulls])).toEqual([
      ["newer", 2],
      ["older", 1],
    ]);
  });

  it("only counts the newest `limit` raid nights", () => {
    const recent = buildLoggedGear(nights, { limit: 1 });
    expect(recent.reports.map((r) => r.code)).toEqual(["newer"]);
    // The trinket worn only on the older night is out of scope entirely.
    expect(recent.slots.find((s) => s.index === TRINKET)!.options.map((o) => o.itemId)).toEqual([900]);
  });

  it("ignores pulls with no gear snapshot rather than inventing an empty slot", () => {
    const empty = buildLoggedGear([report("a", "2026-07-20T18:00:00.000Z", [pull(1, "Gruul", [])])]);
    expect(empty).toMatchObject({ pulls: 0, reports: [], slots: [] });
  });
});
