import { describe, expect, it } from "vitest";
import {
  LOOT_PRIORITY_WEIGHTS,
  computeLootPriority,
  rankLootContenders,
  slotServedAdjustment,
} from "@/lib/analysis/loot-priority";
import { DEFAULT_POLICY, type GuildPolicy } from "@/lib/analysis/policy";
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
    professions: [],
    membershipId: null,
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
    allWeeks: [],
    allWeeksAttended: 0,
    allWeeksTracked: 0,
    scoreBasis: "raid",
    scorePct: pct,
    scoreAttended: Math.round((pct / 100) * tracked),
    scoreTracked: tracked,
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
    listRank: 0,
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
    expect(slotServedAdjustment({ bis: 0, filler: 0, offList: 0, unknown: 0 }, 1)).toBeUndefined();
  });

  it("marks down a raider who already won something for this slot", () => {
    const one = slotServedAdjustment({ bis: 1, filler: 0, offList: 0, unknown: 0 }, 1)!;
    expect(one.multiplier).toBe(0.6);
    expect(one.note).toMatch(/already won 1 item for this slot/);
    // Piling up in one slot bites harder, then floors.
    expect(slotServedAdjustment({ bis: 2, filler: 0, offList: 0, unknown: 0 }, 1)!.multiplier).toBe(0.35);
    expect(slotServedAdjustment({ bis: 5, filler: 0, offList: 0, unknown: 0 }, 1)!.multiplier).toBe(0.35);
  });

  it("scales rings and trinkets by how full the pair is, not by raw count", () => {
    // One ring fills half of two ring slots, so it costs half the drop...
    expect(slotServedAdjustment({ bis: 1, filler: 0, offList: 0, unknown: 0 }, 2)!.multiplier).toBe(0.8);
    // ...and a second ring fills the pair, landing exactly where one belt does.
    expect(slotServedAdjustment({ bis: 2, filler: 0, offList: 0, unknown: 0 }, 2)!.multiplier).toBe(slotServedAdjustment({ bis: 1, filler: 0, offList: 0, unknown: 0 }, 1)!.multiplier);
    expect(slotServedAdjustment({ bis: 1, filler: 0, offList: 0, unknown: 0 }, 2)!.note).toMatch(/which holds 2/);
  });

  it("drops a served contender below a bare-slot one without disqualifying them", () => {
    const bare = computeLootPriority(character("Bare"), perfect, 0, 0).score!;
    const served = computeLootPriority(
      character("Served"),
      perfect,
      0,
      0,
      slotServedAdjustment({ bis: 1, filler: 0, offList: 0, unknown: 0 }, 1),
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

describe("slotServedAdjustment — a filler is not the same as being served", () => {
  it("costs the same as a BiS by default, so adopting the split moves nobody", () => {
    expect(slotServedAdjustment({ bis: 0, filler: 1, offList: 0, unknown: 0 }, 1)!.multiplier).toBe(
      slotServedAdjustment({ bis: 1, filler: 0, offList: 0, unknown: 0 }, 1)!.multiplier,
    );
  });

  it("costs less once the council separates them", () => {
    const policy = { drop: 0.4, floor: 0.35, fillerDrop: 0.1, offListDrop: 0 };
    expect(slotServedAdjustment({ bis: 1, filler: 0, offList: 0, unknown: 0 }, 1, policy)!.multiplier).toBe(0.6);
    expect(slotServedAdjustment({ bis: 0, filler: 1, offList: 0, unknown: 0 }, 1, policy)!.multiplier).toBe(0.9);
  });

  it("adds the two costs when a raider took one of each", () => {
    const policy = { drop: 0.4, floor: 0.35, fillerDrop: 0.1, offListDrop: 0 };
    // Two rings: one they asked for, one they settled for.
    expect(slotServedAdjustment({ bis: 1, filler: 1, offList: 0, unknown: 0 }, 2, policy)!.multiplier).toBe(0.75);
  });

  it("says which it was, because the note is what an officer reads out", () => {
    expect(slotServedAdjustment({ bis: 0, filler: 1, offList: 0, unknown: 0 }, 1)!.note).toMatch(/a fallback, not what they asked for/);
    expect(slotServedAdjustment({ bis: 1, filler: 1, offList: 0, unknown: 0 }, 1)!.note).toMatch(/1 of them a fallback/);
    expect(slotServedAdjustment({ bis: 1, filler: 0, offList: 0, unknown: 0 }, 1)!.note).not.toMatch(/fallback/);
  });

  it("still floors, so an uncontested drop can go to somebody", () => {
    expect(slotServedAdjustment({ bis: 0, filler: 5, offList: 0, unknown: 0 }, 1)!.multiplier).toBe(0.35);
  });
});

describe("slotServedAdjustment — a drop they never asked for", () => {
  it("costs nothing, by council decision", () => {
    // Being handed something nobody asked for shouldn't weaken their claim on
    // the item they did ask for.
    expect(slotServedAdjustment({ bis: 0, filler: 0, offList: 2, unknown: 0 }, 1)).toBeUndefined();
  });

  it("doesn't dilute a real penalty", () => {
    const one = slotServedAdjustment({ bis: 1, filler: 0, offList: 0, unknown: 0 }, 1)!;
    const oneWithGifts = slotServedAdjustment({ bis: 1, filler: 0, offList: 3, unknown: 0 }, 1)!;
    expect(oneWithGifts.multiplier).toBe(one.multiplier);
    expect(oneWithGifts.note).toMatch(/3 more they never listed, which doesn't count/);
  });

  it("counts a raider with no list on record in full", () => {
    // "Not on their list" and "we have no list" are different facts, and
    // treating the second as the first hands out a discount for not importing.
    const unknown = slotServedAdjustment({ bis: 0, filler: 0, offList: 0, unknown: 1 }, 1)!;
    expect(unknown.multiplier).toBe(
      slotServedAdjustment({ bis: 1, filler: 0, offList: 0, unknown: 0 }, 1)!.multiplier,
    );
    expect(unknown.note).toMatch(/no wishlist on record, so counted in full/);
  });

  it("still charges when the council prices an off-list drop", () => {
    const policy = { drop: 0.4, floor: 0.35, fillerDrop: 0.4, offListDrop: 0.2 };
    expect(slotServedAdjustment({ bis: 0, filler: 0, offList: 1, unknown: 0 }, 1, policy)!.multiplier)
      .toBe(0.8);
  });
});

describe("attendance basis", () => {
  /*
   * Per-raid and per-week are different claims about the same raider, and they
   * diverge most exactly where it matters: somebody who makes one night of
   * every multi-night week. 4 of 12 raids is 33%; those same nights are 4 of 4
   * reset weeks, or 100%. Attendance carries the largest weight on the sheet,
   * so which one is read decides who wins contested items.
   */
  const partial: AttendanceSummary = {
    ...attendance(33, 12),
    raidsAttended: 4,
    raidsTracked: 12,
    raidPct: 33,
    allWeeks: [],
    allWeeksAttended: 4,
    allWeeksTracked: 4,
  };

  const factorFor = (policy: GuildPolicy, a: AttendanceSummary = partial) =>
    computeLootPriority(
      character("Weekly"),
      { attendance: a } as RaiderMetrics,
      0,
      0,
      undefined,
      policy,
    ).factors.find((f) => f.key === "attendance")!;

  const weekly: GuildPolicy = {
    ...DEFAULT_POLICY,
    attendance: { ...DEFAULT_POLICY.attendance, basis: "week" },
  };

  it("counts raids by default, so adopting the field re-ranks nobody", () => {
    const f = factorFor(DEFAULT_POLICY);
    expect(f.score).toBe(33);
    expect(f.detail).toBe("4 of 12 logged raids");
  });

  it("counts reset weeks when the guild says so", () => {
    const f = factorFor(weekly);
    expect(f.score).toBe(100);
    expect(f.detail).toBe("4 of 4 reset weeks");
  });

  it("says there is nothing to count rather than scoring a zero", () => {
    const f = factorFor(weekly, { ...partial, allWeeksAttended: 0, allWeeksTracked: 0 });
    expect(f.score).toBeUndefined();
    expect(f.detail).toBe("no logged raid weeks yet");
  });
});
