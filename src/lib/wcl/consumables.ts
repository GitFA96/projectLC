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

export type AuraCategory =
  | "flask"
  | "battleElixir"
  | "guardianElixir"
  | "food"
  | "potion"
  | "scroll"
  /** Consumables outside the standard slots (alcohol, Bogling Root, …). */
  | "misc";

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
  // Lesser caster damage elixirs: the buff is the bare stat ("Shadow Power"),
  // which the generic "…elixir" fallback never catches — curate them by name.
  { label: "Elixir of Shadow Power", category: "battleElixir", ids: [11474], buffNames: ["Shadow Power"] },
  { label: "Elixir of Firepower", category: "battleElixir", ids: [7844], buffNames: ["Fire Power"] },
  { label: "Elixir of Frost Power", category: "battleElixir", ids: [21920], buffNames: ["Frost Power"] },
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
  { label: "Elixir of Major Defense", category: "guardianElixir", ids: [28502], buffNames: ["Major Defense", "Major Armor"] },
  { label: "Elixir of Major Fortitude", category: "guardianElixir", ids: [39625], buffNames: ["Major Fortitude"] },
  { label: "Elixir of Major Mageblood", category: "guardianElixir", buffNames: ["Major Mageblood"] },
  { label: "Elixir of Draenic Wisdom", category: "guardianElixir", ids: [39627], buffNames: ["Draenic Wisdom"] },
  { label: "Earthen Elixir", category: "guardianElixir", ids: [39626] },
  { label: "Elixir of Ironskin", category: "guardianElixir", ids: [39628], buffNames: ["Ironskin"] },
  { label: "Elixir of Superior Defense", category: "guardianElixir", buffNames: ["Greater Armor"] },
  { label: "Elixir of Fortitude", category: "guardianElixir", buffNames: ["Health II"] },
  { label: "Gift of Arthas", category: "guardianElixir" },
  { label: "Major Troll's Blood Elixir", category: "guardianElixir", buffNames: ["Regeneration"] },
  /* Zanza buffs (Zandalar) — guardian-elixir slot, "one Zanza at a time". */
  { label: "Swiftness of Zanza", category: "guardianElixir", ids: [24383] },
  { label: "Spirit of Zanza", category: "guardianElixir" },
  { label: "Sheen of Zanza", category: "guardianElixir" },
  /* Off-slot consumables (stack with everything — sweaty-raider tells) */
  { label: "Bogling Root", category: "misc", ids: [5665], buffNames: ["Fury of the Bogling"] },
  { label: "Kreeg's Stout Beatdown", category: "misc", ids: [22790] },
  // Situational engineering/herb DPS consumables — off-slot, stack with elixirs.
  { label: "Flame Cap", category: "misc", ids: [28714] },
  { label: "Eye of the Night", category: "misc", ids: [31033] },
];

const AURA_BY_ID = new Map<number, AuraDef>();
const AURA_BY_NAME = new Map<string, AuraDef>();
for (const def of AURA_DEFS) {
  for (const id of def.ids ?? []) AURA_BY_ID.set(id, def);
  AURA_BY_NAME.set(def.label.toLowerCase(), def);
  for (const name of def.buffNames ?? []) AURA_BY_NAME.set(name.toLowerCase(), def);
}

/** Scroll buffs are named after the bare stat in logs ("Agility", "Armor"). */
const SCROLL_RANK_V_IDS: Record<number, string> = {
  33077: "Scroll of Agility V",
  33078: "Scroll of Intellect V",
  33079: "Scroll of Protection V",
  33080: "Scroll of Spirit V",
  33081: "Scroll of Stamina V",
  33082: "Scroll of Strength V",
};

/** Bare-stat buff name → generic scroll label (rank unknown without the id). */
const SCROLL_BUFF_NAMES: Record<string, string> = {
  agility: "Scroll of Agility",
  strength: "Scroll of Strength",
  stamina: "Scroll of Stamina",
  intellect: "Scroll of Intellect",
  spirit: "Scroll of Spirit",
  armor: "Scroll of Protection",
};

/** Some logs do keep the scroll's own name, rank included. */
const SCROLL_PATTERN = /^scroll of (agility|intellect|protection|spirit|stamina|strength)\b/i;

/**
 * Known NON-consumable auras (class buffs, stances, racials) curated from real
 * log dumps — filtered out of the curation dump so it only surfaces genuine
 * unknowns. Deliberately conservative: only auras verified non-consumable get
 * listed; anything new still lands in the dump for review.
 */
const NONCONSUMABLE_AURA_IDS = new Set<number>([
  25898, 27127, 25895, 27141, 27143, 20218, 2048, 24932, 27142, 24907, 27149,
  2458, 27125, 27168, 469, 25780, 9634, 25433, 27144, 20217, 6346, 71, 1038,
]);

const NONCONSUMABLE_AURA_NAMES = new Set<string>(
  [
    "Arcane Brilliance", "Arcane Intellect", "Battle Shout", "Commanding Shout",
    "Power Word: Fortitude", "Divine Spirit", "Shadow Protection", "Fear Ward",
    "Inner Fire", "Mark of the Wild", "Gift of the Wild", "Thorns",
    "Leader of the Pack", "Righteous Fury", "Mage Armor", "Ice Armor",
    "Frost Armor", "Fel Armor", "Demon Armor", "Demon Skin", "Blood Pact",
    "Water Shield", "Lightning Shield", "Earth Shield", "Unending Breath",
    "Detect Invisibility", "Amplify Magic", "Dampen Magic", "Vanguard",
    "Trueshot Aura", "Heroic Presence", "Inspiring Presence", "Hand of Salvation",
  ].map((n) => n.toLowerCase()),
);

/** Buff families that are never consumables (auras, stances, forms, blessings…). */
const NONCONSUMABLE_AURA_PATTERNS: RegExp[] = [
  /^(greater )?blessing of /,
  /^hand of /,
  /^prayer of /,
  /^seal of /,
  /^aspect of the /,
  / aura$/,
  / form$/,
  / stance$/,
  / presence$/,
];

/**
 * True for auras known NOT to be consumables — used only to de-noise the
 * curation dump. Runs AFTER classifyAura, so it can never eat a tracked item.
 */
export function isNonConsumableAura(name: string, abilityId?: number): boolean {
  if (abilityId !== undefined && NONCONSUMABLE_AURA_IDS.has(abilityId)) return true;
  const lower = name.trim().toLowerCase();
  if (NONCONSUMABLE_AURA_NAMES.has(lower)) return true;
  return NONCONSUMABLE_AURA_PATTERNS.some((p) => p.test(lower));
}

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
    const scrollV = SCROLL_RANK_V_IDS[abilityId];
    if (scrollV) return { category: "scroll", label: scrollV };
    if (PREPOT_AURA_IDS.has(abilityId)) return { category: "potion", label: trimmed };
  }
  const byName = AURA_BY_NAME.get(lower);
  if (byName) return { category: byName.category, label: byName.label };
  const scrollByStat = SCROLL_BUFF_NAMES[lower];
  if (scrollByStat) return { category: "scroll", label: scrollByStat };

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

export type CastCategory = "potion" | "drums" | "rune" | "healthstone" | "gem" | "sapper" | "other";

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
  // Mana gems all cast "Replenish Mana" — the spell rank tells the gem apart.
  { id: 27103, name: "Mana Emerald", category: "gem" },
  { id: 10058, name: "Mana Ruby", category: "gem" },
  { id: 10057, name: "Mana Citrine", category: "gem" },
  { id: 10052, name: "Mana Jade", category: "gem" },
  { id: 5405, name: "Mana Agate", category: "gem" },
  { id: 28726, name: "Nightmare Seed", category: "other" },
  // Engineering explosives — the item on-use spell WCL records on the throw.
  // The casts query ALSO matches these by name (see SAPPER_CAST_NAMES), so a
  // wrong/aliased rank id still counts; the classifyCast name fallback buckets it.
  { id: 30486, name: "Super Sapper Charge", category: "sapper" },
  { id: 12760, name: "Goblin Sapper Charge", category: "sapper" },
  { id: 13241, name: "Goblin Sapper Charge", category: "sapper" },
];

export const TRACKED_CAST_IDS = TRACKED_CASTS.map((c) => c.id);
/**
 * Sapper names for the casts filter: engineering explosives have several
 * near-identical spell ranks, so matching the throw by NAME as well as id keeps
 * them counted no matter which rank the log carries.
 */
export const SAPPER_CAST_NAMES = [
  ...new Set(TRACKED_CASTS.filter((c) => c.category === "sapper").map((c) => c.name)),
];
const CASTS_BY_ID = new Map(TRACKED_CASTS.map((c) => [c.id, c]));
const COMBAT_POTION_NAMES = new Set(
  TRACKED_CASTS.filter((c) => c.category === "potion").map((c) => c.name.toLowerCase()),
);
/** Potion buffs share their use-spell id — at pull they signal a pre-pot. */
const PREPOT_AURA_IDS = new Set(
  TRACKED_CASTS.filter((c) => c.category === "potion").map((c) => c.id),
);

/** Classify a cast event by spell id, with the inline ability name as fallback. */
export function classifyCast(abilityId: number | undefined, abilityName?: string): TrackedCast | undefined {
  if (abilityId !== undefined) {
    // Curated names win: mana gems all cast "Replenish Mana" — the id alone
    // tells a Mana Emerald from a Mana Ruby.
    const known = CASTS_BY_ID.get(abilityId);
    if (known) return known;
  }
  if (!abilityName) return undefined;
  const lower = abilityName.trim().toLowerCase();
  if (lower.endsWith("potion")) return { id: abilityId ?? 0, name: abilityName.trim(), category: "potion" };
  if (lower.startsWith("drums of")) return { id: abilityId ?? 0, name: abilityName.trim(), category: "drums" };
  if (lower.includes("sapper charge")) return { id: abilityId ?? 0, name: abilityName.trim(), category: "sapper" };
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
