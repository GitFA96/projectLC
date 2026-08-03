import { describe, expect, it } from "vitest";
import {
  LOOT_PRIORITY_WEIGHTS,
  computeLootPriority,
  rankLootContenders,
  slotServedAdjustment,
} from "@/lib/analysis/loot-priority";
import type {
  AttendanceSummary,
  Character,
  CharacterStatus,
  ContentionWisher,
  PerformanceSummary,
  RaiderMetrics,
} from "@/lib/types";

function character(name: string, status: CharacterStatus = "main"): Character {
  return {
    id: `c-${name.toLowerCase()}`,
    guildId: "g1",
    name,
    class: "Warrior",
    spec: "Fury",
    role: "Melee DPS",
    status,
    mainCharacterId: null,
  };
}

function attendance(pct: number, tracked = 10): AttendanceSummary {
  return {
    raidsTotal: tracked,
    raidsAttended: Math.round((pct / 100) * tracked),
    raidsTracked: tracked,
    raidPct: pct,
    recentAttended: 0,
    recentTotal: 0,
    recentPct: 0,
    pullsAttended: 0,
    pullsTotal: 0,
    pullPct: 0,
    weeks: [],
    weeksAttended: 0,
    weeksTracked: 0,
    weeksExcused: 0,
  };
}

/** A career rollup carrying just the two numbers the score reads. */
function career(opts: { medianParse?: number; preparedPct?: number }): PerformanceSummary {
  return {
    fights: 20,
    kills: 15,
    wipes: 5,
    deaths: 2,
    medianParse: opts.medianParse,
    role: "dps",
    flaskOrElixirsPct: 100,
    flaskPct: 100,
    elixirsPct: 0,
    foodPct: 100,
    weaponBuffPct: 100,
    preparedPct: opts.preparedPct ?? 0,
    potionsTotal: 0,
    potionsPerFight: 0,
    prepots: 0,
    drums: 0,
    runes: 0,
    healthstones: 0,
    sappers: 0,
    missingEnchants: [],
  };
}

const perfect: RaiderMetrics = {
  attendance: attendance(100),
  career: career({ medianParse: 100, preparedPct: 100 }),
};

function wisher(
  name: string,
  opts: {
    satisfied?: boolean;
    awards?: number;
    status?: CharacterStatus;
    /** How many of `awards` land in the contested item's slot family. */
    sameSlot?: number;
  } = {},
): ContentionWisher {
  const count = opts.awards ?? 0;
  const sameSlot = opts.sameSlot ?? 0;
  return {
    character: character(name, opts.status),
    phases: [2],
    currentInSlot: [],
    satisfied: opts.satisfied ?? false,
    onSpecAwardsActivePhase: count,
    awardsThisPhase: Array.from({ length: count }, (_, i) => ({
      itemId: 1000 + i,
      itemName: `Item ${1000 + i}`,
      awardedAt: `2026-07-0${i + 1}T20:00:00`,
      offspec: false,
      slot: "waist" as const,
      sameSlot: i < sameSlot,
    })),
    totalOnSpecAwards: count,
  };
}

describe("computeLootPriority", () => {
  it("scores a flawless main at the top of the scale", () => {
    expect(computeLootPriority(character("Ideal"), perfect, 0, 0).score).toBe(100);
  });

  it("weights each factor as the policy says", () => {
    // Only attendance is imperfect: 0 instead of 100, so the score drops by
    // exactly the attendance weight.
    const priority = computeLootPriority(
      character("Absent"),
      { ...perfect, attendance: attendance(0) },
      0,
      0,
    );
    expect(priority.score).toBe(100 - LOOT_PRIORITY_WEIGHTS.attendance);
  });

  it("leaves a missing metric out of the average instead of scoring it zero", () => {
    // A raider with no parses is not thereby a bad raider — the performance
    // weight leaves the denominator rather than dragging them down.
    const noParses = computeLootPriority(
      character("Fresh"),
      { attendance: attendance(100), career: career({ preparedPct: 100 }) },
      0,
      0,
    );
    expect(noParses.score).toBe(100);
    expect(noParses.factors.find((f) => f.key === "performance")).toMatchObject({
      score: undefined,
      detail: "no parses logged",
    });
  });

  it("has no score at all when nothing has been logged", () => {
    const priority = computeLootPriority(character("Unknown"), undefined, 0, 0);
    // Loot owed is the one factor that always has data, so it alone decides.
    expect(priority.score).toBe(100);
    expect(priority.factors.filter((f) => f.score !== undefined).map((f) => f.key)).toEqual([
      "lootDebt",
    ]);
  });

  it("measures loot owed against the best-fed contender", () => {
    const metrics = perfect;
    // Two of four items taken → half the debt score of someone on zero.
    expect(computeLootPriority(character("Fed"), metrics, 2, 4).factors[1]).toMatchObject({
      key: "lootDebt",
      score: 50,
      detail: "2 on-spec items this phase",
    });
    // Nobody has taken anything: the factor stops discriminating.
    expect(computeLootPriority(character("Even"), metrics, 0, 0).factors[1].score).toBe(100);
  });

  it("puts a main ahead of an alt on identical metrics", () => {
    const main = computeLootPriority(character("Main"), perfect, 0, 0);
    const alt = computeLootPriority(character("Alt", "alt"), perfect, 0, 0);
    expect(alt.score).toBeLessThan(main.score!);
    expect(alt.adjustments.find((a) => a.key === "standing")?.note).toMatch(/behind mains/);
    // A plain main carries no adjustment at all — nothing to explain away.
    expect(main.adjustments).toEqual([]);
  });
});

describe("slotServedAdjustment", () => {
  it("does not penalise a slot that hasn't been filled", () => {
    expect(slotServedAdjustment(0, 1)).toBeUndefined();
  });

  it("marks down a raider who already won something for this slot", () => {
    const one = slotServedAdjustment(1, 1)!;
    expect(one.multiplier).toBe(0.6);
    expect(one.note).toMatch(/already won 1 item for this slot/);
    // Piling up in one slot bites harder, then floors.
    expect(slotServedAdjustment(2, 1)!.multiplier).toBe(0.35);
    expect(slotServedAdjustment(5, 1)!.multiplier).toBe(0.35);
  });

  it("scales rings and trinkets by how full the pair is, not by raw count", () => {
    // One ring fills half of two ring slots, so it costs half the drop...
    expect(slotServedAdjustment(1, 2)!.multiplier).toBe(0.8);
    // ...and a second ring fills the pair, landing exactly where one belt does.
    expect(slotServedAdjustment(2, 2)!.multiplier).toBe(slotServedAdjustment(1, 1)!.multiplier);
    expect(slotServedAdjustment(1, 2)!.note).toMatch(/which holds 2/);
  });

  it("drops a served contender below a bare-slot one without disqualifying them", () => {
    const bare = computeLootPriority(character("Bare"), perfect, 0, 0).score!;
    const served = computeLootPriority(
      character("Served"),
      perfect,
      0,
      0,
      slotServedAdjustment(1, 1),
    ).score!;
    expect(served).toBeLessThan(bare);
    // Still rankable: an uncontested drop should still find a home.
    expect(served).toBeGreaterThan(0);
  });
});

describe("rankLootContenders", () => {
  const solid = { attendance: attendance(95), career: career({ medianParse: 80, preparedPct: 95 }) };
  const metrics: Record<string, RaiderMetrics> = {
    "c-regular": solid,
    "c-fed": solid,
    "c-slacker": { attendance: attendance(20), career: career({ medianParse: 30, preparedPct: 10 }) },
  };
  const ranked = rankLootContenders(
    [
      wisher("Slacker"),
      wisher("Fed", { awards: 4 }),
      wisher("Regular"),
      wisher("Done", { satisfied: true }),
    ],
    (id) => metrics[id],
  );

  it("ranks the open contenders best-first and numbers them", () => {
    expect(ranked.slice(0, 3).map((w) => [w.character.name, w.rank])).toEqual([
      ["Regular", 1],
      ["Fed", 2],
      ["Slacker", 3],
    ]);
  });

  it("ranks satisfied contenders out of the contest entirely", () => {
    const done = ranked.find((w) => w.character.name === "Done")!;
    expect(done.rank).toBeUndefined();
    expect(done.priority).toBeUndefined();
    // ...and keeps them at the end of the list.
    expect(ranked.at(-1)!.character.name).toBe("Done");
  });

  it("carries the whole rollup behind each score, for the detail drawer", () => {
    // Not just the scored numbers: the drawer argues with bracket percentile,
    // recent form and missing enchants too.
    expect(ranked[0].metrics?.career?.medianParse).toBe(80);
    expect(ranked[0].metrics?.attendance?.raidPct).toBe(95);
  });

  it("ranks a raider who already won this slot below one who hasn't", () => {
    // Identical metrics and identical loot counts — the only difference is
    // that Belted's item went in the slot now being contested.
    const slotAware = rankLootContenders(
      [wisher("Belted", { awards: 1, sameSlot: 1 }), wisher("Bare", { awards: 1 })],
      () => perfect,
    );
    expect(slotAware.map((w) => w.character.name)).toEqual(["Bare", "Belted"]);
    expect(slotAware[1].priority?.adjustments.map((a) => a.key)).toEqual(["slotServed"]);
    expect(slotAware[0].priority?.adjustments).toEqual([]);
  });

  it("marks a ring contender down more gently than a belt contender", () => {
    const rings = rankLootContenders(
      [wisher("OneRing", { awards: 1, sameSlot: 1 }), wisher("Bare", { awards: 1 })],
      () => perfect,
      { familySize: 2 }, // rings come in pairs
    );
    expect(rings.map((w) => w.character.name)).toEqual(["Bare", "OneRing"]);
    expect(rings[1].priority?.adjustments[0].multiplier).toBe(0.8);
  });

  it("lets the council's sheet outrank the metrics", () => {
    // Slacker is on the top rung of the chain, Regular is a rung below with a
    // far better record. The sheet decides who's eligible; the score only ever
    // breaks ties inside a rung.
    const tiered = rankLootContenders(
      [
        { ...wisher("Regular"), priorityTier: 1, priorityTierLabel: "MS" },
        { ...wisher("Slacker"), priorityTier: 0, priorityTierLabel: "Hunter" },
      ],
      (id) => (id === "c-regular" ? perfect : { attendance: attendance(10) }),
    );
    expect(tiered.map((w) => w.character.name)).toEqual(["Slacker", "Regular"]);
    expect(tiered[0].priority!.score).toBeLessThan(tiered[1].priority!.score!);
  });

  it("sorts contenders the chain never names below every named rung", () => {
    const tiered = rankLootContenders(
      [{ ...wisher("Unnamed") }, { ...wisher("Named"), priorityTier: 3, priorityTierLabel: "OS" }],
      () => perfect,
    );
    expect(tiered.map((w) => w.character.name)).toEqual(["Named", "Unnamed"]);
  });

  it("breaks ties toward whoever has taken less, then by name", () => {
    const tied = rankLootContenders(
      [wisher("Bravo", { awards: 1 }), wisher("Alpha", { awards: 1 }), wisher("Charlie")],
      () => perfect,
    );
    expect(tied.map((w) => w.character.name)).toEqual(["Charlie", "Alpha", "Bravo"]);
  });
});
