import { describe, expect, it } from "vitest";
import { coveredMs, mergeTargets, msAtStack, unionIntervals } from "@/lib/analysis/debuff-merge";
import type { UpkeepFightProvider, WclUpkeepTarget } from "@/lib/types";

const PULL_MS = 100_000;

/** One warrior's Sunder on the boss, as the raid view holds it. */
function sunder(
  name: string,
  segments: [number, number][],
  extra: Partial<Pick<WclUpkeepTarget, "applications" | "stackUps" | "refreshes" | "stackPoints">> = {},
): UpkeepFightProvider {
  const covered = segments.reduce((s, [a, b]) => s + (b - a), 0);
  const pct = Math.round((covered / PULL_MS) * 100);
  return {
    name,
    pct,
    targets: [{ target: "Lady Vashj", boss: true, pct, segments, ...extra }],
  };
}

describe("unionIntervals", () => {
  it("merges overlaps instead of adding them up", () => {
    expect(unionIntervals([[0, 50], [25, 75]])).toEqual([[0, 75]]);
  });

  it("treats touching windows as continuous", () => {
    // A refresh landing exactly as the previous window closes never let the
    // debuff drop, so this is one interval, not two.
    expect(unionIntervals([[0, 50], [50, 90]])).toEqual([[0, 90]]);
  });

  it("keeps a real gap", () => {
    expect(unionIntervals([[0, 40], [60, 90]])).toEqual([[0, 40], [60, 90]]);
  });

  it("drops empty and reversed windows rather than counting them", () => {
    expect(unionIntervals([[10, 10], [30, 20]])).toEqual([]);
  });

  it("does not mutate its input", () => {
    const input: [number, number][] = [[0, 50], [25, 75]];
    unionIntervals(input);
    expect(input).toEqual([[0, 50], [25, 75]]);
  });
});

describe("coveredMs", () => {
  it("counts shared time once", () => {
    expect(coveredMs([[0, 30_000], [10_000, 40_000]])).toBe(40_000);
  });
});

describe("msAtStack", () => {
  it("holds a stack until something changes it", () => {
    // Up to 5 at 10s, still 5 when the pull ends at 100s.
    expect(msAtStack([[2_000, 2], [10_000, 5]], PULL_MS)).toEqual({ maxStack: 5, msAtMax: 90_000 });
  });

  it("stops counting when the stack drops", () => {
    expect(msAtStack([[10_000, 5], [40_000, 1]], PULL_MS)).toEqual({ maxStack: 5, msAtMax: 30_000 });
  });

  it("counts a max reached twice", () => {
    // 10s→20s plus 30s→40s.
    expect(msAtStack([[10_000, 5], [20_000, 2], [30_000, 5], [40_000, 1]], PULL_MS)).toEqual({
      maxStack: 5,
      msAtMax: 20_000,
    });
  });

  it("treats a second source re-applying the max as no change", () => {
    // Two warriors both pushing to 5 must not end the window between them.
    expect(msAtStack([[10_000, 5], [15_000, 5], [40_000, 1]], PULL_MS)).toEqual({
      maxStack: 5,
      msAtMax: 30_000,
    });
  });

  it("says nothing when no stacks were recorded", () => {
    expect(msAtStack([], PULL_MS)).toBeUndefined();
  });
});

describe("mergeTargets", () => {
  it("answers the question the per-source rows cannot", () => {
    // Two warriors covering different parts of the pull: the raid had Sunder up
    // for 70s of 100s, which neither row says on its own.
    const merged = mergeTargets([sunder("Byrd", [[0, 40_000]]), sunder("Scomb", [[30_000, 70_000]])], PULL_MS);
    expect(merged).toHaveLength(1);
    expect(merged[0].pct).toBe(70);
    expect(merged[0].intervals).toEqual([[0, 70_000]]);
    expect(merged[0].contributors.map((c) => c.source)).toEqual(["Byrd", "Scomb"]);
  });

  it("never sums overlapping cover into more than the pull", () => {
    const merged = mergeTargets([sunder("Byrd", [[0, 100_000]]), sunder("Scomb", [[0, 100_000]])], PULL_MS);
    expect(merged[0].pct).toBe(100);
  });

  it("adds up the landed casts while merging the time", () => {
    const merged = mergeTargets(
      [
        sunder("Byrd", [[0, 40_000]], { applications: 6 }),
        sunder("Scomb", [[30_000, 70_000]], { applications: 9 }),
      ],
      PULL_MS,
    );
    // Casts are per person and do add; time is shared and does not.
    expect(merged[0].applications).toBe(15);
    expect(merged[0].pct).toBe(70);
  });

  it("reconstructs the target's stack timeline from every source's points", () => {
    const merged = mergeTargets(
      [
        sunder("Byrd", [[0, 50_000]], {
          applications: 4,
          stackUps: 3,
          refreshes: 1,
          stackPoints: [[1_000, 2], [2_000, 3], [3_000, 4]],
        }),
        sunder("Scomb", [[40_000, 90_000]], {
          applications: 6,
          stackUps: 1,
          refreshes: 5,
          stackPoints: [[10_000, 5]],
        }),
      ],
      PULL_MS,
    );
    expect(merged[0].maxStack).toBe(5);
    // Reached 5 at 10s and nothing lowered it: 90s of a 100s pull.
    expect(merged[0].msAtMaxStack).toBe(90_000);
    expect(merged[0].pctAtMaxStack).toBe(90);
    // The two halves of the landed casts, summed across both warriors.
    expect(merged[0].stackUps).toBe(4);
    expect(merged[0].refreshes).toBe(6);
  });

  it("says nothing about stacks on rows imported before they were kept", () => {
    // "Not recorded" and "never stacked" are different claims.
    const merged = mergeTargets([sunder("Byrd", [[0, 40_000]], { applications: 6 })], PULL_MS);
    expect(merged[0].maxStack).toBeUndefined();
    expect(merged[0].pctAtMaxStack).toBeUndefined();
    expect(merged[0].stackUps).toBeUndefined();
    expect(merged[0].applications).toBe(6);
  });

  it("keeps separate mobs separate and puts the boss first", () => {
    const provider: UpkeepFightProvider = {
      name: "Byrd",
      pct: 90,
      targets: [
        { target: "Enchanted Elemental", instance: 24, boss: false, pct: 90, segments: [[0, 90_000]] },
        { target: "Lady Vashj", boss: true, pct: 10, segments: [[0, 10_000]] },
      ],
    };
    expect(mergeTargets([provider], PULL_MS).map((m) => m.target)).toEqual([
      "Lady Vashj",
      "Enchanted Elemental",
    ]);
  });

  it("keeps one mob's two actor ids together", () => {
    // The split-id case: same name and instance under different ids arrives as
    // two target entries, and they are one mob.
    const provider: UpkeepFightProvider = {
      name: "Byrd",
      pct: 20,
      targets: [
        { target: "Enchanted Elemental", instance: 24, boss: false, pct: 10, segments: [[0, 10_000]] },
        { target: "Enchanted Elemental", instance: 24, boss: false, pct: 10, segments: [[10_000, 20_000]] },
      ],
    };
    const merged = mergeTargets([provider], PULL_MS);
    expect(merged).toHaveLength(1);
    expect(merged[0].intervals).toEqual([[0, 20_000]]);
  });

  it("leaves friendly-target buffs alone", () => {
    // Earth Shield on a player is per recipient, never shared — merging it would
    // claim a raid-wide fact about one person's buff.
    const provider: UpkeepFightProvider = {
      name: "Lunara",
      pct: 40,
      targets: [{ target: "Thrainn", boss: false, player: true, pct: 40, segments: [[0, 40_000]] }],
    };
    expect(mergeTargets([provider], PULL_MS)).toEqual([]);
  });

  it("returns nothing when no provider recorded a target", () => {
    // Pre-timeline imports have percentages but no per-victim breakdown.
    expect(mergeTargets([{ name: "Byrd" }], PULL_MS)).toEqual([]);
  });
});
