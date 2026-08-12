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

/**
 * The three talent trees of each TBC class — the palette a board is
 * planned from.
 *
 * Structural, not editorial: these are the trees the game ships, not a judgement
 * about how anyone plays them. What a spec is *for* is deliberately absent —
 * Feral is a tank or a cat and Protection Paladin is a tank or nothing, and this
 * app does not get to decide which. The planner lets an officer rename a slot
 * ("Feral" filed as "OT Bear") precisely so that call stays theirs.
 *
 * The guild's own logs are layered on top of this at read time, so the spec
 * names Warcraft Logs actually emits for this guild — Warden, Justicar, Feral
 * Tank — appear alongside without being invented here.
 */
export const CLASS_SPECS: Record<WowClass, string[]> = {
  Druid: ["Balance", "Feral", "Restoration"],
  Hunter: ["Beast Mastery", "Marksmanship", "Survival"],
  Mage: ["Arcane", "Fire", "Frost"],
  Paladin: ["Holy", "Protection", "Retribution"],
  Priest: ["Discipline", "Holy", "Shadow"],
  Rogue: ["Assassination", "Combat", "Subtlety"],
  Shaman: ["Elemental", "Enhancement", "Restoration"],
  Warlock: ["Affliction", "Demonology", "Destruction"],
  Warrior: ["Arms", "Fury", "Protection"],
};

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

/**
 * Every slot an item could sit in interchangeably with this one, the slot
 * itself first. Rings and trinkets pair up — which finger a ring is on is
 * arbitrary, so a picker for "ring 1" has to offer what was worn on either.
 */
export function slotFamilyMembers(slot: SlotId): SlotId[] {
  const family = SLOT_FAMILIES[slot];
  if (!family) return [slot];
  return [slot, ...SLOT_IDS.filter((s) => s !== slot && SLOT_FAMILIES[s] === family)];
}

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

/**
 * TBC raid instances in progression order, with their bosses.
 *
 * Used to group boss lists by the raid they belong to. A report's own zone
 * can't do this: Warcraft Logs routinely labels a multi-zone night with one
 * zone (which is why the import page offers a raid-label override), so the
 * boss itself has to say where it comes from.
 *
 * Names are matched loosely (case and punctuation insensitive) because
 * apostrophes vary between sources — `Kael'thas` and `Kael’thas` are the same
 * boss. Anything unmatched falls into an "Other" group rather than vanishing,
 * so a wrong or missing entry here is visible and harmless.
 *
 * SSC, Tempest Keep and Gruul's Lair are verified against this guild's own
 * imported encounter names. The rest follow the standard TBC rosters so older
 * and future content lands correctly without another change here.
 */
export const TBC_RAIDS: { name: string; short: string; bosses: string[] }[] = [
  {
    name: "Karazhan",
    short: "Kara",
    bosses: [
      "Attumen the Huntsman",
      "Moroes",
      "Maiden of Virtue",
      "Opera Hall",
      "The Curator",
      "Shade of Aran",
      "Terestian Illhoof",
      "Netherspite",
      "Chess Event",
      "Prince Malchezaar",
      "Nightbane",
    ],
  },
  { name: "Gruul's Lair", short: "Gruul", bosses: ["High King Maulgar", "Gruul the Dragonkiller"] },
  { name: "Magtheridon's Lair", short: "Mag", bosses: ["Magtheridon"] },
  {
    name: "Serpentshrine Cavern",
    short: "SSC",
    bosses: [
      "Hydross the Unstable",
      "The Lurker Below",
      "Leotheras the Blind",
      "Fathom-Lord Karathress",
      "Morogrim Tidewalker",
      "Lady Vashj",
    ],
  },
  {
    name: "Tempest Keep",
    short: "TK",
    bosses: ["Al'ar", "Void Reaver", "High Astromancer Solarian", "Kael'thas Sunstrider"],
  },
  {
    name: "Black Temple",
    short: "BT",
    bosses: [
      "High Warlord Naj'entus",
      "Supremus",
      "Shade of Akama",
      "Teron Gorefiend",
      "Gurtogg Bloodboil",
      "Reliquary of Souls",
      "Mother Shahraz",
      "The Illidari Council",
      "Illidan Stormrage",
    ],
  },
  {
    name: "Mount Hyjal",
    short: "MH",
    bosses: ["Rage Winterchill", "Anetheron", "Kaz'rogal", "Azgalor", "Archimonde"],
  },
  {
    name: "Zul'Aman",
    short: "ZA",
    bosses: ["Nalorakk", "Akil'zon", "Jan'alai", "Halazzi", "Hex Lord Malacrass", "Zul'jin"],
  },
  {
    name: "Sunwell Plateau",
    short: "SWP",
    bosses: ["Kalecgos", "Brutallus", "Felmyst", "The Eredar Twins", "M'uru", "Kil'jaeden"],
  },
];

/** Loose key so apostrophe and casing differences between sources still match. */
function bossKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const RAID_BY_BOSS = new Map<string, (typeof TBC_RAIDS)[number]>(
  TBC_RAIDS.flatMap((raid) => raid.bosses.map((boss) => [bossKey(boss), raid] as const)),
);

/** The raid a boss belongs to, or undefined for anything not in the table. */
export function raidOfBoss(encounterName: string): (typeof TBC_RAIDS)[number] | undefined {
  return RAID_BY_BOSS.get(bossKey(encounterName));
}

/** Progression rank for sorting; unknown bosses sort last. */
export function raidOrder(encounterName: string): number {
  const raid = raidOfBoss(encounterName);
  return raid ? TBC_RAIDS.indexOf(raid) : TBC_RAIDS.length;
}

/** Kill order within its raid; unknown bosses keep a stable position. */
export function bossOrder(encounterName: string): number {
  const raid = raidOfBoss(encounterName);
  if (!raid) return 0;
  return raid.bosses.findIndex((b) => bossKey(b) === bossKey(encounterName));
}

const ZONE_TO_PHASE: Record<string, Phase> = Object.fromEntries(
  PHASES.flatMap((p) => p.zones.map((z) => [z, p.phase])),
);

/**
 * Lowest item level that only a phase's own raid tier reaches.
 *
 * The item cache learns a phase only for the handful of items seeded with one
 * — a log's gear snapshot carries an item level and nothing else — so this is
 * how "is this current-tier gear" gets answered for everything else. Each
 * floor sits ABOVE the previous tier's ceiling (SSC/TK top out at 141, Black
 * Temple tier starts at 146), which makes the test deliberately conservative:
 * a piece from the previous tier can never trip it, and the early, lower-level
 * drops of the current one simply aren't counted. Under-claiming beats telling
 * a raider to re-gem gear they're about to replace.
 */
export const PHASE_ITEM_LEVEL_FLOOR: Record<Phase, number> = {
  1: 115,
  2: 133,
  3: 146,
  4: 151,
  5: 154,
};

/** Awards are attributed to a phase by raid zone, not by date (guilds farm old zones). */
export function phaseForZones(zones: string[]): Phase | undefined {
  const phases = zones
    .map((z) => ZONE_TO_PHASE[z])
    .filter((p): p is Phase => p !== undefined);
  if (phases.length === 0) return undefined;
  return Math.max(...phases) as Phase;
}

/** Canonical class colors — use as backgrounds/accents (chips, bars). */
const CLASS_COLORS: Record<WowClass, string> = {
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

/**
 * Class colors that stay legible as text on the current theme's page.
 *
 * These are CSS variables, not hex, because they are applied through inline
 * `style` — a `dark:` class cannot reach an inline style, so the variable is
 * what carries the theme. `src/app/globals.css` holds both sets of values:
 * darkened for the light page, canonical for the dark one.
 */
export const CLASS_TEXT_COLORS: Record<WowClass, string> = {
  Druid: "var(--class-text-druid)",
  Hunter: "var(--class-text-hunter)",
  Mage: "var(--class-text-mage)",
  Paladin: "var(--class-text-paladin)",
  Priest: "var(--class-text-priest)",
  Rogue: "var(--class-text-rogue)",
  Shaman: "var(--class-text-shaman)",
  Warlock: "var(--class-text-warlock)",
  Warrior: "var(--class-text-warrior)",
};

/**
 * Class colors as a faint background wash, for panels and chips.
 *
 * `CLASS_COLORS` for eight of the nine. **Priest is the exception**: its
 * canonical color is pure white, which washes out to the page it sits on — a
 * blank panel in a row of tinted ones reads as a rendering fault rather than as
 * "priest". On the light theme it borrows slate; on the dark one white washes
 * correctly and the variable gives it back. The canonical color is left alone;
 * it is right everywhere it's used at full strength.
 */
export const CLASS_TINT_COLORS: Record<WowClass, string> = {
  ...CLASS_COLORS,
  Priest: "var(--class-tint-priest)",
};

/**
 * `CLASS_TINT_COLORS` as a CSS color, or undefined for a class we don't know.
 *
 * The alpha is a variable rather than a literal because a wash that reads as
 * faint on white disappears entirely on near-black — each theme sets its own.
 * Pass `alpha` only to override that deliberately.
 */
export const classTint = (
  wowClass: string | undefined,
  alpha = "var(--class-tint-alpha)",
): string | undefined =>
  wowClass && wowClass in CLASS_TINT_COLORS
    ? `color-mix(in srgb, ${CLASS_TINT_COLORS[wowClass as WowClass]} calc(${alpha} * 100%), transparent)`
    : undefined;

/** Canonical quality colors — for icon rings and accents. */
export const QUALITY_COLORS: Record<Quality, string> = {
  poor: "#9D9D9D",
  common: "#FFFFFF",
  uncommon: "#1EFF00",
  rare: "#0070DD",
  epic: "#A335EE",
  legendary: "#FF8000",
};

/**
 * Quality colors tuned for text on the current theme's background — variables
 * for the same reason as `CLASS_TEXT_COLORS`.
 */
export const QUALITY_TEXT_COLORS: Record<Quality, string> = {
  poor: "var(--quality-text-poor)",
  common: "var(--quality-text-common)",
  uncommon: "var(--quality-text-uncommon)",
  rare: "var(--quality-text-rare)",
  epic: "var(--quality-text-epic)",
  legendary: "var(--quality-text-legendary)",
};

/**
 * Display metadata for known stat keys (label + order). StatBlocks are open maps:
 * unknown keys are still displayed, prettified, after the known ones.
 */
const STAT_META: { key: string; label: string }[] = [
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

/**
 * What a character is to the guild.
 *
 * `trial` is a real raider on a trial: they turn up, they are logged, and they
 * take loot — so they are a roster member everywhere a member is counted. It is
 * NOT the raid planner's "trial", which is a name on a board and has no
 * character row at all (see docs/change-chains.md §3); the two never meet.
 */
export const CHARACTER_STATUSES = ["main", "trial", "alt", "inactive", "pug"] as const;
export type CharacterStatus = (typeof CHARACTER_STATUSES)[number];

/**
 * Form/display labels for character statuses.
 *
 * A noun and then what it means, because these are read in a dropdown where the
 * label is the whole explanation — the previous spelling ("main — guild
 * roster") read as a sentence fragment mid-list and an officer filing this
 * feedback said so.
 */
export const STATUS_LABELS: Record<CharacterStatus, string> = {
  main: "Main",
  trial: "Trial",
  alt: "Alt",
  inactive: "Inactive",
  pug: "Pug",
};

/** The one line of help each status needs, for a form that has room for it. */
export const STATUS_HELP: Record<CharacterStatus, string> = {
  main: "On the raiding roster, and their loot is judged on this character.",
  trial: "Raiding with the guild while the council decides. Counts everywhere a member counts.",
  alt: "A second character of somebody already on the roster.",
  inactive: "Left the roster. Kept so their loot history still explains itself.",
  pug: "A known player from outside the guild.",
};

export const GEAR_SET_KINDS = ["current", "wishlist"] as const;
export const GEAR_SET_SOURCES = ["sixtyupgrades", "seed", "manual"] as const;

/** Where an officer-pinned current-gear slot was picked from. */
export const GEAR_OVERRIDE_SOURCES = ["logs", "manual"] as const;
export type GearOverrideSource = (typeof GEAR_OVERRIDE_SOURCES)[number];

/**
 * Which of a raider's two kits a pinned gear slot belongs to.
 *
 * A raider who steps in as an off-spec keeps a second set of gear for it, and
 * the two answer different questions: "main" is what loot is judged on, "off"
 * is a record of what they can field when the guild needs that role. Only
 * meaningful for characters with an off-spec recorded.
 */
export const GEAR_SPECS = ["main", "off"] as const;
export type GearSpec = (typeof GEAR_SPECS)[number];
export const SESSION_SOURCES = ["gargul", "manual", "seed"] as const;

/** Wowhead CDN icon URL (icons render in the user's browser; UI falls back gracefully). */
export function iconUrl(icon: string, size: "small" | "medium" | "large" = "medium"): string {
  return `https://wow.zamimg.com/images/wow/icons/${size}/${icon}.jpg`;
}

export function wowheadItemUrl(itemId: number): string {
  return `https://www.wowhead.com/tbc/item=${itemId}`;
}
