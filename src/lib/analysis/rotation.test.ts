import { describe, expect, it } from "vitest";
import { activity, compareRotations, perMinute, profileFromCasts } from "@/lib/analysis/rotation";

const FURY = [21, 40, 0];

function casts(pairs: [number, string][]) {
  return pairs.map(([tMs, name]) => ({ tMs, name }));
}

describe("profileFromCasts", () => {
  it("tallies abilities commonest first and keeps the timeline in order", () => {
    const p = profileFromCasts({
      label: "Katzewarr · Void Reaver",
      durationMs: 60_000,
      talents: FURY,
      casts: casts([
        [3000, "Whirlwind"],
        [1000, "Bloodthirst"],
        [2000, "Bloodthirst"],
      ]),
    });
    expect(p.abilities).toEqual([
      { name: "Bloodthirst", casts: 2 },
      { name: "Whirlwind", casts: 1 },
    ]);
    expect(p.timeline!.map((c) => c.tMs)).toEqual([1000, 2000, 3000]);
    expect(p.build.label).toBe("21/40/0");
  });

  it("carries an unknown build rather than inventing one", () => {
    const p = profileFromCasts({ label: "x", durationMs: 1000, casts: [] });
    expect(p.build.key).toBeUndefined();
  });

  it("does not mutate the caller's cast array", () => {
    const source = casts([[3000, "b"], [1000, "a"]]);
    profileFromCasts({ label: "x", durationMs: 1000, casts: source });
    expect(source[0].tMs).toBe(3000);
  });
});

describe("activity", () => {
  it("calls an uninterrupted pull fully active", () => {
    const a = activity(casts([[0, "a"], [1500, "b"], [3000, "c"]]), 3000);
    expect(a.activePct).toBe(100);
    expect(a.idleMs).toBe(0);
  });

  it("counts a long gap as downtime and locates it", () => {
    // 30s of nothing in a 60s fight — a phase, a knockback, or standing in fire.
    const a = activity(casts([[0, "a"], [30_000, "b"], [31_500, "c"]]), 60_000);
    expect(a.idleMs).toBeGreaterThanOrEqual(30_000);
    expect(a.activePct).toBeLessThan(55);
    expect(a.gaps[0]).toMatchObject({ fromMs: 0, toMs: 30_000 });
  });

  it("does not punish normal global-cooldown spacing", () => {
    const a = activity(
      casts(Array.from({ length: 40 }, (_, i) => [i * 1500, "x"] as [number, string])),
      60_000,
    );
    expect(a.activePct).toBe(100);
  });

  it("counts a late opener as lost time", () => {
    // Eight seconds before the first cast is real downtime, not missing data.
    const a = activity(casts([[8000, "a"], [9500, "b"]]), 20_000);
    expect(a.gaps.some((g) => g.fromMs === 0 && g.toMs === 8000)).toBe(true);
  });

  it("counts trailing silence after the last cast", () => {
    const a = activity(casts([[0, "a"]]), 20_000);
    expect(a.idleMs).toBe(20_000);
    expect(a.activePct).toBe(0);
  });

  it("treats a pull with no casts as fully idle", () => {
    expect(activity([], 10_000)).toMatchObject({ idleMs: 10_000, activePct: 0 });
  });

  it("returns zeroes for a zero-length fight rather than dividing by zero", () => {
    expect(activity([], 0)).toMatchObject({ activePct: 0, idleMs: 0 });
  });

  it("orders gaps longest first — the biggest one is the story", () => {
    const a = activity(casts([[0, "a"], [5000, "b"], [25_000, "c"]]), 25_000);
    expect(a.gaps[0].ms).toBeGreaterThan(a.gaps[1].ms);
  });
});

describe("perMinute", () => {
  it("normalises to a rate", () => {
    expect(perMinute(20, 120_000)).toBe(10);
  });

  it("returns zero for a zero-length fight instead of dividing by zero", () => {
    expect(perMinute(5, 0)).toBe(0);
  });
});

describe("compareRotations", () => {
  // The real question from the guild's data: same player, same build, same
  // boss, 134s vs 156s. Raw counts would be misleading; rates are not.
  const good = profileFromCasts({
    label: "Katzewarr 96%",
    durationMs: 134_000,
    talents: FURY,
    casts: casts([
      [0, "Bloodthirst"], [1500, "Whirlwind"], [3000, "Heroic Strike"], [4500, "Bloodthirst"],
      [6000, "Bloodthirst"], [7500, "Bloodthirst"], [9000, "Bloodthirst"],
    ]),
  });
  const bad = profileFromCasts({
    label: "Katzewarr 34%",
    durationMs: 156_000,
    talents: FURY,
    casts: casts([
      [0, "Bloodthirst"], [1500, "Whirlwind"], [3000, "Slam"], [4500, "Heroic Strike"],
      [6000, "Heroic Strike"], [7500, "Heroic Strike"],
    ]),
  });

  const cmp = compareRotations(good, bad);

  it("ranks the abilities that actually separate the two runs first", () => {
    // Bloodthirst is the biggest swing (−1.8/min) and Heroic Strike second
    // (+0.8) — "you stopped pressing your main ability" outranks "you pressed
    // filler more", which is the right order to read them in.
    expect(cmp.abilities.map((x) => x.name).slice(0, 2)).toEqual(["Bloodthirst", "Heroic Strike"]);
    expect(cmp.abilities[0].perMinDelta).toBeLessThan(0);
    expect(cmp.abilities[1].perMinDelta).toBeGreaterThan(0);
  });

  it("normalises by fight length rather than comparing raw counts", () => {
    const bt = cmp.abilities.find((x) => x.name === "Bloodthirst")!;
    expect(bt.aCasts).toBe(5);
    expect(bt.bCasts).toBe(1);
    // 5 casts in 134s ≈ 2.2/min; 1 in 156s ≈ 0.4/min.
    expect(bt.aPerMin).toBeCloseTo(2.2, 1);
    expect(bt.bPerMin).toBeCloseTo(0.4, 1);
    expect(bt.perMinDelta).toBeLessThan(0);
  });

  it("includes an ability only one side used", () => {
    const slam = cmp.abilities.find((x) => x.name === "Slam")!;
    expect(slam.aCasts).toBe(0);
    expect(slam.bCasts).toBe(1);
  });

  it("reports cast share so rage spent in the wrong place is visible", () => {
    const hs = cmp.abilities.find((x) => x.name === "Heroic Strike")!;
    expect(hs.aShare).toBeCloseTo(14.3, 1); // 1 of 7
    expect(hs.bShare).toBeCloseTo(50, 1); // 3 of 6
  });

  it("lines the opener up cast for cast and finds the first divergence", () => {
    expect(cmp.opener[0]).toMatchObject({ match: true });
    expect(cmp.opener[1]).toMatchObject({ match: true });
    expect(cmp.opener[2].match).toBe(false); // Heroic Strike vs Slam
    expect(cmp.openerMatchedSteps).toBe(2);
  });

  it("handles one side being shorter than the other", () => {
    const short = profileFromCasts({ label: "s", durationMs: 10_000, casts: casts([[0, "Bloodthirst"]]) });
    const c = compareRotations(good, short);
    expect(c.opener[1].b).toBeUndefined();
    expect(c.opener[1].match).toBe(false);
    expect(c.openerMatchedSteps).toBe(1);
  });

  it("survives two empty profiles without dividing by zero", () => {
    const empty = profileFromCasts({ label: "e", durationMs: 0, casts: [] });
    const c = compareRotations(empty, empty);
    expect(c.abilities).toEqual([]);
    expect(c.opener).toEqual([]);
    expect(c.openerMatchedSteps).toBe(0);
  });
});
