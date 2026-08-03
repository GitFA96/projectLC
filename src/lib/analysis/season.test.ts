import { describe, expect, it } from "vitest";
import { summarizeSeason } from "@/lib/analysis/season";
import type { RaiderUsage, SeasonReportInput } from "@/lib/types";

function usage(over: Partial<RaiderUsage> & { name: string }): RaiderUsage {
  return {
    slug: over.name.toLowerCase(),
    className: "Warrior",
    role: "dps",
    potions: 0,
    sappers: 0,
    otherItems: 0,
    consumablesTotal: 0,
    prepots: 0,
    cooldowns: 0,
    itemBreakdown: [],
    cooldownBreakdown: [],
    deaths: 0,
    prepBreakdown: [],
    ...over,
  };
}

// Default prices: Haste Potion 15g, Flask of Relentless Assault 82g.
const reports: SeasonReportInput[] = [
  {
    code: "R1",
    title: "Night 1",
    startTime: "2026-06-01T19:00:00.000Z",
    overrides: {},
    upkeep: [
      { name: "Curse of the Elements", kind: "debuff", className: "Warlock", bestPct: 90,
        providers: [{ name: "Morg", slug: "morg", pct: 90 }] },
    ],
    usage: [
      usage({ name: "Kaz", itemBreakdown: [{ name: "Haste Potion", count: 2 }],
        prepBreakdown: [{ name: "Flask of Relentless Assault", count: 1 }], consumablesTotal: 2, deaths: 1 }),
      usage({ name: "Morg", className: "Warlock", itemBreakdown: [{ name: "Haste Potion", count: 1 }],
        consumablesTotal: 1, deaths: 0 }),
    ],
  },
  {
    code: "R2",
    title: "Night 2",
    startTime: "2026-06-08T19:00:00.000Z",
    overrides: {},
    upkeep: [
      { name: "Curse of the Elements", kind: "debuff", className: "Warlock", bestPct: 80,
        providers: [{ name: "Morg", slug: "morg", pct: 80 }] },
    ],
    usage: [
      usage({ name: "Kaz", itemBreakdown: [{ name: "Haste Potion", count: 4 }],
        prepBreakdown: [{ name: "Flask of Relentless Assault", count: 1 }], consumablesTotal: 4, deaths: 3 }),
    ],
  },
];

describe("summarizeSeason — hand adjustments", () => {
  const at = "2026-08-02T20:00:00.000Z";

  it("carries a raid's corrections into the cross-raid totals", () => {
    // One extra flask on Kaz's first night: R1 112 → 194, so total 254 → 336.
    const adjusted = summarizeSeason([
      {
        ...reports[0],
        adjustments: [{ actorName: "Kaz", name: "Flask of Relentless Assault", delta: 1, at }],
      },
      reports[1],
    ]);
    const kaz = adjusted.raiders.find((r) => r.name === "Kaz")!;
    expect(kaz.goldTotal).toBe(336);
    // Morg wasn't touched, so his figure is unchanged.
    expect(adjusted.raiders.find((r) => r.name === "Morg")!.goldTotal).toBe(15);
  });

  it("prices a consumable the log never saw on that night", () => {
    const adjusted = summarizeSeason([
      { ...reports[0], adjustments: [{ actorName: "Morg", name: "Dark Rune", delta: 2, at }] },
      reports[1],
    ]);
    // Morg: 15 logged + 2 Dark Runes at 6g = 27.
    expect(adjusted.raiders.find((r) => r.name === "Morg")!.goldTotal).toBe(27);
  });

  it("never lets a removal drive a night below zero", () => {
    const adjusted = summarizeSeason([
      { ...reports[0], adjustments: [{ actorName: "Morg", name: "Haste Potion", delta: -9, at }] },
      reports[1],
    ]);
    expect(adjusted.raiders.find((r) => r.name === "Morg")!.goldTotal).toBe(0);
  });
});

describe("summarizeSeason", () => {
  const view = summarizeSeason(reports);

  it("aggregates gold and consumables across raids with per-raid medians", () => {
    expect(view.reportCount).toBe(2);
    const kaz = view.raiders[0];
    expect(kaz.name).toBe("Kaz"); // sorted by total gold
    // R1 = 2×15 + 82 = 112; R2 = 4×15 + 82 = 142 → total 254, median 127.
    expect(kaz.goldTotal).toBe(254);
    expect(kaz.goldMedianPerRaid).toBe(127);
    expect(kaz.consumablesMedianPerRaid).toBe(3); // median of 2, 4
    expect(kaz.deathsMedianPerRaid).toBe(2); // median of 1, 3
    expect(kaz.raids).toBe(2);
    expect(view.raiders[1].name).toBe("Morg");
  });

  it("averages debuff/buff uptime per keeper across the season", () => {
    expect(view.uptime[0].name).toBe("Curse of the Elements");
    expect(view.uptime[0].providers[0]).toEqual({ name: "Morg", slug: "morg", pct: 85, raids: 2 });
  });

  it("surfaces both leaders and laggards as notables", () => {
    const labels = view.notables.map((n) => n.label);
    expect(labels).toContain("Biggest spender");
    expect(labels).toContain("Best Curse of the Elements uptime");
    const spender = view.notables.find((n) => n.label === "Biggest spender")!;
    expect(spender.tone).toBe("positive");
    expect(spender.raider.name).toBe("Kaz");
    expect(view.notables.some((n) => n.tone === "negative")).toBe(true);
  });
});
