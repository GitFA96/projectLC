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
  "Beast Mastery",
  "Marksmanship",
  "Survival",
  "Mage",
  "Arcane",
  "Fire",
  "Frost",
  "Holy Paladin",
  "Prot Paladin",
  "Retribution",
  "Shadow",
  "Healing Priest",
  "Rogue",
  "Combat",
  "Assassination",
  "Subtlety",
  "Resto Shaman",
  "Enhancement",
  "Elemental",
  "Warlock",
  "Affliction",
  "Demonology",
  "Destruction",
  "Prot Warrior",
  "DPS Warrior",
  "Arms",
  "Fury",
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
  "fire mage": "Fire",
  "frost mage": "Frost",
  "bm": "Beast Mastery",
  "bm hunter": "Beast Mastery",
  "beast mastery hunter": "Beast Mastery",
  mm: "Marksmanship",
  "mm hunter": "Marksmanship",
  marksman: "Marksmanship",
  "marksman hunter": "Marksmanship",
  surv: "Survival",
  "surv hunter": "Survival",
  "survival hunter": "Survival",
  "combat rogue": "Combat",
  assassination: "Assassination",
  "assassination rogue": "Assassination",
  mutilate: "Assassination",
  sub: "Subtlety",
  "sub rogue": "Subtlety",
  "subtlety rogue": "Subtlety",
  affli: "Affliction",
  "affli lock": "Affliction",
  affliction: "Affliction",
  "affliction lock": "Affliction",
  demo: "Demonology",
  "demo lock": "Demonology",
  "demonology lock": "Demonology",
  destro: "Destruction",
  "destro lock": "Destruction",
  "destruction lock": "Destruction",
  "fury warrior": "Fury",
  "arms warrior": "Arms",
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
  // Class-level tags match ANY spec of that class, and stay in the vocabulary
  // deliberately: the guild's sheets are written with them ("Hunter > MS > OS"),
  // and a raider whose roster spec is blank must still land somewhere. The
  // per-spec tags below are the finer instrument, not a replacement.
  Hunter: (c) => c.class === "Hunter",
  "Beast Mastery": (c) => c.class === "Hunter" && has(c.spec, "beast", "bm"),
  Marksmanship: (c) => c.class === "Hunter" && has(c.spec, "marks", "mm"),
  Survival: (c) => c.class === "Hunter" && has(c.spec, "surv"),
  Mage: (c) => c.class === "Mage",
  Arcane: (c) => c.class === "Mage" && has(c.spec, "arcane"),
  Fire: (c) => c.class === "Mage" && has(c.spec, "fire"),
  Frost: (c) => c.class === "Mage" && has(c.spec, "frost"),
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
  Combat: (c) => c.class === "Rogue" && has(c.spec, "combat"),
  Assassination: (c) => c.class === "Rogue" && has(c.spec, "assass", "mutilate"),
  Subtlety: (c) => c.class === "Rogue" && has(c.spec, "sub"),
  "Resto Shaman": (c) => c.class === "Shaman" && has(c.spec, "resto"),
  Enhancement: (c) => c.class === "Shaman" && has(c.spec, "enh"),
  Elemental: (c) => c.class === "Shaman" && has(c.spec, "ele"),
  Warlock: (c) => c.class === "Warlock",
  Affliction: (c) => c.class === "Warlock" && has(c.spec, "affl"),
  Demonology: (c) => c.class === "Warlock" && has(c.spec, "demo"),
  // "destr", not "destro": the spec is spelled DestrUction, so the colloquial
  // needle matches the shorthand a roster might carry and misses the real word.
  Destruction: (c) => c.class === "Warlock" && has(c.spec, "destr"),
  "Prot Warrior": (c) => c.class === "Warrior" && has(c.spec, "prot"),
  // Everything that isn't protection — fury, arms, and whatever they call it.
  // Kept alongside Arms and Fury so "DPS Warrior" on a sheet still means
  // "Arms = Fury", and so a warrior with no spec recorded is still ranked.
  "DPS Warrior": (c) => c.class === "Warrior" && !has(c.spec, "prot"),
  Arms: (c) => c.class === "Warrior" && has(c.spec, "arms"),
  Fury: (c) => c.class === "Warrior" && has(c.spec, "fury"),
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
