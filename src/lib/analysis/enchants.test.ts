import { describe, expect, it } from "vitest";
import { buildEnchantReference, gradeEnchant, type EnchantReference } from "@/lib/analysis/enchants";
import type { GearSet, SlotId, WowClass } from "@/lib/types";

/** A gear set with just the slots a test cares about. */
function set(
  over: {
    characterId: string;
    kind: GearSet["kind"];
    slots: { slot: SlotId; enchant?: { id?: number; itemId?: number; name: string } }[];
  },
): GearSet {
  return {
    id: `gs-${over.characterId}-${over.kind}`,
    characterId: over.characterId,
    kind: over.kind,
    phase: over.kind === "wishlist" ? 2 : undefined,
    name: "set",
    source: "sixtyupgrades",
    importedAt: "2026-01-01T00:00:00.000Z",
    stats: {},
    slots: over.slots.map((s) => ({ ...s, itemId: 1, itemName: "Item" })),
  } as GearSet;
}

const HEAD = 0; // WCL gear-array index for the head slot.
const classOf = (id: string): WowClass | undefined =>
  id.startsWith("war") ? "Warrior" : id.startsWith("mage") ? "Mage" : undefined;

describe("buildEnchantReference", () => {
  const sets = [
    set({ characterId: "war1", kind: "wishlist", slots: [{ slot: "head", enchant: { id: 3003, itemId: 29192, name: "Glyph of Ferocity" } }] }),
    set({ characterId: "war2", kind: "wishlist", slots: [{ slot: "head", enchant: { id: 3003, name: "Glyph of Ferocity" } }] }),
    set({ characterId: "war3", kind: "wishlist", slots: [{ slot: "head", enchant: { id: 2999, name: "Glyph of the Defender" } }] }),
    // Current gear names an enchant but never votes on what's best.
    set({ characterId: "mage1", kind: "current", slots: [{ slot: "head", enchant: { id: 3096, name: "Glyph of Power" } }] }),
    // An enchant with no id can't be matched against a log — dictionary only skips it.
    set({ characterId: "war1", kind: "wishlist", slots: [{ slot: "back", enchant: { name: "Greater Agility" } }] }),
  ];
  const reference = buildEnchantReference(sets, classOf);

  it("names every enchant any imported set knows, current gear included", () => {
    expect(reference.names).toEqual(
      expect.arrayContaining([
        { id: 2999, name: "Glyph of the Defender", itemId: undefined },
        { id: 3003, name: "Glyph of Ferocity", itemId: 29192 },
        { id: 3096, name: "Glyph of Power", itemId: undefined },
      ]),
    );
  });

  it("falls back to the curated table for ids no set names", () => {
    // Mongoose is a weapon enchant SixtyUpgrades lists rarely carry.
    expect(reference.names.find((e) => e.id === 2673)).toEqual({ id: 2673, name: "Mongoose" });
  });

  it("names the ids nobody wishlists from the resolved enchantment table", () => {
    // A scope is worn by every hunter and listed by none of them.
    const withResolved = buildEnchantReference(sets, classOf, {
      2724: "Scope (+28 Critical Strike Rating)",
      1593: "+24 Attack Power",
    });
    expect(withResolved.names).toEqual(
      expect.arrayContaining([
        { id: 1593, name: "+24 Attack Power" },
        { id: 2724, name: "Scope (+28 Critical Strike Rating)" },
      ]),
    );
  });

  it("keeps an imported set's wording over a resolved one", () => {
    // The set knows the applying item too, which a resolved name never does.
    const withResolved = buildEnchantReference(sets, classOf, { 3003: "+34 Attack Power" });
    expect(withResolved.names.find((e) => e.id === 3003)).toEqual({
      id: 3003,
      name: "Glyph of Ferocity",
      itemId: 29192,
    });
  });

  it("ignores a blank resolved name rather than showing an empty enchant", () => {
    const withResolved = buildEnchantReference(sets, classOf, { 4242: "   " });
    expect(withResolved.names.find((e) => e.id === 4242)).toBeUndefined();
  });

  it("takes the most-picked wishlist enchant per class and slot as the consensus", () => {
    const head = reference.consensus.find((c) => c.wowClass === "Warrior" && c.slot === "head")!;
    expect(head).toMatchObject({ enchantId: 3003, name: "Glyph of Ferocity", sets: 2, totalSets: 3 });
    // Current gear doesn't vote, so the mage's slot has no consensus at all.
    expect(reference.consensus.some((c) => c.wowClass === "Mage")).toBe(false);
  });
});

describe("gradeEnchant", () => {
  const reference: EnchantReference = {
    names: [
      { id: 3003, name: "Glyph of Ferocity", itemId: 29192 },
      { id: 2999, name: "Glyph of the Defender" },
    ],
    consensus: [
      { wowClass: "Warrior", slot: "head", enchantId: 3003, name: "Glyph of Ferocity", sets: 2, totalSets: 3 },
    ],
  };
  const ownList = [
    set({ characterId: "war1", kind: "wishlist", slots: [{ slot: "head", enchant: { id: 2999, name: "Glyph of the Defender" } }] }),
  ];
  const base = { slotIndex: HEAD, enchantable: true, wowClass: "Warrior" as WowClass, reference };

  it("calls it BiS when it matches the character's own list", () => {
    const grade = gradeEnchant({ ...base, wornEnchantId: 2999, ownWishlists: ownList });
    expect(grade.verdict).toBe("bis");
    expect(grade.source).toBe("own-list");
  });

  it("names both sides when the worn enchant isn't the one their list picked", () => {
    const grade = gradeEnchant({ ...base, wornEnchantId: 3003, ownWishlists: ownList });
    expect(grade.verdict).toBe("off-bis");
    expect(grade.worn).toMatchObject({ name: "Glyph of Ferocity" });
    expect(grade.wanted).toMatchObject({ name: "Glyph of the Defender" });
  });

  it("falls back to what the class's other lists chose, and says so", () => {
    const grade = gradeEnchant({ ...base, wornEnchantId: 3003, ownWishlists: [] });
    expect(grade).toMatchObject({
      verdict: "bis",
      source: "guild-lists",
      agreement: { sets: 2, totalSets: 3 },
    });
  });

  it("reports an unenchanted slot as missing, with what it should have", () => {
    const grade = gradeEnchant({ ...base, wornEnchantId: undefined, ownWishlists: ownList });
    expect(grade.verdict).toBe("missing");
    expect(grade.wanted).toMatchObject({ name: "Glyph of the Defender" });
  });

  it("refuses to judge an enchant with no reference at all", () => {
    // A mage in the same slot: nobody's list covers it, so there's no standard
    // to hold them to — the enchant is reported, not graded.
    const grade = gradeEnchant({ ...base, wowClass: "Mage", wornEnchantId: 3003, ownWishlists: [] });
    expect(grade.verdict).toBe("unknown");
    expect(grade.worn).toMatchObject({ name: "Glyph of Ferocity" });
  });

  it("keeps an id nobody has named as an id, never a guess", () => {
    const grade = gradeEnchant({ ...base, wowClass: "Mage", wornEnchantId: 9999, ownWishlists: [] });
    expect(grade).toEqual({ verdict: "unknown", worn: { id: 9999, name: "" } });
  });

  it("stays quiet about slots that take no enchant", () => {
    expect(gradeEnchant({ ...base, slotIndex: 1, enchantable: false, wornEnchantId: undefined, ownWishlists: [] }))
      .toEqual({ verdict: "not-enchantable" });
  });
});
