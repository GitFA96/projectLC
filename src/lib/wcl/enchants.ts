/**
 * Gear-slot knowledge for the WCL gear panel.
 *
 * WCL combatant-info gear arrays are ordered by equipment slot; enchants come
 * as bare ENCHANTMENT ids, which no Wowhead page or API accepts. Names are
 * curated only where we're certain; everything else is left as its id, with
 * the item's hover tooltip (rendered by Wowhead with the enchant applied) as
 * the ground truth an officer can read off and paste back here.
 */

/** Display label per gear-array index (shirt 3 and tabard 18 omitted). */
export const GEAR_SLOT_LABELS: { index: number; label: string }[] = [
  { index: 0, label: "Head" },
  { index: 1, label: "Neck" },
  { index: 2, label: "Shoulder" },
  { index: 4, label: "Chest" },
  { index: 5, label: "Waist" },
  { index: 6, label: "Legs" },
  { index: 7, label: "Feet" },
  { index: 8, label: "Wrist" },
  { index: 9, label: "Hands" },
  { index: 10, label: "Ring 1" },
  { index: 11, label: "Ring 2" },
  { index: 12, label: "Trinket 1" },
  { index: 13, label: "Trinket 2" },
  { index: 14, label: "Back" },
  { index: 15, label: "Main hand" },
  { index: 16, label: "Off hand" },
  { index: 17, label: "Ranged" },
];

/** Enchantment ids we're confident naming; everything else shows the linked id. */
export const ENCHANT_NAMES: Record<number, string> = {
  2673: "Mongoose",
  2674: "Spellsurge",
  2675: "Battlemaster",
  3225: "Executioner",
  3273: "Deathfrost",
};

/**
 * Wowhead has no page for a SpellItemEnchantment id — /tbc/enchantment=3273
 * is a 404 — so a known enchant links to a search for its name instead. The
 * ids themselves only resolve inside an item tooltip, which the gear panel
 * feeds via data-wowhead="item=…&ench=…".
 */
export function wowheadEnchantSearchUrl(name: string): string {
  return `https://www.wowhead.com/tbc/search?q=${encodeURIComponent(name)}`;
}

export function wowheadItemUrl(id: number): string {
  return `https://www.wowhead.com/tbc/item=${id}`;
}

/**
 * Phase 2 reference picks per slot (names only — the human-readable cheat
 * sheet the panel shows next to what's actually worn).
 */
export const P2_ENCHANT_GUIDE: { slot: string; picks: string }[] = [
  { slot: "Weapon", picks: "Mongoose (melee/tank) · Major Spellpower / Soulfrost / Sunfire (caster) · Major Healing (healer) · plus a temp buff every pull: oil / stone / poison / shaman imbue" },
  { slot: "Head", picks: "Glyph of Power / Ferocity / Renewal (Sha'tar etc. revered arcanums); Glyph of the Defender for tanks" },
  { slot: "Shoulder", picks: "Greater Inscription of the Orb / Blade / Vengeance / Discipline (Aldor–Scryer exalted)" },
  { slot: "Chest", picks: "Exceptional Stats (+6 all); Major Resilience situational" },
  { slot: "Legs", picks: "Nethercobra Leg Armor (physical) · Runic Spellthread (caster/healer) · Nethercleft Leg Armor (tank)" },
  { slot: "Feet", picks: "Boar's Speed / Cat's Swiftness (run speed matters on SSC/TK bosses) · Fortitude for tanks" },
  { slot: "Wrist", picks: "Spellpower / Superior Healing / Brawn / Fortitude" },
  { slot: "Hands", picks: "Major Spellpower / Major Healing / Major Strength / Major Agility / Blasting" },
  { slot: "Back", picks: "Greater Agility / Subtlety (threat) · Major Resistance situational" },
  { slot: "Rings", picks: "Enchanter-only (Spellpower / Healing Power / Striking) — not expected of everyone" },
];
