import { describe, expect, it } from "vitest";
import {
  elixirCoverage,
  hasConsumableCoverage,
  hasFood,
  isPrepared,
  type PreparationRow,
} from "@/lib/analysis/preparation";

const row = (over: Partial<PreparationRow> = {}): PreparationRow => ({
  elixirs: [],
  food: false,
  ...over,
});

/* Labels curated in wcl/consumables.ts — the same strings ingest stores. */
const BATTLE = "Elixir of Major Agility";
const GUARDIAN = "Elixir of Draenic Wisdom";
/* Deliberately not a real item: ingest's name-pattern fallback catches
   anything ending in "Elixir", so a label can reach storage without the
   curated list ever naming a slot for it. */
const UNPLACED = "Elixir of the Uncurated";

describe("elixirCoverage", () => {
  it("grades a flask as a full set — it occupies both slots", () => {
    expect(elixirCoverage(row({ flask: "Flask of Relentless Assault" })).grade).toBe("flask");
  });

  it("grades battle + guardian as full, and says which was which", () => {
    const c = elixirCoverage(row({ elixirs: [BATTLE, GUARDIAN] }));
    expect(c.grade).toBe("full");
    expect(c.battle).toBe(BATTLE);
    expect(c.guardian).toBe(GUARDIAN);
  });

  it("names the empty slot on a half-filled set", () => {
    expect(elixirCoverage(row({ elixirs: [BATTLE] })).missing).toBe("guardianElixir");
    expect(elixirCoverage(row({ elixirs: [GUARDIAN] })).missing).toBe("battleElixir");
  });

  it("grades nothing as none", () => {
    expect(elixirCoverage(row()).grade).toBe("none");
  });

  it("keeps an elixir the curated list doesn't place, rather than assuming a slot", () => {
    const c = elixirCoverage(row({ elixirs: [UNPLACED] }));
    expect(c.grade).toBe("partial");
    expect(c.unclassified).toEqual([UNPLACED]);
    expect(c.battle).toBeUndefined();
    expect(c.guardian).toBeUndefined();
  });

  it("won't name a missing slot an unplaced elixir might be filling", () => {
    // Battle elixir plus something we can't categorise: the second one may well
    // be the guardian half. Saying "no guardian" here would invent a gap.
    const c = elixirCoverage(row({ elixirs: [BATTLE, UNPLACED] }));
    expect(c.grade).toBe("partial");
    expect(c.missing).toBeUndefined();
  });

  it("lets a flask win over a stale elixir on the same pull", () => {
    // Both up at the pull: the flask already covers both slots, so this can't
    // read as half a set.
    expect(elixirCoverage(row({ flask: "Flask of Blinding Light", elixirs: [BATTLE] })).grade)
      .toBe("flask");
  });
});

describe("hasConsumableCoverage", () => {
  it("counts a flask under every standard", () => {
    const flask = row({ flask: "Flask of Relentless Assault" });
    expect(hasConsumableCoverage(flask, { coverage: "any" })).toBe(true);
    expect(hasConsumableCoverage(flask, { coverage: "full" })).toBe(true);
    expect(hasConsumableCoverage(flask, { coverage: "flaskOnly" })).toBe(true);
  });

  it("counts a single elixir by default — this roster runs them", () => {
    expect(hasConsumableCoverage(row({ elixirs: [BATTLE] }))).toBe(true);
  });

  it("stops counting half a set once the council asks for a full one", () => {
    const half = row({ elixirs: [BATTLE] });
    expect(hasConsumableCoverage(half, { coverage: "full" })).toBe(false);
    expect(hasConsumableCoverage(row({ elixirs: [BATTLE, GUARDIAN] }), { coverage: "full" }))
      .toBe(true);
  });

  it("counts two elixirs as coverage even under `full` — they are a full set", () => {
    // The point of the rewrite: for several specs the pair beats the flask, so
    // the strict standard must not mean "flask or nothing".
    expect(hasConsumableCoverage(row({ elixirs: [BATTLE, GUARDIAN] }), { coverage: "full" }))
      .toBe(true);
    expect(hasConsumableCoverage(row({ elixirs: [BATTLE, GUARDIAN] }), { coverage: "flaskOnly" }))
      .toBe(false);
  });

  it("is false with neither", () => {
    expect(hasConsumableCoverage(row())).toBe(false);
  });

  it("ignores food — that is the other half of the answer", () => {
    expect(hasConsumableCoverage(row({ food: true }))).toBe(false);
  });
});

describe("isPrepared", () => {
  it("needs coverage and food together", () => {
    expect(isPrepared(row({ flask: "Flask of Fortification", food: true }))).toBe(true);
    expect(isPrepared(row({ elixirs: [BATTLE], food: true }))).toBe(true);
  });

  it("is false with food alone", () => {
    expect(isPrepared(row({ food: true }))).toBe(false);
  });

  it("is false with coverage alone", () => {
    expect(isPrepared(row({ flask: "Flask of Relentless Assault" }))).toBe(false);
  });

  it("follows the council's coverage standard", () => {
    const half = row({ elixirs: [BATTLE], food: true });
    expect(isPrepared(half, { coverage: "any" })).toBe(true);
    expect(isPrepared(half, { coverage: "full" })).toBe(false);
  });
});

describe("hasFood", () => {
  it("takes the boolean when ingest set it", () => {
    expect(hasFood(row({ food: true }))).toBe(true);
  });

  it("finds a food curated after the report was imported", () => {
    // Ingest reduces a food aura to a boolean and keeps no label, so a food
    // added to the curated list later leaves only its name in `extras`. Reading
    // that back is what stops "we now know this is food" from meaning "re-import
    // a season of logs or keep calling them unfed".
    expect(hasFood(row({ food: false, extras: ["Enlightened"] }))).toBe(true);
  });

  it("is false for off-slot consumables that aren't food", () => {
    expect(hasFood(row({ food: false, extras: ["Flame Cap", "Bogling Root"] }))).toBe(false);
  });

  it("is false with nothing at all", () => {
    expect(hasFood(row())).toBe(false);
  });

  it("feeds isPrepared, so the score sees it too", () => {
    const soup = row({ flask: "Flask of Relentless Assault", food: false, extras: ["Enlightened"] });
    expect(isPrepared(soup)).toBe(true);
  });
});
