import { describe, expect, it } from "vitest";
import { summarizeRaidReport } from "@/lib/analysis/raid-report";
import type { WclPlayerFight, WclReport } from "@/lib/types";

const report: WclReport = {
  code: "RAID001",
  title: "SSC night",
  zone: "Serpentshrine Cavern",
  startTime: "2026-06-10T19:00:00.000Z",
  endTime: "2026-06-10T23:00:00.000Z",
  fetchedAt: "2026-06-11T08:00:00.000Z",
  raidSessionId: null,
};

/** Minimal fight row; overrides win. */
function row(over: Partial<WclPlayerFight> & { fightId: number; actorName: string }): WclPlayerFight {
  const { fightId, actorName, encounterName, kill, ...rest } = over;
  return {
    id: `RAID001:${fightId}:${actorName.toLowerCase()}`,
    reportCode: "RAID001",
    fightId,
    encounterId: 600 + fightId,
    encounterName: encounterName ?? `Boss ${fightId}`,
    kill: kill ?? true,
    durationMs: 300000,
    actorName,
    characterId: null,
    role: "dps",
    deaths: 0,
    elixirs: [],
    scrolls: [],
    food: true,
    weaponBuff: true,
    prepot: false,
    potions: [],
    otherCasts: [],
    extras: [],
    cooldowns: [],
    upkeep: [],
    drums: 0,
    runes: 0,
    healthstones: 0,
    missingEnchants: [],
    gear: [],
    ...rest,
  };
}

describe("summarizeRaidReport", () => {
  const rows: WclPlayerFight[] = [
    // Kazrak: well prepared, drops Battle Shout, uses Death Wish + a potion.
    row({ fightId: 1, actorName: "Kazrak", encounterName: "Hydross", className: "Warrior", role: "dps",
      flask: "Flask of Relentless Assault", cooldowns: ["Death Wish"], potions: ["Haste Potion"], prepot: true,
      upkeep: [{ name: "Battle Shout", pct: 90 }] }),
    row({ fightId: 2, actorName: "Kazrak", encounterName: "Leotheras", kill: false, fightPercentage: 12, className: "Warrior",
      flask: "Flask of Relentless Assault", cooldowns: ["Death Wish", "Recklessness"],
      upkeep: [{ name: "Battle Shout", pct: 80 }] }),
    // Morgrave: warlock keeping Curse of the Elements on the boss; no flask on Leotheras; missing enchants.
    row({ fightId: 1, actorName: "Morgrave", encounterName: "Hydross", className: "Warlock", role: "dps",
      flask: "Flask of Pure Death", upkeep: [{ name: "Curse of the Elements", pct: 95 }] }),
    row({ fightId: 2, actorName: "Morgrave", encounterName: "Leotheras", kill: false, fightPercentage: 12, className: "Warlock",
      flask: undefined, elixirs: [], food: false, missingEnchants: ["Main hand", "Wrist"],
      upkeep: [{ name: "Curse of the Elements", pct: 88 }] }),
    // Tidemar: a shaman who never enchanted weapon and skipped a potion on a kill.
    row({ fightId: 1, actorName: "Tidemar", encounterName: "Hydross", className: "Shaman", role: "healer",
      flask: "Flask of Mighty Restoration", missingEnchants: ["Main hand"] }),
    row({ fightId: 2, actorName: "Tidemar", encounterName: "Leotheras", className: "Shaman", role: "healer",
      flask: "Flask of Mighty Restoration", missingEnchants: ["Main hand"] }),
  ];

  const slugByActor = new Map([
    ["kazrak", "kazrak"],
    ["morgrave", "morgrave"],
    // Tidemar intentionally unmatched (no slug).
  ]);

  const raid = summarizeRaidReport({ report, rows, reportPulls: 2, slugByActor });

  it("lists distinct boss pulls with kill/wipe state", () => {
    expect(raid.fights).toHaveLength(2);
    expect(raid.fights[1]).toMatchObject({ encounterName: "Leotheras", kill: false, fightPercentage: 12 });
  });

  it("computes preparation coverage across player-pulls", () => {
    expect(raid.prep.raiders).toBe(3);
    expect(raid.prep.rows).toBe(6);
    // 5 of 6 player-pulls prepared (Morgrave's Leotheras pull is not).
    expect(raid.prep.flaskOrElixirPct).toBe(83);
    expect(raid.prep.potionsTotal).toBe(1);
    expect(raid.prep.potionTypes).toEqual([{ name: "Haste Potion", uses: 1 }]);
  });

  it("rolls up debuff/buff uptime per provider, boss debuffs first", () => {
    // Curse of the Elements (debuff) sorts above Battle Shout (selfbuff).
    expect(raid.upkeep[0].name).toBe("Curse of the Elements");
    expect(raid.upkeep[0].kind).toBe("debuff");
    expect(raid.upkeep[0].bestPct).toBe(92); // avg of 95 and 88, rounded
    expect(raid.upkeep[0].providers[0]).toMatchObject({ name: "Morgrave", slug: "morgrave" });
    const shout = raid.upkeep.find((u) => u.name === "Battle Shout")!;
    expect(shout.kind).toBe("selfbuff");
    expect(shout.bestPct).toBe(85);
  });

  it("tallies cooldown usage with providers", () => {
    const deathWish = raid.cooldowns.find((c) => c.name === "Death Wish")!;
    expect(deathWish.uses).toBe(2);
    expect(deathWish.providers[0]).toMatchObject({ name: "Kazrak", count: 2 });
  });

  it("flags weapon-enchant gaps as the highest-severity improvement", () => {
    // Morgrave (missing main-hand + wrist + a no-flask pull) and Tidemar
    // (missing main-hand both pulls) outrank well-prepared Kazrak (absent).
    expect(raid.improvements.some((p) => p.name === "Kazrak")).toBe(false);
    const morgrave = raid.improvements.find((p) => p.name === "Morgrave")!;
    expect(morgrave.findings.some((f) => f.severity === "high" && f.label === "No weapon enchant")).toBe(true);
    expect(morgrave.findings.some((f) => f.label === "Missing enchants" && f.detail === "Wrist")).toBe(true);
    // Worst-first ordering by severity-weighted score.
    expect(raid.improvements[0].score).toBeGreaterThanOrEqual(raid.improvements[1].score);
    // Unmatched raiders still appear, just without a deep link.
    expect(raid.improvements.find((p) => p.name === "Tidemar")!.slug).toBeUndefined();
  });

  it("defaults to no report gracefully via the store, but summarizes when given rows", () => {
    expect(raid.report.code).toBe("RAID001");
    expect(raid.reportPulls).toBe(2);
  });
});
