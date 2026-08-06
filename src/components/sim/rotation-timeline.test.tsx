// @vitest-environment node
import { describe, expect, it } from "vitest";
import { lanesOf, ticksOf, type TimelineTrack } from "@/components/sim/rotation-timeline";

const track = (label: string, tone: "log" | "sim", names: string[]): TimelineTrack => ({
  label,
  tone,
  casts: names.map((name, i) => ({ tMs: i * 1000, name })),
});

describe("lanesOf", () => {
  it("puts the busiest ability at the top — that's the rotation's spine", () => {
    const lanes = lanesOf([track("Logged", "log", ["Heroic Strike", "Heroic Strike", "Bloodthirst"])]);
    expect(lanes).toEqual(["Heroic Strike", "Bloodthirst"]);
  });

  it("shares lanes across both sides so the same ability sits on one row", () => {
    // The whole point of the view: Execute has to be on the same line in both
    // tracks, or you can't see that one side pressed it and the other didn't.
    const lanes = lanesOf([
      track("Logged", "log", ["Bloodthirst"]),
      track("Sim", "sim", ["Execute", "Execute"]),
    ]);
    expect(lanes).toEqual(["Execute", "Bloodthirst"]);
  });

  it("keeps an ability only one side used", () => {
    const lanes = lanesOf([track("Logged", "log", ["Whirlwind"]), track("Sim", "sim", ["Overpower"])]);
    expect(lanes).toContain("Overpower");
    expect(lanes).toContain("Whirlwind");
  });

  it("breaks a tie alphabetically rather than by whichever track came first", () => {
    const lanes = lanesOf([track("Logged", "log", ["Zeal", "Anger"])]);
    expect(lanes).toEqual(["Anger", "Zeal"]);
  });

  it("returns nothing for a pull with no casts", () => {
    expect(lanesOf([track("Logged", "log", [])])).toEqual([]);
  });
});

describe("ticksOf", () => {
  it("covers the whole fight at the chosen segment", () => {
    // The point of the rework: you always get the end of the pull, whatever
    // segment you picked. An earlier cut windowed it, so "did he Execute at
    // the end" depended on where you happened to be scrolled.
    const ticks = ticksOf(0, 137_000, 10_000);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(137_000);
  });

  it("starts before zero when the sim opened pre-pull", () => {
    // wowsims casts Bloodrage and Battle Shout before the pull; those marks
    // have negative timestamps and must not fall off the left edge.
    const ticks = ticksOf(-4500, 60_000, 5000);
    expect(ticks[0]).toBeLessThanOrEqual(-4500);
  });

  it("gives one gridline per second at the finest segment", () => {
    expect(ticksOf(0, 10_000, 1000)).toHaveLength(12);
  });

  it("gives far fewer at the coarsest", () => {
    expect(ticksOf(0, 120_000, 30_000).length).toBeLessThan(7);
  });
});
