import { describe, expect, it } from "vitest";
import {
  consumableTitle,
  countedList,
  coverage,
  fmtAmount,
  fmtDuration,
  upkeepAverages,
  usesOf,
} from "@/lib/analysis/performance-view";
import type { WclPlayerFight } from "@/lib/types";

/**
 * The performance page's arithmetic, testable now that it is out of the page.
 *
 * Nothing here was ever covered: a server component cannot be imported, so
 * every one of these was verified only by looking at the rendered page. Two of
 * them carry a distinction that is easy to flatten by accident — pulls covered
 * versus uses, and an average weighted by pull length rather than plain.
 */

function fight(over: Partial<WclPlayerFight> = {}): WclPlayerFight {
  return {
    id: "R:1:x",
    reportCode: "R",
    fightId: 1,
    encounterId: 601,
    encounterName: "Hydross",
    kill: true,
    durationMs: 300000,
    actorName: "Kazrak",
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
    ...over,
  } as WclPlayerFight;
}

describe("fmtDuration", () => {
  it("reads as minutes and seconds, zero-padded", () => {
    expect(fmtDuration(0)).toBe("0:00");
    expect(fmtDuration(9_000)).toBe("0:09");
    expect(fmtDuration(65_000)).toBe("1:05");
    expect(fmtDuration(600_000)).toBe("10:00");
  });

  it("rounds to the nearest second rather than truncating", () => {
    expect(fmtDuration(59_600)).toBe("1:00");
  });
});

describe("fmtAmount", () => {
  it("says nothing rather than zero when the pull was never ranked", () => {
    // A pull WCL did not rank has no amount. Printing 0 would read as "did
    // nothing", which is a different claim and an unfair one.
    expect(fmtAmount({ amount: undefined, role: "dps" })).toBe("—");
  });

  it("names the metric the role is judged on", () => {
    expect(fmtAmount({ amount: 1234.6, role: "dps" })).toBe("1,235 dps");
    expect(fmtAmount({ amount: 987, role: "healer" })).toBe("987 hps");
    expect(fmtAmount({ amount: 1_234_567, role: "tank" })).toBe("1,234,567 dps");
  });
});

describe("consumableTitle", () => {
  it("says the flask and stops — one item covers both halves", () => {
    expect(consumableTitle(fight({ flask: "Flask of Relentless Assault" }))).toBe(
      "Flask of Relentless Assault",
    );
  });

  it("names the missing half, not just 'partial'", () => {
    // The point of the sentence: an officer can act on "no guardian elixir".
    const title = consumableTitle(fight({ elixirs: ["Elixir of Major Agility"] }));
    expect(title).toMatch(/Elixir of Major Agility/);
    expect(title).toMatch(/no guardian elixir/);
  });

  it("says so plainly when there was nothing", () => {
    expect(consumableTitle(fight())).toBe("no flask or elixirs");
  });
});

describe("coverage and usesOf answer different questions", () => {
  const rows = [
    fight({ fightId: 1, potions: ["Haste Potion", "Haste Potion"] }),
    fight({ fightId: 2, potions: ["Haste Potion", "Super Mana Potion"] }),
    fight({ fightId: 3, potions: [] }),
  ];
  const potions = (r: WclPlayerFight) => r.potions;

  it("counts pulls covered, deduped within a pull", () => {
    // Two Haste Potions on pull 1 cover one pull, not two.
    expect([...coverage(rows, potions)]).toEqual([
      ["Haste Potion", 2],
      ["Super Mana Potion", 1],
    ]);
  });

  it("counts every use, including two on one pull", () => {
    expect(usesOf(rows, potions).get("Haste Potion")).toBe(3);
    expect(usesOf(rows, potions).get("Super Mana Potion")).toBe(1);
  });

  it("puts the best-covered label first", () => {
    expect([...coverage(rows, potions).keys()][0]).toBe("Haste Potion");
  });
});

describe("countedList", () => {
  it("collapses repeats into a count, most-used first", () => {
    expect(countedList(["Haste Potion", "Sapper", "Haste Potion"])).toBe("Haste Potion ×2 · Sapper");
  });

  it("settles a tie by name, through the shared collator", () => {
    // Never a bare localeCompare: this project is developed under nb-NO, where
    // "aa" sorts as "å". See src/lib/sort.ts.
    expect(countedList(["Zeta", "Alpha"])).toBe("Alpha · Zeta");
  });

  it("is empty for nothing at all", () => {
    expect(countedList([])).toBe("");
  });
});

describe("upkeepAverages", () => {
  it("weights by pull length rather than taking a plain mean", () => {
    // 100% across nine minutes and 0% across one is 90%, not 50%. A plain mean
    // would let one short pull sink a number describing the whole night.
    const rows = [
      fight({ fightId: 1, durationMs: 540_000, upkeep: [{ name: "Sunder Armor", pct: 100 }] }),
      fight({ fightId: 2, durationMs: 60_000, upkeep: [{ name: "Sunder Armor", pct: 0 }] }),
    ] as WclPlayerFight[];
    expect(upkeepAverages(rows).get("Sunder Armor")).toBe(90);
  });

  it("counts a pull the aura is missing from as zero, not as absent", () => {
    // "They did not keep it up on that pull" is the answer; skipping the pull
    // would report the average of the pulls where they did, which is flattery.
    const rows = [
      fight({ fightId: 1, durationMs: 100_000, upkeep: [{ name: "Curse of Elements", pct: 80 }] }),
      fight({ fightId: 2, durationMs: 100_000, upkeep: [] }),
    ] as WclPlayerFight[];
    expect(upkeepAverages(rows).get("Curse of Elements")).toBe(40);
  });

  it("ranks the best-kept aura first", () => {
    const rows = [
      fight({
        durationMs: 100_000,
        upkeep: [
          { name: "Low", pct: 10 },
          { name: "High", pct: 90 },
        ],
      }),
    ] as WclPlayerFight[];
    expect([...upkeepAverages(rows).keys()]).toEqual(["High", "Low"]);
  });

  it("survives a report of zero length by reporting zero, not by dividing", () => {
    // The `Math.max(1, totalDur)` floor. Every average is 0 here and there is
    // no ranking to be had — which is right: nothing was measured over no time.
    const rows = [
      fight({
        durationMs: 0,
        upkeep: [
          { name: "Low", pct: 10 },
          { name: "High", pct: 90 },
        ],
      }),
    ] as WclPlayerFight[];
    expect([...upkeepAverages(rows).values()]).toEqual([0, 0]);
  });
});
