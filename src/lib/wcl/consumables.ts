/**
 * TBC consumable knowledge for Warcraft Logs imports.
 *
 * Two detection paths, chosen for robustness:
 *  - Auras at pull (from combatantinfo events) are classified BY NAME — the
 *    log embeds aura names, so curated spell-id lists can't go stale here.
 *  - In-fight usage (potions/drums/runes/healthstones) comes from cast events
 *    filtered server-side BY SPELL ID — names aren't filterable, so this list
 *    is curated. A wrong/missing id under-counts one consumable type; it never
 *    breaks an import.
 */

export type AuraCategory = "flask" | "battleElixir" | "guardianElixir" | "food" | "potion";

export interface ClassifiedAura {
  category: AuraCategory;
  label: string;
}

/** Battle elixirs raiders actually run in TBC (incl. vanilla holdouts). */
const BATTLE_ELIXIRS = new Set(
  [
    "Elixir of Major Agility",
    "Elixir of Major Strength",
    "Elixir of the Mongoose",
    "Elixir of Major Shadow Power",
    "Elixir of Major Firepower",
    "Elixir of Major Frost Power",
    "Greater Arcane Elixir",
    "Adept's Elixir",
    "Elixir of Demonslaying",
    "Elixir of Mastery",
    "Fel Strength Elixir",
    "Elixir of Healing Power",
    "Elixir of the Giants",
    "Winterfall Firewater",
  ].map((n) => n.toLowerCase()),
);

const GUARDIAN_ELIXIRS = new Set(
  [
    "Elixir of Major Defense",
    "Elixir of Major Fortitude",
    "Elixir of Major Mageblood",
    "Elixir of Draenic Wisdom",
    "Earthen Elixir",
    "Elixir of Ironskin",
    "Elixir of Superior Defense",
    "Elixir of Fortitude",
    "Gift of Arthas",
    "Major Troll's Blood Elixir",
  ].map((n) => n.toLowerCase()),
);

/**
 * Classify one aura present at pull. Returns undefined for everything that
 * isn't a consumable we track (class buffs, world buffs, procs, …).
 */
export function classifyAura(name: string): ClassifiedAura | undefined {
  const lower = name.trim().toLowerCase();
  if (lower.includes("flask of")) return { category: "flask", label: name.trim() };
  if (lower.startsWith("well fed")) return { category: "food", label: "Well Fed" };
  if (BATTLE_ELIXIRS.has(lower)) return { category: "battleElixir", label: name.trim() };
  if (GUARDIAN_ELIXIRS.has(lower)) return { category: "guardianElixir", label: name.trim() };
  // A combat-potion aura at pull means the player pre-potted before the pull.
  if (lower.endsWith("potion") || COMBAT_POTION_NAMES.has(lower)) {
    return { category: "potion", label: name.trim() };
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
