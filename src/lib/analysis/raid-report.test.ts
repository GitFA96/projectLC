import { describe, expect, it } from "vitest";
import { summarizeRaidReport } from "@/lib/analysis/raid-report";
import { DEFAULT_POLICY } from "@/lib/analysis/policy";
import type { WclPlayerFight, WclPlayerOffPull, WclReport } from "@/lib/types";

const report: WclReport = {
  code: "RAID001",
  title: "SSC night",
  zone: "Serpentshrine Cavern",
  startTime: "2026-06-10T19:00:00.000Z",
  endTime: "2026-06-10T23:00:00.000Z",
  fetchedAt: "2026-06-11T08:00:00.000Z",
  upkeepTracks: [],
  unclassifiedAuras: [],
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
    deathTimes: [],
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
    dispels: [],
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
    // Two potions: Kazrak's Haste Potion in-fight, and the one he opened with.
    // Reports imported before the name was kept only stored a boolean, so that
    // one counts under a stand-in name rather than not counting at all.
    expect(raid.prep.potionsTotal).toBe(2);
    expect(raid.prep.potionTypes).toEqual([
      { name: "Haste Potion", uses: 1, providers: [{ name: "Kazrak", slug: "kazrak", count: 1 }] },
      { name: "Pre-pull potion", uses: 1, providers: [{ name: "Kazrak", slug: "kazrak", count: 1 }] },
    ]);
  });

  it("rolls up debuff/buff uptime per provider, boss debuffs first", () => {
    // Curse of the Elements (debuff) sorts above Battle Shout (a raid buff).
    expect(raid.upkeep[0].name).toBe("Curse of the Elements");
    expect(raid.upkeep[0].kind).toBe("debuff");
    expect(raid.upkeep[0].bestPct).toBe(92); // avg of 95 and 88, rounded
    expect(raid.upkeep[0].providers[0]).toMatchObject({ name: "Morgrave", slug: "morgrave" });
    const shout = raid.upkeep.find((u) => u.name === "Battle Shout")!;
    expect(shout.kind).toBe("buff");
    expect(shout.bestPct).toBe(85);
  });

  it("breaks uptime down boss by boss with per-pull providers", () => {
    const curse = raid.upkeep.find((u) => u.name === "Curse of the Elements")!;
    expect(curse.perFight).toEqual([
      { fightId: 1, providers: [{ name: "Morgrave", slug: "morgrave", className: "Warlock", pct: 95 }] },
      { fightId: 2, providers: [{ name: "Morgrave", slug: "morgrave", className: "Warlock", pct: 88 }] },
    ]);
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

  it("folds per-type consumable usage out to who used it", () => {
    const v = summarizeRaidReport({
      report,
      reportPulls: 1,
      slugByActor: new Map([["kazrak", "kazrak"]]),
      rows: [
        row({ fightId: 1, actorName: "Kazrak", potions: ["Haste Potion"], otherCasts: ["Super Sapper Charge"], sappers: 1 }),
        row({ fightId: 1, actorName: "Bombjr", potions: ["Haste Potion"], otherCasts: ["Super Sapper Charge", "Goblin Sapper Charge"], sappers: 2 }),
      ],
    });
    const haste = v.prep.potionTypes.find((t) => t.name === "Haste Potion")!;
    expect(haste.uses).toBe(2);
    expect(haste.providers).toEqual([
      { name: "Bombjr", slug: undefined, count: 1 },
      { name: "Kazrak", slug: "kazrak", count: 1 },
    ]);
  });

  it("ranks raiders by consumable and cooldown usage with a named breakdown", () => {
    const v = summarizeRaidReport({
      report,
      reportPulls: 1,
      slugByActor: new Map(),
      rows: [
        row({ fightId: 1, actorName: "Kazrak", potions: ["Haste Potion"], cooldowns: ["Death Wish"] }),
        row({ fightId: 1, actorName: "Bombjr", potions: ["Haste Potion", "Destruction Potion"],
          otherCasts: ["Super Sapper Charge", "Goblin Sapper Charge"], sappers: 2 }),
      ],
      // Bombjr threw 4 in-fight items to Kazrak's 1 → tops the leaderboard.
    });
    expect(v.usage.map((u) => u.name)).toEqual(["Bombjr", "Kazrak"]);
    const bomb = v.usage[0];
    expect(bomb.consumablesTotal).toBe(4);
    expect(bomb.sappers).toBe(2);
    expect(bomb.potions).toBe(2);
    expect(bomb.otherItems).toBe(0); // both other casts are sappers
    expect(bomb.itemBreakdown[0]).toEqual({ name: "Destruction Potion", count: 1 });
    const kaz = v.usage[1];
    expect(kaz.cooldowns).toBe(1);
    expect(kaz.cooldownBreakdown).toEqual([{ name: "Death Wish", count: 1 }]);
  });

  it("scales prep buffs by raid length and deaths (flask ×2 on a 4h night)", () => {
    // The report fixture spans 19:00–23:00 = 4 hours; Kazrak holds a flask in an
    // early and a late pull, so a 2h flask is bought ~twice.
    const v = summarizeRaidReport({
      report,
      reportPulls: 2,
      slugByActor: new Map(),
      rows: [
        row({ fightId: 1, actorName: "Kazrak", flask: "Flask of Relentless Assault",
          food: true, weaponBuff: true, deaths: 1, scrolls: ["Scroll of Agility V"] }),
        row({ fightId: 2, actorName: "Kazrak", flask: "Flask of Relentless Assault",
          food: true, weaponBuff: true, deaths: 2, scrolls: ["Scroll of Agility V"] }),
      ],
    });
    const kaz = v.usage.find((u) => u.name === "Kazrak")!;
    expect(kaz.deaths).toBe(3);
    const prep = Object.fromEntries(kaz.prepBreakdown.map((p) => [p.name, p.count]));
    expect(prep["Flask of Relentless Assault"]).toBe(2); // 4h ÷ 2h window, present early+late
    expect(prep["Scroll of Agility V"]).toBe(4); // max(4h window, 1 + 3 deaths)
    expect(prep["Food"]).toBe(4);
    expect(prep["Weapon oil/stone"]).toBe(4);
  });

  it("doesn't double a flask on a short raid or a one-off pull", () => {
    const shortReport = { ...report, startTime: "2026-06-10T19:00:00.000Z", endTime: "2026-06-10T20:30:00.000Z" };
    const v = summarizeRaidReport({
      report: shortReport,
      reportPulls: 2,
      slugByActor: new Map(),
      rows: [
        row({ fightId: 1, actorName: "Kazrak", flask: "Flask of Relentless Assault" }),
        row({ fightId: 2, actorName: "Kazrak", flask: "Flask of Relentless Assault" }),
      ],
    });
    const kaz = v.usage.find((u) => u.name === "Kazrak")!;
    // 1.5h night → under the 2h flask window → a single flask.
    expect(kaz.prepBreakdown.find((p) => p.name.startsWith("Flask"))!.count).toBe(1);
  });
});

describe("summarizeRaidReport — excluded pulls", () => {
  const rows: WclPlayerFight[] = [
    row({ fightId: 1, actorName: "Kazrak", encounterName: "Hydross", className: "Warrior",
      flask: "Flask of Relentless Assault", potions: ["Haste Potion"], cooldowns: ["Death Wish"],
      upkeep: [{ name: "Battle Shout", pct: 90 }] }),
    // The pull the officers want out: no flask, no food, no potion — a gimmick
    // wipe that would otherwise drag the whole night's numbers down.
    row({ fightId: 2, actorName: "Kazrak", encounterName: "Leotheras", kill: false, className: "Warrior",
      flask: undefined, food: false, potions: [], cooldowns: ["Recklessness"],
      upkeep: [{ name: "Battle Shout", pct: 10 }] }),
  ];
  const full = summarizeRaidReport({ report, rows, reportPulls: 2, slugByActor: new Map() });
  const filtered = summarizeRaidReport({ report, rows, reportPulls: 2, slugByActor: new Map(), excludedFightIds: [2] });

  it("keeps every pull in the fight list, flagging the excluded ones", () => {
    expect(filtered.fights.map((f) => [f.fightId, f.excluded])).toEqual([
      [1, undefined],
      [2, true],
    ]);
  });

  it("leaves excluded pulls out of preparation coverage and consumable counts", () => {
    expect(full.prep.flaskOrElixirPct).toBe(50);
    expect(filtered.prep.flaskOrElixirPct).toBe(100);
    expect(filtered.prep.foodPct).toBe(100);
    expect(filtered.prep.rows).toBe(1);
    expect(filtered.usage.find((u) => u.name === "Kazrak")!.potions).toBe(1);
  });

  it("leaves them out of cooldowns, uptime and the improvement list", () => {
    expect(filtered.cooldowns.map((c) => c.name)).toEqual(["Death Wish"]);
    expect(filtered.upkeep.find((u) => u.name === "Battle Shout")!.bestPct).toBe(90); // not (90+10)/2
    // The only gap Kazrak had was on the excluded pull.
    expect(full.improvements.some((p) => p.name === "Kazrak")).toBe(true);
    expect(filtered.improvements).toEqual([]);
  });
});

describe("summarizeRaidReport — raid buffs by player", () => {
  // Two warriors overlapping Battle Shout on the same raider, plus a single
  // Innervate: the provider rows carry the per-recipient timelines.
  const rows: WclPlayerFight[] = [
    row({ fightId: 1, actorName: "Dëltâ", className: "Warrior",
      upkeep: [{ name: "Battle Shout", pct: 50, targets: [
        { target: "Kazrak", boss: false, player: true, pct: 50, segments: [[0, 150000]], applications: 1 },
      ] }] }),
    row({ fightId: 1, actorName: "Katzewarr", className: "Warrior",
      upkeep: [{ name: "Battle Shout", pct: 50, targets: [
        // Overlaps Dëltâ's window — the union is 0–250s, not 400s of a 300s pull.
        { target: "Kazrak", boss: false, player: true, pct: 50, segments: [[100000, 250000]], applications: 1 },
      ] }] }),
    row({ fightId: 1, actorName: "Lunara", className: "Druid", role: "healer",
      cooldowns: ["Innervate"],
      castTimes: [{ name: "Innervate", atMs: 60000, target: "Tidemar" }],
      upkeep: [{ name: "Innervate", pct: 6, targets: [
        { target: "Tidemar", boss: false, player: true, pct: 6, segments: [[60000, 80000]], applications: 1 },
      ] }] }),
    row({ fightId: 1, actorName: "Kazrak", className: "Warrior" }),
    // A second pull nobody buffed — it still counts against the night average.
    row({ fightId: 2, actorName: "Kazrak", className: "Warrior" }),
  ];
  const v = summarizeRaidReport({
    report,
    rows,
    reportPulls: 2,
    slugByActor: new Map([["kazrak", "kazrak"]]),
  });
  const shout = v.playerBuffs.find((b) => b.name === "Battle Shout")!;

  it("inverts provider timelines into per-recipient coverage, counting overlap once", () => {
    const pull = shout.perFight.find((p) => p.fightId === 1)!;
    const kazrak = pull.recipients.find((r) => r.name === "Kazrak")!;
    expect(kazrak.pct).toBe(83); // union 0–250s of a 300s pull, not 100%
    expect(kazrak.slug).toBe("kazrak");
    expect(kazrak.className).toBe("Warrior");
    expect(kazrak.sources.map((s) => s.name).sort()).toEqual(["Dëltâ", "Katzewarr"]);
  });

  it("averages a recipient over the pulls they raided, unbuffed ones as zeros", () => {
    expect(shout.recipients).toEqual([
      { name: "Kazrak", slug: "kazrak", className: "Warrior", pct: 42, pulls: 2 },
    ]);
  });

  it("keeps the cast moment next to the window it bought", () => {
    const innervate = v.playerBuffs.find((b) => b.name === "Innervate")!;
    expect(innervate.providers[0]).toMatchObject({ name: "Lunara", className: "Druid", applications: 1 });
    expect(innervate.recipients.map((r) => r.name)).toEqual(["Tidemar"]);
    const source = innervate.perFight[0].recipients[0].sources[0];
    expect(source.casts).toEqual([60000]);
    expect(source.segments).toEqual([[60000, 80000]]);
  });
});

describe("summarizeRaidReport — totem drops", () => {
  const v = summarizeRaidReport({
    report,
    reportPulls: 1,
    slugByActor: new Map([["tidemar", "tidemar"]]),
    rows: [
      row({ fightId: 1, actorName: "Tidemar", className: "Shaman", castTimes: [
        { name: "Windfury Totem", atMs: 20000, totem: true },
        { name: "Strength of Earth Totem", atMs: 21000, totem: true },
        { name: "Death Wish", atMs: 30000 },
      ] }),
      row({ fightId: 1, actorName: "Kazrak", className: "Warrior" }),
    ],
  });

  it("lays each shaman's drops out along the pull, cooldowns excluded", () => {
    expect(v.totems).toEqual([
      {
        fightId: 1,
        lanes: [
          {
            name: "Tidemar",
            slug: "tidemar",
            className: "Shaman",
            drops: [
              { name: "Windfury Totem", atMs: 20000 },
              { name: "Strength of Earth Totem", atMs: 21000 },
            ],
          },
        ],
      },
    ]);
  });
});


describe("summarizeRaidReport — parse boards", () => {
  const rows: WclPlayerFight[] = [
    // Two kills and a wipe. The wipe carries no parse — WCL doesn't rank them.
    row({ fightId: 1, actorName: "Kazrak", encounterName: "Hydross", className: "Warrior", role: "dps",
      spec: "Fury", parsePercent: 90, bracketPercent: 84, amount: 1200, bossParsePercent: 70, bossAmount: 800 }),
    row({ fightId: 3, actorName: "Kazrak", encounterName: "Vashj", className: "Warrior", role: "dps",
      spec: "Fury", parsePercent: 80, amount: 1100, bossParsePercent: 60 }),
    row({ fightId: 2, actorName: "Kazrak", encounterName: "Leotheras", kill: false, className: "Warrior", role: "dps" }),
    // Present for one kill only — an average over one parse, not a zero. A high
    // all-damage parse with no boss-damage one at all (an add-heavy pull).
    row({ fightId: 3, actorName: "Morgrave", encounterName: "Vashj", className: "Warlock", role: "dps",
      spec: "Destruction", parsePercent: 41, amount: 900 }),
    row({ fightId: 1, actorName: "Ardin", encounterName: "Hydross", className: "Paladin", role: "tank",
      spec: "Protection", parsePercent: 55, bossParsePercent: 30 }),
    row({ fightId: 1, actorName: "Tidemar", encounterName: "Hydross", className: "Shaman", role: "healer",
      spec: "Restoration", parsePercent: 77, bossParsePercent: 12 }),
  ];
  const raid = summarizeRaidReport({
    report, rows, reportPulls: 3, slugByActor: new Map([["kazrak", "kazrak"]]),
  });
  const board = (key: string) => raid.parseBoards.find((b) => b.key === key)!;

  it("splits raiders into one board per role, and no raider into two", () => {
    expect(raid.parseBoards.map((b) => b.key)).toEqual(["dps", "healers", "tanks"]);
    expect(board("dps").rows.map((r) => r.name)).toEqual(["Kazrak", "Morgrave"]);
    expect(board("healers").rows.map((r) => r.name)).toEqual(["Tidemar"]);
    expect(board("tanks").rows.map((r) => r.name)).toEqual(["Ardin"]);
  });

  it("gives a column per counted kill and none for wipes", () => {
    expect(board("dps").columns.map((c) => c.encounterName)).toEqual(["Hydross", "Vashj"]);
    // The healer was only ranked on Hydross, so Vashj would be dead width.
    expect(board("healers").columns.map((c) => c.encounterName)).toEqual(["Hydross"]);
  });

  it("averages over the kills a raider was ranked on, not the whole night", () => {
    const [kazrak, morgrave] = board("dps").rows;
    expect(kazrak).toMatchObject({ avg: 85, ranked: 2, spec: "Fury", slug: "kazrak" });
    // One parse of 41 stays 41 — a missed boss is not a zero.
    expect(morgrave).toMatchObject({ avg: 41, ranked: 1, slug: undefined });
    expect(morgrave.cells.map((c) => c.fightId)).toEqual([3]);
  });

  it("carries both percentiles on the same cell, never as a second board", () => {
    const kazrak = board("dps").rows[0];
    expect(kazrak.cells.map((c) => [c.parse, c.bossParse])).toEqual([
      [90, 70],
      [80, 60],
    ]);
    // Both averages are kept, each over the kills that metric ranked.
    expect(kazrak).toMatchObject({ avg: 85, ranked: 2, bossAvg: 65, bossRanked: 2 });
    // Morgrave has no boss-damage parse at all — the cell keeps its all-damage
    // number and simply has nothing to show on the other metric.
    expect(board("dps").rows[1]).toMatchObject({ avg: 41, bossAvg: undefined, bossRanked: 0 });
  });

  it("offers boss damage only where it means something", () => {
    expect(board("dps").bossMetric).toBeDefined();
    expect(board("tanks").bossMetric).toBeDefined();
    // WCL ranks healers on boss damage at ~0 — never worth offering.
    expect(board("healers").bossMetric).toBeUndefined();
    expect(board("healers").rows[0].cells[0].bossParse).toBeUndefined();
  });

  it("keeps the single metric when a report predates boss-damage parses", () => {
    const older = summarizeRaidReport({
      report,
      rows: rows.map((r) => ({ ...r, bossParsePercent: undefined })),
      reportPulls: 3,
      slugByActor: new Map(),
    });
    expect(older.parseBoards.every((b) => b.bossMetric === undefined)).toBe(true);
    expect(older.parseBoards.find((b) => b.key === "dps")!.rows[0].avg).toBe(85);
  });

  it("ignores excluded pulls entirely", () => {
    const filtered = summarizeRaidReport({
      report, rows, reportPulls: 3, slugByActor: new Map(), excludedFightIds: [3],
    });
    expect(filtered.parseBoards.find((b) => b.key === "dps")!.columns.map((c) => c.encounterName))
      .toEqual(["Hydross"]);
    // Morgrave only played the excluded kill, so he's off the board.
    expect(filtered.parseBoards.find((b) => b.key === "dps")!.rows.map((r) => r.name)).toEqual(["Kazrak"]);
  });
});

describe("summarizeRaidReport — elixir coverage", () => {
  const slugByActor = new Map<string, string>();
  const summarize = (rows: WclPlayerFight[], policy?: Parameters<typeof summarizeRaidReport>[0]["policy"]) =>
    summarizeRaidReport({ report, rows, reportPulls: 1, slugByActor, policy });

  it("separates a full set from half of one, which the percentage cannot", () => {
    const raid = summarize([
      row({ fightId: 1, actorName: "Flasked", flask: "Flask of Relentless Assault" }),
      row({ fightId: 1, actorName: "Bothslots", elixirs: ["Elixir of Major Agility", "Elixir of Draenic Wisdom"] }),
      row({ fightId: 1, actorName: "Halfset", elixirs: ["Elixir of Major Agility"] }),
      row({ fightId: 1, actorName: "Nothing" }),
    ]);
    expect(raid.prep.coverage).toEqual({ flask: 1, full: 1, partial: 1, none: 1 });
    // All three of those read as covered under the default standard.
    expect(raid.prep.flaskOrElixirPct).toBe(75);
  });

  it("names the empty slot in the raider's improvements", () => {
    const raid = summarize([
      row({ fightId: 1, actorName: "Halfset", encounterName: "Hydross", potions: ["Haste Potion"],
        elixirs: ["Elixir of Major Agility"] }),
    ]);
    const finding = raid.improvements
      .find((p) => p.name === "Halfset")!
      .findings.find((f) => f.label === "Half a set of elixirs")!;
    expect(finding.detail).toBe("battle elixir, no guardian, all night");
  });

  it("says nothing about a raider who brought both", () => {
    const raid = summarize([
      row({ fightId: 1, actorName: "Bothslots", potions: ["Haste Potion"],
        elixirs: ["Elixir of Major Agility", "Elixir of Draenic Wisdom"] }),
    ]);
    expect(raid.improvements.some((p) => p.name === "Bothslots")).toBe(false);
  });

  it("reports an unplaced elixir raid-wide rather than blaming the raider for it", () => {
    // The curated list doesn't name a slot for this one, so the gap is in our
    // data. Naming a missing half here would be a guess.
    const raid = summarize([
      row({ fightId: 1, actorName: "Mystery", potions: ["Haste Potion"],
        elixirs: ["Elixir of the Uncurated"] }),
    ]);
    expect(raid.prep.unplacedElixirs).toEqual([{ label: "Elixir of the Uncurated", pulls: 1 }]);
    expect(raid.improvements.some((p) => p.name === "Mystery")).toBe(false);
  });

  it("falls back to the no-coverage finding when the council asks for full sets", () => {
    const rows = [
      row({ fightId: 1, actorName: "Halfset", potions: ["Haste Potion"],
        elixirs: ["Elixir of Major Agility"] }),
    ];
    const strict = summarize(rows, { ...DEFAULT_POLICY, preparation: { ...DEFAULT_POLICY.preparation, coverage: "full" } });
    const findings = strict.improvements.find((p) => p.name === "Halfset")!.findings;
    // One complaint, not two: under `full` a half set isn't coverage at all.
    expect(findings.map((f) => f.label)).toEqual(["No flask/elixir all night"]);
    expect(strict.prep.flaskOrElixirPct).toBe(0);
  });
});

describe("summarizeRaidReport — the pre-pull potion counts as a potion", () => {
  const slugByActor = new Map<string, string>();

  it("counts it in the night's totals and names it when the import kept the name", () => {
    const raid = summarizeRaidReport({
      report,
      rows: [
        row({ fightId: 1, actorName: "Opener", prepot: true, prepotLabel: "Haste Potion",
          potions: ["Super Mana Potion"] }),
      ],
      reportPulls: 1,
      slugByActor,
    });
    expect(raid.prep.potionsTotal).toBe(2);
    expect(raid.prep.potionTypes.map((t) => t.name).sort())
      .toEqual(["Haste Potion", "Super Mana Potion"]);
    expect(raid.usage.find((u) => u.name === "Opener")!.potions).toBe(2);
  });

  it("doesn't flag a kill the raider opened potted — that is a potion the fight got", () => {
    // Counting it as a use and flagging its absence would be having it both
    // ways. Whether opening with it was the right call is the spec guide's
    // question, and "fewer than the fight allowed" is the sim context's.
    const raid = summarizeRaidReport({
      report,
      rows: [
        row({ fightId: 1, actorName: "Opener", encounterName: "Hydross", prepot: true, potions: [],
          flask: "Flask of Relentless Assault" }),
      ],
      reportPulls: 1,
      slugByActor,
    });
    expect(raid.improvements.some((p) => p.name === "Opener")).toBe(false);
  });

  it("still flags a kill where nothing at all was drunk", () => {
    const raid = summarizeRaidReport({
      report,
      rows: [
        row({ fightId: 1, actorName: "Dry", encounterName: "Hydross", potions: [],
          flask: "Flask of Relentless Assault" }),
      ],
      reportPulls: 1,
      slugByActor,
    });
    expect(
      raid.improvements.find((p) => p.name === "Dry")!.findings.some((f) => f.label === "No potion on a kill"),
    ).toBe(true);
  });

  it("still spares a wipe, where the fight can end before a repot", () => {
    const raid = summarizeRaidReport({
      report,
      rows: [
        row({ fightId: 1, actorName: "Wiper", kill: false, fightPercentage: 40, potions: [],
          flask: "Flask of Relentless Assault" }),
      ],
      reportPulls: 1,
      slugByActor,
    });
    expect(raid.improvements.some((p) => p.name === "Wiper")).toBe(false);
  });
});

/** Minimal off-pull record; overrides win. */
function offPull(over: Partial<WclPlayerOffPull> & { actorName: string }): WclPlayerOffPull {
  return {
    id: `RAID001:${over.actorName.toLowerCase()}`,
    reportCode: "RAID001",
    characterId: null,
    potions: [],
    otherCasts: [],
    petBuffsSeen: [], trashDispels: [],
    drums: 0,
    runes: 0,
    healthstones: 0,
    sappers: 0,
    petConsumables: [],
    ...over,
  };
}

/*
 * The raid page's scope is the night, not the boss pulls inside it. Probed on
 * mbwNGRaxhPHMTpKB: 43% of that night's sappers and 13% of its potions were
 * used on trash, and the heaviest user in the raid read as one of the lightest.
 */
describe("off-pull consumables count toward the night", () => {
  const rows: WclPlayerFight[] = [
    row({ fightId: 1, actorName: "Delta", className: "Paladin", potions: ["Bottled Nethergon Energy"],
      otherCasts: ["Super Sapper Charge"], sappers: 1 }),
    row({ fightId: 1, actorName: "Quiet", className: "Priest" }),
  ];
  const offPulls = [
    offPull({ actorName: "Delta", potions: ["Bottled Nethergon Energy", "Bottled Nethergon Energy"],
      otherCasts: ["Super Sapper Charge", "Goblin Sapper Charge"], sappers: 2 }),
    // Nobody by this name held a pull — no row to fold into, and inventing one
    // would put a stranger in the rankings.
    offPull({ actorName: "Passerby", potions: ["Haste Potion"], otherCasts: [] }),
  ];
  const view = summarizeRaidReport({
    report, rows, reportPulls: 1, slugByActor: new Map(), offPull: offPulls,
  });

  it("adds trash use to the raid totals", () => {
    expect(view.prep.potionsTotal).toBe(3);
    expect(view.prep.sappersTotal).toBe(3);
    expect(view.prep.potionTypes.find((t) => t.name === "Bottled Nethergon Energy")!.uses).toBe(3);
    expect(view.prep.inFightTypes.find((t) => t.name === "Goblin Sapper Charge")!.uses).toBe(1);
  });

  it("adds it to the raider's own tallies and breakdown", () => {
    const delta = view.usage.find((u) => u.name === "Delta")!;
    expect(delta.potions).toBe(3);
    expect(delta.sappers).toBe(3);
    expect(delta.consumablesTotal).toBe(6);
    expect(delta.itemBreakdown.find((b) => b.name === "Super Sapper Charge")!.count).toBe(2);
  });

  it("keeps the totals equal to the sum of the rows the page lists", () => {
    // An off-pull record for somebody with no included pull is dropped, so a
    // total can never exceed the rows beside it. Passerby's potion is not here.
    expect(view.usage.reduce((s, u) => s + u.potions, 0)).toBe(view.prep.potionsTotal);
    expect(view.usage.some((u) => u.name === "Passerby")).toBe(false);
  });

  it("prices pet food with the rest, the way career gold always has", () => {
    const fed = summarizeRaidReport({
      report,
      rows: [row({ fightId: 1, actorName: "Houndmaster", className: "Hunter" })],
      reportPulls: 1,
      slugByActor: new Map(),
      offPull: [offPull({ actorName: "Houndmaster", petConsumables: [{ name: "Kibler's Bits" }, { name: "Kibler's Bits" }] })],
    });
    const u = fed.usage.find((x) => x.name === "Houndmaster")!;
    expect(u.itemBreakdown.find((b) => b.name === "Kibler's Bits (pet)")!.count).toBe(2);
    expect(u.otherItems).toBe(2);
  });

  it("keeps a hunter's own scroll and their pet's apart", () => {
    // One name, two purchases, and they used to fold into a single line — so
    // an officer's ±1 against "Scroll of Agility V" moved the raider's count
    // and the pet's at once. 14 of the 18 raider-nights in this guild's logs
    // that scrolled a pet ran the same scroll on the raider too.
    const both = summarizeRaidReport({
      report,
      rows: [
        row({
          fightId: 1,
          actorName: "Houndmaster",
          className: "Hunter",
          scrolls: ["Scroll of Agility V"],
        }),
      ],
      reportPulls: 1,
      slugByActor: new Map(),
      offPull: [
        offPull({
          actorName: "Houndmaster",
          petConsumables: [{ name: "Scroll of Agility V" }],
        }),
      ],
    });
    const u = both.usage.find((x) => x.name === "Houndmaster")!;
    expect(u.itemBreakdown.map((b) => b.name)).toEqual(["Scroll of Agility V (pet)"]);
    expect(u.prepBreakdown.map((b) => b.name)).toContain("Scroll of Agility V");
    expect(u.prepBreakdown.map((b) => b.name)).not.toContain("Scroll of Agility V (pet)");
  });

  it("reports pet spend as a range, without moving the ranking", () => {
    // The wiring, not the model (that has its own tests): the night's span and
    // the raider's identity have to reach it, or the card renders one row of
    // logged counts and silently claims the log saw everything.
    const fed = summarizeRaidReport({
      report, // 19:00 → 23:00, four hours
      rows: [row({ fightId: 1, actorName: "Houndmaster", className: "Hunter" })],
      reportPulls: 1,
      slugByActor: new Map([["houndmaster", "houndmaster"]]),
      offPull: [
        offPull({
          actorName: "Houndmaster",
          petConsumables: [{ name: "Kibler's Bits" }],
          petBuffsSeen: [{ name: "Scroll of Agility V", atMs: 10 }],
        }),
        // No pull tonight, so no row here either — the same fold rule the gold
        // totals run on.
        offPull({ actorName: "Passerby", petConsumables: [{ name: "Kibler's Bits" }] }),
      ],
    });
    expect(fed.petSpend.rows.map((r) => r.name)).toEqual(["Houndmaster"]);
    const [pet] = fed.petSpend.rows;
    expect(pet.slug).toBe("houndmaster");
    const seen = pet.lines.find((l) => l.name === "Scroll of Agility V")!;
    expect(seen).toMatchObject({ logged: 0, seen: true, maintained: 4 });
    // And the ranking beside it still charges the logged half only.
    const u = fed.usage.find((x) => x.name === "Houndmaster")!;
    expect(u.itemBreakdown.map((b) => b.name)).toEqual(["Kibler's Bits (pet)"]);
  });

  it("is out of the pull switch's reach", () => {
    // Excluding a pull excludes that fight, not the trash before it. Delta
    // still holds pull 1, so his off-pull use stays.
    const twoPulls = [...rows, row({ fightId: 2, actorName: "Delta", className: "Paladin" })];
    const filtered = summarizeRaidReport({
      report, rows: twoPulls, reportPulls: 2, slugByActor: new Map(),
      offPull: offPulls, excludedFightIds: [2],
    });
    expect(filtered.usage.find((u) => u.name === "Delta")!.potions).toBe(3);
  });
});
