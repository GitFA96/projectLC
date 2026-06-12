/**
 * TBC consumable knowledge for Warcraft Logs imports.
 *
 * Detection paths:
 *  - Auras at pull (combatantinfo events) carry the BUFF spell's id + name —
 *    and TBC buff names often differ from item names (Elixir of Major Agility
 *    applies "Major Agility", spell 28497). Classification therefore matches
 *    by curated spell id first, then by name against both the buff-style and
 *    item-style spellings, then by generic patterns (flask of…, scroll of…).
 *  - In-fight usage (potions/drums/runes/healthstones) comes from cast events
 *    filtered server-side BY SPELL ID — a wrong/missing id under-counts one
 *    consumable type; it never breaks an import.
 */

export type AuraCategory = "flask" | "battleElixir" | "guardianElixir" | "food" | "potion" | "scroll";

export interface ClassifiedAura {
  category: AuraCategory;
  label: string;
}

interface AuraDef {
  /** Canonical item name — what the UI displays. */
  label: string;
  category: AuraCategory;
  /** Known buff spell ids (best effort — names are the safety net). */
  ids?: number[];
  /** Buff-name variants seen in logs, when they differ from the label. */
  buffNames?: string[];
}

/**
 * Elixirs raiders actually run in TBC (incl. vanilla holdouts). Buff names
 * verified pattern: TBC elixirs usually drop the "Elixir of" prefix
 * ("Major Agility"), vanilla ones usually keep the full item name.
 */
const AURA_DEFS: AuraDef[] = [
  /* Battle elixirs */
  { label: "Elixir of Major Agility", category: "battleElixir", ids: [28497], buffNames: ["Major Agility"] },
  { label: "Elixir of Major Strength", category: "battleElixir", buffNames: ["Major Strength"] },
  { label: "Elixir of Major Shadow Power", category: "battleElixir", buffNames: ["Major Shadow Power"] },
  { label: "Elixir of Major Firepower", category: "battleElixir", buffNames: ["Major Firepower"] },
  { label: "Elixir of Major Frost Power", category: "battleElixir", buffNames: ["Major Frost Power"] },
  { label: "Elixir of Healing Power", category: "battleElixir", buffNames: ["Healing Power"] },
  { label: "Elixir of Mastery", category: "battleElixir", buffNames: ["Mastery"] },
  { label: "Fel Strength Elixir", category: "battleElixir", buffNames: ["Fel Strength"] },
  { label: "Elixir of Demonslaying", category: "battleElixir" },
  { label: "Adept's Elixir", category: "battleElixir" },
  { label: "Onslaught Elixir", category: "battleElixir", buffNames: ["Onslaught"] },
  { label: "Elixir of the Mongoose", category: "battleElixir" },
  { label: "Greater Arcane Elixir", category: "battleElixir" },
  { label: "Elixir of the Giants", category: "battleElixir" },
  { label: "Elixir of Greater Agility", category: "battleElixir", buffNames: ["Greater Agility"] },
  { label: "Winterfall Firewater", category: "battleElixir" },
  /* Guardian elixirs */
  { label: "Elixir of Major Defense", category: "guardianElixir", buffNames: ["Major Defense"] },
  { label: "Elixir of Major Fortitude", category: "guardianElixir", ids: [39625], buffNames: ["Major Fortitude"] },
  { label: "Elixir of Major Mageblood", category: "guardianElixir", buffNames: ["Major Mageblood"] },
  { label: "Elixir of Draenic Wisdom", category: "guardianElixir", ids: [39627], buffNames: ["Draenic Wisdom"] },
  { label: "Earthen Elixir", category: "guardianElixir", ids: [39626] },
  { label: "Elixir of Ironskin", category: "guardianElixir", ids: [39628], buffNames: ["Ironskin"] },
  { label: "Elixir of Superior Defense", category: "guardianElixir", buffNames: ["Greater Armor"] },
  { label: "Elixir of Fortitude", category: "guardianElixir", buffNames: ["Health II"] },
  { label: "Gift of Arthas", category: "guardianElixir" },
  { label: "Major Troll's Blood Elixir", category: "guardianElixir", buffNames: ["Regeneration"] },
];

const AURA_BY_ID = new Map<number, AuraDef>();
const AURA_BY_NAME = new Map<string, AuraDef>();
for (const def of AURA_DEFS) {
  for (const id of def.ids ?? []) AURA_BY_ID.set(id, def);
  AURA_BY_NAME.set(def.label.toLowerCase(), def);
  for (const name of def.buffNames ?? []) AURA_BY_NAME.set(name.toLowerCase(), def);
}

/** Scroll buffs keep the scroll's name (rank included): "Scroll of Agility V". */
const SCROLL_PATTERN = /^scroll of (agility|intellect|protection|spirit|stamina|strength)\b/i;

/**
 * Classify one aura present at pull. Returns undefined for everything that
 * isn't a consumable we track (class buffs, world buffs, procs, …).
 */
export function classifyAura(name: string, abilityId?: number): ClassifiedAura | undefined {
  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();

  if (abilityId !== undefined) {
    const byId = AURA_BY_ID.get(abilityId);
    if (byId) return { category: byId.category, label: byId.label };
    if (PREPOT_AURA_IDS.has(abilityId)) return { category: "potion", label: trimmed };
  }
  const byName = AURA_BY_NAME.get(lower);
  if (byName) return { category: byName.category, label: byName.label };

  if (lower.includes("flask of")) return { category: "flask", label: trimmed };
  if (lower.startsWith("well fed")) return { category: "food", label: "Well Fed" };
  if (SCROLL_PATTERN.test(lower)) return { category: "scroll", label: trimmed };
  // Unrecognized elixirs still count as elixirs (battle/guardian split doesn't
  // matter for coverage — a flask occupies both slots either way).
  if (lower.startsWith("elixir of") || lower.endsWith("elixir")) {
    return { category: "battleElixir", label: trimmed };
  }
  // A combat-potion aura at pull means the player pre-potted before the pull.
  if (lower.endsWith("potion") || COMBAT_POTION_NAMES.has(lower)) {
    return { category: "potion", label: trimmed };
  }
  return undefined;
}

export type CastCategory = "potion" | "drums" | "rune" | "healthstone";

export interface TrackedCast {
  id: number;
  name: string;
  category: CastCategory;
}

/**
 * Spell IDs of in-combat consumable casts worth counting. These are the spell
 * ids the cast event reports (= the use-effect of the item).
 */
export const TRACKED_CASTS: TrackedCast[] = [
  { id: 28507, name: "Haste Potion", category: "potion" },
  { id: 28508, name: "Destruction Potion", category: "potion" },
  { id: 28494, name: "Insane Strength Potion", category: "potion" },
  { id: 28506, name: "Heroic Potion", category: "potion" },
  { id: 28515, name: "Ironshield Potion", category: "potion" },
  { id: 28499, name: "Super Mana Potion", category: "potion" },
  { id: 38929, name: "Fel Mana Potion", category: "potion" },
  { id: 28495, name: "Super Healing Potion", category: "potion" },
  { id: 17528, name: "Mighty Rage Potion", category: "potion" },
  { id: 17531, name: "Major Mana Potion", category: "potion" },
  { id: 6615, name: "Free Action Potion", category: "potion" },
  { id: 24364, name: "Living Action Potion", category: "potion" },
  { id: 28511, name: "Major Fire Protection Potion", category: "potion" },
  { id: 28512, name: "Major Frost Protection Potion", category: "potion" },
  { id: 28513, name: "Major Nature Protection Potion", category: "potion" },
  { id: 28509, name: "Major Arcane Protection Potion", category: "potion" },
  { id: 28514, name: "Major Shadow Protection Potion", category: "potion" },
  { id: 28510, name: "Major Holy Protection Potion", category: "potion" },
  { id: 35476, name: "Drums of Battle", category: "drums" },
  { id: 35475, name: "Drums of War", category: "drums" },
  { id: 35478, name: "Drums of Restoration", category: "drums" },
  { id: 35477, name: "Drums of Speed", category: "drums" },
  { id: 35474, name: "Drums of Panic", category: "drums" },
  { id: 27869, name: "Dark Rune", category: "rune" },
  { id: 16666, name: "Demonic Rune", category: "rune" },
  { id: 27875, name: "Master Healthstone", category: "healthstone" },
  { id: 27876, name: "Master Healthstone", category: "healthstone" },
  { id: 27877, name: "Master Healthstone", category: "healthstone" },
];

export const TRACKED_CAST_IDS = TRACKED_CASTS.map((c) => c.id);
const CASTS_BY_ID = new Map(TRACKED_CASTS.map((c) => [c.id, c]));
const COMBAT_POTION_NAMES = new Set(
  TRACKED_CASTS.filter((c) => c.category === "potion").map((c) => c.name.toLowerCase()),
);
/** Potion buffs share their use-spell id — at pull they signal a pre-pot. */
const PREPOT_AURA_IDS = new Set(
  TRACKED_CASTS.filter((c) => c.category === "potion").map((c) => c.id),
);

/** Classify a cast event by spell id, with the inline ability name as label fallback. */
export function classifyCast(abilityId: number | undefined, abilityName?: string): TrackedCast | undefined {
  if (abilityId !== undefined) {
    const known = CASTS_BY_ID.get(abilityId);
    if (known) return abilityName ? { ...known, name: abilityName } : known;
  }
  if (!abilityName) return undefined;
  const lower = abilityName.trim().toLowerCase();
  if (lower.endsWith("potion")) return { id: abilityId ?? 0, name: abilityName.trim(), category: "potion" };
  if (lower.startsWith("drums of")) return { id: abilityId ?? 0, name: abilityName.trim(), category: "drums" };
  return undefined;
}

/**
 * WCL combatantinfo gear arrays are ordered by equipment slot. These are the
 * slots a TBC raider is expected to keep permanently enchanted (rings are
 * enchanter-only, ranged/offhand vary — deliberately excluded).
 */
export const ENCHANTABLE_GEAR_SLOTS: { index: number; label: string }[] = [
  { index: 0, label: "Head" },
  { index: 2, label: "Shoulder" },
  { index: 4, label: "Chest" },
  { index: 6, label: "Legs" },
  { index: 7, label: "Feet" },
  { index: 8, label: "Wrist" },
  { index: 9, label: "Hands" },
  { index: 14, label: "Back" },
  { index: 15, label: "Main hand" },
];

/** Gear indexes carrying temporary weapon buffs (oils, stones, poisons, imbues). */
export const WEAPON_GEAR_SLOTS = [15, 16];
