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

/** The two elixir slots. A flask fills both; one elixir fills one of them. */
export type ElixirSlot = Extract<AuraCategory, "battleElixir" | "guardianElixir">;

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
  /*
   * Unstable Flasks — the Ogri'la / Blade's Edge apexis flasks. Bought with
   * Apexis Shards rather than gold, which is why they don't show up in a
   * shopping list. Curated by id so they can never fall through to the generic
   * "…flask of…" guess.
   *
   * **They do NOT behave like any other flask in the log, and that cost a bug.**
   * Warcraft Logs leaves them out of the pull's `combatantinfo` aura snapshot,
   * which is the only place every other flask is read from — so a raider who
   * drank one before the pull showed a red cross on the preparation column all
   * night. Probed on a real report: Unstable Flask of the Soldier applied at
   * 15m, Maulgar pulled at 20m, and the raider's snapshot at that pull lists
   * eight auras with no flask among them.
   *
   * They arrive as `applybuff`/`removebuff` events instead, which is why these
   * ids also ride the Buffs fetch and why `normalize` stamps them onto a pull
   * from an interval rather than from the snapshot. See FLASK_BUFF_IDS below.
   */
  /*
   * Vanilla flasks this guild still runs, curated by id because the log sends
   * only the BARE buff name and nothing matched it.
   *
   * Probed, not remembered: an import of this guild's own report listed
   * `17628 Supreme Power ×11` and `17629 Chromatic Resistance ×1` in the
   * unrecognized-aura dump. `classifyAura` matches "Flask of Supreme Power" via
   * the generic "…flask of…" pattern, but the log never says that — so eleven
   * pulls of a real flask graded as no flask at all, on the preparation column
   * that feeds the loot score.
   *
   * The **label carries "Flask of"** deliberately. `defaultPriceFor` prices any
   * name containing "flask" at the flask default and everything it doesn't
   * recognise at zero, so labelling these with the bare buff name would have
   * counted them as free. The ids and buff names are what the log stated; the
   * label is the flask those buffs come from.
   */
  { label: "Flask of Supreme Power", category: "flask", ids: [17628], buffNames: ["Supreme Power"] },
  {
    label: "Flask of Chromatic Resistance",
    category: "flask",
    ids: [17629],
    buffNames: ["Chromatic Resistance"],
  },
  { label: "Unstable Flask of the Beast", category: "flask", ids: [40572] },
  { label: "Unstable Flask of the Bandit", category: "flask", ids: [40567] },
  { label: "Unstable Flask of the Elder", category: "flask", ids: [40568] },
  { label: "Unstable Flask of the Physician", category: "flask", ids: [40573] },
  { label: "Unstable Flask of the Soldier", category: "flask", ids: [40575] },
  { label: "Unstable Flask of the Sorcerer", category: "flask", ids: [40576] },
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
  /*
   * WCL serves 33721 as "Spellpower Elixir", which is the aura's name and not
   * an item — Wowhead's TBC data has item 28103 "Adept's Elixir" casting
   * exactly that spell, with the same "+24 spell damage/healing, +24 spell
   * crit, 1 hour, Battle Elixir" text. Probed, not remembered.
   *
   * Both labels used to sit in this list as separate entries, so one elixir was
   * filed under two names: the buff name carried 699 of this guild's pulls and
   * the item name matched nothing at all. That split its gold, its leaderboard
   * row, and left it with no item id to draw an icon from.
   */
  { label: "Adept's Elixir", category: "battleElixir", ids: [33721], buffNames: ["Spellpower Elixir"] },
  { label: "Onslaught Elixir", category: "battleElixir", buffNames: ["Onslaught"] },
  { label: "Elixir of the Mongoose", category: "battleElixir" },
  { label: "Greater Arcane Elixir", category: "battleElixir" },
  { label: "Elixir of the Giants", category: "battleElixir" },
  { label: "Elixir of Greater Agility", category: "battleElixir", buffNames: ["Greater Agility"] },
  { label: "Winterfall Firewater", category: "battleElixir" },
  /*
   * Three ids Warcraft Logs serves under **retail** names.
   *
   * WCL resolved these TBC spell ids against a modern spell database, so the
   * log says "Greater Versatility" and "Flask of Mighty Versatility" —
   * versatility being a stat that does not exist in TBC. Wowhead's TBC data is
   * the authority for this game version:
   *
   *   28509  "Greater Mana Regeneration"    (WCL: "Greater Versatility")
   *   28514  "Empowerment", -30 resistances for 1h
   *   28519  "Flask of Mighty Restoration"  (WCL: "Flask of Mighty Versatility")
   *
   * Curated by **id**, keeping the retail name as a `buffNames` alias so reports
   * already imported under it still match. The lesson generalises: an ability id
   * from a log is a fact, an ability *name* from a log is not.
   *
   * 28509 was labelled with its spell name for a while, on the reasoning that
   * the log names the spell and never the item, so an accurate buff name beat a
   * guessed item name. That premise no longer holds: Wowhead's TBC page for
   * item 22840, Elixir of Major Mageblood, lists 28509 as its use-effect, and
   * the tooltips agree word for word ("Regenerate 16 mana per 5 sec for 1 hour,
   * Guardian Elixir"). It is the item, and the entry that carried its item name
   * lower down was matching nothing.
   */
  { label: "Elixir of Major Mageblood", category: "guardianElixir", ids: [28509], buffNames: ["Major Mageblood", "Greater Mana Regeneration", "Greater Versatility"] },
  { label: "Empowerment", category: "guardianElixir", ids: [28514], buffNames: ["Empowerment"] },
  { label: "Flask of Mighty Restoration", category: "flask", ids: [28519], buffNames: ["Flask of Mighty Restoration", "Flask of Mighty Versatility"] },
  /* Guardian elixirs */
  { label: "Elixir of Major Defense", category: "guardianElixir", ids: [28502], buffNames: ["Major Defense", "Major Armor"] },
  { label: "Elixir of Major Fortitude", category: "guardianElixir", ids: [39625], buffNames: ["Major Fortitude"] },
  { label: "Elixir of Draenic Wisdom", category: "guardianElixir", ids: [39627], buffNames: ["Draenic Wisdom"] },
  { label: "Earthen Elixir", category: "guardianElixir", ids: [39626] },
  { label: "Elixir of Ironskin", category: "guardianElixir", ids: [39628], buffNames: ["Ironskin"] },
  { label: "Elixir of Superior Defense", category: "guardianElixir", buffNames: ["Greater Armor"] },
  { label: "Elixir of Fortitude", category: "guardianElixir", buffNames: ["Health II"] },
  { label: "Gift of Arthas", category: "guardianElixir" },
  { label: "Major Troll's Blood Elixir", category: "guardianElixir", buffNames: ["Regeneration"] },
  /*
   * WCL serves 24363 as "Mageblood Elixir"; the spell's own name is the generic
   * "Mana Regeneration", and item 20007 "Mageblood Potion" is what casts it
   * ("Regenerate 12 mana per 5 sec for 1 hour, Guardian Elixir"). The vanilla
   * 12 mp5 version, distinct from the 16 mp5 TBC elixir above — same family,
   * different item, and the guild has raiders still drinking both.
   *
   * `buffNames` keeps the logged name so reports imported before this still
   * match; "Mana Regeneration" is deliberately NOT an alias, being far too
   * generic a phrase to match auras on.
   */
  { label: "Mageblood Potion", category: "guardianElixir", ids: [24363], buffNames: ["Mageblood Elixir"] },
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
  // Skullfish Soup (item 33825) applies "Enlightened" rather than the generic
  // Well Fed, so it was landing in the off-slot bucket and its eaters were
  // reading as unfed — 84 pulls on this guild's data, every one of them.
  // Officers, 2026-08-10; source https://www.wowhead.com/tbc/item=33825.
  { label: "Enlightened", category: "food", ids: [43722] },
];

const AURA_BY_ID = new Map<number, AuraDef>();
const AURA_BY_NAME = new Map<string, AuraDef>();
for (const def of AURA_DEFS) {
  for (const id of def.ids ?? []) AURA_BY_ID.set(id, def);
  AURA_BY_NAME.set(def.label.toLowerCase(), def);
  for (const name of def.buffNames ?? []) AURA_BY_NAME.set(name.toLowerCase(), def);
}

/**
 * Which elixir slot a stored label occupies.
 *
 * Ingest keeps the canonical label but throws the category away — `elixirs` is
 * one flat list — so this reads the slot back out of the same curated list that
 * assigned it. One source of truth, and nothing asserted from memory.
 *
 * `undefined` means the label is not one we curate: an elixir the import
 * matched by name pattern alone. We do not know which slot it fills, and
 * guessing would put an unearned "fully covered" on a raider's night.
 */
export function elixirCategoryOf(label: string): ElixirSlot | undefined {
  const def = AURA_BY_NAME.get(label.trim().toLowerCase());
  if (def === undefined) return undefined;
  return def.category === "battleElixir" || def.category === "guardianElixir"
    ? def.category
    : undefined;
}

/**
 * Foods whose buff is named after the dish rather than "Well Fed".
 *
 * Ingest turns a food aura into a boolean and keeps no label, so a food added
 * here doesn't re-grade rows imported before it — those still carry the name
 * in `extras`, which is where `isFoodLabel` finds it. Same read-time recovery
 * as `elixirCategoryOf`, and for the same reason: the alternative is telling a
 * raider they turned up unfed until somebody re-imports a season of logs.
 */
const NAMED_FOOD_LABELS: readonly string[] = AURA_DEFS.filter(
  (d) => d.category === "food",
).map((d) => d.label);

const FOOD_LABELS = new Set(NAMED_FOOD_LABELS.map((l) => l.toLowerCase()));

/** True when this label is a food the curated list knows, under any spelling. */
export function isFoodLabel(label: string): boolean {
  const lower = label.trim().toLowerCase();
  return FOOD_LABELS.has(lower) || lower.startsWith("well fed");
}

/**
 * Flasks that have to be read from the buff stream rather than the pull.
 *
 * Every other flask is visible in the pull's `combatantinfo` snapshot, which is
 * where preparation is graded from. These are not — Warcraft Logs omits them —
 * so they are fetched as buff events and turned into intervals instead. Keyed
 * by the aura id, mapping to the label the row records.
 *
 * Derived from the curated defs rather than listed again: a flask curated with
 * an id is one we can follow through the buff stream, and one curated by name
 * alone is one whose snapshot already works. Adding an id here changes what the
 * *fetch* asks Warcraft Logs for, which makes it a §1 change — reports already
 * imported have to be re-imported before it can find anything.
 */
export const FLASK_BUFF_IDS: ReadonlyMap<number, string> = new Map(
  AURA_DEFS.filter((d) => d.category === "flask").flatMap((d) =>
    (d.ids ?? []).map((id) => [id, d.label] as const),
  ),
);

/** Every elixir the curated list can place in a slot. */
export const CURATED_ELIXIR_LABELS: readonly string[] = AURA_DEFS.filter(
  (d) => d.category === "battleElixir" || d.category === "guardianElixir",
).map((d) => d.label);

/**
 * Every scroll rank, by the spell id the buff and the cast both carry.
 *
 * **All five ranks, not just rank V.** A scroll's aura is named after the bare
 * stat — "Agility", never "Scroll of Agility IV" — so without an id the rank is
 * simply gone, and every rank collapsed into one rankless label. That is not a
 * cosmetic loss: rank V costs a multiple of rank I, and this guild really runs
 * the lower ranks. Across five reports: 202 uses of Agility IV, 121 of Strength
 * IV, plus ranks II and III, every one of them counted and priced as the
 * cheapest scroll in the game.
 *
 * The ids are derived, not remembered: each is the use-effect Wowhead lists on
 * the scroll's own TBC item page (Scroll of Agility IV = item 10309 = spell
 * 12174). The six rank-V ids that were already curated came back identical,
 * which is the cross-check that the other twenty-four are right.
 *
 * **WCL renames some of these.** Its modern spell database calls Protection
 * "Armor" and Spirit "Versatility" — so the name is not a fallback that can
 * recover a rank, and for Spirit it cannot even recover the scroll. The id is
 * the only thing that works, which is the whole reason this table exists.
 */
const SCROLL_IDS: Record<number, string> = {
  /* Agility — items 3012, 1477, 4425, 10309, 27498 */
  8115: "Scroll of Agility",
  8116: "Scroll of Agility II",
  8117: "Scroll of Agility III",
  12174: "Scroll of Agility IV",
  33077: "Scroll of Agility V",
  /* Strength — items 954, 2289, 4426, 10310, 27503 */
  8118: "Scroll of Strength",
  8119: "Scroll of Strength II",
  8120: "Scroll of Strength III",
  12179: "Scroll of Strength IV",
  33082: "Scroll of Strength V",
  /* Spirit — items 1181, 1712, 4424, 10306, 27501 */
  8112: "Scroll of Spirit",
  8113: "Scroll of Spirit II",
  8114: "Scroll of Spirit III",
  12177: "Scroll of Spirit IV",
  33080: "Scroll of Spirit V",
  /* Stamina — items 1180, 1711, 4422, 10307, 27502 */
  8099: "Scroll of Stamina",
  8100: "Scroll of Stamina II",
  8101: "Scroll of Stamina III",
  12178: "Scroll of Stamina IV",
  33081: "Scroll of Stamina V",
  /* Intellect — items 955, 2290, 4419, 10308, 27499 */
  8096: "Scroll of Intellect",
  8097: "Scroll of Intellect II",
  8098: "Scroll of Intellect III",
  12176: "Scroll of Intellect IV",
  33078: "Scroll of Intellect V",
  /* Protection — items 3013, 1478, 4421, 10305, 27500 */
  8091: "Scroll of Protection",
  8094: "Scroll of Protection II",
  8095: "Scroll of Protection III",
  12175: "Scroll of Protection IV",
  33079: "Scroll of Protection V",
};

/** Every curated scroll label, for the price catalog to be checked against. */
export const SCROLL_LABELS: readonly string[] = Object.values(SCROLL_IDS);

/**
 * Reading a scroll casts the same spell that shows up as the aura, so these
 * ids serve twice: as a buff at the pull (the raider scrolled themselves) and
 * as a CAST, which is the only way to see a hunter scrolling their pet. A
 * self-cast is already covered by the pull aura, so only the pet-targeted ones
 * are recorded from the cast stream.
 *
 * This list is part of what the *fetch* asks Warcraft Logs for, so widening it
 * from six ids to thirty is a §1 change: **already-imported reports have to be
 * re-imported before the lower ranks can be found at all.**
 */
export const SCROLL_CAST_IDS = Object.keys(SCROLL_IDS).map(Number);

/** The scroll a cast id names, when it is one. */
export function scrollCastName(abilityId: number | undefined): string | undefined {
  return abilityId === undefined ? undefined : SCROLL_IDS[abilityId];
}

/**
 * Bare-stat buff name → a scroll with **no rank**, for rows that reach us
 * without an id.
 *
 * Every rank is curated by id above, so this is now only the last resort: a
 * pre-id import, or a log that names the aura and nothing else. It cannot
 * recover the rank, which is exactly why the id table exists — a rankless
 * label prices at the family default and reads as the cheapest scroll.
 *
 * "Versatility" is deliberately **not** listed, though WCL uses it for Spirit
 * scrolls: it is also what WCL calls Elixir of Major Mageblood's aura, and a
 * name that means two consumables can only be resolved by id.
 *
 * These labels **collide with rank I on purpose** — "Scroll of Agility" is the
 * rank I scroll's real name, and inventing a "(rank unknown)" label would put a
 * string no item is called into the officer's gold table and price editor, for
 * rows a re-import deletes anyway. An id-less scroll therefore reads as the
 * cheapest rank, which is the right way to be wrong about an unknown.
 */
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
    // "Greater Intellect" is the sibling of the two beside it that slipped
    // through: the auto-filer flagged it at 11 pulls, and probing the pull
    // snapshot settled it — held by a Mage, applied by that same Mage to
    // themself, 14 times. A class buff, so it belongs here rather than in
    // AURA_DEFS. Nothing about the name says that; the source did.
    "Arcane Brilliance", "Arcane Intellect", "Greater Intellect",
    "Battle Shout", "Commanding Shout",
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
    const scroll = SCROLL_IDS[abilityId];
    if (scroll) return { category: "scroll", label: scroll };
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

export type CastCategory =
  | "potion"
  | "drums"
  | "rune"
  | "healthstone"
  | "gem"
  | "sapper"
  /** Fed to the hunter's pet, not the hunter — tracked separately for that reason. */
  | "pet"
  | "other";

export interface TrackedCast {
  id: number;
  name: string;
  category: CastCategory;
}

/**
 * Spell IDs of in-combat consumable casts worth counting. These are the spell
 * ids the cast event reports (= the use-effect of the item).
 */
const TRACKED_CASTS: TrackedCast[] = [
  { id: 28507, name: "Haste Potion", category: "potion" },
  { id: 28508, name: "Destruction Potion", category: "potion" },
  { id: 28494, name: "Insane Strength Potion", category: "potion" },
  { id: 28506, name: "Heroic Potion", category: "potion" },
  { id: 28515, name: "Ironshield Potion", category: "potion" },
  // 28499 is "Restore Mana" — shared by the Super Mana Potion AND the Auchenai
  // Mana Potion, which are the same restore. Nothing in the cast event tells
  // them apart, so they're counted under one label rather than guessed at.
  { id: 28499, name: "Super Mana Potion", category: "potion" },
  { id: 38929, name: "Fel Mana Potion", category: "potion" },
  { id: 28495, name: "Super Healing Potion", category: "potion" },
  /*
   * The reputation / instance-vendor restores. Each has its own use-spell, so
   * unlike the Auchenai potion these are distinguishable — and being cheap or
   * free they're what a well-drilled raider actually burns through a night.
   */
  { id: 41617, name: "Cenarion Mana Salve", category: "potion" },
  { id: 41618, name: "Bottled Nethergon Energy", category: "potion" },
  { id: 41619, name: "Cenarion Healing Salve", category: "potion" },
  { id: 41620, name: "Bottled Nethergon Vapor", category: "potion" },
  { id: 17528, name: "Mighty Rage Potion", category: "potion" },
  { id: 17531, name: "Major Mana Potion", category: "potion" },
  { id: 6615, name: "Free Action Potion", category: "potion" },
  { id: 24364, name: "Living Action Potion", category: "potion" },
  { id: 28511, name: "Major Fire Protection Potion", category: "potion" },
  { id: 28512, name: "Major Frost Protection Potion", category: "potion" },
  { id: 28513, name: "Major Nature Protection Potion", category: "potion" },
  /*
   * Arcane, shadow and holy protection potions are deliberately absent.
   *
   * They were listed as 28509 / 28514 / 28510, which are not those potions:
   * Wowhead's TBC data makes 28509 a mana-regeneration buff and 28514
   * Empowerment, and 28510 is not a spell WCL knows at all. They read as
   * pattern-filled from the three real ids above — exactly what invariant 4
   * forbids — and the cost was concrete: for 541 pulls every raider running the
   * 28509 elixir was recorded as having pre-potted, under the log's retail name.
   *
   * Adding them back needs a probed id, not a plausible one.
   */
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
  /*
   * Thistle Tea — a rogue's in-fight energy burst, spent to fund an Expose
   * Armor or an extra finisher. The log calls it "Restore Energy", not the item
   * name, so nothing but the id will catch it; probed from this guild's own
   * reports (93 casts, every one from a rogue) rather than taken from memory.
   *
   * NOT category "potion", despite playing like one. Potions are audited as a
   * RATE against the two-minute cooldown (see potionRow in sim/context.ts), and
   * tea does not share that cooldown — the same rogue casts tea and a Haste
   * Potion 0.2s apart in these logs. Counting it as a potion would let a rogue
   * who drank two teas and skipped their damage potion read as "3 of 3 the
   * fight allowed". As "other" it is still counted, listed and priced.
   */
  { id: 9512, name: "Thistle Tea", category: "other" },
  /*
   * Pet food. A hunter buffing their pet is preparation the raid benefits from
   * — the pet is a chunk of their damage — but it's cast ON the pet, so it
   * would otherwise be invisible next to the hunter's own consumables.
   */
  { id: 43771, name: "Kibler's Bits", category: "pet" },
  { id: 46168, name: "Pet Biscuit", category: "pet" },
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

/**
 * The family a consumable belongs to, for grouping the gold breakdown.
 *
 * Read back out of the same curated lists that assigned it — `AURA_DEFS` for
 * anything that lands as a buff, `TRACKED_CASTS` for anything thrown or drunk
 * mid-fight — for the reason `elixirCategoryOf` does the same: one source of
 * truth, and nothing asserted from memory. Curating a new consumable groups it
 * automatically; there is no second list here to forget to update.
 *
 * Battle and guardian elixirs share one group even though the curation splits
 * them. The split exists to grade slot coverage, and an elixir the list doesn't
 * name has no known slot — `elixirCategoryOf` refuses to guess, so grouping by
 * slot would drop uncurated elixirs somewhere arbitrary. Family is enough here.
 */
export type ConsumableGroup =
  | "flask"
  | "elixir"
  | "potion"
  | "scroll"
  | "sapper"
  | "rune"
  | "drums"
  | "food"
  | "weapon"
  | "pet"
  | "conjured"
  | "other";

const CAST_BY_NAME = new Map(TRACKED_CASTS.map((c) => [c.name.trim().toLowerCase(), c]));

/** Fixed display order, so the same family sits in the same place on every raider. */
export const CONSUMABLE_GROUP_ORDER: readonly ConsumableGroup[] = [
  "flask",
  "elixir",
  "potion",
  "scroll",
  "sapper",
  "rune",
  "drums",
  "food",
  "weapon",
  "pet",
  "conjured",
  "other",
];

export const CONSUMABLE_GROUP_LABELS: Record<ConsumableGroup, string> = {
  flask: "Flasks",
  elixir: "Elixirs",
  potion: "Potions",
  scroll: "Scrolls",
  sapper: "Sappers",
  rune: "Runes",
  drums: "Drums",
  food: "Food",
  weapon: "Weapon buffs",
  pet: "Pet",
  conjured: "Conjured",
  other: "Other",
};

/**
 * Which family a consumable label belongs to.
 *
 * `Food` and `Weapon oil/stone` are matched by name because they are names this
 * codebase writes rather than reads — `raid-report.ts` synthesises both for prep
 * buffs that carry no item name of their own.
 */
export function consumableGroupOf(label: string): ConsumableGroup {
  const lower = label.trim().toLowerCase();

  const aura = AURA_BY_NAME.get(lower);
  if (aura) {
    switch (aura.category) {
      case "flask":
        return "flask";
      case "battleElixir":
      case "guardianElixir":
        return "elixir";
      case "food":
        return "food";
      case "potion":
        return "potion";
      case "scroll":
        return "scroll";
      case "misc":
        return "other";
    }
  }

  const cast = CAST_BY_NAME.get(lower);
  if (cast) {
    switch (cast.category) {
      case "potion":
        return "potion";
      case "drums":
        return "drums";
      case "rune":
        return "rune";
      case "sapper":
        return "sapper";
      case "pet":
        return "pet";
      case "healthstone":
      case "gem":
        return "conjured";
      case "other":
        return "other";
    }
  }

  // Names this codebase synthesises for prep buffs with no item name.
  if (lower === "food") return "food";
  if (lower === "weapon oil/stone") return "weapon";

  // The same family patterns `defaultPriceFor` falls back on, so a consumable
  // priced as a flask is also grouped as one.
  if (lower.includes("flask")) return "flask";
  if (SCROLL_PATTERN.test(lower)) return "scroll";
  if (lower.startsWith("elixir of") || lower.endsWith("elixir")) return "elixir";
  if (lower.endsWith("potion")) return "potion";
  if (lower.includes("sapper charge")) return "sapper";
  if (lower.startsWith("drums of")) return "drums";
  return "other";
}
