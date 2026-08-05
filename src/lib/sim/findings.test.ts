import { describe, expect, it } from "vitest";
import { findings, findingsHeadline, type FindingsInput } from "@/lib/sim/findings";
import type { AbilityDelta } from "@/lib/analysis/rotation";
import type { ContextRow } from "@/lib/sim/context";

function ability(over: Partial<AbilityDelta> & { name: string }): AbilityDelta {
  return {
    aCasts: 10,
    bCasts: 10,
    aPerMin: 5,
    bPerMin: 5,
    perMinDelta: 0,
    aShare: 10,
    bShare: 10,
    aDamageShare: 10,
    bDamageShare: 10,
    ...over,
  };
}

function contextRow(over: Partial<ContextRow> & { name: string }): ContextRow {
  return {
    category: "raid buff",
    sim: "yes",
    logged: "no",
    verdict: "sim-only",
    favours: "sim",
    ...over,
  };
}

const base: FindingsInput = {
  abilities: [],
  audit: [],
  activity: { durationMs: 137_000, idleMs: 0, activePct: 100, gaps: [] } as never,
  durationMs: 137_000,
  loggedDps: 2049,
  simDps: 2673,
};

describe("findings", () => {
  it("leads with what the sim was handed and the raid didn't have", () => {
    // Telling someone to press more buttons when nobody drummed is worse than
    // saying nothing, so context outranks rotation however big the gap.
    const out = findings({
      ...base,
      audit: [contextRow({ name: "Gift of Arthas", logged: "no — nobody applied it" })],
      abilities: [
        ability({ name: "Bloodthirst", perMinDelta: 1.5, aDamage: 39_540, bDamage: 67_200 }),
      ],
    });
    expect(out[0].kind).toBe("context");
    expect(out[0].text).toContain("Gift of Arthas");
  });

  it("ranks rotation findings by damage, not by cast rate", () => {
    /*
     * The reason the damage column exists. Hamstring is pressed far more often
     * than the sim wants and is worth nothing; Bloodthirst is a smaller rate
     * gap and a much bigger fight.
     */
    const out = findings({
      ...base,
      abilities: [
        ability({ name: "Hamstring", perMinDelta: -2, aDamage: 1497, bDamage: 1800 }),
        ability({ name: "Bloodthirst", perMinDelta: 1.5, aDamage: 39_540, bDamage: 67_200 }),
      ],
    });
    expect(out[0].text).toContain("Bloodthirst");
    expect(out.some((f) => f.text.includes("Hamstring"))).toBe(false);
  });

  it("credits the raider when they beat the model", () => {
    const out = findings({
      ...base,
      abilities: [
        ability({ name: "Heroic Strike", perMinDelta: -6.4, aDamage: 96_000, bDamage: 81_914 }),
      ],
    });
    expect(out[0].good).toBe(true);
    expect(out[0].text).toContain("MORE damage");
  });

  it("calls out an ability that was never used at all", () => {
    // A zero is a different conversation from a shortfall.
    const out = findings({
      ...base,
      abilities: [ability({ name: "Overpower", aCasts: 0, aPerMin: 0, bPerMin: 1.4, perMinDelta: 1.4, bDamage: 8000 })],
    });
    expect(out.some((f) => f.text.includes("Overpower"))).toBe(true);
  });

  it("stays quiet about a rate difference worth no damage", () => {
    const out = findings({
      ...base,
      abilities: [ability({ name: "Battle Shout", perMinDelta: 2 })],
    });
    expect(out).toEqual([]);
  });

  it("reports idle time, which no rotation change recovers", () => {
    const out = findings({
      ...base,
      activity: { durationMs: 137_000, idleMs: 15_000, activePct: 88.8, gaps: [] } as never,
    });
    expect(out[0].kind).toBe("uptime");
    expect(out[0].text).toContain("15s idle");
  });
});

describe("findingsHeadline", () => {
  it("says how much of the gap the findings actually explain", () => {
    const list = findings({
      ...base,
      abilities: [ability({ name: "Bloodthirst", perMinDelta: 1.5, aDamage: 39_540, bDamage: 67_200 })],
    });
    expect(findingsHeadline(base, list)).toMatch(/624 dps behind the sim/);
  });

  it("does not claim to explain a gap when nothing is big enough", () => {
    expect(findingsHeadline(base, [])).toMatch(/look at the fight itself/i);
  });

  it("says plainly when the pull beat the sim", () => {
    const ahead = { ...base, loggedDps: 2800 };
    expect(findingsHeadline(ahead, [])).toMatch(/beat the sim by 127 dps/);
  });

  it("never claims more than the whole gap", () => {
    // Attributions overlap — idle time and a cast shortfall describe some of
    // the same damage — so the share is capped rather than reading as 140%.
    const list = findings({
      ...base,
      abilities: [ability({ name: "Melee", perMinDelta: 10, aDamage: 0, bDamage: 900_000 })],
    });
    expect(findingsHeadline(base, list)).toContain("100%");
  });

  it("says nothing about a gap it has no numbers for", () => {
    expect(findingsHeadline({ ...base, simDps: undefined }, [])).toMatch(/no gap to explain/i);
  });
});
