import { describe, expect, it } from "vitest";
import { buildBossDeathProfile, buildDeathProfiles } from "@/lib/analysis/deaths";
import type { WclPlayerFight } from "@/lib/types";

function row(
  over: Partial<WclPlayerFight> & { fightId: number; actorName: string },
): WclPlayerFight {
  const { deathTimes = [], ...rest } = over;
  return {
    id: `f${over.fightId}:${over.actorName}`,
    reportCode: "R1",
    encounterId: 700,
    encounterName: "Leotheras the Blind",
    kill: false,
    durationMs: 300000,
    characterId: null,
    role: "dps",
    deaths: deathTimes.length,
    deathTimes,
    elixirs: [],
    scrolls: [],
    food: true,
    weaponBuff: true,
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
    ...rest,
  } as WclPlayerFight;
}

describe("buildBossDeathProfile", () => {
  it("finds the median first death — an opener reads differently from attrition", () => {
    const profile = buildBossDeathProfile([
      row({ fightId: 1, actorName: "A", deathTimes: [{ atMs: 20000 }] }),
      row({ fightId: 1, actorName: "B", deathTimes: [{ atMs: 90000 }] }),
      row({ fightId: 2, actorName: "A", deathTimes: [{ atMs: 30000 }] }),
      row({ fightId: 2, actorName: "B", deathTimes: [] }),
      row({ fightId: 3, actorName: "A", deathTimes: [{ atMs: 40000 }] }),
      row({ fightId: 3, actorName: "B", deathTimes: [] }),
    ])!;
    // First deaths: 20s, 30s, 40s.
    expect(profile.medianFirstDeathMs).toBe(30000);
    expect(profile.deathsTotal).toBe(4);
    expect(profile.wipes).toBe(3);
  });

  it("buckets by tenth of the pull, not by the clock", () => {
    // A wipe is short by definition. On a raw clock every wipe's deaths cluster
    // near the start and the raid reads as dying early when the truth is that
    // the pull ended.
    const profile = buildBossDeathProfile([
      // Died at the very end of a 60s wipe...
      row({ fightId: 1, actorName: "A", durationMs: 60000, deathTimes: [{ atMs: 57000 }] }),
      // ...and at the very end of a 600s kill.
      row({ fightId: 2, actorName: "A", durationMs: 600000, kill: true, deathTimes: [{ atMs: 570000 }] }),
    ])!;
    expect(profile.byTenth[9]).toBe(2);
    expect(profile.byTenth[0]).toBe(0);
  });

  it("names who dies here and who dies first", () => {
    const profile = buildBossDeathProfile([
      row({ fightId: 1, actorName: "Early", className: "Rogue", deathTimes: [{ atMs: 10000 }] }),
      row({ fightId: 1, actorName: "Late", deathTimes: [{ atMs: 200000 }] }),
      row({ fightId: 2, actorName: "Early", className: "Rogue", deathTimes: [{ atMs: 12000 }] }),
      row({ fightId: 2, actorName: "Late", deathTimes: [] }),
    ])!;
    const early = profile.offenders.find((o) => o.actorName === "Early")!;
    expect(early.deaths).toBe(2);
    expect(early.firstDeaths).toBe(2);
    expect(early.className).toBe("Rogue");
    expect(early.medianAtMs).toBe(11000);
    expect(profile.offenders[0].actorName).toBe("Early");
  });

  it("leaves out raiders who survived, rather than listing them with a zero", () => {
    const profile = buildBossDeathProfile([
      row({ fightId: 1, actorName: "Died", deathTimes: [{ atMs: 1000 }] }),
      row({ fightId: 1, actorName: "Fine", deathTimes: [] }),
    ])!;
    expect(profile.offenders.map((o) => o.actorName)).toEqual(["Died"]);
  });

  it("tells a report with no timing from a pull with no deaths", () => {
    // Deaths were always counted; the timestamp is new. A report imported
    // before that says "3 deaths, no idea when", and pretending otherwise
    // would read as a clean pull.
    const untimed = buildBossDeathProfile([
      row({ fightId: 1, actorName: "A", deaths: 3, deathTimes: [] }),
    ])!;
    expect(untimed.timingMissing).toBe(true);
    expect(untimed.deathsTotal).toBe(3);
    expect(untimed.medianFirstDeathMs).toBeUndefined();

    const clean = buildBossDeathProfile([row({ fightId: 1, actorName: "A", deathTimes: [] })])!;
    expect(clean.timingMissing).toBe(false);
  });

  it("orders each pull's deaths by when they happened", () => {
    const profile = buildBossDeathProfile([
      row({ fightId: 1, actorName: "Second", deathTimes: [{ atMs: 50000 }] }),
      row({ fightId: 1, actorName: "First", deathTimes: [{ atMs: 10000 }] }),
    ])!;
    expect(profile.pulls[0].deaths.map((d) => d.actorName)).toEqual(["First", "Second"]);
    expect(profile.pulls[0].firstAtMs).toBe(10000);
  });

  it("counts two deaths by the same raider on one pull", () => {
    // A battle rez, or a wipe that ran long. Both are real.
    const profile = buildBossDeathProfile([
      row({ fightId: 1, actorName: "A", deathTimes: [{ atMs: 10000 }, { atMs: 90000 }] }),
    ])!;
    expect(profile.deathsTotal).toBe(2);
    expect(profile.pulls[0].deaths).toHaveLength(2);
  });
});

describe("buildDeathProfiles", () => {
  it("puts the boss that wiped the raid most first", () => {
    const profiles = buildDeathProfiles([
      row({ fightId: 1, actorName: "A", encounterId: 1, encounterName: "Easy", kill: true }),
      row({ fightId: 2, actorName: "A", encounterId: 2, encounterName: "Hard", deathTimes: [{ atMs: 1000 }] }),
      row({ fightId: 3, actorName: "A", encounterId: 2, encounterName: "Hard", deathTimes: [{ atMs: 2000 }] }),
    ]);
    expect(profiles.map((p) => p.encounterName)).toEqual(["Hard", "Easy"]);
    expect(profiles[0].wipes).toBe(2);
  });

  it("is empty with nothing logged", () => {
    expect(buildDeathProfiles([])).toEqual([]);
  });
});

describe("the killing blow", () => {
  it("carries what the log named, per pull and in order", () => {
    const profile = buildBossDeathProfile([
      row({
        fightId: 1,
        actorName: "Byrd",
        kill: false,
        fightPercentage: 96.6,
        deathTimes: [{ atMs: 40000, killer: "Fathom-Guard Sharkkis", ability: "Melee" }],
      }),
      row({
        fightId: 1,
        actorName: "Elshyn",
        kill: false,
        fightPercentage: 96.6,
        deathTimes: [{ atMs: 12000, ability: "Arcing Smash" }],
      }),
    ]);

    const [pull] = profile!.pulls;
    expect(pull.kill).toBe(false);
    expect(pull.fightPercentage).toBeCloseTo(96.6);
    // In order, each with only what the report actually stated.
    expect(pull.deaths.map((d) => [d.actorName, d.atMs, d.ability, d.killer])).toEqual([
      ["Elshyn", 12000, "Arcing Smash", undefined],
      ["Byrd", 40000, "Melee", "Fathom-Guard Sharkkis"],
    ]);
  });

  it("leaves a pre-killing-blow row unexplained rather than guessing", () => {
    // A row imported before the field was kept parses to time-only, and the UI
    // says "cause not recorded" off exactly this.
    const profile = buildBossDeathProfile([
      row({ fightId: 1, actorName: "Byrd", deathTimes: [{ atMs: 40000 }] }),
    ]);
    expect(profile!.pulls[0].deaths[0]).toMatchObject({ actorName: "Byrd", atMs: 40000 });
    expect(profile!.pulls[0].deaths[0].killer).toBeUndefined();
    expect(profile!.pulls[0].deaths[0].ability).toBeUndefined();
  });

  it("keeps kills and wipes as separate pulls", () => {
    // "dont double stack" — the aggregate merges them, the pull list must not.
    const profile = buildBossDeathProfile([
      row({ fightId: 1, actorName: "A", kill: false, fightPercentage: 40, durationMs: 60000, deathTimes: [{ atMs: 30000 }] }),
      row({ fightId: 2, actorName: "A", kill: true, durationMs: 272000, deathTimes: [{ atMs: 100000 }] }),
    ]);
    expect(profile!.pulls.map((p) => [p.kill, p.durationMs])).toEqual([
      [false, 60000],
      [true, 272000],
    ]);
    expect(profile!.wipes).toBe(1);
    expect(profile!.kills).toBe(1);
  });
});
