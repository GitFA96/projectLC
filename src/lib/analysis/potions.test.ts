import { describe, expect, it } from "vitest";
import {
  potionNames,
  potionsUsed,
  prepotName,
  UNNAMED_PREPOT,
  type PotionRow,
} from "@/lib/analysis/potions";

const row = (over: Partial<PotionRow> = {}): PotionRow => ({
  potions: [],
  prepot: false,
  ...over,
});

describe("potionsUsed", () => {
  it("counts the pre-pot — it was bought and drunk like any other", () => {
    expect(potionsUsed(row({ prepot: true }))).toBe(1);
    expect(potionsUsed(row({ potions: ["Haste Potion"], prepot: true }))).toBe(2);
  });

  it("counts in-fight potions on their own", () => {
    expect(potionsUsed(row({ potions: ["Haste Potion", "Super Mana Potion"] }))).toBe(2);
  });

  it("is zero when the fight got nothing", () => {
    expect(potionsUsed(row())).toBe(0);
  });
});

describe("prepotName", () => {
  it("uses the recorded potion when the import captured one", () => {
    expect(prepotName(row({ prepot: true, prepotLabel: "Haste Potion" }))).toBe("Haste Potion");
  });

  it("stands in for reports imported before the name was kept", () => {
    // Those rows only ever stored a boolean. Counting the use under a vague
    // name beats dropping a potion that was really drunk.
    expect(prepotName(row({ prepot: true }))).toBe(UNNAMED_PREPOT);
  });

  it("is undefined when nobody pre-potted", () => {
    expect(prepotName(row({ prepotLabel: "Haste Potion" }))).toBeUndefined();
  });
});

describe("potionNames", () => {
  it("puts the pre-pot first — it was drunk first", () => {
    expect(potionNames(row({ prepot: true, prepotLabel: "Haste Potion", potions: ["Super Mana Potion"] })))
      .toEqual(["Haste Potion", "Super Mana Potion"]);
  });

  it("returns the in-fight list untouched without one", () => {
    expect(potionNames(row({ potions: ["Haste Potion"] }))).toEqual(["Haste Potion"]);
  });
});
