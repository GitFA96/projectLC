import { describe, expect, it } from "vitest";
import {
  adjustmentGold,
  adjustmentsFor,
  applyAdjustments,
} from "@/lib/analysis/consumable-adjustments";
import { leaderboardPrices, pricedNames, raidGoldView } from "@/lib/analysis/raid-gold";
import { summarizeRaidReport } from "@/lib/analysis/raid-report";
import { compareText } from "@/lib/sort";
import { costPerUseMap, effectivePrice, goldOfBreakdown } from "@/lib/wcl/consumable-prices";
import { baseConsumableName } from "@/lib/wcl/consumables";
import type {
  ConsumableAdjustment,
  ConsumablePrice,
  PetSpendView,
  RaiderUsage,
  WclPlayerFight,
  WclReport,
} from "@/lib/types";

/**
 * The third pricing site, now that it is somewhere a test can reach.
 *
 * Two claims, and the first is temporary scaffolding on purpose. **Moving this
 * out of `logs/page.tsx` must not have changed a single number**, so the old
 * expression is reproduced here verbatim and asserted to agree, over the seed
 * guild's real raid night rather than a fixture built to suit. Delete that
 * comparison the day the old shape stops being the reference — but not before,
 * because it is the only proof the move was faithful.
 *
 * The second is ordinary behaviour: what gets a price, who appears in the
 * ranking, and how a correction moves a total. Those are the rules
 * change-chains §5 says all three sites must agree on, and A4 is the test that
 * will compare them — which needed this code to be callable at all.
 *
 * The raid it runs against is built by `summarizeRaidReport`, the way every
 * other test in this directory builds one. The first draft read the seed guild
 * out of SQLite instead and `docs.test.ts` refused it, correctly: this layer is
 * pure, and that is exactly what makes it testable without a database.
 */

/** Exactly what `GoldPanel` computed inline, before the move. */
function inlineGoldPanel(
  usage: RaiderUsage[],
  petSpend: PetSpendView,
  overrides: Record<string, ConsumablePrice>,
  adjustments: ConsumableAdjustment[],
) {
  const names = new Set<string>();
  for (const u of usage) {
    for (const b of u.itemBreakdown) names.add(b.name);
    for (const b of u.prepBreakdown) names.add(b.name);
  }
  for (const a of adjustments) names.add(a.name);
  for (const row of petSpend.rows) for (const line of row.lines) names.add(line.name);
  const costPerUse = costPerUseMap(names, overrides);
  const usingDefault = Object.keys(overrides).length === 0;
  const priceRows = [...new Set([...names].map(baseConsumableName))]
    .sort()
    .map((name) => ({ name, price: effectivePrice(name, overrides) }));
  const ranked = usage
    .map((u) => {
      const inFight = goldOfBreakdown(u.itemBreakdown, costPerUse);
      const prep = goldOfBreakdown(u.prepBreakdown, costPerUse);
      const logged = [...u.itemBreakdown, ...u.prepBreakdown];
      const mine = adjustmentsFor(adjustments, u.name);
      const delta = adjustmentGold(logged, applyAdjustments(logged, mine), costPerUse);
      return {
        row: { name: u.name, slug: u.slug, className: u.className, inFight, prep, logged },
        total: inFight + prep + delta,
        adjusted: mine.length,
      };
    })
    .filter((x) => x.total > 0 || x.adjusted > 0)
    .sort((a, b) => b.total - a.total || compareText(a.row.name, b.row.name));
  return { costPerUse, usingDefault, priceRows, ranked };
}

const REPORT: WclReport = {
  code: "GOLD001",
  title: "SSC night",
  zone: "Serpentshrine Cavern",
  startTime: "2026-06-10T19:00:00.000Z",
  endTime: "2026-06-10T23:00:00.000Z",
  fetchedAt: "2026-06-11T08:00:00.000Z",
  upkeepTracks: [],
  enemyCasts: [],
  unclassifiedAuras: [],
  raidSessionId: null,
};

function fight(
  over: Partial<WclPlayerFight> & { fightId: number; actorName: string },
): WclPlayerFight {
  const { fightId, actorName, ...rest } = over;
  return {
    id: `GOLD001:${fightId}:${actorName.toLowerCase()}`,
    reportCode: "GOLD001",
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

/**
 * A raid with the shapes that make this arithmetic interesting: three raiders,
 * consumables used in a pull and worn to one, a sapper, a death (which is the
 * reapply multiplier on prep buffs), and a raider who brought nothing.
 */
function aRaid() {
  return summarizeRaidReport({
    report: REPORT,
    reportPulls: 2,
    slugByActor: new Map([
      ["kazrak", "kazrak"],
      ["pyrelia", "pyrelia"],
      ["morgrave", "morgrave"],
    ]),
    rows: [
      fight({
        fightId: 1,
        actorName: "Kazrak",
        flask: "Flask of Relentless Assault",
        potions: ["Haste Potion", "Haste Potion"],
        otherCasts: ["Super Sapper Charge"],
        sappers: 1,
        deaths: 1,
      }),
      fight({ fightId: 2, actorName: "Kazrak", flask: "Flask of Relentless Assault" }),
      fight({
        fightId: 1,
        actorName: "Pyrelia",
        elixirs: ["Elixir of Major Firepower"],
        potions: ["Super Mana Potion"],
      }),
      fight({ fightId: 2, actorName: "Pyrelia", elixirs: ["Elixir of Major Firepower"] }),
      // Nothing at all: the raider a filter has to drop.
      fight({ fightId: 1, actorName: "Morgrave", food: false, weaponBuff: false }),
    ],
  });
}

describe("the move out of logs/page.tsx changed no number", () => {
  it("agrees with the old inline expression", () => {
    const raid = aRaid();
    expect(raid.usage.length).toBeGreaterThan(0);

    expect(raidGoldView(raid.usage, raid.petSpend, {}, [])).toEqual(
      inlineGoldPanel(raid.usage, raid.petSpend, {}, []),
    );
  });

  it("agrees once the raid is priced and corrected", () => {
    // Both of the things that move the arithmetic, at once: an override that
    // changes a price, and a correction that adds and removes uses.
    const raid = aRaid();
    const overrides: Record<string, ConsumablePrice> = {
      "Flask of Relentless Assault": { gold: 42, charges: 1 },
      "Super Mana Potion": { gold: 7, charges: 5 },
    };
    const at = "2026-08-02T20:00:00.000Z";
    const adjustments: ConsumableAdjustment[] = [
      { actorName: raid.usage[0].name, name: "Super Mana Potion", delta: 3, at },
      { actorName: raid.usage[0].name, name: "Flask of Relentless Assault", delta: -1, at },
      // A consumable nobody was logged using still costs gold.
      { actorName: raid.usage[0].name, name: "Elixir of Major Agility", delta: 2, at },
    ];

    expect(raidGoldView(raid.usage, raid.petSpend, overrides, adjustments)).toEqual(
      inlineGoldPanel(raid.usage, raid.petSpend, overrides, adjustments),
    );
  });

  it("agrees on the leaderboard's narrower question", () => {
    const raid = aRaid();
    const overrides = { "Haste Potion": { gold: 30, charges: 1 } };
    const names = new Set(raid.usage.flatMap((u) => u.itemBreakdown.map((b) => b.name)));
    expect(leaderboardPrices(raid.usage, overrides)).toEqual({
      costPerUse: costPerUseMap(names, overrides),
      usingDefault: false,
    });
  });
});

/**
 * A real `RaiderUsage`, so a fixture never needs a cast that would hide a field
 * being added to the type.
 */
function usageRow(over: Partial<RaiderUsage> = {}): RaiderUsage {
  return {
    name: "Thrainn",
    slug: "thrainn",
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
  } as RaiderUsage;
}

/** No pets in this raid. */
const NO_PETS: PetSpendView = { rows: [], total: 0 } as unknown as PetSpendView;

describe("what a raid has to hold a price for", () => {
  const usage = (over: Partial<RaiderUsage> = {}) =>
    usageRow({
      itemBreakdown: [{ name: "Haste Potion", count: 2 }],
      prepBreakdown: [{ name: "Flask of Relentless Assault", count: 1 }],
      ...over,
    });
  const at = "2026-08-02T20:00:00.000Z";

  it("covers what was used, what was worn, what was corrected, and what a pet drank", () => {
    const pets = {
      rows: [{ lines: [{ name: "Scroll of Agility V (pet)" }] }],
    } as unknown as PetSpendView;
    const names = pricedNames(
      [usage()],
      pets,
      [{ actorName: "Thrainn", name: "Elixir of Major Agility", delta: 1, at }],
    );
    expect([...names].sort()).toEqual([
      // Hand-added: an officer can name a consumable nobody was logged using.
      "Elixir of Major Agility",
      // Worn to the pull, not used in one.
      "Flask of Relentless Assault",
      // Used in a pull.
      "Haste Potion",
      // Seen only on a pet, so it reached no breakdown at all — leave it out
      // and the card prices it at zero.
      "Scroll of Agility V (pet)",
    ]);
  });

  it("gives the pet's copy and the raider's own one price, under the item's name", () => {
    const pets = {
      rows: [{ lines: [{ name: "Scroll of Agility V (pet)" }] }],
    } as unknown as PetSpendView;
    const view = raidGoldView(
      [usage({ prepBreakdown: [{ name: "Scroll of Agility V", count: 1 }] })],
      pets,
      {},
      [],
    );
    // Two lines in the breakdowns, one row in the price panel: the same scroll
    // at the same price. Two rows would let one raid hold two prices for it.
    expect(view.priceRows.filter((r) => /Scroll of Agility V/.test(r.name))).toHaveLength(1);
    expect(view.priceRows.map((r) => r.name)).toContain("Scroll of Agility V");
  });
});

describe("the ranking", () => {
  const at = "2026-08-02T20:00:00.000Z";
  const raider = (name: string, potions: number) =>
    usageRow({
      name,
      slug: name.toLowerCase(),
      itemBreakdown: potions > 0 ? [{ name: "Haste Potion", count: potions }] : [],
    });

  it("puts the biggest spender first and settles ties by name", () => {
    const view = raidGoldView([raider("Zeta", 1), raider("Alpha", 1), raider("Big", 9)], NO_PETS, {}, []);
    expect(view.ranked.map((r) => r.row.name)).toEqual(["Big", "Alpha", "Zeta"]);
  });

  it("drops a raider who spent nothing, and keeps one somebody corrected", () => {
    const adjustments = [{ actorName: "Corrected", name: "Haste Potion", delta: 0, at }];
    const view = raidGoldView([raider("Spent", 2), raider("Nothing", 0), raider("Corrected", 0)], NO_PETS, {}, adjustments);
    // "Nothing" is absent; "Corrected" stays even at zero gold, because a
    // person decided that zero — the row is the record of the decision.
    expect(view.ranked.map((r) => r.row.name).sort()).toEqual(["Corrected", "Spent"]);
    expect(view.ranked.find((r) => r.row.name === "Corrected")!.adjusted).toBe(1);
  });

  it("keeps the logged columns as the log reported them, correction apart", () => {
    // The adjustment column has to show exactly what a person changed rather
    // than hiding it inside a bigger number.
    const adjustments = [{ actorName: "Thrainn", name: "Haste Potion", delta: 5, at }];
    const [row] = raidGoldView([raider("Thrainn", 2)], NO_PETS, {}, adjustments).ranked;
    expect(row.row.logged).toEqual([{ name: "Haste Potion", count: 2 }]);
    expect(row.total).toBeGreaterThan(row.row.inFight + row.row.prep);
  });

  it("says whether anybody has priced the night", () => {
    expect(raidGoldView([raider("A", 1)], NO_PETS, {}, []).usingDefault).toBe(true);
    expect(
      raidGoldView([raider("A", 1)], NO_PETS, { "Haste Potion": { gold: 9, charges: 1 } }, []).usingDefault,
    ).toBe(false);
  });
});
