import { describe, expect, it } from "vitest";
import { summarizePetSpend, type PetSpendInput } from "@/lib/analysis/pet-consumables";
import type { WclPlayerOffPull } from "@/lib/types";

/** Minimal off-pull record; overrides win. */
function offPull(over: Partial<WclPlayerOffPull> & { actorName: string }): WclPlayerOffPull {
  return {
    id: `RAID001:${over.actorName.toLowerCase()}`,
    reportCode: "RAID001",
    characterId: null,
    potions: [],
    otherCasts: [],
    drums: 0,
    runes: 0,
    healthstones: 0,
    sappers: 0,
    petConsumables: [],
    petBuffsSeen: [], trashDispels: [],
    ...over,
  };
}

const HUNTERS: PetSpendInput["actors"] = new Map([
  ["houndmaster", { name: "Houndmaster", slug: "houndmaster", className: "Hunter", role: "dps" as const }],
  ["kennel", { name: "Kennel", className: "Hunter", role: "dps" as const }],
]);

/** A three-hour night against one-hour windows: three of anything kept up. */
function summarize(offPulls: WclPlayerOffPull[], spanHours = 3) {
  return summarizePetSpend({
    offPull: offPulls,
    spanHours,
    windowHours: { food: 1, scroll: 1 },
    actors: HUNTERS,
  });
}

describe("the logged count is a floor, not the answer", () => {
  it("reports what the cast stream saw and what keeping it up would take", () => {
    const view = summarize([
      offPull({
        actorName: "Houndmaster",
        petConsumables: [{ name: "Kibler's Bits" }, { name: "Kibler's Bits" }],
      }),
    ]);
    const line = view.rows[0].lines.find((l) => l.name === "Kibler's Bits")!;
    expect(line.logged).toBe(2);
    expect(line.maintained).toBe(3);
  });

  it("never reads the model below what somebody was logged doing", () => {
    // Six feeds on a three-hour night is the hunter telling us about their
    // night, not evidence that the window is wrong.
    const view = summarize([
      offPull({
        actorName: "Houndmaster",
        petConsumables: Array.from({ length: 6 }, () => ({ name: "Kibler's Bits" })),
      }),
    ]);
    expect(view.rows[0].lines[0]).toMatchObject({ logged: 6, maintained: 6 });
  });

  it("reads each kind against its own window", () => {
    const view = summarizePetSpend({
      offPull: [
        offPull({
          actorName: "Houndmaster",
          petConsumables: [{ name: "Kibler's Bits" }, { name: "Scroll of Agility V" }],
        }),
      ],
      spanHours: 4,
      windowHours: { food: 2, scroll: 1 },
      actors: HUNTERS,
    });
    const by = new Map(view.rows[0].lines.map((l) => [l.name, l]));
    expect(by.get("Kibler's Bits")!.maintained).toBe(2);
    expect(by.get("Scroll of Agility V")!.maintained).toBe(4);
  });

  it("falls back to one application when the report has no usable clock", () => {
    // A span of zero is what unparseable timestamps read as. Inventing a
    // re-buy count out of a missing number is worse than reporting the floor.
    const view = summarize(
      [offPull({ actorName: "Houndmaster", petConsumables: [{ name: "Kibler's Bits" }] })],
      0,
    );
    expect(view.rows[0].lines[0].maintained).toBe(1);
  });
});

describe("a sighting is evidence, never a count", () => {
  it("opens a line for a consumable no cast ever explained", () => {
    // The scroll gold that is invisible today: the pet held it, and nothing
    // in the cast stream has ever been charged for it.
    const view = summarize([
      offPull({
        actorName: "Houndmaster",
        petBuffsSeen: [{ name: "Scroll of Strength V", atMs: 10 }],
      }),
    ]);
    const line = view.rows[0].lines[0];
    expect(line).toMatchObject({ name: "Scroll of Strength V", logged: 0, seen: true });
    expect(line.maintained).toBe(3);
  });

  it("does not add itself to the cast that raised it", () => {
    // One scroll read during a pull produces a cast AND an aura. Counting both
    // would charge a hunter twice for the same scroll.
    const view = summarize([
      offPull({
        actorName: "Houndmaster",
        petConsumables: [{ name: "Scroll of Agility V" }],
        petBuffsSeen: [{ name: "Scroll of Agility V", atMs: 10 }],
      }),
    ]);
    expect(view.rows[0].lines).toHaveLength(1);
    expect(view.rows[0].lines[0]).toMatchObject({ logged: 1, seen: true });
  });
});

describe("whose night it is", () => {
  it("drops an off-pull record belonging to nobody with a pull", () => {
    // Same fold rule as the gold totals: a stranger who appears only in an
    // off-pull record has no row anywhere else on this page either.
    const view = summarize([
      offPull({ actorName: "Passerby", petConsumables: [{ name: "Kibler's Bits" }] }),
    ]);
    expect(view.rows).toEqual([]);
    expect(view.maintainedUses).toBe(0);
  });

  it("leaves out a raider who put nothing on a pet", () => {
    const view = summarize([offPull({ actorName: "Kennel", potions: ["Haste Potion"] })]);
    expect(view.rows).toEqual([]);
  });

  it("carries the roster link and class through, and ranks the widest gap first", () => {
    const view = summarize([
      offPull({ actorName: "Kennel", petConsumables: [{ name: "Kibler's Bits" }] }),
      offPull({
        actorName: "Houndmaster",
        petConsumables: [{ name: "Kibler's Bits" }, { name: "Scroll of Agility V" }],
      }),
    ]);
    expect(view.rows.map((r) => r.name)).toEqual(["Houndmaster", "Kennel"]);
    expect(view.rows[0]).toMatchObject({ slug: "houndmaster", className: "Hunter" });
    expect(view.rows[1].slug).toBeUndefined();
    expect(view.loggedUses).toBe(3);
    expect(view.maintainedUses).toBe(9);
  });
});
