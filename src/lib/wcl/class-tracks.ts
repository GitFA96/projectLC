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
  /** Buff the player maintains on themself (shouts) — source must equal target. */
  | "selfbuff"
  /** Buff the player maintains on someone friendly (Earth Shield on the tank). */
  | "buff";

export interface UptimeTrack {
  /** Aura name exactly as logs spell it — the match key, all ranks. */
  name: string;
  /** Display label when the log name isn't self-explanatory. */
  label?: string;
  kind: UptimeKind;
  wowClass: string;
}

export const UPTIME_TRACKS: UptimeTrack[] = [
  /* Warrior */
  { name: "Sunder Armor", kind: "debuff", wowClass: "Warrior" },
  { name: "Thunder Clap", kind: "debuff", wowClass: "Warrior" },
  { name: "Demoralizing Shout", kind: "debuff", wowClass: "Warrior" },
  { name: "Battle Shout", kind: "selfbuff", wowClass: "Warrior" },
  { name: "Commanding Shout", kind: "selfbuff", wowClass: "Warrior" },
  /* Warlock curse assignments */
  { name: "Curse of Recklessness", kind: "debuff", wowClass: "Warlock" },
  { name: "Curse of the Elements", kind: "debuff", wowClass: "Warlock" },
  { name: "Curse of Shadow", kind: "debuff", wowClass: "Warlock" },
  { name: "Curse of Doom", kind: "debuff", wowClass: "Warlock" },
  { name: "Curse of Agony", kind: "debuff", wowClass: "Warlock" },
  { name: "Curse of Tongues", kind: "debuff", wowClass: "Warlock" },
  /* Druid */
  { name: "Faerie Fire", kind: "debuff", wowClass: "Druid" },
  { name: "Faerie Fire (Feral)", kind: "debuff", wowClass: "Druid" },
  /* Mage */
  { name: "Fire Vulnerability", label: "Imp. Scorch (Fire Vulnerability)", kind: "debuff", wowClass: "Mage" },
  { name: "Winter's Chill", kind: "debuff", wowClass: "Mage" },
  /* Priest */
  { name: "Shadow Weaving", kind: "debuff", wowClass: "Priest" },
  { name: "Misery", kind: "debuff", wowClass: "Priest" },
  { name: "Vampiric Touch", kind: "debuff", wowClass: "Priest" },
  /* Paladin judgements */
  { name: "Judgement of Wisdom", kind: "debuff", wowClass: "Paladin" },
  { name: "Judgement of Light", kind: "debuff", wowClass: "Paladin" },
  { name: "Judgement of the Crusader", kind: "debuff", wowClass: "Paladin" },
  /* Hunter */
  { name: "Hunter's Mark", kind: "debuff", wowClass: "Hunter" },
  { name: "Expose Weakness", kind: "debuff", wowClass: "Hunter" },
  /* Rogue */
  { name: "Expose Armor", kind: "debuff", wowClass: "Rogue" },
  /* Shaman */
  { name: "Stormstrike", kind: "debuff", wowClass: "Shaman" },
  { name: "Earth Shield", kind: "buff", wowClass: "Shaman" },
];

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
