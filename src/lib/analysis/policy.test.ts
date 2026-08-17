import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, resolvePolicy } from "@/lib/analysis/policy";

describe("resolvePolicy", () => {
  it("is the defaults when nothing is stored", () => {
    expect(resolvePolicy()).toEqual(DEFAULT_POLICY);
    expect(resolvePolicy({})).toEqual(DEFAULT_POLICY);
  });

  it("merges one level deep, leaving siblings alone", () => {
    const policy = resolvePolicy({ standing: { alt: 0.9 } });
    expect(policy.standing.alt).toBe(0.9);
    expect(policy.standing.main).toBe(DEFAULT_POLICY.standing.main);
    expect(policy.standing.pug).toBe(DEFAULT_POLICY.standing.pug);
    // A group nobody touched is untouched.
    expect(policy.weights).toEqual(DEFAULT_POLICY.weights);
  });

  it("never mutates the defaults", () => {
    resolvePolicy({ weights: { attendance: 99 }, slotServed: { drop: 0.9 } });
    expect(DEFAULT_POLICY.weights.attendance).toBe(35);
    expect(DEFAULT_POLICY.slotServed.drop).toBe(0.4);
  });

  it("keeps the defaults that reproduce the previous hard-coded behaviour", () => {
    // These are the constants this record replaced. If one changes, it should
    // be because the council decided so — not because a default drifted.
    expect(DEFAULT_POLICY).toEqual({
      weights: { attendance: 35, lootDebt: 30, performance: 20, preparation: 15 },
      // A trial multiplies by 1 because the app has no view on trial loot, not
      // because trials rank like mains — see the field's own comment.
      standing: { main: 1, trial: 1, alt: 0.7, inactive: 0.4, pug: 0.25 },
      slotServed: { drop: 0.4, floor: 0.35, fillerDrop: 0.4, offListDrop: 0 },
      attendance: { recentRaids: 10, weeks: 8, basis: "raid" },
      performance: { parseMetric: "all" },
      loot: { altsContend: false },
      // No content is excused until the council names some — see policy.ts.
      preparation: { coverage: "any", excusedEncounters: [] },
      // Equal because the app has no opinion — the council sets these.
      roster: { weights: { attendance: 34, performance: 33, preparation: 33 }, minRaids: 3 },
      improvementSeverity: { high: 100, medium: 40, low: 12 },
    });
  });
});
