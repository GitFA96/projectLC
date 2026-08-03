import { describe, expect, it } from "vitest";
import { buildEnchantReference, gradeEnchant, type EnchantReference } from "@/lib/analysis/enchants";
import type { GearSet, Role, SlotId, WowClass } from "@/lib/types";

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
const OFF_HAND = 16;
/** war* are Melee DPS warriors, wtank* tanking ones, mage* casters. */
const ownerOf = (id: string): { class: WowClass; role: Role } | undefined => {
  if (id.startsWith("wtank")) return { class: "Warrior", role: "Tank" };
  if (id.startsWith("war")) return { class: "Warrior", role: "Melee DPS" };
  if (id.startsWith("mage")) return { class: "Mage", role: "Ranged DPS" };
  return undefined;
};

describe("buildEnchantReference", () => {
  const sets = [
    set({ characterId: "war1", kind: "wishlist", slots: [{ slot: "head", enchant: { id: 3003, itemId: 29192, name: "Glyph of Ferocity" } }] }),
    set({ characterId: "war2", kind: "wishlist", slots: [{ slot: "head", enchant: { id: 3003, name: "Glyph of Ferocity" } }] }),
    set({ characterId: "war3", kind: "wishlist", slots: [{ slot: "head", enchant: { id: 2999, name: "Glyph of the Defender" } }] }),
    // Current gear names an enchant but never votes on what's best.
    set({ characterId: "mage1", kind: "current", slots: [{ slot: "head", enchant: { id: 3096, name: "Glyph of Power" } }] }),
    // An enchant with no id can't be matched against a log — dictionary only skips it.
    set({ characterId: "war1", kind: "wishlist", slots: [{ slot: "back", enchant: { name: "Greater Agility" } }] }),
    // Same class, different job: tanks want something else in the same slot.
    set({ characterId: "wtank1", kind: "wishlist", slots: [{ slot: "head", enchant: { id: 2999, name: "Glyph of the Defender" } }] }),
  ];
  const reference = buildEnchantReference(sets, ownerOf);

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
    const withResolved = buildEnchantReference(sets, ownerOf, {
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
    const withResolved = buildEnchantReference(sets, ownerOf, { 3003: "+34 Attack Power" });
    expect(withResolved.names.find((e) => e.id === 3003)).toEqual({
      id: 3003,
      name: "Glyph of Ferocity",
      itemId: 29192,
    });
  });

  it("ignores a blank resolved name rather than showing an empty enchant", () => {
    const withResolved = buildEnchantReference(sets, ownerOf, { 4242: "   " });
    expect(withResolved.names.find((e) => e.id === 4242)).toBeUndefined();
  });

  it("takes the most-picked wishlist enchant per class, role and slot", () => {
    const dps = reference.consensus.find(
      (c) => c.wowClass === "Warrior" && c.role === "Melee DPS" && c.slot === "head",
    )!;
    expect(dps).toMatchObject({ enchantId: 3003, name: "Glyph of Ferocity", sets: 2, totalSets: 3 });
    // Current gear doesn't vote, so the mage's slot has no consensus at all.
    expect(reference.consensus.some((c) => c.wowClass === "Mage")).toBe(false);
  });

  it("keeps a class's roles apart so one spec's pick can't speak for another", () => {
    // The three dps warriors must not make Glyph of Ferocity the tank standard.
    const tank = reference.consensus.find(
      (c) => c.wowClass === "Warrior" && c.role === "Tank" && c.slot === "head",
    )!;
    expect(tank).toMatchObject({ enchantId: 2999, sets: 1, totalSets: 1 });
  });
});

describe("gradeEnchant", () => {
  const reference: EnchantReference = {
    names: [
      { id: 3003, name: "Glyph of Ferocity", itemId: 29192 },
      { id: 2999, name: "Glyph of the Defender" },
    ],
    consensus: [
      { wowClass: "Warrior", role: "Melee DPS", slot: "head", enchantId: 3003, name: "Glyph of Ferocity", sets: 2, totalSets: 3 },
      // What an Enhancement shaman's list puts on a weapon, in the off-hand.
      { wowClass: "Shaman", role: "Melee DPS", slot: "offHand", enchantId: 2673, name: "Mongoose", sets: 3, totalSets: 3 },
    ],
  };
  const ownList = [
    set({ characterId: "war1", kind: "wishlist", slots: [{ slot: "head", enchant: { id: 2999, name: "Glyph of the Defender" } }] }),
  ];
  const base = {
    slotIndex: HEAD,
    enchantable: true,
    wowClass: "Warrior" as WowClass,
    role: "Melee DPS" as Role,
    reference,
  };

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

  it("names an off-hand enchant without holding it to a weapon's standard", () => {
    // A Restoration shaman with a shield. The log can't tell a shield from a
    // stat stick from a weapon, and the class's Enhancement lists put Mongoose
    // in that slot — so the shield enchant is reported and nothing is claimed.
    const grade = gradeEnchant({
      ...base,
      slotIndex: OFF_HAND,
      enchantable: false,
      wowClass: "Shaman",
      role: "Healer",
      wornEnchantId: 2673,
      ownWishlists: [],
    });
    expect(grade.verdict).toBe("unknown");
    expect(grade.wanted).toBeUndefined();
  });

  it("does not offer a melee spec's off-hand pick to their own melee twin either", () => {
    // Even the Enhancement shaman the consensus came from: the off-hand is not
    // a slot the app judges, whoever is holding it.
    const grade = gradeEnchant({
      ...base,
      slotIndex: OFF_HAND,
      enchantable: false,
      wowClass: "Shaman",
      role: "Melee DPS",
      wornEnchantId: 3003,
      ownWishlists: [],
    });
    expect(grade).toMatchObject({ verdict: "unknown" });
    expect(grade.wanted).toBeUndefined();
  });

  it("will not let one role's standard judge another", () => {
    // A Restoration shaman's head, against a Melee DPS consensus: no match.
    const grade = gradeEnchant({ ...base, role: "Healer", wornEnchantId: 3003, ownWishlists: [] });
    expect(grade.verdict).toBe("unknown");
  });
});
