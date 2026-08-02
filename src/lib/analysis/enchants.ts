import { ENCHANT_NAMES, GEAR_SLOT_IDS } from "@/lib/wcl/enchants";
import type { GearSet, SlotId, WowClass } from "@/lib/types";

/**
 * Reading a raider's enchants out of a log — by name, and against what their
 * own list asks for.
 *
 * Warcraft Logs reports a permanent enchant as a bare SpellItemEnchantment id
 * (2661, 3003…). Nothing outside the game data names those: Wowhead has no
 * page, no tooltip endpoint and no XML for an enchantment id, and the WCL API
 * doesn't carry the name either.
 *
 * The guild's own SixtyUpgrades imports do. Every set lists, per slot, the
 * enchant it wants as { id, itemId, name } — with `id` in exactly the id space
 * the logs use. So each imported set is two things at once:
 *
 *   1. a dictionary — id → name, good for EVERY raider's logs, not just the
 *      one whose set it came from;
 *   2. a standard — what that character is supposed to be wearing in that slot.
 *
 * Imported sets only cover what somebody put on a list, though — never the
 * scope on a hunter's bow or the resistance enchant worn for one fight. Those
 * come from the resolved-name cache (lib/items/enchant-names), which reads the
 * enchantment table itself. Sets still win where both know an id: a set's name
 * is the guild's own wording and carries the applying item's icon with it.
 *
 * Nothing is invented at any point: an enchant no source can name stays an id.
 */

/** One enchant the guild's lists know by name. */
export interface EnchantRef {
  id: number;
  name: string;
  /** The item that applies it (glyph, inscription, leg armor), when there is one. */
  itemId?: number;
}

/** What the guild's lists agree on for one class + slot. */
export interface EnchantConsensus {
  wowClass: WowClass;
  slot: SlotId;
  enchantId: number;
  name: string;
  /** Wishlists of that class picking this enchant, out of those covering the slot. */
  sets: number;
  totalSets: number;
}

/** Everything derived from imported sets that the gear panel needs. */
export interface EnchantReference {
  names: EnchantRef[];
  consensus: EnchantConsensus[];
}

/**
 * Build the dictionary + consensus from every imported set.
 *
 * Names come from ALL sets (current gear included — a name is a name), while
 * the consensus is wishlists only: current gear says what someone happens to
 * have on, not what they're aiming for.
 */
export function buildEnchantReference(
  gearSets: GearSet[],
  classOf: (characterId: string) => WowClass | undefined,
  /** Names resolved from the enchantment table, for ids no set lists. */
  resolvedNames: Record<number, string> = {},
): EnchantReference {
  const names = new Map<number, EnchantRef>();
  /** `${class}|${slot}` → enchant id → sets picking it. */
  const picks = new Map<string, Map<number, number>>();
  const slotTotals = new Map<string, number>();

  for (const set of gearSets) {
    const wowClass = classOf(set.characterId);
    for (const slot of set.slots) {
      const enchant = slot.enchant;
      if (!enchant?.id) continue;
      if (!names.has(enchant.id)) {
        names.set(enchant.id, { id: enchant.id, name: enchant.name, itemId: enchant.itemId });
      }
      if (set.kind !== "wishlist" || !wowClass) continue;
      const key = `${wowClass}|${slot.slot}`;
      const byEnchant = picks.get(key) ?? new Map<number, number>();
      byEnchant.set(enchant.id, (byEnchant.get(enchant.id) ?? 0) + 1);
      picks.set(key, byEnchant);
      slotTotals.set(key, (slotTotals.get(key) ?? 0) + 1);
    }
  }

  const consensus: EnchantConsensus[] = [];
  for (const [key, byEnchant] of picks) {
    const [wowClass, slot] = key.split("|") as [WowClass, SlotId];
    const [enchantId, sets] = [...byEnchant].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
    consensus.push({
      wowClass,
      slot,
      enchantId,
      name: names.get(enchantId)?.name ?? `Enchant #${enchantId}`,
      sets,
      totalSets: slotTotals.get(key) ?? sets,
    });
  }

  // Then the gaps imported sets leave, in order of how much they know:
  // resolved names come from the enchantment table itself and cover anything
  // ever worn, the hand-curated table is the last few we're confident of.
  // Imported sets win over both — they carry the applying item's icon too.
  for (const [id, name] of Object.entries(resolvedNames)) {
    const enchantId = Number(id);
    if (name.trim() && !names.has(enchantId)) names.set(enchantId, { id: enchantId, name });
  }
  for (const [id, name] of Object.entries(ENCHANT_NAMES)) {
    const enchantId = Number(id);
    if (!names.has(enchantId)) names.set(enchantId, { id: enchantId, name });
  }

  return {
    names: [...names.values()].sort((a, b) => a.id - b.id),
    consensus: consensus.sort((a, b) => a.wowClass.localeCompare(b.wowClass) || a.slot.localeCompare(b.slot)),
  };
}

/**
 * How a worn enchant measures up.
 *
 * "bis" and "off-bis" are only ever claimed against a real reference — the
 * character's own list first, the guild's other lists for their class second.
 * With no reference at all the verdict is "unknown": the app will not guess
 * that an enchant is good or bad, only report what it is.
 */
export type EnchantVerdict = "bis" | "off-bis" | "missing" | "unknown" | "not-enchantable";

export interface EnchantGrade {
  verdict: EnchantVerdict;
  /** The worn enchant, named when any imported set names it. */
  worn?: EnchantRef;
  /** What the reference asks for — set on "off-bis" and "missing". */
  wanted?: EnchantRef;
  /** Where `wanted` came from, for an honest label. */
  source?: "own-list" | "guild-lists";
  /** Guild agreement behind `wanted` when it came from other lists. */
  agreement?: { sets: number; totalSets: number };
}

export interface GradeInput {
  /** WCL gear-array index of the slot. */
  slotIndex: number;
  /** permanentEnchant from the log; undefined = nothing enchanted. */
  wornEnchantId?: number;
  /** True when this slot is expected to carry a permanent enchant. */
  enchantable: boolean;
  wowClass: WowClass;
  /** The character's own wishlist slots (active phase first). */
  ownWishlists: GearSet[];
  reference: EnchantReference;
}

export function gradeEnchant(input: GradeInput): EnchantGrade {
  const { slotIndex, wornEnchantId, enchantable, wowClass, ownWishlists, reference } = input;
  const byId = new Map(reference.names.map((e) => [e.id, e]));
  const worn = wornEnchantId !== undefined ? (byId.get(wornEnchantId) ?? { id: wornEnchantId, name: "" }) : undefined;
  const slot = GEAR_SLOT_IDS[slotIndex];

  if (!enchantable && wornEnchantId === undefined) return { verdict: "not-enchantable" };

  // Their own list wins; failing that, what their class's other lists chose.
  const own = slot
    ? ownWishlists.flatMap((set) => set.slots.filter((s) => s.slot === slot)).find((s) => s.enchant?.id)
    : undefined;
  const ownWanted = own?.enchant?.id
    ? { id: own.enchant.id, name: own.enchant.name, itemId: own.enchant.itemId }
    : undefined;
  const consensus = slot
    ? reference.consensus.find((c) => c.wowClass === wowClass && c.slot === slot)
    : undefined;
  const wanted = ownWanted ?? (consensus ? (byId.get(consensus.enchantId) ?? undefined) : undefined);
  const source = ownWanted ? ("own-list" as const) : consensus ? ("guild-lists" as const) : undefined;
  const agreement =
    !ownWanted && consensus ? { sets: consensus.sets, totalSets: consensus.totalSets } : undefined;

  if (wornEnchantId === undefined) {
    return { verdict: "missing", wanted, source, agreement };
  }
  if (wanted === undefined) return { verdict: "unknown", worn };
  if (wanted.id === wornEnchantId) return { verdict: "bis", worn: worn ?? wanted, source, agreement };
  return { verdict: "off-bis", worn, wanted, source, agreement };
}
