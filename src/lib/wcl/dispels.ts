/**
 * Curated knowledge about dispels — who can take what off whom.
 *
 * Warcraft Logs emits a `dispel` event whenever an aura is removed by another
 * spell, carrying four facts: who cast it, who it landed on, which spell did
 * the removing, and which aura came off. That is the whole question an officer
 * asks about Mount Hyjal trash and Archimonde — "who decursed, and how often" —
 * so the ingest keeps all four rather than a counter.
 *
 * **This list labels; it does not filter.** Unlike the consumable and cooldown
 * lists, the Dispels fetch asks Warcraft Logs for *every* dispel and stores the
 * spell id alongside the name the log gave it. Classification happens at read
 * time, the same inversion as `elixirCategoryOf`: curating a spell here
 * re-grades reports imported months ago with no refetch. What still needs a
 * re-import is the fetch itself — a report imported before it existed has no
 * dispel rows at all, and says so rather than reading as a quiet night.
 *
 * Every id and every `removes` list below was read off this guild's own MH+BT
 * report (cWrNZY23Rx6V4faw, 30 Aug), not remembered. `removes` records what
 * each spell was **observed** taking off, which is a weaker claim than the
 * spell's tooltip and the only one the log supports — a spell that can cleanse
 * disease but never met one reads as poison-only here, and that is honest.
 */

/**
 * What a dispel took off, as far as this guild's logs show.
 *
 * `offensive` is not a school: it is a buff stripped from an ENEMY (Purge,
 * Spellsteal, Tranquilizing Shot). Those share the event type and nothing else
 * — they answer "did somebody strip the Enrage", never "was the raid decursed".
 */
export type DispelKind = "magic" | "curse" | "poison" | "disease" | "offensive";

export interface DispelAbility {
  /** WCL spell id — the match key, because the NAME is not stable (see below). */
  id: number;
  /**
   * What this app calls it.
   *
   * Warcraft Logs resolves some TBC ids against a *modern* spell database, so
   * the name in the log is not always the name the raider pressed — 526 comes
   * back as "Cure Toxins", 2782 as "Remove Corruption". The label here is the
   * log's own spelling on purpose: an officer reading the board has the WCL
   * report open beside it, and two names for one spell is worse than one
   * anachronistic name. The id is what anything else should key on.
   */
  name: string;
  /** WCL class string ("Priest", "Mage", …). */
  wowClass: string;
  /** Schools observed coming off, in this guild's logs. Empty = none seen. */
  removes: DispelKind[];
}

export const DISPEL_ABILITIES: DispelAbility[] = [
  /*
   * Priest. Dispel Magic took off Polymorph, Soul Drain, Flame Buffet,
   * Incinerate, Shadow Word: Pain, Ice Trap, Bloodbolt, Shadow Resonance,
   * Sleep, Hammer of Justice, Earthbind and Moonfire — magic throughout.
   */
  { id: 988, name: "Dispel Magic", wowClass: "Priest", removes: ["magic"] },
  /*
   * Mass Dispel carries TWO ids and they are not interchangeable: 32375 is the
   * friendly half (83 Ice Traps, Frost Nova, Banish, Polymorph off our own
   * raiders) and 39897 is the enemy half, seen only against NPCs with the
   * event's `isBuff` set. Curating one and not the other loses half a priest's
   * work in silence.
   */
  { id: 32375, name: "Mass Dispel", wowClass: "Priest", removes: ["magic"] },
  { id: 39897, name: "Mass Dispel", wowClass: "Priest", removes: ["offensive"] },
  /* Mage — the only thing it ever removed was a curse (74 Banshee Curse, 19 Grip of the Legion). */
  { id: 475, name: "Remove Curse", wowClass: "Mage", removes: ["curse"] },
  { id: 30449, name: "Spellsteal", wowClass: "Mage", removes: ["offensive"] },
  /*
   * Paladin. The one spell in this list observed doing two jobs — Flame Buffet
   * and Polymorph (magic) alongside Wound Poison and Poisonous Throw (poison).
   * Disease is missing because none was met, not because Cleanse cannot.
   */
  { id: 4987, name: "Cleanse", wowClass: "Paladin", removes: ["magic", "poison"] },
  /*
   * Druid. 2782 is the TBC druid's cure, which WCL names "Remove Corruption";
   * only curses came off it here (Banshee Curse, Curse of the Bleakheart).
   * Abolish Poison is the periodic one: 13 casts produced 2 dispel events all
   * night, because a tick that meets no poison removes nothing and logs
   * nothing. Read the two numbers as presses and landings, never as the same
   * fact.
   */
  { id: 2782, name: "Remove Corruption", wowClass: "Druid", removes: ["curse"] },
  { id: 2893, name: "Abolish Poison", wowClass: "Druid", removes: ["poison"] },
  /*
   * Shaman. WCL names 526 "Cure Toxins"; every removal was a poison (Poisonous
   * Throw, Wound Poison, Wyvern Sting, Paralyzing Poison).
   *
   * **Poison Cleansing Totem is NOT in this list, and cannot be.** The totem
   * was dropped 51 times in the probed report and produced exactly zero dispel
   * events — no source in the whole stream is anything but a Player actor. The
   * totem's cleanses are invisible the same way its buff is (see
   * SHAMAN_TOTEM_CASTS), so the drop is the entire record, and a shaman's
   * cleansing work reads as the totem timeline plus these casts. Counting the
   * two together would be inventing the half the log withholds.
   */
  { id: 526, name: "Cure Toxins", wowClass: "Shaman", removes: ["poison"] },
  { id: 8012, name: "Purge", wowClass: "Shaman", removes: ["offensive"] },
  /* Hunter — both strip an enemy buff; Tranquilizing Shot is the Enrage answer. */
  { id: 19801, name: "Tranquilizing Shot", wowClass: "Hunter", removes: ["offensive"] },
  { id: 27019, name: "Arcane Shot", wowClass: "Hunter", removes: ["offensive"] },
  /*
   * The gnome racial. It emits a dispel event when it breaks a root off its own
   * caster, which is real and is not cleansing work for anybody else — it is
   * here so the row reads as "Escape Artist" instead of an unnamed id, with an
   * empty `removes` saying it belongs to no school.
   */
  { id: 20589, name: "Escape Artist", wowClass: "Any", removes: [] },
];

export const DISPEL_ABILITY_BY_ID = new Map<number, DispelAbility>(
  DISPEL_ABILITIES.map((d) => [d.id, d]),
);

/**
 * The curated entry for a logged dispel, or undefined for one nobody has named
 * yet. An uncurated dispel is still **counted** — it arrived with its own name
 * from the log — it just has no school and no class attached, and the raid page
 * lists it so somebody can curate it. Same bargain as an unplaced elixir.
 */
export function dispelAbilityOf(spellId: number | undefined): DispelAbility | undefined {
  return spellId === undefined ? undefined : DISPEL_ABILITY_BY_ID.get(spellId);
}

/**
 * Whether an event removed a buff from an enemy rather than a debuff from a
 * friendly.
 *
 * The log's own `isBuff` is the authority per event and is what normalize
 * stores; this is the fallback for a spell that has no event to ask, and for
 * the "what can this class do" side of the board.
 */
export function isOffensiveDispel(spellId: number | undefined): boolean {
  return dispelAbilityOf(spellId)?.removes.includes("offensive") ?? false;
}
