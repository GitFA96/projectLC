import { describe, expect, it } from "vitest";
import {
  attendanceFacts,
  attendanceTitle,
  resetWeekStart,
  summarizePerformance,
} from "@/lib/analysis/performance";
import { DEFAULT_POLICY, type GuildPolicy } from "@/lib/analysis/policy";
import type { AttendanceSummary, WclPlayerFight } from "@/lib/types";

describe("resetWeekStart (EU reset, Wednesday)", () => {
  it("a Wednesday raid opens its own week", () => {
    expect(resetWeekStart("2026-06-10T19:30:00.000Z")).toBe("2026-06-10");
    expect(resetWeekStart("2026-06-10T00:00:00.000Z")).toBe("2026-06-10");
  });

  it("a Tuesday-night raid belongs to the closing week", () => {
    expect(resetWeekStart("2026-06-09T22:30:00.000Z")).toBe("2026-06-03");
  });

  it("mid-week days map back to the opening Wednesday", () => {
    expect(resetWeekStart("2026-06-07T20:00:00.000Z")).toBe("2026-06-03"); // Sunday
    expect(resetWeekStart("2026-06-12T21:00:00.000Z")).toBe("2026-06-10"); // Friday
  });

  it("crosses month boundaries", () => {
    expect(resetWeekStart("2026-07-01T20:00:00.000Z")).toBe("2026-07-01"); // Wed 1 Jul
    expect(resetWeekStart("2026-06-30T20:00:00.000Z")).toBe("2026-06-24"); // Tue 30 Jun
  });
});

describe("attendanceFacts", () => {
  const base: AttendanceSummary = {
    raidsTotal: 12, raidsAttended: 10, raidsTracked: 12, raidPct: 83,
    firstSeenAt: "2026-05-27T19:00:00Z",
    recentAttended: 8, recentTotal: 10, recentPct: 80,
    pullsAttended: 97, pullsTotal: 100, pullPct: 97,
    weeks: [], weeksAttended: 9, weeksTracked: 10, weeksExcused: 0,
  };

  it("states one fraction, and the percentage is that same fraction", () => {
    const facts = attendanceFacts(base);
    expect(facts.map((f) => f.label)).toEqual(["Raids", "Boss pulls"]);
    expect(facts[0].value).toBe("10 of 12 · 83%");
    expect(facts[0].note).toContain("27 May 2026");
    expect(facts[1].value).toBe("97% when present");
  });

  it("never shows a rolling window beside the lifetime total", () => {
    // The score still uses "last N raids" and "last N weeks" — they are policy
    // and they stay in the data. They are kept off this card because three
    // different "7 of 10"s over three denominators is what made it unreadable.
    const rendered = attendanceFacts({ ...base, weeksExcused: 1 })
      .flatMap((f) => [f.label, f.value, f.note ?? ""])
      .join(" ");
    expect(rendered).not.toMatch(/last \d+ raids?/);
    expect(rendered).not.toContain(String(base.recentAttended) + " of");
  });

  it("names the unit, so the reset figure can't read as a contradiction", () => {
    // An officer comparing "10 of 12 raids" here with "9/10 counted weeks" on
    // the reset card asked why they disagree. They measure different things and
    // nothing said so.
    expect(attendanceFacts(base)[0].note).toContain("per raid, not per reset week");
  });

  it("states the rule that makes the weekly figure higher", () => {
    // One night and three nights score a week identically. That is the biggest
    // single reason the two figures differ, and it was written down nowhere.
    const withWeeks = attendanceFacts({
      ...base,
      weeks: [{ start: "2026-05-27", attended: true, reports: 2, excused: false }],
    });
    expect(withWeeks.find((f) => f.label === "Dots")?.note).toContain(
      "any one raid counts the whole week",
    );
  });

  it("only mentions excused weeks when there are some", () => {
    expect(attendanceFacts(base).some((f) => f.label === "Excused")).toBe(false);
    const excused = attendanceFacts({ ...base, weeksExcused: 2 });
    expect(excused.find((f) => f.label === "Excused")?.value).toBe("2 weeks");
  });

  it("says how many raids fell outside the count", () => {
    const partial = attendanceFacts({ ...base, raidsTracked: 9, raidsTotal: 12 });
    expect(partial.find((f) => f.label === "Outside the count")?.value).toBe("3 raids");
  });

  it("explains the dots when there are any", () => {
    expect(attendanceFacts(base).some((f) => f.label === "Dots")).toBe(false);
    const withWeeks = attendanceFacts({
      ...base,
      weeks: [{ start: "2026-05-27", attended: true, reports: 2, excused: false }],
    });
    expect(withWeeks.find((f) => f.label === "Dots")?.value).toBe("last 1 reset week");
  });

  it("still explains the denominator when there is no first-raid date", () => {
    const [first] = attendanceFacts({ ...base, firstSeenAt: undefined });
    // Still says what the denominator is, just without a date to hang it on.
    expect(first.note).toContain("every raid logged since their first");
    expect(first.note).not.toMatch(/\d{4}/);
  });

  it("keeps the hover text and the panel saying the same thing", () => {
    // One source, two surfaces — the tooltip is the facts joined, so it cannot
    // drift into claiming something the opened panel doesn't.
    const facts = attendanceFacts({ ...base, weeksExcused: 1 });
    const title = attendanceTitle({ ...base, weeksExcused: 1 });
    for (const fact of facts) {
      expect(title).toContain(`${fact.label}: ${fact.value}`);
      if (fact.note) expect(title).toContain(fact.note);
    }
  });
});

describe("summarizePerformance — content the council excused", () => {
  const pull = (
    fightId: number,
    encounterName: string,
    over: Partial<WclPlayerFight> = {},
  ): WclPlayerFight => ({
    id: `RPT:${fightId}:katze`,
    reportCode: "RPT",
    fightId,
    encounterId: 600 + fightId,
    encounterName,
    kill: true,
    durationMs: 300000,
    actorName: "Katzewarr",
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

  const excusing = (...names: string[]): GuildPolicy => ({
    ...DEFAULT_POLICY,
    preparation: { ...DEFAULT_POLICY.preparation, excusedEncounters: names },
  });

  // The night this was reported on: the guild clears last phase's raid on the
  // way past without flasking for it, then flasks for the content that counts.
  const night = [
    pull(2, "High King Maulgar"),
    pull(6, "Gruul the Dragonkiller"),
    pull(17, "Hydross the Unstable", { flask: "Flask of Relentless Assault" }),
    pull(22, "The Lurker Below", { flask: "Flask of Relentless Assault" }),
  ];

  it("counts every pull while nothing is excused", () => {
    expect(summarizePerformance(night)!.flaskPct).toBe(50);
  });

  it("drops excused encounters out of the preparation figures", () => {
    const summary = summarizePerformance(night, excusing("High King Maulgar", "Gruul the Dragonkiller"))!;
    expect(summary.flaskPct).toBe(100);
    expect(summary.preparedPct).toBe(100);
  });

  it("leaves everything that isn't preparation alone", () => {
    const summary = summarizePerformance(night, excusing("High King Maulgar", "Gruul the Dragonkiller"))!;
    // Showing up for the farm boss still counts as showing up, and the pull
    // still parsed. Only "were they prepared for it" stops being asked.
    expect(summary.fights).toBe(4);
    expect(summary.kills).toBe(4);
  });

  it("keeps the honest figure rather than a 0% nobody was asked to earn", () => {
    // A raider who only made the excused bosses has no counted pull left. The
    // percentages fall back to the whole set instead of dividing by zero.
    const gruulOnly = [night[0], night[1]];
    const summary = summarizePerformance(gruulOnly, excusing("High King Maulgar", "Gruul the Dragonkiller"))!;
    expect(summary.flaskPct).toBe(0);
    expect(summary.foodPct).toBe(100);
  });
});
