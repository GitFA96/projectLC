import { describe, expect, it } from "vitest";
import { matchesSpecTag } from "@/lib/loot/spec-tags";
import type { Character } from "@/lib/types";

const mk = (wowClass: string, spec: string, role = "Ranged DPS"): Character =>
  ({ id: "x", guildId: "g", name: "T", class: wowClass, spec, role, status: "main", mainCharacterId: null }) as Character;

/**
 * The full in-game spec name for every per-spec tag, and the shorthand a roster
 * might carry instead.
 *
 * This table exists because of a bug worth not repeating: the Destruction
 * matcher tested for "destro", which is how everyone says it and is NOT a
 * substring of "Destruction" — the word is destrUction. Every Destruction
 * warlock silently failed to match while the code read as obviously correct.
 * A needle has to match the real spec name AND the shorthand, so both are
 * asserted for every spec.
 */
const CASES: [string, string, string, string][] = [
  ["Druid", "Balance", "Balance", "Boomkin"],
  ["Druid", "Restoration", "Resto Druid", "Resto"],
  ["Hunter", "Beast Mastery", "Beast Mastery", "BM"],
  ["Hunter", "Marksmanship", "Marksmanship", "MM"],
  ["Hunter", "Survival", "Survival", "Surv"],
  ["Mage", "Arcane", "Arcane", "Arcane"],
  ["Mage", "Fire", "Fire", "Fire"],
  ["Mage", "Frost", "Frost", "Frost"],
  ["Paladin", "Holy", "Holy Paladin", "Holy"],
  ["Paladin", "Protection", "Prot Paladin", "Prot"],
  ["Paladin", "Retribution", "Retribution", "Ret"],
  ["Priest", "Shadow", "Shadow", "Shadow"],
  ["Priest", "Discipline", "Healing Priest", "Disc"],
  ["Rogue", "Combat", "Combat", "Combat"],
  ["Rogue", "Assassination", "Assassination", "Assass"],
  ["Rogue", "Subtlety", "Subtlety", "Sub"],
  ["Shaman", "Restoration", "Resto Shaman", "Resto"],
  ["Shaman", "Enhancement", "Enhancement", "Enh"],
  ["Shaman", "Elemental", "Elemental", "Ele"],
  ["Warlock", "Affliction", "Affliction", "Affli"],
  ["Warlock", "Demonology", "Demonology", "Demo"],
  ["Warlock", "Destruction", "Destruction", "Destro"],
  ["Warrior", "Protection", "Prot Warrior", "Prot"],
  ["Warrior", "Arms", "Arms", "Arms"],
  ["Warrior", "Fury", "Fury", "Fury"],
];

describe("spec needles match the real spec name, not just the shorthand", () => {
  it.each(CASES)("%s %s matches %s", (wowClass, fullSpec, tag, short) => {
    const role = tag.includes("Prot") || tag === "Feral Tank" ? "Tank" : tag.includes("Healing") || tag.startsWith("Resto") || tag === "Holy Paladin" ? "Healer" : "Ranged DPS";
    expect(matchesSpecTag(mk(wowClass, fullSpec, role), tag)).toBe(true);
    expect(matchesSpecTag(mk(wowClass, short, role), tag)).toBe(true);
  });
});
