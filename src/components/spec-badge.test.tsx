import { describe, expect, it } from "vitest";
import { specIcon, specLabel } from "@/components/spec-badge";

/**
 * The spec→icon lookup, which has to survive three different vocabularies:
 * the talent trees, Warcraft Logs' own strings, and whatever an officer typed
 * into the roster's free-text spec field. The third is the one that breaks it.
 */
describe("specIcon", () => {
  it("resolves the talent trees", () => {
    expect(specIcon("Warrior", "Fury")).toBe("ability_warrior_innerrage");
    expect(specIcon("Priest", "Shadow")).toBe("spell_shadow_shadowwordpain");
  });

  it("resolves the names Warcraft Logs invents", () => {
    expect(specIcon("Druid", "Dreamstate")).toBe("ability_druid_dreamstate");
    expect(specIcon("Druid", "Guardian")).toBe("ability_racial_bearform");
  });

  it("resolves the roster's own free text, spacing and casing included", () => {
    // A real value on this guild's roster. A tank, so a bear.
    expect(specIcon("Druid", "Feral Tank")).toBe("ability_racial_bearform");
    expect(specIcon("Hunter", "Beast Mastery")).toBe(specIcon("Hunter", "BeastMastery"));
  });

  it("falls back to the first word rather than showing a gap", () => {
    expect(specIcon("Priest", "Holy PvP")).toBe("spell_holy_holybolt");
    expect(specIcon("Shaman", "Resto")).toBeUndefined();
  });

  it("never falls back past a name that resolves whole", () => {
    // "Beast Mastery" must not degrade to a "Beast" that has no icon.
    expect(specIcon("Hunter", "Beast Mastery")).toBe("ability_hunter_beasttaming");
  });

  it("returns nothing rather than guessing when the class is unknown", () => {
    expect(specIcon(undefined, "Fury")).toBeUndefined();
    expect(specIcon("Tinkerer", "Fury")).toBeUndefined();
    expect(specIcon("Warrior", "   ")).toBeUndefined();
  });
});

describe("specLabel", () => {
  it("unsquishes Warcraft Logs' spec strings", () => {
    expect(specLabel("BeastMastery")).toBe("Beast Mastery");
    expect(specLabel("Fury")).toBe("Fury");
  });
});
