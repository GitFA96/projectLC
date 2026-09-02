import { describe, expect, it } from "vitest";
import { explosiveThrows, professionGap } from "@/lib/analysis/professions";

const threw = (...otherCasts: string[]) => ({ otherCasts });

describe("explosiveThrows", () => {
  it("counts pulls and the off-pull record together", () => {
    expect(
      explosiveThrows(
        [threw("Super Sapper Charge", "Super Sapper Charge"), threw("Goblin Sapper Charge")],
        [threw("Arcane Bomb", "Arcane Bomb", "Goblin Sapper Charge")],
      ),
    ).toBe(6);
  });

  it("counts an Arcane Bomb exactly as it counts a sapper", () => {
    // Item 16040 carries `Requires Engineering (300)` on its own tooltip, the
    // same line the charges carry. Nothing weaker gets on that list.
    expect(explosiveThrows([threw("Arcane Bomb")])).toBe(1);
  });

  it("ignores everything that takes no profession to use", () => {
    // The load-bearing negative on the other side: `otherCasts` is every
    // non-potion consumable a raider used, and counting the wrong one here
    // would accuse a raider of a profession off a healthstone.
    expect(
      explosiveThrows([threw("Dark Rune", "Drums of Battle", "Healthstone", "Thistle Tea")]),
    ).toBe(0);
  });

  it("is zero for a raider who never set one off", () => {
    expect(explosiveThrows([threw(), threw()])).toBe(0);
    expect(explosiveThrows([])).toBe(0);
  });

  it("counts a night that was only trash — the off-pull record alone", () => {
    // The reason off-pull rows exist at all: a sapper thrown clearing to Vashj
    // is the same proof as one thrown on her.
    expect(explosiveThrows([], [threw("Goblin Sapper Charge")])).toBe(1);
  });

  it("counts an uncurated rank that still names itself a sapper charge", () => {
    // Same fallback `classifyCast` uses. A rank id this codebase hasn't curated
    // is still an engineering explosive, and dropping it would lose real proof.
    expect(explosiveThrows([threw("Goblin Sapper Charge (Rank 2)")])).toBe(1);
  });
});

describe("professionGap", () => {
  it("names Engineering when a throw is logged and nothing is recorded", () => {
    expect(professionGap([], { explosives: 4 })).toEqual({
      profession: "Engineering",
      explosives: 4,
    });
  });

  it("stays silent once Engineering is recorded", () => {
    expect(professionGap(["Engineering"], { explosives: 4 })).toBeUndefined();
    expect(professionGap(["Tailoring", "Engineering"], { explosives: 1 })).toBeUndefined();
  });

  it("treats one throw as proof — there is no threshold", () => {
    expect(professionGap([], { explosives: 1 })).toEqual({
      profession: "Engineering",
      explosives: 1,
    });
  });

  it("says nothing about a raider with other professions and no throws", () => {
    // The load-bearing negative: absence of an explosive is not absence of
    // engineering, so a recorded alchemist must not be flagged as one.
    expect(professionGap(["Alchemy", "Herbalism"], { explosives: 0 })).toBeUndefined();
  });

  it("never contradicts a recorded engineer who has thrown nothing", () => {
    expect(professionGap(["Engineering"], { explosives: 0 })).toBeUndefined();
  });
});
