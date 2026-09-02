import { describe, expect, it } from "vitest";
import { summarizeComparison, type ComparisonInput } from "@/lib/analysis/comparison";
import type { Character, CharacterComment, WclPlayerFight } from "@/lib/types";

function character(over: Partial<Character> & { id: string; name: string }): Character {
  return {
    guildId: "g1",
    class: "Warrior",
    spec: "Arms",
    role: "Melee DPS",
    status: "main",
    mainCharacterId: null,
    ...over,
  } as Character;
}

function row(over: Partial<WclPlayerFight> & { fightId: number; actorName: string }): WclPlayerFight {
  const { fightId, actorName, ...rest } = over;
  return {
    id: `R:${fightId}:${actorName.toLowerCase()}`,
    reportCode: "R",
    fightId,
    encounterId: 600 + fightId,
    encounterName: `Boss ${fightId}`,
    kill: true,
    durationMs: 300000,
    actorName,
    characterId: null,
    role: "dps",
    deaths: 0,
    deathTimes: [],
    elixirs: [],
    lateConsumables: [],
    scrolls: [],
    food: true,
    weaponBuff: true,
    prepot: false,
    potions: [],
    otherCasts: [],
    extras: [],
    cooldowns: [],
    castTimes: [],
    dispels: [],
    interrupts: [],
    upkeep: [],
    drums: 0,
    runes: 0,
    healthstones: 0,
    sappers: 0,
    missingEnchants: [],
    gear: [],
    talents: [],
    ...rest,
  };
}

describe("summarizeComparison", () => {
  const comment: CharacterComment = {
    id: "cm1",
    characterId: "c-kaz",
    category: "performance",
    body: "Great curse uptime",
    createdAt: "2026-06-11T00:00:00.000Z",
  };

  const inputs: ComparisonInput[] = [
    {
      character: character({ id: "c-kaz", name: "Kazrak" }),
      availableReports: [],
      rows: [
        row({ fightId: 1, actorName: "Kazrak", className: "Warrior", amount: 1000, parsePercent: 60,
          bracketPercent: 55, flask: "Flask of Relentless Assault", deaths: 1,
          cooldowns: ["Death Wish", "Recklessness"], sappers: 2,
          upkeep: [{ name: "Battle Shout", pct: 90 }, {
            name: "Sunder Armor", pct: 80,
            targets: [
              { target: "Attumen", boss: true, pct: 80, segments: [[0, 240000]], applications: 20 },
              { target: "Midnight", boss: false, pct: 95, segments: [[0, 285000]], applications: 4 },
            ],
          }] }),
        row({ fightId: 2, actorName: "Kazrak", className: "Warrior", amount: 1400, parsePercent: 80,
          bracketPercent: 65, flask: "Flask of Relentless Assault",
          cooldowns: ["Death Wish"], sappers: 1,
          upkeep: [{ name: "Battle Shout", pct: 80 }, {
            name: "Sunder Armor", pct: 60,
            targets: [{ target: "Moroes", boss: true, pct: 60, segments: [[0, 180000]], applications: 10 }],
          }] }),
      ],
      comments: [comment],
    },
    {
      character: character({ id: "c-mor", name: "Morgrave", class: "Warlock", spec: "Destruction", role: "Ranged DPS" }),
      availableReports: [],
      rows: [
        row({ fightId: 1, actorName: "Morgrave", className: "Warlock", amount: 1800, parsePercent: 95,
          bracketPercent: 90, flask: undefined, elixirs: [],
 lateConsumables: [], food: false,
          upkeep: [{ name: "Curse of the Elements", pct: 96 }] }),
      ],
      comments: [],
    },
    {
      // Healer with two unequal-length pulls — verifies hps unit + weighted upkeep.
      character: character({ id: "c-tid", name: "Tidemar", class: "Shaman", spec: "Restoration", role: "Healer" }),
      availableReports: [],
      rows: [
        row({ fightId: 1, actorName: "Tidemar", className: "Shaman", role: "healer", amount: 2000,
          durationMs: 100000, upkeep: [{ name: "Earth Shield", pct: 100 }] }),
        row({ fightId: 2, actorName: "Tidemar", className: "Shaman", role: "healer", amount: 2200,
          durationMs: 300000, upkeep: [{ name: "Earth Shield", pct: 0 }] }),
      ],
      comments: [],
    },
    {
      // No logged pulls — log-derived metrics stay empty.
      character: character({ id: "c-new", name: "Newbie" }),
      availableReports: [],
      rows: [],
      comments: [],
    },
  ];

  const view = summarizeComparison(inputs);

  it("computes median output with the role-appropriate unit", () => {
    const kaz = view.characters[0];
    expect(kaz.output).toBe(1200); // median of 1000, 1400
    expect(kaz.outputUnit).toBe("dps");
    expect(view.characters[2].outputUnit).toBe("hps"); // healer
  });

  it("summarizes performance and consumables across pulls", () => {
    const kaz = view.characters[0];
    expect(kaz.medianParse).toBe(70); // median of 60, 80
    expect(kaz.bestParse).toBe(80);
    expect(kaz.medianBracket).toBe(60);
    expect(kaz.deaths).toBe(1);
    expect(kaz.preparedPct).toBe(100); // flask + food both pulls
    const mor = view.characters[1];
    expect(mor.preparedPct).toBe(0); // no flask, no food
  });

  it("weights upkeep by pull length", () => {
    const tid = view.characters[2];
    // (100*100000 + 0*300000) / 400000 = 25
    expect(tid.upkeep.find((u) => u.name === "Earth Shield")!.pct).toBe(25);
  });

  it("tallies cooldown discipline and in-fight items", () => {
    const kaz = view.characters[0];
    expect(kaz.cooldownsTotal).toBe(3);
    expect(kaz.cooldownsPerFight).toBe(1.5);
    expect(kaz.cooldownBreakdown).toEqual([
      { name: "Death Wish", count: 2 },
      { name: "Recklessness", count: 1 },
    ]);
    expect(kaz.sappers).toBe(3);
    // No-log column stays empty rather than zeroed-looking.
    expect(view.characters[3].cooldownsTotal).toBe(0);
    expect(view.characters[3].goldPerRaid).toBeUndefined();
  });

  it("derives boss-only uptime and landed casts from the per-target breakdown", () => {
    const kaz = view.characters[0];
    const sunder = kaz.upkeep.find((u) => u.name === "Sunder Armor")!;
    // Best-target average: equal-length pulls of 80 and 60.
    expect(sunder.pct).toBe(70);
    // Boss-only ignores the 95% on the Midnight add: (80+60)/2.
    expect(sunder.bossPct).toBe(70);
    // (20+4+10) applications over 2 pulls with the track.
    expect(sunder.appliesPerFight).toBe(17);
    // Tracks without target data stay undefined, not 0.
    const shout = kaz.upkeep.find((u) => u.name === "Battle Shout")!;
    expect(shout.bossPct).toBeUndefined();
    expect(shout.appliesPerFight).toBeUndefined();
  });

  it("estimates gold per raid from default prices", () => {
    // Kazrak ran a flask both pulls — at minimum the flask is priced.
    expect(view.characters[0].goldPerRaid ?? 0).toBeGreaterThan(0);
  });

  it("unions upkeep tracks with boss debuffs first", () => {
    const names = view.upkeepTracks.map((t) => t.name);
    expect(names).toContain("Curse of the Elements");
    expect(names).toContain("Battle Shout");
    // Debuff sorts ahead of the self/assigned buffs.
    expect(view.upkeepTracks[0]).toMatchObject({ name: "Curse of the Elements", kind: "debuff" });
  });

  it("marks characters with no logs and passes comments through", () => {
    const newbie = view.characters[3];
    expect(newbie.hasLogs).toBe(false);
    expect(newbie.output).toBeUndefined();
    expect(newbie.preparedPct).toBe(0);
    expect(view.characters[0].comments).toHaveLength(1);
  });

  it("counts a single elixir as flask/elixir coverage (the hunter case)", () => {
    const v = summarizeComparison([
      {
        character: character({ id: "c-syl", name: "Sylvaria", class: "Hunter", spec: "Beast Mastery", role: "Ranged DPS" }),
        availableReports: [],
        rows: [
          row({ fightId: 1, actorName: "Sylvaria", className: "Hunter", flask: undefined, elixirs: ["Elixir of Major Agility"], food: true }),
          row({ fightId: 2, actorName: "Sylvaria", className: "Hunter", flask: undefined, elixirs: ["Elixir of Major Agility"], food: true }),
        ],
        comments: [],
      },
    ]);
    // One battle elixir is coverage — not 0% — and with food it's "prepared".
    expect(v.characters[0].flaskOrElixirsPct).toBe(100);
    expect(v.characters[0].preparedPct).toBe(100);
  });
});
