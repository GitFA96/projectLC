import { describe, expect, it } from "vitest";
import { guessRole } from "@/lib/wcl/roles";
import { ROLES } from "@/lib/constants/wow";

describe("guessRole", () => {
  it("takes the log's word for tank and healer, whatever the spec says", () => {
    // Both are unambiguous in the log, and a Feral tank must not be read as
    // melee dps just because "feral" is on the melee list.
    expect(guessRole("tank", "Druid", "Feral")).toBe("Tank");
    expect(guessRole("healer", "Druid", "Restoration")).toBe("Healer");
    expect(guessRole("healer", "Paladin", "Retribution")).toBe("Healer");
  });

  it("splits dps by spec", () => {
    expect(guessRole("dps", "Rogue", "Combat")).toBe("Melee DPS");
    expect(guessRole("dps", "Shaman", "Enhancement")).toBe("Melee DPS");
    expect(guessRole("dps", "Shaman", "Elemental")).toBe("Ranged DPS");
    expect(guessRole("dps", "Druid", "Balance")).toBe("Ranged DPS");
  });

  it("matches the spec case-insensitively — the log's casing is not ours", () => {
    expect(guessRole("dps", "Warrior", "ARMS")).toBe("Melee DPS");
    expect(guessRole("dps", "Warrior", "arms")).toBe("Melee DPS");
  });

  it("falls back to the class when the log names no spec", () => {
    // A class that has no ranged spec can be answered without one; anything
    // else is guessed as ranged and corrected by hand.
    expect(guessRole("dps", "Warrior")).toBe("Melee DPS");
    expect(guessRole("dps", "Rogue")).toBe("Melee DPS");
    expect(guessRole("dps", "Paladin")).toBe("Melee DPS");
    expect(guessRole("dps", "Mage")).toBe("Ranged DPS");
    expect(guessRole(undefined, "Hunter")).toBe("Ranged DPS");
  });

  it("only ever answers with a real roster role", () => {
    const answers = [
      guessRole("tank", "Warrior", "Protection"),
      guessRole("healer", "Priest", "Holy"),
      guessRole("dps", "Rogue", "Subtlety"),
      guessRole(undefined, "Warlock"),
    ];
    for (const answer of answers) expect(ROLES).toContain(answer);
  });
});
