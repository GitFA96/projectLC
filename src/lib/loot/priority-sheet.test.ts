import { describe, expect, it } from "vitest";
import { LOOT_PRIORITY_SHEET_MD } from "@/data/seed/loot-priority-p3";
import {
  buildPrioritySheetView,
  indexRules,
  normalizeItemName,
  parsePrioritySheet,
} from "@/lib/loot/priority-sheet";
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
    professions: [],
    membershipId: null,
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

describe("buildPrioritySheetView", () => {
  const md = [
    "### Gurtogg Bloodboil",
    "| Item | Priority | Slot | Notes |",
    "|---|---|---|---|",
    "| Cloak of Fire | Mage > MS > OS | Back | |",
    "| Band of Ruin | Warlock > MS > OS | Finger | Cursed. |",
    "### Reliquary of Souls",
    "| Item | Priority | Slot | Notes |",
    "|---|---|---|---|",
    "| Boots of Effort | Resto Druid > MS > OS | Cloth - Feet | |",
  ].join("\n");

  const rules = () => parsePrioritySheet(md);

  it("keeps the document's sections and their order", () => {
    const view = buildPrioritySheetView({ rules: rules(), overrides: {} });
    expect(view.sections.map((s) => s.source)).toEqual(["Gurtogg Bloodboil", "Reliquary of Souls"]);
    expect(view.sections[0].rows.map((r) => r.itemName)).toEqual(["Cloak of Fire", "Band of Ruin"]);
    expect(view.ruleCount).toBe(3);
    expect(view.officerCount).toBe(0);
  });

  it("folds an officer edit over the sheet, keeping what the sheet said", () => {
    const view = buildPrioritySheetView({
      rules: rules(),
      overrides: { [normalizeItemName("Cloak of Fire")]: { itemName: "Cloak of Fire", chain: "Warlock > MS" } },
    });
    const row = view.sections[0].rows[0];
    expect(row.origin).toBe("officer");
    expect(row.chain).toBe("Warlock > MS");
    expect(row.sheetChain).toBe("Mage > MS > OS");
    expect(row.tiers[0].tags).toEqual(["Warlock"]);
    // The sheet's slot survives an edit that doesn't mention one.
    expect(row.slotLabel).toBe("Back");
    expect(view.officerCount).toBe(1);
  });

  it("lists officer chains for items the sheet never named", () => {
    const view = buildPrioritySheetView({
      rules: rules(),
      overrides: { [normalizeItemName("Some Trinket")]: { itemName: "Some Trinket", chain: "Hunter > MS" } },
    });
    expect(view.unlisted.map((r) => r.itemName)).toEqual(["Some Trinket"]);
    expect(view.unlisted[0].origin).toBe("officer");
    expect(view.officerCount).toBe(1);
  });

  it("flags a duplicate name rather than dropping it — matching only reaches the first", () => {
    const dupe = md + "\n| Cloak of Fire | Rogue > MS | Back | |";
    const view = buildPrioritySheetView({ rules: parsePrioritySheet(dupe), overrides: {} });
    const rows = view.sections.flatMap((s) => s.rows).filter((r) => r.itemName === "Cloak of Fire");
    expect(rows).toHaveLength(2);
    expect(rows[0].shadowed).toBeUndefined();
    expect(rows[1].shadowed).toBe(true);
    // Exactly what indexRules would have picked.
    expect(indexRules(parsePrioritySheet(dupe)).get(normalizeItemName("Cloak of Fire"))?.chain.source).toBe(
      "Mage > MS > OS",
    );
  });

  it("links a row when the item cache knows the name", () => {
    const view = buildPrioritySheetView({
      rules: rules(),
      overrides: {},
      itemIdFor: (name) => (name === "Band of Ruin" ? 30048 : undefined),
    });
    const rows = view.sections[0].rows;
    expect(rows.find((r) => r.itemName === "Band of Ruin")?.itemId).toBe(30048);
    expect(rows.find((r) => r.itemName === "Cloak of Fire")?.itemId).toBeUndefined();
  });
});

describe("per-spec tags", () => {
  const warrior = (spec: string) => character("Warrior", spec, "Melee DPS");
  const hunter = (spec: string) => character("Hunter", spec, "Ranged DPS");
  const lock = (spec: string) => character("Warlock", spec, "Ranged DPS");

  it("splits every class that used to collapse to one tag", () => {
    expect(matchesSpecTag(warrior("Fury"), "Fury")).toBe(true);
    expect(matchesSpecTag(warrior("Arms"), "Fury")).toBe(false);
    expect(matchesSpecTag(hunter("Beast Mastery"), "Beast Mastery")).toBe(true);
    expect(matchesSpecTag(hunter("Survival"), "Beast Mastery")).toBe(false);
    expect(matchesSpecTag(lock("Destruction"), "Destruction")).toBe(true);
    expect(matchesSpecTag(lock("Demonology"), "Destruction")).toBe(false);
    expect(matchesSpecTag(character("Rogue", "Combat", "Melee DPS"), "Combat")).toBe(true);
    expect(matchesSpecTag(character("Mage", "Fire", "Ranged DPS"), "Frost")).toBe(false);
  });

  it("keeps the class-level tag meaning any spec — the guild's sheet is written that way", () => {
    for (const spec of ["Fury", "Arms"]) {
      expect(matchesSpecTag(warrior(spec), "DPS Warrior")).toBe(true);
    }
    for (const spec of ["Beast Mastery", "Marksmanship", "Survival"]) {
      expect(matchesSpecTag(hunter(spec), "Hunter")).toBe(true);
    }
    for (const spec of ["Affliction", "Demonology", "Destruction"]) {
      expect(matchesSpecTag(lock(spec), "Warlock")).toBe(true);
    }
  });

  it("still ranks a raider whose roster spec is blank, via the class tag", () => {
    expect(matchesSpecTag(warrior(""), "DPS Warrior")).toBe(true);
    // ...but the finer tag can't claim them, which is the honest answer.
    expect(matchesSpecTag(warrior(""), "Fury")).toBe(false);
  });

  it("reads the wordings a sheet actually uses", () => {
    expect(canonicalSpecTag("fury warrior")).toBe("Fury");
    expect(canonicalSpecTag("destro lock")).toBe("Destruction");
    expect(canonicalSpecTag("BM Hunter")).toBe("Beast Mastery");
    expect(canonicalSpecTag("mutilate")).toBe("Assassination");
    expect(canonicalSpecTag("fire mage")).toBe("Fire");
  });

  it("leaves the guild's own P3 sheet meaning exactly what it did", () => {
    // Every tag the real sheet uses must still be one the app can evaluate;
    // splitting specs must not strand a rung nobody can be ranked into.
    const rules = parsePrioritySheet(LOOT_PRIORITY_SHEET_MD);
    const used = new Set(rules.flatMap((r) => r.chain.tiers.flatMap((t) => t.tags)));
    const evaluable = [...used].filter((t) => canonicalSpecTag(t) !== undefined);
    expect(evaluable).toContain("DPS Warrior");
    expect(evaluable).toContain("Hunter");
    expect(evaluable).toContain("Warlock");
  });
});
