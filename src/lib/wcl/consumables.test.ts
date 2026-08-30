import { describe, expect, it } from "vitest";
import {
  CONSUMABLE_GROUP_ORDER,
  POTION_PURPOSE_ORDER,
  consumableGroupOf,
  petConsumableLabel,
  baseConsumableName,
  isRestrictedRestore,
  potionPurposeOf,
  type ConsumableGroup,
  type PotionPurpose,
} from "./consumables";

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

describe("potionPurposeOf", () => {
  it("names what the common potions are drunk for", () => {
    expect(potionPurposeOf("Haste Potion")).toBe("damage");
    expect(potionPurposeOf("Destruction Potion")).toBe("damage");
    expect(potionPurposeOf("Super Mana Potion")).toBe("mana");
    expect(potionPurposeOf("Super Healing Potion")).toBe("healing");
    expect(potionPurposeOf("Major Fire Protection Potion")).toBe("protection");
    expect(potionPurposeOf("Free Action Potion")).toBe("utility");
  });

  it("leaves a potion that does two things unassigned", () => {
    // Deliberate: naming these by one half of what they do would be the app
    // deciding something no source it holds has said. See the list's comment.
    expect(potionPurposeOf("Heroic Potion")).toBeUndefined();
    expect(potionPurposeOf("Mighty Rage Potion")).toBeUndefined();
  });

  it("does not guess a purpose from a name it hasn't curated", () => {
    // It still groups as a potion — that fallback is the name's to make. The
    // purpose isn't, so it stays absent rather than being pattern-matched.
    expect(consumableGroupOf("Mystery Potion")).toBe("potion");
    expect(potionPurposeOf("Mystery Potion")).toBeUndefined();
    expect(potionPurposeOf("Flask of Relentless Assault")).toBeUndefined();
  });

  it("can place every purpose it can return", () => {
    const purposes = new Set<PotionPurpose>(POTION_PURPOSE_ORDER);
    expect(purposes.size).toBe(POTION_PURPOSE_ORDER.length);
  });
});

describe("isRestrictedRestore", () => {
  it("separates the vendor restores from the bought ones", () => {
    expect(isRestrictedRestore("Bottled Nethergon Energy")).toBe(true);
    expect(isRestrictedRestore("Cenarion Mana Salve")).toBe(true);
    expect(isRestrictedRestore("Bottled Nethergon Vapor")).toBe(true);
    expect(isRestrictedRestore("Cenarion Healing Salve")).toBe(true);
    expect(isRestrictedRestore("Super Mana Potion")).toBe(false);
    expect(isRestrictedRestore("Major Mana Potion")).toBe(false);
  });

  it("pairs each vendor's restore with its heal", () => {
    expect(potionPurposeOf("Cenarion Mana Salve")).toBe("mana");
    expect(potionPurposeOf("Bottled Nethergon Energy")).toBe("mana");
    expect(potionPurposeOf("Cenarion Healing Salve")).toBe("healing");
    expect(potionPurposeOf("Bottled Nethergon Vapor")).toBe("healing");
  });
});

describe("a pet's copy of a consumable", () => {
  it("files under Pet, not under the family it came from", () => {
    // The point of the label: a hunter's own Scroll of Agility V and the one
    // they read to the pet stop sharing a line, so a correction to one leaves
    // the other alone.
    expect(consumableGroupOf(petConsumableLabel("Scroll of Agility V"))).toBe("pet");
    expect(consumableGroupOf("Scroll of Agility V")).toBe("scroll");
  });

  it("names the item underneath, which is what gets priced", () => {
    expect(baseConsumableName(petConsumableLabel("Kibler's Bits"))).toBe("Kibler's Bits");
    // Anything without the suffix is already the item.
    expect(baseConsumableName("Kibler's Bits")).toBe("Kibler's Bits");
  });
});
