import { describe, expect, it } from "vitest";
import { goldPerRaid } from "@/lib/analysis/comparison";
import { raidGoldView } from "@/lib/analysis/raid-gold";
import { summarizeRaidReport } from "@/lib/analysis/raid-report";
import { summarizeSeason } from "@/lib/analysis/season";
import type {
  ConsumableAdjustment,
  WclPlayerFight,
  WclPlayerOffPull,
  WclReport,
} from "@/lib/types";

/**
 * **The three consumable pricing sites must agree**, and until this file there
 * was nothing that noticed when they stopped.
 *
 * `docs/change-chains.md` §5 has said so in prose for months — "nothing catches
 * this but a test that compares them" — and it could not be written, because
 * one of the three lived inside `logs/page.tsx` where nothing could call it.
 * B3 moved it to `analysis/raid-gold.ts`; this is what that was for.
 *
 * The three, and the question each answers:
 *
 * | Site | Scope |
 * |---|---|
 * | `raidGoldView` | this night, as the raid page ranks it |
 * | `goldPerRaid` | a raider's average night, as the compare page and the loot drawer read it |
 * | `summarizeSeason` | a phase, as the season rankings and the payback ledger sum it |
 *
 * One raid night is where all three overlap, so the fixture is one night and
 * one report. Anything that changes what a consumable costs, or how often it
 * counts as bought, has to move all three together — and when it doesn't, the
 * same night reads two different ways on two pages a raider can open side by
 * side. That has happened: the raid page once priced a night at 80g against the
 * 287g the career page charged, because one site folded off-pull use in and the
 * other did not.
 *
 * ## The two divergences that are on purpose
 *
 * Both are asserted below rather than worked around, so that removing either
 * one is a deliberate act:
 *
 * 1. **`goldPerRaid` ignores per-raid price overrides.** It answers "what does
 *    a night cost this raider" *at default prices*, so a column of raiders
 *    stays comparable even when one of their raids happened to be priced by
 *    hand. See its own doc comment.
 * 2. **`goldPerRaid` measures the night by the raider's own pulls.** It is
 *    handed one raider's rows and no report, so it can only approximate the
 *    raid span from them — and the span is what decides how many times a timed
 *    buff counts as re-bought. A raider present all night agrees with the other
 *    two exactly; one who turned up for the last boss is charged for the
 *    fifteen minutes they were there, not the four hours the guild raided.
 *    That is the right answer to "what does a night cost *this* raider" and the
 *    wrong one to "what did tonight cost", which is why the raid page does not
 *    use it.
 *
 * A third looks like a divergence in the source and is not: `summarizeSeason`
 * wraps its night in `Math.max(0, …)` and `raidGoldView` does not. Neither can
 * reach it — `applyAdjustments` floors each line's count at zero, because
 * "minus one flask" against a raider who never had one is a mistake and not a
 * refund. The case below pins that, since a reader comparing the two would
 * otherwise reasonably conclude they disagree.
 */

const REPORT: WclReport = {
  code: "AGREE001",
  title: "Agreement night",
  zone: "Serpentshrine Cavern",
  startTime: "2026-06-10T19:00:00.000Z",
  endTime: "2026-06-10T23:00:00.000Z",
  fetchedAt: "2026-06-11T08:00:00.000Z",
  upkeepTracks: [],
  enemyCasts: [],
  unclassifiedAuras: [],
  raidSessionId: null,
};

/**
 * One pull for one raider.
 *
 * `fightStartMs` and `durationMs` matter more here than they look: `goldPerRaid`
 * derives the raid span from them, and the span decides how many times a timed
 * buff is counted as re-bought. Get them wrong and the three sites disagree for
 * a reason that has nothing to do with pricing.
 */
function fight(
  over: Partial<WclPlayerFight> & { fightId: number; actorName: string },
): WclPlayerFight {
  const { fightId, actorName, ...rest } = over;
  return {
    id: `AGREE001:${fightId}:${actorName.toLowerCase()}`,
    reportCode: "AGREE001",
    fightId,
    encounterId: 600 + fightId,
    encounterName: `Boss ${fightId}`,
    kill: true,
    durationMs: 300_000,
    // Spread across the report's four hours. This is load-bearing: see the
    // "a raider who joined late" case at the bottom.
    fightStartMs: (fightId - 1) * 13_800_000,
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

/**
 * A night with every shape that has caused a disagreement before.
 *
 * On-pull consumables, prep buffs that re-buy on death, a death to make them
 * re-buy, **off-pull** use (43% of one real night's sappers were on trash), and
 * a **pet** record — whose copy of a scroll is a different line from the
 * raider's own, labelled apart in two places that both have to do it.
 */
const ROWS: WclPlayerFight[] = [
  fight({
    fightId: 1,
    actorName: "Kazrak",
    flask: "Flask of Relentless Assault",
    potions: ["Haste Potion", "Haste Potion"],
    otherCasts: ["Super Sapper Charge"],
    sappers: 1,
    deaths: 1,
  }),
  fight({
    fightId: 2,
    actorName: "Kazrak",
    flask: "Flask of Relentless Assault",
    potions: ["Haste Potion"],
  }),
  fight({
    fightId: 1,
    actorName: "Sylvaria",
    elixirs: ["Elixir of Major Agility"],
    scrolls: ["Scroll of Agility V"],
    potions: ["Haste Potion"],
  }),
  fight({ fightId: 2, actorName: "Sylvaria", elixirs: ["Elixir of Major Agility"] }),
];

/** A complete off-pull record; the cast that hid a missing field is not worth it. */
function offPull(over: Partial<WclPlayerOffPull> & { actorName: string }): WclPlayerOffPull {
  return {
    id: `AGREE001|${over.actorName.toLowerCase()}`,
    reportCode: "AGREE001",
    characterId: null,
    potions: [],
    otherCasts: [],
    drums: 0,
    runes: 0,
    healthstones: 0,
    sappers: 0,
    petConsumables: [],
    petBuffsSeen: [],
    trashInterrupts: [],
    trashDispels: [],
    ...over,
  } as WclPlayerOffPull;
}

const OFF_PULL: WclPlayerOffPull[] = [
  offPull({
    actorName: "Kazrak",
    potions: ["Super Mana Potion"],
    otherCasts: ["Super Sapper Charge"],
    sappers: 1,
  }),
  // The hunter's pet drinks its own scroll. It is a separate line from the one
  // Sylvaria read to herself, and both sites have to label it apart.
  offPull({ actorName: "Sylvaria", petConsumables: [{ name: "Scroll of Agility V" }] }),
];

const SLUGS = new Map([
  ["kazrak", "kazrak"],
  ["sylvaria", "sylvaria"],
]);

/** The night as the raid page builds it. */
function theNight(adjustments: ConsumableAdjustment[] = []) {
  const raid = summarizeRaidReport({
    report: REPORT,
    reportPulls: 2,
    slugByActor: SLUGS,
    rows: ROWS,
    offPull: OFF_PULL,
  });
  return { raid, view: raidGoldView(raid.usage, raid.petSpend, {}, adjustments) };
}

/** The same night, through the season rollup. */
function theSeason(
  usage: ReturnType<typeof theNight>["raid"]["usage"],
  adjustments: ConsumableAdjustment[] = [],
) {
  return summarizeSeason([
    {
      code: REPORT.code,
      title: REPORT.title,
      zone: REPORT.zone,
      startTime: REPORT.startTime,
      usage,
      upkeep: [],
      overrides: {},
      adjustments,
    },
  ]);
}

/**
 * The same night, from the raw rows, as a raider's career reads it.
 *
 * `goldPerRaid` answers `undefined` for a raider with no rows at all, which
 * would silently skip every comparison below — so it is a failure here, not a
 * fallback.
 */
function theCareer(actor: string, adjustments: ConsumableAdjustment[] = []): number {
  const gold = goldPerRaid(
    ROWS.filter((r) => r.actorName === actor),
    OFF_PULL.filter((o) => o.actorName === actor),
    { [REPORT.code]: adjustments },
  );
  expect(gold, `${actor} has no rows in the fixture`).toBeDefined();
  return gold!;
}

describe("all three pricing sites agree on one raid night", () => {
  it("has a fixture that actually spends money", () => {
    // A fixture where everybody spends nothing would agree perfectly and prove
    // nothing at all.
    const { view } = theNight();
    expect(view.ranked).toHaveLength(2);
    for (const r of view.ranked) expect(r.total).toBeGreaterThan(0);
  });

  it("prices the night the same from the raid page, the career and the season", () => {
    const { raid, view } = theNight();
    const season = theSeason(raid.usage);

    for (const actor of ["Kazrak", "Sylvaria"]) {
      const fromRaid = view.ranked.find((r) => r.row.name === actor)!.total;
      const fromSeason = season.raiders.find((r) => r.name === actor)!;

      expect(Math.round(fromRaid), `${actor}: raid vs career`).toBe(theCareer(actor));
      // Over one night, a season total and its median night are both that night.
      expect(fromSeason.goldTotal, `${actor}: raid vs season total`).toBe(Math.round(fromRaid));
      expect(fromSeason.goldMedianPerRaid, `${actor}: raid vs season median`).toBe(
        Math.round(fromRaid),
      );
    }
  });

  it("still agrees once an officer has corrected the night", () => {
    // Corrections are the step most likely to be applied in one place and not
    // another: three sites, three copies of `applyAdjustments`.
    const at = "2026-08-02T20:00:00.000Z";
    const adjustments: ConsumableAdjustment[] = [
      { actorName: "Kazrak", name: "Haste Potion", delta: 2, at },
      { actorName: "Kazrak", name: "Super Sapper Charge", delta: -1, at },
      // A consumable the log never saw, added by hand — it still costs gold.
      { actorName: "Sylvaria", name: "Elixir of Major Firepower", delta: 1, at },
    ];

    const { raid, view } = theNight(adjustments);
    const season = theSeason(raid.usage, adjustments);

    for (const actor of ["Kazrak", "Sylvaria"]) {
      const fromRaid = view.ranked.find((r) => r.row.name === actor)!.total;
      expect(Math.round(fromRaid), `${actor}: raid vs career, corrected`).toBe(
        theCareer(actor, adjustments),
      );
      expect(
        season.raiders.find((r) => r.name === actor)!.goldTotal,
        `${actor}: raid vs season, corrected`,
      ).toBe(Math.round(fromRaid));
    }
  });

  it("counts what happened away from the pulls, in all three", () => {
    // The disagreement this chain was written for: one site folded off-pull use
    // in and another did not, so the raid page said 80g and the career page
    // said 287g for the same night.
    const withoutOffPull = summarizeRaidReport({
      report: REPORT,
      reportPulls: 2,
      slugByActor: SLUGS,
      rows: ROWS,
    });
    const bare = raidGoldView(withoutOffPull.usage, withoutOffPull.petSpend, {}, []);
    const { view } = theNight();

    const kazrakBare = bare.ranked.find((r) => r.row.name === "Kazrak")!.total;
    const kazrakFull = view.ranked.find((r) => r.row.name === "Kazrak")!.total;
    // A potion and a sapper on trash are bought and paid for like any other.
    expect(kazrakFull).toBeGreaterThan(kazrakBare);
    // And the career figure counts them too, which is the agreement.
    expect(theCareer("Kazrak")).toBe(Math.round(kazrakFull));
  });

  it("keeps a pet's copy of a scroll apart from its owner's, in all three", () => {
    // Under one name they fold into a single line, and an officer's ±1 against
    // that name then moves both — a correction is keyed by the name it corrects.
    const { raid, view } = theNight();
    const sylvaria = view.ranked.find((r) => r.row.name === "Sylvaria")!;
    const labels = sylvaria.row.logged.map((l) => l.name);

    expect(labels).toContain("Scroll of Agility V");
    const petLabel = labels.find((l) => l !== "Scroll of Agility V" && /Scroll of Agility V/.test(l));
    expect(petLabel, "the pet's copy is not labelled apart on the raid page").toBeDefined();

    // The season sums the same two lines rather than one.
    const season = theSeason(raid.usage);
    const names = season.consumables.map((c) => c.name);
    expect(names).toContain("Scroll of Agility V");
    expect(names).toContain(petLabel);
  });
});

describe("the divergences that are deliberate", () => {
  it("prices a career at defaults, so raiders stay comparable across raids", () => {
    // `goldPerRaid` answers "what does a night cost this raider" for a column of
    // raiders, and one raid having been priced by hand must not move that
    // raider up or down against the others. So it ignores overrides — and the
    // raid page, which is about THIS night, honours them.
    const { raid } = theNight();
    const overrides = { "Haste Potion": { gold: 500, charges: 1 } };
    const priced = raidGoldView(raid.usage, raid.petSpend, overrides, []);

    const kazrakPriced = priced.ranked.find((r) => r.row.name === "Kazrak")!.total;
    expect(kazrakPriced).toBeGreaterThan(theCareer("Kazrak"));
    // The career figure did not move, because it never read the override.
    expect(theCareer("Kazrak")).toBe(
      Math.round(raidGoldView(raid.usage, raid.petSpend, {}, []).ranked.find(
        (r) => r.row.name === "Kazrak",
      )!.total),
    );
  });

  it("agrees under a correction big enough to look like it should go negative", () => {
    /*
     * `summarizeSeason` floors its night at zero and `raidGoldView` does not,
     * which reads like a disagreement waiting to happen. It is not: a removal
     * can only take away what is there, so `applyAdjustments` drops the line
     * rather than letting a count go negative, and neither floor is ever
     * reached. Take that away and the two sites really would differ — which is
     * why the assertion is here and not in the adjustments test alone.
     */
    const at = "2026-08-02T20:00:00.000Z";
    const impossible: ConsumableAdjustment[] = [
      "Haste Potion",
      "Flask of Relentless Assault",
      "Super Sapper Charge",
      "Super Mana Potion",
      "Food",
      "Weapon oil/stone",
    ].map((name) => ({ actorName: "Kazrak", name, delta: -99, at }));

    const { raid, view } = theNight(impossible);
    const fromRaid = view.ranked.find((r) => r.row.name === "Kazrak");
    const fromSeason = theSeason(raid.usage, impossible).raiders.find((r) => r.name === "Kazrak")!;

    // Nothing left to charge for, and no negative anywhere.
    expect(fromSeason.goldTotal).toBe(0);
    expect(fromRaid!.total).toBe(0);
    // The row survives at zero: somebody made that decision, and the ranking is
    // where they see it.
    expect(fromRaid!.adjusted).toBeGreaterThan(0);
  });
  it("charges a latecomer for the hours they were there, not the raid's", () => {
    /*
     * The approximation named in the header, made visible. `goldPerRaid` gets
     * one raider's rows and no report, so a raider whose pulls cover fifteen
     * minutes of a four-hour night is charged for fifteen minutes of timed
     * buffs — fewer re-buys than the raid page counts for the same rows.
     *
     * Both are right about their own question. This test exists so that the
     * day somebody makes them agree, they do it on purpose: the fix is to pass
     * the raid span in, not to change either formula.
     */
    const late = ROWS.filter((r) => r.actorName === "Kazrak").map((r) => ({
      ...r,
      fightStartMs: 13_800_000 + r.fightId * 60_000,
    }));
    const shortSpan = goldPerRaid(late, OFF_PULL.filter((o) => o.actorName === "Kazrak"), {});
    expect(shortSpan).toBeDefined();

    expect(shortSpan!).toBeLessThan(theCareer("Kazrak"));
    // And still more than nothing — the items they used are charged in full;
    // it is only the timed buffs that re-buy less often.
    expect(shortSpan!).toBeGreaterThan(0);
  });
});
