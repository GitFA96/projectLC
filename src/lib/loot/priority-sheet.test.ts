import { describe, expect, it } from "vitest";
import { LOOT_PRIORITY_SHEET_MD } from "@/data/seed/loot-priority-p3";
import { indexRules, normalizeItemName, parsePrioritySheet } from "@/lib/loot/priority-sheet";
import { manualTiers, parsePriorityChain, tierFor } from "@/lib/loot/priority-chain";
import { canonicalSpecTag, matchesSpecTag, specTagsOf } from "@/lib/loot/spec-tags";
import type { Character } from "@/lib/types";

function character(wowClass: Character["class"], spec: string, role: Character["role"]): Character {
  return {
    id: `c-${wowClass}-${spec}`,
    guildId: "g1",
    name: "Test",
    class: wowClass,
    spec,
    role,
    status: "main",
    mainCharacterId: null,
  };
}

describe("spec tags", () => {
  it("lets a character satisfy both their class tag and their spec tag", () => {
    const arcane = character("Mage", "Arcane", "Ranged DPS");
    expect(matchesSpecTag(arcane, "Mage")).toBe(true);
    expect(matchesSpecTag(arcane, "Arcane")).toBe(true);
    expect(specTagsOf(arcane)).toEqual(["Mage", "Arcane"]);
  });

  it("splits feral druids by what they actually do in the raid", () => {
    expect(matchesSpecTag(character("Druid", "Feral", "Tank"), "Feral Tank")).toBe(true);
    expect(matchesSpecTag(character("Druid", "Feral", "Tank"), "Feral DPS")).toBe(false);
    expect(matchesSpecTag(character("Druid", "Feral", "Melee DPS"), "Feral DPS")).toBe(true);
  });

  it("treats any non-protection warrior as a DPS warrior", () => {
    expect(matchesSpecTag(character("Warrior", "Fury", "Melee DPS"), "DPS Warrior")).toBe(true);
    expect(matchesSpecTag(character("Warrior", "Arms", "Melee DPS"), "DPS Warrior")).toBe(true);
    expect(matchesSpecTag(character("Warrior", "Protection", "Tank"), "DPS Warrior")).toBe(false);
    expect(matchesSpecTag(character("Warrior", "Protection", "Tank"), "Prot Warrior")).toBe(true);
  });

  it("matches nothing for a token that isn't a spec tag", () => {
    expect(matchesSpecTag(character("Rogue", "Combat", "Melee DPS"), "Set completion")).toBe(false);
  });

  it("treats holy and discipline priests as one loot pool", () => {
    const holy = character("Priest", "Holy", "Healer");
    const disc = character("Priest", "Discipline", "Healer");
    for (const priest of [holy, disc]) {
      // However the sheet spells it, both healing priests match and neither
      // is a shadow priest.
      for (const wording of ["Healing Priest", "Holy Priest", "Disc Priest"]) {
        expect(matchesSpecTag(priest, wording)).toBe(true);
      }
      expect(matchesSpecTag(priest, "Shadow")).toBe(false);
    }
  });

  it("keeps shadow priests out of the healing pool", () => {
    const shadow = character("Priest", "Shadow", "Ranged DPS");
    expect(matchesSpecTag(shadow, "Shadow")).toBe(true);
    expect(matchesSpecTag(shadow, "Shadow Priest")).toBe(true);
    expect(matchesSpecTag(shadow, "Healing Priest")).toBe(false);
    expect(matchesSpecTag(shadow, "Holy Priest")).toBe(false);
  });

  it("falls back to the roster role when the spec string names no tree", () => {
    expect(matchesSpecTag(character("Priest", "Priest", "Healer"), "Healing Priest")).toBe(true);
    expect(matchesSpecTag(character("Priest", "Priest", "Ranged DPS"), "Shadow")).toBe(true);
  });

  it("never puts one priest in both pools when spec and role disagree", () => {
    // A real case on the roster: spec "Holy", role "Ranged DPS". The spec is
    // the more specific statement, so it wins outright — otherwise chain order
    // would silently decide which pool they land in.
    const mismatched = character("Priest", "Holy", "Ranged DPS");
    expect(matchesSpecTag(mismatched, "Healing Priest")).toBe(true);
    expect(matchesSpecTag(mismatched, "Shadow")).toBe(false);

    const shadowHealer = character("Priest", "Shadow", "Healer");
    expect(matchesSpecTag(shadowHealer, "Shadow")).toBe(true);
    expect(matchesSpecTag(shadowHealer, "Healing Priest")).toBe(false);
  });

  it("is case- and spacing-insensitive about how a sheet is typed", () => {
    expect(canonicalSpecTag("  feral tank ")).toBe("Feral Tank");
    expect(canonicalSpecTag("HOLY PRIEST")).toBe("Healing Priest");
    expect(canonicalSpecTag("Ret Paladin")).toBe("Retribution");
    expect(canonicalSpecTag("Set completion")).toBeUndefined();
  });
});

describe("priority chains", () => {
  const chain = parsePriorityChain("Resto Shaman = Healing Priest > Holy Paladin > Resto Druid");

  it("reads = as equal priority and > as a step down", () => {
    expect(chain.tiers.map((t) => t.tags)).toEqual([
      ["Resto Shaman", "Healing Priest"],
      ["Holy Paladin"],
      ["Resto Druid"],
    ]);
  });

  it("puts a contender in the first tier they satisfy", () => {
    expect(tierFor(chain, character("Priest", "Holy", "Healer"))).toMatchObject({
      index: 0,
      label: "Resto Shaman = Healing Priest",
    });
    expect(tierFor(chain, character("Druid", "Restoration", "Healer")).index).toBe(2);
  });

  it("leaves a contender the chain never names untiered", () => {
    expect(tierFor(chain, character("Rogue", "Combat", "Melee DPS")).index).toBeUndefined();
  });

  it("skips over tiers it can't evaluate instead of promoting everybody", () => {
    // "Major 2pc/4pc completion" is a judgement call, not a spec rule — a
    // warlock must not be swept into tier 0 just because nothing matched it.
    const tier = parsePriorityChain(
      "Major 2pc/4pc completion > Prot Paladin > Warlock > Shadow",
    );
    expect(tier.tiers[0].manual).toBe(true);
    expect(tierFor(tier, character("Warlock", "Destruction", "Ranged DPS")).index).toBe(2);
    expect(manualTiers(tier)).toEqual(["Major 2pc/4pc completion"]);
  });
});

describe("the seeded Phase 3 sheet", () => {
  const rules = parsePrioritySheet(LOOT_PRIORITY_SHEET_MD);
  const byName = indexRules(rules);

  it("parses every boss table without swallowing headers or separators", () => {
    expect(rules.length).toBeGreaterThan(150);
    expect(rules.some((r) => r.itemName === "Item")).toBe(false);
    expect(rules.some((r) => /^-+$/.test(r.itemName))).toBe(false);
  });

  it("keeps each rule's boss, slot wording and note", () => {
    const nethervoid = byName.get(normalizeItemName("Nethervoid Cloak"))!;
    expect(nethervoid).toMatchObject({
      source: "Hyjal Trash",
      slotLabel: "Back",
      note: "Shadow-damage-only item.",
    });
    expect(nethervoid.chain.tiers.map((t) => t.tags)).toEqual([
      ["Warlock"],
      ["Shadow"],
      ["MS"],
      ["OS"],
    ]);
  });

  it("ranks a real contested item the way the sheet reads", () => {
    // "Hunter > DPS Warrior > MS > OS" — the hunter outranks the warrior, and
    // a rogue still places on MS rather than dropping off the list.
    const madness = byName.get(normalizeItemName("Madness of the Betrayer"))!;
    expect(tierFor(madness.chain, character("Hunter", "Beast Mastery", "Ranged DPS")).index).toBe(0);
    expect(tierFor(madness.chain, character("Warrior", "Fury", "Melee DPS")).index).toBe(1);
    expect(tierFor(madness.chain, character("Rogue", "Combat", "Melee DPS")).index).toBe(2);
  });

  it("covers the tier tokens with no evaluable rule as manual calls", () => {
    const glaive = byName.get(normalizeItemName("Warglaive of Azzinoth (Main Hand)"))!;
    expect(manualTiers(glaive.chain)).toEqual(["Set completion"]);
  });

  it("resolves the sheet's one-off “Holy Priest” wording", () => {
    // Boots of the Divine Light is the only row that says "Holy Priest" where
    // the rest of the sheet says "Healing Priest" — same pool either way, so a
    // disc priest has to place on it too.
    const boots = byName.get(normalizeItemName("Boots of the Divine Light"))!;
    expect(manualTiers(boots.chain)).toEqual([]);
    expect(tierFor(boots.chain, character("Priest", "Holy", "Healer")).index).toBe(0);
    expect(tierFor(boots.chain, character("Priest", "Discipline", "Healer")).index).toBe(0);
    expect(tierFor(boots.chain, character("Druid", "Restoration", "Healer")).index).toBe(1);
    expect(tierFor(boots.chain, character("Shaman", "Restoration", "Healer")).index).toBe(2);
  });

  it("leaves no chain in the whole sheet stranded on unknown wording", () => {
    // Every rung that isn't a deliberate judgement call ("Set completion",
    // "Quest Item") has to be rankable, or the sheet silently loses a rung.
    const DELIBERATE = new Set(["Major 2pc/4pc completion", "Set completion", "Quest Item"]);
    const stranded = rules
      .flatMap((r) => manualTiers(r.chain).map((tier) => ({ item: r.itemName, tier })))
      .filter((s) => !DELIBERATE.has(s.tier));
    expect(stranded).toEqual([]);
  });
});
