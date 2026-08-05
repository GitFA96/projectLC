/**
 * Class-specific performance tracking for Warcraft Logs imports — the things
 * a player is responsible for beyond their parse:
 *
 *  - Cooldown casts: major class cooldowns counted per boss pull. Cast events
 *    are filtered server-side BY SPELL ID, so multi-rank spells enumerate
 *    every rank (a missing rank silently under-counts, never breaks).
 *  - Upkeep: debuffs/buffs a spec is expected to maintain (warlock curses,
 *    Thunder Clap, shouts, Earth Shield…). These are matched BY NAME so one
 *    entry covers all spell ranks; uptime is computed from apply/remove
 *    events, attributed to the SOURCE player, on their best enemy target
 *    (≈ the boss — adds with brief uptime never win).
 */

export interface ClassCooldown {
  /** Every spell-rank id that casts this cooldown. */
  ids: number[];
  name: string;
  /** WCL class string ("Warrior", "Mage", …). */
  wowClass: string;
}

export const CLASS_COOLDOWNS: ClassCooldown[] = [
  /* Warrior */
  { ids: [12292], name: "Death Wish", wowClass: "Warrior" },
  { ids: [1719], name: "Recklessness", wowClass: "Warrior" },
  { ids: [871], name: "Shield Wall", wowClass: "Warrior" },
  { ids: [12328], name: "Sweeping Strikes", wowClass: "Warrior" },
  /* Mage */
  { ids: [11129], name: "Combustion", wowClass: "Mage" },
  { ids: [12042], name: "Arcane Power", wowClass: "Mage" },
  { ids: [12472], name: "Icy Veins", wowClass: "Mage" },
  { ids: [12043], name: "Presence of Mind", wowClass: "Mage" },
  { ids: [11958], name: "Cold Snap", wowClass: "Mage" },
  { ids: [12051], name: "Evocation", wowClass: "Mage" },
  /* Priest */
  { ids: [10060], name: "Power Infusion", wowClass: "Priest" },
  { ids: [14751], name: "Inner Focus", wowClass: "Priest" },
  { ids: [34433], name: "Shadowfiend", wowClass: "Priest" },
  { ids: [33206], name: "Pain Suppression", wowClass: "Priest" },
  /* Druid */
  { ids: [29166], name: "Innervate", wowClass: "Druid" },
  { ids: [20484, 20739, 20742, 20747, 20748, 26994], name: "Rebirth", wowClass: "Druid" },
  { ids: [17116], name: "Nature's Swiftness", wowClass: "Druid" },
  { ids: [740, 8918, 9862, 9863, 26983], name: "Tranquility", wowClass: "Druid" },
  /* Hunter */
  { ids: [3045], name: "Rapid Fire", wowClass: "Hunter" },
  { ids: [19574], name: "Bestial Wrath", wowClass: "Hunter" },
  { ids: [34477], name: "Misdirection", wowClass: "Hunter" },
  { ids: [23989], name: "Readiness", wowClass: "Hunter" },
  /* Rogue */
  { ids: [13750], name: "Adrenaline Rush", wowClass: "Rogue" },
  { ids: [13877], name: "Blade Flurry", wowClass: "Rogue" },
  { ids: [14177], name: "Cold Blood", wowClass: "Rogue" },
  /* Paladin */
  { ids: [31884], name: "Avenging Wrath", wowClass: "Paladin" },
  { ids: [20216], name: "Divine Favor", wowClass: "Paladin" },
  { ids: [31842], name: "Divine Illumination", wowClass: "Paladin" },
  { ids: [633, 2800, 10310, 27154], name: "Lay on Hands", wowClass: "Paladin" },
  /* Shaman */
  { ids: [30823], name: "Shamanistic Rage", wowClass: "Shaman" },
  { ids: [2825], name: "Bloodlust", wowClass: "Shaman" },
  { ids: [32182], name: "Heroism", wowClass: "Shaman" },
  { ids: [16190], name: "Mana Tide Totem", wowClass: "Shaman" },
  { ids: [16188], name: "Nature's Swiftness", wowClass: "Shaman" },
  { ids: [16166], name: "Elemental Mastery", wowClass: "Shaman" },
];

export const COOLDOWN_CAST_IDS = CLASS_COOLDOWNS.flatMap((c) => c.ids);
export const COOLDOWN_BY_ID = new Map<number, ClassCooldown>(
  CLASS_COOLDOWNS.flatMap((c) => c.ids.map((id) => [id, c] as const)),
);

export type UptimeKind =
  /** Debuff the player maintains on enemies (uptime on their best target). */
  | "debuff"
  /** Buff the player maintains on themself (Rampage, Water Shield) — source must equal target. */
  | "selfbuff"
  /**
   * Buff a player puts on other raiders — shouts, Innervate, every totem aura.
   * Tracked in both directions: who provided it, and who had it (uptime per
   * recipient, the "uptime by player" view).
   */
  | "buff";

export interface UptimeTrack {
  /** Aura name exactly as logs spell it — the match key, all ranks. */
  name: string;
  /** Display label when the log name isn't self-explanatory. */
  label?: string;
  kind: UptimeKind;
  wowClass: string;
}

/**
 * Owner of a track no single class provides — a consumable debuff or an
 * item-sourced party buff, which anyone can bring.
 *
 * Such a track is still collected and still has uptime; it just isn't part of
 * any class's expectations, so `uptimeTracksForClass` correctly returns it for
 * nobody.
 *
 * On a buff this also changes attribution, deliberately. normalize falls back
 * to "a class-matching recipient must have buffed themself" only when the log
 * doesn't name a source; no class can match ANY_CLASS, so those instances stay
 * unattributed instead of being credited to whoever happened to be standing
 * there. For an item buff that is the correct answer — you cannot tell who wore
 * the neck from an aura with no source, and a wrong provider is worse than
 * none. Sourced instances attribute normally.
 *
 * Not valid on `selfbuff`, which is class-personal by definition.
 */
export const ANY_CLASS = "Any";

export const UPTIME_TRACKS: UptimeTrack[] = [
  /* Warrior — fury keeps Rampage rolling; tanks stack Sunder and hold TC/Demo. */
  { name: "Sunder Armor", kind: "debuff", wowClass: "Warrior" },
  /**
   * Arms talent debuff (spell 29859) — +4% physical damage taken, applied by
   * the warrior's own Rend and Deep Wounds ticks. Raid-wide value, so whether
   * an Arms warrior specs it is a raid question, not a personal one.
   *
   * Verified absent from all five reports fetched so far, searched by id rather
   * than name — while Rend (36991) and Deep Wounds (12721) are both present.
   * The procs that would apply it are landing, so the talent simply isn't
   * taken. Sims assume it, which quietly flatters every melee comparison.
   */
  { name: "Blood Frenzy", kind: "debuff", wowClass: "Warrior" },
  { name: "Thunder Clap", kind: "debuff", wowClass: "Warrior" },
  { name: "Demoralizing Shout", kind: "debuff", wowClass: "Warrior" },
  { name: "Battle Shout", kind: "buff", wowClass: "Warrior" },
  { name: "Commanding Shout", kind: "buff", wowClass: "Warrior" },
  { name: "Rampage", kind: "selfbuff", wowClass: "Warrior" },
  /* Warlock curse assignments */
  { name: "Curse of Recklessness", kind: "debuff", wowClass: "Warlock" },
  { name: "Curse of the Elements", kind: "debuff", wowClass: "Warlock" },
  { name: "Curse of Shadow", kind: "debuff", wowClass: "Warlock" },
  { name: "Curse of Doom", kind: "debuff", wowClass: "Warlock" },
  { name: "Curse of Agony", kind: "debuff", wowClass: "Warlock" },
  { name: "Curse of Tongues", kind: "debuff", wowClass: "Warlock" },
  /* Druid — feral upkeep: Mangle is the bleed/Shred amplifier, Lacerate the bear threat stack. */
  { name: "Faerie Fire", kind: "debuff", wowClass: "Druid" },
  { name: "Faerie Fire (Feral)", kind: "debuff", wowClass: "Druid" },
  { name: "Mangle (Cat)", kind: "debuff", wowClass: "Druid" },
  { name: "Mangle (Bear)", kind: "debuff", wowClass: "Druid" },
  { name: "Lacerate", kind: "debuff", wowClass: "Druid" },
  /* Balance DoT upkeep. */
  { name: "Insect Swarm", kind: "debuff", wowClass: "Druid" },
  { name: "Moonfire", kind: "debuff", wowClass: "Druid" },
  /* Mage */
  { name: "Fire Vulnerability", label: "Imp. Scorch (Fire Vulnerability)", kind: "debuff", wowClass: "Mage" },
  { name: "Winter's Chill", kind: "debuff", wowClass: "Mage" },
  /* Priest — shadow DoT upkeep is the spec's whole rotation. */
  { name: "Shadow Weaving", kind: "debuff", wowClass: "Priest" },
  { name: "Misery", kind: "debuff", wowClass: "Priest" },
  { name: "Vampiric Touch", kind: "debuff", wowClass: "Priest" },
  { name: "Shadow Word: Pain", kind: "debuff", wowClass: "Priest" },
  { name: "Vampiric Embrace", kind: "debuff", wowClass: "Priest" },
  /* Paladin — judgement assignments; prot's block wall. */
  { name: "Judgement of Wisdom", kind: "debuff", wowClass: "Paladin" },
  { name: "Judgement of Light", kind: "debuff", wowClass: "Paladin" },
  { name: "Judgement of the Crusader", kind: "debuff", wowClass: "Paladin" },
  { name: "Holy Shield", kind: "selfbuff", wowClass: "Paladin" },
  /* Hunter */
  { name: "Hunter's Mark", kind: "debuff", wowClass: "Hunter" },
  { name: "Expose Weakness", kind: "debuff", wowClass: "Hunter" },
  /* Rogue — Slice and Dice uptime IS rogue play; Rupture for the finisher rotation. */
  { name: "Expose Armor", kind: "debuff", wowClass: "Rogue" },
  { name: "Rupture", kind: "debuff", wowClass: "Rogue" },
  { name: "Slice and Dice", kind: "selfbuff", wowClass: "Rogue" },
  /* Shaman — enhancement keeps Flame Shock rolling between Stormstrikes; Water Shield is the mana engine. */
  { name: "Stormstrike", kind: "debuff", wowClass: "Shaman" },
  { name: "Flame Shock", kind: "debuff", wowClass: "Shaman" },
  { name: "Water Shield", kind: "selfbuff", wowClass: "Shaman" },
  { name: "Earth Shield", kind: "buff", wowClass: "Shaman" },
  /* Warlock — personal DoT upkeep alongside the curse assignment. */
  { name: "Corruption", kind: "debuff", wowClass: "Warlock" },
  { name: "Immolate", kind: "debuff", wowClass: "Warlock" },
  { name: "Unstable Affliction", kind: "debuff", wowClass: "Warlock" },
  /* Hunter */
  { name: "Serpent Sting", kind: "debuff", wowClass: "Hunter" },
  /*
   * Raid buffs put on OTHER players — the "uptime by player" view.
   *
   * Only auras the TBC combat log actually emits belong here. Totem party
   * buffs (Strength of Earth, Grace of Air, Wrath of Air, Mana Spring…) are
   * NOT logged — they appear in neither buff events nor the pull's aura
   * snapshot — and "Windfury Totem" as a buff is the attacker's own proc
   * window, not who stands in the totem. Totems are tracked from their DROPS
   * instead; see SHAMAN_TOTEM_CASTS.
   */
  { name: "Innervate", kind: "buff", wowClass: "Druid" },
  /*
   * Consumable-sourced raid debuff: the elixir is drunk (usually by a tank) and
   * procs a debuff on whatever they're tanking. So it belongs to no class, and
   * the raider it helps is never the raider who provides it — a DPS reading
   * their own numbers can't be blamed for its absence, but a sim assumes it.
   *
   * Verified present in this guild's logs as spell 11374, not added from memory.
   */
  { name: "Gift of Arthas", kind: "debuff", wowClass: ANY_CLASS },
  /*
   * Jewelcrafting party necks. One person's equipped item buffs their whole
   * group, so coverage depends on who is standing in which party — a raid can
   * own all three and still leave a group uncovered, which no gear check would
   * reveal. Sims switch these on by default (wowsims: partyBuffs), so an
   * unchecked assumption here silently flatters the sim.
   *
   * All three verified present in this guild's logs by id: 31025, 31035, 31033.
   */
  { name: "Braided Eternium Chain", kind: "buff", wowClass: ANY_CLASS },
  { name: "Chain of the Twilight Owl", kind: "buff", wowClass: ANY_CLASS },
  { name: "Eye of the Night", kind: "buff", wowClass: ANY_CLASS },
];

/**
 * Every shaman totem, matched by CAST name so one entry covers all ranks.
 * The log records the drop (source, timestamp, totem) even though the buff it
 * hands out never reaches the combat log — so the honest view of totem work is
 * a drop timeline per shaman, not an uptime bar per raider.
 */
export const SHAMAN_TOTEM_CASTS = [
  "Windfury Totem",
  "Strength of Earth Totem",
  "Grace of Air Totem",
  "Mana Spring Totem",
  "Healing Stream Totem",
  "Mana Tide Totem",
  "Wrath of Air Totem",
  "Totem of Wrath",
  "Flametongue Totem",
  "Tranquil Air Totem",
  "Stoneskin Totem",
  "Stoneclaw Totem",
  "Windwall Totem",
  "Fire Resistance Totem",
  "Frost Resistance Totem",
  "Nature Resistance Totem",
  "Searing Totem",
  "Magma Totem",
  "Fire Nova Totem",
  "Earthbind Totem",
  "Tremor Totem",
  "Grounding Totem",
  "Cleansing Totem",
  "Poison Cleansing Totem",
  "Disease Cleansing Totem",
  "Sentry Totem",
  "Fire Elemental Totem",
  "Earth Elemental Totem",
];

export const TOTEM_CAST_BY_NAME = new Map<string, string>(
  SHAMAN_TOTEM_CASTS.map((n) => [n.toLowerCase(), n]),
);

export const UPTIME_TRACK_BY_NAME = new Map<string, UptimeTrack>(
  UPTIME_TRACKS.map((t) => [t.name.toLowerCase(), t]),
);

/** Reverse lookup from the stored display label back to the track. */
export const UPTIME_TRACK_BY_LABEL = new Map<string, UptimeTrack>(
  UPTIME_TRACKS.map((t) => [(t.label ?? t.name).toLowerCase(), t]),
);

/** Names for the server-side debuff-events filter (uptime on enemies). */
export const DEBUFF_TRACK_NAMES = UPTIME_TRACKS.filter((t) => t.kind === "debuff").map((t) => t.name);
/** Names for the server-side buff-events filter (uptime on friendlies). */
export const BUFF_TRACK_NAMES = UPTIME_TRACKS.filter((t) => t.kind !== "debuff").map((t) => t.name);

/**
 * Every aura this app asks Warcraft Logs for, recorded ON each report at import
 * so later readers can tell two very different silences apart:
 *
 *   - "we asked for Blood Frenzy and the raid never applied it" — a finding.
 *   - "this report was fetched before Blood Frenzy was tracked" — refetch it.
 *
 * Without the record both look identical (no rows), and the audit has to say
 * "not tracked" even for auras it now follows perfectly well — which is exactly
 * what it did, on data that had already been refetched.
 */
export const TRACKED_AURA_NAMES: string[] = UPTIME_TRACKS.map((t) => t.name);

export function trackLabel(track: UptimeTrack): string {
  return track.label ?? track.name;
}

export function cooldownsForClass(wowClass: string | undefined): ClassCooldown[] {
  if (!wowClass) return [];
  return CLASS_COOLDOWNS.filter((c) => c.wowClass === wowClass);
}

export function uptimeTracksForClass(wowClass: string | undefined): UptimeTrack[] {
  if (!wowClass) return [];
  return UPTIME_TRACKS.filter((t) => t.wowClass === wowClass);
}
