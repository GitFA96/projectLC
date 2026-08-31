import { describe, expect, it } from "vitest";
import {
  buildDevelopmentSeries,
  parseTrend,
  type DevelopmentReport,
} from "@/lib/analysis/development";
import { DEFAULT_POLICY } from "@/lib/analysis/policy";
import type { WclPlayerFight } from "@/lib/types";

function report(code: string, day: number): DevelopmentReport {
  return {
    code,
    title: `Night ${code}`,
    startTime: `2026-06-${String(day).padStart(2, "0")}T19:00:00.000Z`,
    zone: "Serpentshrine Cavern",
  };
}

/** One ranked kill on one night. */
function row(
  code: string,
  fightId: number,
  over: Partial<WclPlayerFight> = {},
): WclPlayerFight {
  return {
    id: `${code}:${fightId}`,
    reportCode: code,
    fightId,
    encounterId: 600 + fightId,
    encounterName: `Boss ${fightId}`,
    kill: true,
    durationMs: 300000,
    actorName: "Kazrak",
    characterId: "c-kazrak",
    role: "dps",
    deaths: 0,
    deathTimes: [],
    flask: "Flask of Relentless Assault",
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
    ...over,
  } as WclPlayerFight;
}

const reports = [report("A", 1), report("B", 8), report("C", 15), report("D", 22)];

describe("buildDevelopmentSeries", () => {
  it("gives one row per night, oldest first", () => {
    const series = buildDevelopmentSeries(
      [row("C", 1, { parsePercent: 70 }), row("A", 1, { parsePercent: 40 })],
      reports,
    );
    expect(series.nights.map((n) => n.reportCode)).toEqual(["A", "C"]);
    expect(series.nights[0].medianParse).toBe(40);
  });

  it("leaves a night they missed out entirely, rather than plotting a zero", () => {
    // An absence is a gap in the line. Whether they should have been there is
    // the attendance view's question.
    const series = buildDevelopmentSeries([row("A", 1, { parsePercent: 50 })], reports);
    expect(series.nights).toHaveLength(1);
  });

  it("measures the recent window against everything before it", () => {
    const policy = { ...DEFAULT_POLICY, attendance: { ...DEFAULT_POLICY.attendance, recentRaids: 2 } };
    const series = buildDevelopmentSeries(
      [
        row("A", 1, { parsePercent: 30 }),
        row("B", 1, { parsePercent: 40 }),
        row("C", 1, { parsePercent: 70 }),
        row("D", 1, { parsePercent: 80 }),
      ],
      reports,
      policy,
    );
    const perf = series.trends.find((t) => t.key === "performance")!;
    expect(perf.earlier).toBe(35); // A and B
    expect(perf.recent).toBe(75); // C and D
    expect(perf.delta).toBe(40);
    expect(perf.nightsRecent).toBe(2);
    expect(perf.nightsEarlier).toBe(2);
    expect(series.window).toBe(2);
  });

  it("reports a decline as plainly as a climb, and calls neither one a verdict", () => {
    const policy = { ...DEFAULT_POLICY, attendance: { ...DEFAULT_POLICY.attendance, recentRaids: 2 } };
    const series = buildDevelopmentSeries(
      [
        row("A", 1, { parsePercent: 90 }),
        row("B", 1, { parsePercent: 80 }),
        row("C", 1, { parsePercent: 40 }),
        row("D", 1, { parsePercent: 30 }),
      ],
      reports,
      policy,
    );
    expect(parseTrend(series)).toBe(-50);
  });

  it("has no trend on a single night — one night has no direction", () => {
    // "Too soon to say" is not the same as "flat", and a zero would read as flat.
    const series = buildDevelopmentSeries([row("A", 1, { parsePercent: 60 })], reports);
    expect(parseTrend(series)).toBeUndefined();
    expect(series.window).toBe(0);
  });

  it("caps the window at half their nights, so a trend always has two sides", () => {
    // The council's "recent" is ten raids. Most of this roster has logged
    // fewer than ten nights in total, so an uncapped window covered everything
    // anyone had ever done and produced a trend for exactly one raider.
    const series = buildDevelopmentSeries(
      [
        row("A", 1, { parsePercent: 30 }),
        row("B", 1, { parsePercent: 40 }),
        row("C", 1, { parsePercent: 80 }),
      ],
      reports,
      DEFAULT_POLICY, // recentRaids: 10
    );
    expect(series.window).toBe(1);
    const perf = series.trends.find((t) => t.key === "performance")!;
    expect(perf.recent).toBe(80);
    expect(perf.earlier).toBe(35);
    expect(perf.delta).toBe(45);
  });

  it("uses the council's window once there is history enough for it", () => {
    const policy = { ...DEFAULT_POLICY, attendance: { ...DEFAULT_POLICY.attendance, recentRaids: 2 } };
    const series = buildDevelopmentSeries(
      [
        row("A", 1, { parsePercent: 10 }),
        row("B", 1, { parsePercent: 20 }),
        row("C", 1, { parsePercent: 30 }),
        row("D", 1, { parsePercent: 40 }),
      ],
      reports,
      policy,
    );
    // Four nights, window two — the cap doesn't bite.
    expect(series.window).toBe(2);
  });

  it("skips unranked nights in the parse trend without losing the night itself", () => {
    // A night with no percentile still happened — it keeps its preparation and
    // its deaths, and only drops out of the metric it has no figure for.
    const policy = { ...DEFAULT_POLICY, attendance: { ...DEFAULT_POLICY.attendance, recentRaids: 1 } };
    const series = buildDevelopmentSeries(
      [row("A", 1, { parsePercent: 50 }), row("B", 1)],
      reports,
      policy,
    );
    expect(series.nights).toHaveLength(2);
    expect(series.nights[1].medianParse).toBeUndefined();
    const perf = series.trends.find((t) => t.key === "performance")!;
    expect(perf.nightsRecent).toBe(0);
    expect(perf.delta).toBeUndefined();
    // Preparation has a figure for both, so its trend still works.
    expect(series.trends.find((t) => t.key === "preparation")!.nightsRecent).toBe(1);
  });

  it("tracks preparation night by night, not just as a career average", () => {
    const policy = { ...DEFAULT_POLICY, attendance: { ...DEFAULT_POLICY.attendance, recentRaids: 1 } };
    const series = buildDevelopmentSeries(
      [
        row("A", 1, { flask: undefined, food: false }),
        row("B", 1, { flask: "Flask of Relentless Assault", food: true }),
      ],
      reports,
      policy,
    );
    expect(series.nights[0].preparedPct).toBe(0);
    expect(series.nights[1].preparedPct).toBe(100);
    expect(series.trends.find((t) => t.key === "preparation")!.delta).toBe(100);
  });

  it("counts pulls, kills and deaths per night", () => {
    const series = buildDevelopmentSeries(
      [
        row("A", 1, { parsePercent: 50, deaths: 1 }),
        row("A", 2, { parsePercent: 60, kill: false, deaths: 2 }),
      ],
      reports,
    );
    expect(series.nights[0].pulls).toBe(2);
    expect(series.nights[0].kills).toBe(1);
    expect(series.nights[0].deaths).toBe(3);
  });

  it("is empty for a raider with nothing logged", () => {
    const series = buildDevelopmentSeries([], reports);
    expect(series.nights).toEqual([]);
    expect(parseTrend(series)).toBeUndefined();
  });
});
