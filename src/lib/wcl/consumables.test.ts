import { describe, expect, it } from "vitest";
import { CONSUMABLE_GROUP_ORDER, consumableGroupOf, type ConsumableGroup } from "./consumables";

/**
 * `consumableGroupOf` reads families back out of the curated lists rather than
 * carrying its own. These pin the cases where that indirection could quietly
 * stop working — not an inventory of every consumable, which the lists own.
 */
describe("consumableGroupOf", () => {
  it("groups from the curated cast list", () => {
    expect(consumableGroupOf("Haste Potion")).toBe("potion");
    expect(consumableGroupOf("Super Sapper Charge")).toBe("sapper");
    expect(consumableGroupOf("Dark Rune")).toBe("rune");
    expect(consumableGroupOf("Drums of Battle")).toBe("drums");
    expect(consumableGroupOf("Kibler's Bits")).toBe("pet");
  });

  it("groups from the curated aura list", () => {
    expect(consumableGroupOf("Flask of Relentless Assault")).toBe("flask");
    expect(consumableGroupOf("Scroll of Agility V")).toBe("scroll");
  });

  it("puts both elixir slots in one family", () => {
    // The slot split grades coverage; an uncurated elixir has no known slot, so
    // grouping by it would scatter them. See the note on the type.
    expect(consumableGroupOf("Elixir of Major Agility")).toBe("elixir");
    expect(consumableGroupOf("Elixir of Draenic Wisdom")).toBe("elixir");
    expect(consumableGroupOf("Elixir of Nothing In Particular")).toBe("elixir");
  });

  it("keeps a mana gem and a healthstone out of the priced families", () => {
    expect(consumableGroupOf("Mana Emerald")).toBe("conjured");
    expect(consumableGroupOf("Master Healthstone")).toBe("conjured");
  });

  it("respects a curation that deliberately refuses a family", () => {
    // Thistle Tea plays like a potion and is curated "other" on purpose,
    // because it doesn't share the potion cooldown. Grouping must not re-guess
    // it from the name.
    expect(consumableGroupOf("Thistle Tea")).toBe("other");
  });

  it("names the prep buffs this codebase synthesises", () => {
    // Neither is an item — `raid-report.ts` writes both labels itself.
    expect(consumableGroupOf("Food")).toBe("food");
    expect(consumableGroupOf("Weapon oil/stone")).toBe("weapon");
  });

  it("falls back on the same families the default pricing does", () => {
    expect(consumableGroupOf("Flask of Some New Thing")).toBe("flask");
    expect(consumableGroupOf("Scroll of Stamina IV")).toBe("scroll");
    expect(consumableGroupOf("Mystery Potion")).toBe("potion");
    expect(consumableGroupOf("A Thing Nobody Curated")).toBe("other");
  });

  it("can place every group it can return", () => {
    const groups = new Set<ConsumableGroup>(CONSUMABLE_GROUP_ORDER);
    expect(groups.size).toBe(CONSUMABLE_GROUP_ORDER.length);
  });
});
