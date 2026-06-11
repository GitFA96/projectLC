/**
 * Static TBC domain facts: classes, roles, slots, phases, zones, colors, stat metadata.
 * This file has no imports — zod schemas and types derive from these const arrays.
 */

export const WOW_CLASSES = [
  "Druid",
  "Hunter",
  "Mage",
  "Paladin",
  "Priest",
  "Rogue",
  "Shaman",
  "Warlock",
  "Warrior",
] as const;
export type WowClass = (typeof WOW_CLASSES)[number];

export const ROLES = ["Tank", "Healer", "Melee DPS", "Ranged DPS"] as const;
export type Role = (typeof ROLES)[number];

export const QUALITIES = [
  "poor",
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
] as const;
export type Quality = (typeof QUALITIES)[number];

export const SLOT_IDS = [
  "head",
  "neck",
  "shoulder",
  "back",
  "chest",
  "wrist",
  "hands",
  "waist",
  "legs",
  "feet",
  "ring1",
  "ring2",
  "trinket1",
  "trinket2",
  "mainHand",
  "offHand",
  "ranged",
] as const;
export type SlotId = (typeof SLOT_IDS)[number];

/** Slots that come in interchangeable pairs — compared as multisets, never by index. */
export const SLOT_FAMILIES: Partial<Record<SlotId, "ring" | "trinket">> = {
  ring1: "ring",
  ring2: "ring",
  trinket1: "trinket",
  trinket2: "trinket",
};

export const SLOT_META: { id: SlotId; label: string }[] = [
  { id: "head", label: "Head" },
  { id: "neck", label: "Neck" },
  { id: "shoulder", label: "Shoulder" },
  { id: "back", label: "Back" },
  { id: "chest", label: "Chest" },
  { id: "wrist", label: "Wrist" },
  { id: "hands", label: "Hands" },
  { id: "waist", label: "Waist" },
  { id: "legs", label: "Legs" },
  { id: "feet", label: "Feet" },
  { id: "ring1", label: "Ring 1" },
  { id: "ring2", label: "Ring 2" },
  { id: "trinket1", label: "Trinket 1" },
  { id: "trinket2", label: "Trinket 2" },
  { id: "mainHand", label: "Main Hand" },
  { id: "offHand", label: "Off Hand" },
  { id: "ranged", label: "Ranged" },
];

export const SLOT_LABELS: Record<SlotId, string> = Object.fromEntries(
  SLOT_META.map((s) => [s.id, s.label]),
) as Record<SlotId, string>;

export const PHASE_IDS = [1, 2, 3, 4, 5] as const;
export type Phase = (typeof PHASE_IDS)[number];

export const PHASES: { phase: Phase; name: string; short: string; zones: string[] }[] = [
  { phase: 1, name: "Phase 1", short: "P1", zones: ["Karazhan", "Gruul's Lair", "Magtheridon's Lair"] },
  { phase: 2, name: "Phase 2", short: "P2", zones: ["Serpentshrine Cavern", "Tempest Keep"] },
  { phase: 3, name: "Phase 3", short: "P3", zones: ["Mount Hyjal", "Black Temple"] },
  { phase: 4, name: "Phase 4", short: "P4", zones: ["Zul'Aman"] },
  { phase: 5, name: "Phase 5", short: "P5", zones: ["Sunwell Plateau"] },
];

export const ZONE_TO_PHASE: Record<string, Phase> = Object.fromEntries(
  PHASES.flatMap((p) => p.zones.map((z) => [z, p.phase])),
);

/** Awards are attributed to a phase by raid zone, not by date (guilds farm old zones). */
export function phaseForZones(zones: string[]): Phase | undefined {
  const phases = zones
    .map((z) => ZONE_TO_PHASE[z])
    .filter((p): p is Phase => p !== undefined);
  if (phases.length === 0) return undefined;
  return Math.max(...phases) as Phase;
}

/** Canonical class colors — use as backgrounds/accents (chips, bars). */
export const CLASS_COLORS: Record<WowClass, string> = {
  Druid: "#FF7C0A",
  Hunter: "#AAD372",
  Mage: "#3FC7EB",
  Paladin: "#F48CBA",
  Priest: "#FFFFFF",
  Rogue: "#FFF468",
  Shaman: "#0070DD",
  Warlock: "#8788EE",
  Warrior: "#C69B6D",
};

/** Darkened class colors that stay legible as text on a white/light background. */
export const CLASS_TEXT_COLORS: Record<WowClass, string> = {
  Druid: "#B35900",
  Hunter: "#4C7A1A",
  Mage: "#0E7490",
  Paladin: "#C2417E",
  Priest: "#64748B",
  Rogue: "#8A7A00",
  Shaman: "#0061BF",
  Warlock: "#5B5BD6",
  Warrior: "#8A6A3F",
};

/** Canonical quality colors — for icon rings and accents. */
export const QUALITY_COLORS: Record<Quality, string> = {
  poor: "#9D9D9D",
  common: "#FFFFFF",
  uncommon: "#1EFF00",
  rare: "#0070DD",
  epic: "#A335EE",
  legendary: "#FF8000",
};

/** Quality colors tuned for text on a light background. */
export const QUALITY_TEXT_COLORS: Record<Quality, string> = {
  poor: "#757575",
  common: "#3F3F46",
  uncommon: "#0F8A00",
  rare: "#0070DD",
  epic: "#A335EE",
  legendary: "#C26000",
};

/**
 * Display metadata for known stat keys (label + order). StatBlocks are open maps:
 * unknown keys are still displayed, prettified, after the known ones.
 */
export const STAT_META: { key: string; label: string }[] = [
  { key: "health", label: "Health" },
  { key: "mana", label: "Mana" },
  { key: "armor", label: "Armor" },
  { key: "stamina", label: "Stamina" },
  { key: "strength", label: "Strength" },
  { key: "agility", label: "Agility" },
  { key: "intellect", label: "Intellect" },
  { key: "spirit", label: "Spirit" },
  { key: "attackPower", label: "Attack Power" },
  { key: "rangedAttackPower", label: "Ranged Attack Power" },
  { key: "hit", label: "Hit %" },
  { key: "hitRating", label: "Hit Rating" },
  { key: "crit", label: "Crit %" },
  { key: "critRating", label: "Crit Rating" },
  { key: "hasteRating", label: "Haste Rating" },
  { key: "expertise", label: "Expertise" },
  { key: "expertiseRating", label: "Expertise Rating" },
  { key: "armorPenetration", label: "Armor Penetration" },
  { key: "armorPen", label: "Armor Penetration" },
  { key: "rangedHit", label: "Ranged Hit %" },
  { key: "rangedHitRating", label: "Ranged Hit Rating" },
  { key: "rangedCrit", label: "Ranged Crit %" },
  { key: "rangedCritRating", label: "Ranged Crit Rating" },
  { key: "mainHandSpeed", label: "Main Hand Speed" },
  { key: "offHandSpeed", label: "Off Hand Speed" },
  { key: "rangedSpeed", label: "Ranged Speed" },
  { key: "spellDamage", label: "Spell Damage" },
  { key: "shadowDamage", label: "Shadow Damage" },
  { key: "fireDamage", label: "Fire Damage" },
  { key: "frostDamage", label: "Frost Damage" },
  { key: "arcaneDamage", label: "Arcane Damage" },
  { key: "natureDamage", label: "Nature Damage" },
  { key: "healing", label: "Bonus Healing" },
  { key: "spellHit", label: "Spell Hit %" },
  { key: "spellHitRating", label: "Spell Hit Rating" },
  { key: "spellCrit", label: "Spell Crit %" },
  { key: "spellCritRating", label: "Spell Crit Rating" },
  { key: "spellHasteRating", label: "Spell Haste Rating" },
  { key: "mp5", label: "MP5" },
  { key: "defense", label: "Defense" },
  { key: "defenseRating", label: "Defense Rating" },
  { key: "dodge", label: "Dodge %" },
  { key: "dodgeRating", label: "Dodge Rating" },
  { key: "parry", label: "Parry %" },
  { key: "parryRating", label: "Parry Rating" },
  { key: "block", label: "Block %" },
  { key: "blockRating", label: "Block Rating" },
  { key: "blockValue", label: "Block Value" },
  { key: "blockValueBonus", label: "Block Value Bonus" },
  { key: "resilience", label: "Resilience" },
];

export const STAT_ORDER: Map<string, number> = new Map(
  STAT_META.map((s, i) => [s.key, i]),
);
export const STAT_LABELS: Map<string, string> = new Map(
  STAT_META.map((s) => [s.key, s.label]),
);

export const FACTIONS = ["Horde", "Alliance"] as const;
export type Faction = (typeof FACTIONS)[number];

export const CHARACTER_STATUSES = ["main", "alt", "inactive"] as const;
export type CharacterStatus = (typeof CHARACTER_STATUSES)[number];

export const GEAR_SET_KINDS = ["current", "wishlist"] as const;
export const GEAR_SET_SOURCES = ["sixtyupgrades", "seed", "manual"] as const;
export const SESSION_SOURCES = ["gargul", "manual", "seed"] as const;

/** Wowhead CDN icon URL (icons render in the user's browser; UI falls back gracefully). */
export function iconUrl(icon: string, size: "small" | "medium" | "large" = "medium"): string {
  return `https://wow.zamimg.com/images/wow/icons/${size}/${icon}.jpg`;
}

export function wowheadItemUrl(itemId: number): string {
  return `https://www.wowhead.com/tbc/item=${itemId}`;
}
