import type { Character, Role, WowClass } from "@/lib/types";

/**
 * The vocabulary a loot priority sheet is written in.
 *
 * A council's sheet says "Warlock > Shadow > MS > OS", not "class=Warlock".
 * Those tags overlap on purpose: an arcane mage is BOTH `Mage` and `Arcane`, a
 * feral druid is `Feral Tank` or `Feral DPS` depending on what they're actually
 * doing in the raid. So a tag is a predicate over a character, not a label
 * stamped on one — a character can satisfy several, and the first tier of the
 * chain they satisfy is the tier they sit in.
 *
 * `MS` and `OS` are the catch-alls every sheet ends with. Everyone contending
 * for an item has it wishlisted, so they're all main-spec here and `MS` matches
 * anyone; `OS` exists so a chain that names it still parses and displays.
 */

export const SPEC_TAGS = [
  "Feral Tank",
  "Feral DPS",
  "Balance",
  "Resto Druid",
  "Hunter",
  "Mage",
  "Arcane",
  "Holy Paladin",
  "Prot Paladin",
  "Retribution",
  "Shadow",
  "Healing Priest",
  "Rogue",
  "Resto Shaman",
  "Enhancement",
  "Elemental",
  "Warlock",
  "Prot Warrior",
  "DPS Warrior",
  "MS",
  "OS",
] as const;
export type SpecTag = (typeof SPEC_TAGS)[number];

/**
 * Wording a sheet uses for a tag it already has.
 *
 * A council writes what it says out loud, and the same spec gets several names
 * across a document — the Phase 3 sheet says "Healing Priest" everywhere except
 * one line that says "Holy Priest". Holy and Discipline take the same loot, so
 * they're one tag with several spellings rather than two tags that happen to
 * agree; only Shadow, the damage spec, is genuinely separate.
 *
 * Aliases never introduce a new predicate — they resolve to a canonical tag,
 * and the sheet keeps displaying its own words.
 */
const TAG_ALIASES: Record<string, SpecTag> = {
  "holy priest": "Healing Priest",
  "disc priest": "Healing Priest",
  "disc": "Healing Priest",
  "discipline": "Healing Priest",
  "discipline priest": "Healing Priest",
  "priest healer": "Healing Priest",
  "shadow priest": "Shadow",
  "ret paladin": "Retribution",
  "retribution paladin": "Retribution",
  ret: "Retribution",
  "prot pala": "Prot Paladin",
  "holy pala": "Holy Paladin",
  enhance: "Enhancement",
  ele: "Elemental",
  resto: "Resto Shaman",
  "arcane mage": "Arcane",
  "fire mage": "Mage",
  "frost mage": "Mage",
  "bm hunter": "Hunter",
  "mm hunter": "Hunter",
  "surv hunter": "Hunter",
  "survival hunter": "Hunter",
  "demo lock": "Warlock",
  "affli lock": "Warlock",
  "destro lock": "Warlock",
  "fury warrior": "DPS Warrior",
  "arms warrior": "DPS Warrior",
  "prot warrior": "Prot Warrior",
  "warrior dps": "DPS Warrior",
  "feral druid": "Feral DPS",
  "boomkin": "Balance",
  moonkin: "Balance",
};

/** Tags are compared on trimmed, case-folded text — sheets are typed by hand. */
const fold = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

const CANONICAL = new Map<string, SpecTag>([
  ...SPEC_TAGS.map((t) => [fold(t), t] as const),
  ...Object.entries(TAG_ALIASES).map(([alias, tag]) => [fold(alias), tag] as const),
]);

/** The tag a sheet's wording means, or undefined when nothing does. */
export function canonicalSpecTag(value: string): SpecTag | undefined {
  return CANONICAL.get(fold(value));
}

export function isSpecTag(value: string): boolean {
  return canonicalSpecTag(value) !== undefined;
}

/** Spec strings are free text ("Fury", "Prot", "Restoration") — match loosely. */
const has = (spec: string, ...needles: string[]) => {
  const s = spec.toLowerCase();
  return needles.some((n) => s.includes(n));
};

type Subject = { class: WowClass; spec: string; role: Role };

const MATCHERS: Record<SpecTag, (c: Subject) => boolean> = {
  // Druid feral splits by what they actually do, which the roster role knows
  // and the spec string usually doesn't.
  "Feral Tank": (c) => c.class === "Druid" && has(c.spec, "feral", "bear", "guardian") && c.role === "Tank",
  "Feral DPS": (c) => c.class === "Druid" && has(c.spec, "feral", "cat") && c.role !== "Tank",
  Balance: (c) => c.class === "Druid" && has(c.spec, "balance", "moonkin", "boomkin"),
  "Resto Druid": (c) => c.class === "Druid" && has(c.spec, "resto"),
  Hunter: (c) => c.class === "Hunter",
  Mage: (c) => c.class === "Mage",
  Arcane: (c) => c.class === "Mage" && has(c.spec, "arcane"),
  "Holy Paladin": (c) => c.class === "Paladin" && has(c.spec, "holy"),
  "Prot Paladin": (c) => c.class === "Paladin" && has(c.spec, "prot"),
  Retribution: (c) => c.class === "Paladin" && has(c.spec, "ret"),
  // Priests split on what they do, not on which healing tree they picked:
  // Holy and Discipline are one loot pool, Shadow is the damage spec.
  //
  // The roster role only breaks the tie when the spec string names no tree at
  // all. A roster can carry a spec and a role that disagree — a "Holy" priest
  // filed under Ranged DPS — and the spec is the more specific statement, so
  // it wins. Guessing from the role there would put the same raider in two
  // pools and let chain order decide which, silently.
  Shadow: (c) =>
    c.class === "Priest" &&
    (has(c.spec, "shadow") || (c.role === "Ranged DPS" && !has(c.spec, "holy", "disc"))),
  "Healing Priest": (c) =>
    c.class === "Priest" &&
    (has(c.spec, "holy", "disc") || (c.role === "Healer" && !has(c.spec, "shadow"))),
  Rogue: (c) => c.class === "Rogue",
  "Resto Shaman": (c) => c.class === "Shaman" && has(c.spec, "resto"),
  Enhancement: (c) => c.class === "Shaman" && has(c.spec, "enh"),
  Elemental: (c) => c.class === "Shaman" && has(c.spec, "ele"),
  Warlock: (c) => c.class === "Warlock",
  "Prot Warrior": (c) => c.class === "Warrior" && has(c.spec, "prot"),
  // Everything that isn't protection — fury, arms, and whatever they call it.
  "DPS Warrior": (c) => c.class === "Warrior" && !has(c.spec, "prot"),
  // Contenders wishlisted the item, so they're main-spec by construction.
  MS: () => true,
  OS: () => true,
};

export function matchesSpecTag(character: Character, tag: string): boolean {
  const canonical = canonicalSpecTag(tag);
  return canonical ? MATCHERS[canonical](character) : false;
}

/**
 * The most specific tags a character satisfies, for showing what they'd match
 * on a sheet. `MS`/`OS` are left out — they're true of everyone and say nothing.
 */
export function specTagsOf(character: Character): SpecTag[] {
  return SPEC_TAGS.filter((t) => t !== "MS" && t !== "OS" && MATCHERS[t](character));
}
