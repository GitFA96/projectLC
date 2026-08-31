import { describe, expect, it } from "vitest";
import { isGuildCharacter, summarizeSeason } from "@/lib/analysis/season";
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

describe("summarizeSeason — per-consumable rollup", () => {
  const view = summarizeSeason(reports);
  const of = (name: string) => view.consumables.find((c) => c.name === name)!;

  it("pivots the same spend by consumable, most gold first", () => {
    // Flasks: 2 × 82 = 164. Haste: 7 × 15 = 105.
    expect(view.consumables.map((c) => c.name)).toEqual([
      "Flask of Relentless Assault",
      "Haste Potion",
    ]);
    expect(of("Flask of Relentless Assault").gold).toBe(164);
    expect(of("Haste Potion").uses).toBe(7);
    expect(of("Haste Potion").gold).toBe(105);
  });

  it("counts the raids a consumable was used in, not the raids selected", () => {
    // Both nights had haste potions; only Kaz's flask spans both, and Morg
    // never flasked at all.
    expect(of("Haste Potion").raids).toBe(2);
    expect(of("Flask of Relentless Assault").raids).toBe(2);
  });

  it("lists only players who used it, ranked by uses", () => {
    const haste = of("Haste Potion");
    expect(haste.users.map((u) => u.name)).toEqual(["Kaz", "Morg"]);
    expect(haste.users[0]).toMatchObject({ name: "Kaz", uses: 6, gold: 90 });
    // Morg never flasked, so he is absent rather than present with a zero.
    expect(of("Flask of Relentless Assault").users.map((u) => u.name)).toEqual(["Kaz"]);
  });

  it("divides by the raids the player attended, not the raids selected", () => {
    // Morg raided once of the two. His average is per HIS night — the board
    // divides by this number, and halving it would flatter everyone who skips.
    expect(of("Haste Potion").users.find((u) => u.name === "Morg")!.raids).toBe(1);
    expect(of("Haste Potion").users.find((u) => u.name === "Kaz")!.raids).toBe(2);
  });

  it("agrees with the per-raider totals it was built from", () => {
    // The same corrected lines feed both views; if they ever diverge, one of
    // the two is lying about the same night. See docs/change-chains.md §5.
    const perConsumable = view.consumables.reduce((s, c) => s + c.gold, 0);
    const perRaider = view.raiders.reduce((s, r) => s + r.goldTotal, 0);
    expect(perConsumable).toBe(perRaider);
  });

  it("carries a hand correction into the consumable view too", () => {
    const adjusted = summarizeSeason([
      {
        ...reports[0],
        adjustments: [
          { actorName: "Kaz", name: "Flask of Relentless Assault", delta: 1, at: "2026-08-02T20:00:00.000Z" },
        ],
      },
      reports[1],
    ]);
    const flask = adjusted.consumables.find((c) => c.name === "Flask of Relentless Assault")!;
    expect(flask.uses).toBe(3);
    expect(flask.gold).toBe(246);
    expect(flask.users[0]).toMatchObject({ name: "Kaz", uses: 3 });
  });
});

describe("summarizeSeason — roster status", () => {
  it("stamps the roster's own words on a logged name", () => {
    const view = summarizeSeason(reports, {
      kaz: { status: "main" },
      morg: { status: "alt", mainName: "Kaz" },
    });
    expect(view.raiders.find((r) => r.name === "Kaz")).toMatchObject({ status: "main" });
    expect(view.raiders.find((r) => r.name === "Morg")).toMatchObject({
      status: "alt",
      mainName: "Kaz",
    });
    const haste = view.consumables.find((c) => c.name === "Haste Potion")!;
    expect(haste.users.map((u) => u.status)).toEqual(["main", "alt"]);
  });

  it("leaves a name the roster doesn't know unstamped rather than guessing", () => {
    // No status is how a pug — or an unmatched logged name — reads. The guild
    // filter has to be able to tell "not on the roster" from "on it as a pug".
    const view = summarizeSeason(reports, { kaz: { status: "main" } });
    expect(view.raiders.find((r) => r.name === "Morg")!.status).toBeUndefined();
  });

  it("works with no roster at all", () => {
    const view = summarizeSeason(reports);
    expect(view.raiders.every((r) => r.status === undefined)).toBe(true);
  });
});

describe("isGuildCharacter", () => {
  it("counts the roster and not the visitors", () => {
    expect(isGuildCharacter("main")).toBe(true);
    expect(isGuildCharacter("alt")).toBe(true);
    expect(isGuildCharacter("trial")).toBe(true);
    // Kept: they raided with us, and their nights still have to add up.
    expect(isGuildCharacter("inactive")).toBe(true);
    expect(isGuildCharacter("pug")).toBe(false);
  });

  it("treats a name the roster never matched as not ours", () => {
    // The roster is what makes somebody a guild character. Silence isn't
    // membership — and defaulting the other way would quietly move a stranger's
    // spend into the guild's total.
    expect(isGuildCharacter(undefined)).toBe(false);
  });
});

/**
 * The payback ledger — the running account of who has had their consumables
 * covered across the season, and who keeps missing out.
 *
 * Built inside `summarizeSeason` rather than in a module of its own, because it
 * needs each raider's priced, corrected spend per night — which is exactly what
 * that function already computes and what change-chains §5 warns against
 * computing a second time.
 */
describe("summarizeSeason — payback ledger", () => {
  // Kaz spends 112g on night 1 (2 Haste Potions + a flask) and 142g on night 2;
  // Morg spends 15g on night 1 only.
  const withPot = (over: Partial<SeasonReportInput>[]): SeasonReportInput[] =>
    reports.map((r, i) => ({ ...r, ...over[i] }));

  it("counts only the raids that recorded a pot", () => {
    // A night with no marks banked is not a night anybody went unpaid, and
    // counting it would make every raider who missed a payday look shorted.
    const view = summarizeSeason(
      withPot([{ payback: { marks: 1, markGold: 100, paid: {} } }, {}]),
    );
    expect(view.payback.raids.map((r) => r.code)).toEqual(["R1"]);
    expect(view.payback.raidsWithoutPot).toBe(1);
    expect(view.payback.raiders.find((r) => r.name === "Kaz")!.raids).toBe(1);
  });

  it("adds a raider's owed and paid up across nights", () => {
    const view = summarizeSeason(
      withPot([
        { payback: { marks: 1, markGold: 100, paid: { Kaz: 40 } } },
        { payback: { marks: 1, markGold: 100, paid: { Kaz: 10 } } },
      ]),
    );
    const kaz = view.payback.raiders.find((r) => r.name === "Kaz")!;
    expect(kaz.raids).toBe(2);
    // Night 1: 112 of 127 spend → 88g. Night 2: alone, so the whole 100g.
    expect(Math.round(kaz.recommended)).toBe(188);
    expect(kaz.paid).toBe(50);
    expect(Math.round(kaz.balance)).toBe(138);
    expect(Math.round(view.payback.paidTotal)).toBe(50);
  });

  it("sorts by who is furthest behind, not by who spent most", () => {
    // The whole reason the ledger exists: over a season the split pays the same
    // few raiders every week, and this is the only view that says who never got
    // covered. Kaz spends far more than Morg and is paid in full; Morg is not.
    const view = summarizeSeason(
      withPot([{ payback: { marks: 1, markGold: 100, paid: { Kaz: 500 } } }, {}]),
    );
    expect(view.payback.raiders[0].name).toBe("Morg");
    expect(view.payback.raiders[0].balance).toBeGreaterThan(0);
    // Kaz has had more than the split called for, which reads as negative.
    expect(view.payback.raiders.find((r) => r.name === "Kaz")!.balance).toBeLessThan(0);
  });

  it("records each night's pot and what the ceiling left behind", () => {
    // A pot far bigger than the night's spend cannot all be handed out.
    const view = summarizeSeason(withPot([{ payback: { marks: 30, markGold: 100, paid: {} } }, {}]));
    const [night] = view.payback.raids;
    expect(night.potGold).toBe(3000);
    // Night 1's whole spend is 127g, so that is the most anyone can be paid.
    expect(Math.round(night.recommended)).toBe(127);
    expect(night.marksLeft).toBeGreaterThan(0);
  });

  it("is empty, not wrong, when nobody has recorded a pot", () => {
    const view = summarizeSeason(reports);
    expect(view.payback.raids).toEqual([]);
    expect(view.payback.raiders).toEqual([]);
    expect(view.payback.raidsWithoutPot).toBe(2);
  });
});
