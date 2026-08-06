/**
 * What each class brings to a raid — the catalogue the board picker reads.
 *
 * ## Why this file is allowed to exist
 *
 * The house rule is "name what a source actually says, and stay silent
 * otherwise" (AGENTS.md invariant 4). A board picker is the one feature
 * that cannot obey it literally: it answers **what a raid WOULD have if you put
 * these people in these groups**, which is a question about the game, asked
 * before the pull. No log can answer it, because the raid hasn't happened.
 *
 * So this list is TBC rules, written down. Two guardrails keep it from becoming
 * the invented domain knowledge the invariant is about:
 *
 * 1. **Nothing here is ever a match key against Warcraft Logs.** These are not
 *    fetch filters and must never be interpolated into one. The curated lists
 *    that ARE query inputs live in `src/lib/wcl/` — an id missing there silently
 *    collects nothing forever, which is the failure mode the invariant guards.
 *    A wrong row here shows an officer a wrong chip, which they will see.
 * 2. **`loggedAs` is the join back to evidence.** Where a buff's aura or cast
 *    name is already tracked by `wcl/class-tracks.ts`, the entry names it, and
 *    the board view can say whether the raid *actually* had it. Where it
 *    is absent, the log genuinely cannot tell you — TBC never emits a totem's
 *    party aura, a blessing or a paladin aura — and the view says "planned"
 *    rather than pretending to confirm.
 *
 * When in doubt about an entry, leave it out. A missing buff makes a raid look
 * slightly worse prepared than it is; a wrong one gets an officer to move a
 * raider for nothing.
 *
 * ## What `scope` means here
 *
 * Not the tooltip's wording — the only thing the picker needs to know:
 * **does group placement change who gets it?**
 *
 *  - `party` — only the provider's own group. Moving people changes coverage.
 *  - `raid`  — everyone, however they're grouped. Several of these (Arcane
 *    Brilliance, Prayer of Fortitude, Gift of the Wild) are cast per group in
 *    game, but every group gets one, so grouping is not the question they raise;
 *    "is there a mage at all" is.
 *  - `target` — on the boss, not on the raid. One provider covers everyone.
 */

import type { WowClass } from "@/lib/constants/wow";

export type BuffScope = "party" | "raid" | "target";

export type BuffCategory =
  /** Raw stats and resistances. */
  | "stat"
  /** Damage and crit multipliers. */
  | "damage"
  /** Haste, in any form. */
  | "haste"
  /** Mana and health return. */
  | "resource"
  /** Armor, damage taken, threat — what keeps the raid alive. */
  | "survival"
  /** Pressed once and it matters — Bloodlust, Innervate, a battle rez. */
  | "cooldown"
  /** Removing what the boss puts on the raid. */
  | "dispel";

/** One class that can bring a buff, and what it takes for them to bring it. */
export interface BuffSource {
  wowClass: WowClass;
  /**
   * Specs that bring it. Omitted means any spec of the class does.
   *
   * Matched loosely against Warcraft Logs' spec strings, which are neither
   * stable nor ours ("BeastMastery", "Warden", "Justicar"). A raider whose spec
   * the logs never named is reported as *conditional*, never as missing — see
   * `analysis/board.ts`.
   */
  specs?: string[];
  /** The talent, pet or reagent it actually costs, when that's worth stating. */
  requires?: string;
}

export interface RaidBuff {
  /** Stable slug — what a saved board and the coverage view key on. */
  id: string;
  name: string;
  /** Compact label for a dense chip. Defaults to `name`. */
  short?: string;
  scope: BuffScope;
  category: BuffCategory;
  /** What it does, in one line an officer can act on. */
  effect: string;
  sources: BuffSource[];
  /**
   * Anyone can bring it, regardless of class — a profession item or a
   * consumable. Mutually exclusive with `sources`: no roster arrangement
   * predicts it, so coverage reports it from the logs or not at all.
   */
  openTo?: string;
  /**
   * Named set this competes in, when one provider has to *choose* — a shaman
   * gets one totem per element, a paladin one aura and one blessing per target,
   * a warlock one curse.
   *
   * Coverage never counts a class prediction as covered for these, because
   * "there is a shaman here" would otherwise become eight totems from one
   * shaman, which is the single easiest way to make a board tool lie. The
   * shaman still shows as *able* to bring it; evidence from the log promotes it
   * the moment he actually drops it.
   *
   * The string is both the set key and the words the tooltip uses, so a new set
   * cannot be added without saying what it means.
   */
  exclusiveWith?: string;
  /**
   * The names `wcl/class-tracks.ts` (or `SHAMAN_TOTEM_CASTS`) already tracks
   * this under — a list because one entry can stand for several auras that do
   * the same job (the three jewelcrafting necks). Present = the app can show
   * whether the raid really had it. Absent = the TBC combat log never emits it
   * and no import will change that.
   */
  loggedAs?: string[];
  /** Why the log stays silent — shown on the chip, so the gap is never mistaken for a finding. */
  unloggedBecause?: string;
}

/*
 * Ordered by category, then by how often an officer asks about them. The picker
 * groups by scope, so the order inside a scope is what a strip reads like.
 */
export const RAID_BUFFS: RaidBuff[] = [
  /* ---------------------------------------------------------------- party */

  {
    id: "battle-shout",
    name: "Battle Shout",
    scope: "party",
    category: "stat",
    effect: "Attack power for the group.",
    sources: [{ wowClass: "Warrior" }],
    loggedAs: ["Battle Shout"],
  },
  {
    id: "commanding-shout",
    name: "Commanding Shout",
    scope: "party",
    category: "survival",
    effect: "Maximum health for the group — the shout a tank warrior runs instead.",
    sources: [{ wowClass: "Warrior" }],
    loggedAs: ["Commanding Shout"],
  },
  {
    id: "rampage",
    name: "Rampage",
    scope: "party",
    category: "stat",
    effect: "Melee attack power for the group, stacking off the warrior's crits.",
    sources: [{ wowClass: "Warrior", specs: ["Fury"], requires: "Fury talent" }],
    // Tracked as a selfbuff: the aura sits on the warrior, so what the log
    // proves is that he kept it rolling, not who stood next to him.
    loggedAs: ["Rampage"],
  },
  {
    id: "leader-of-the-pack",
    name: "Leader of the Pack",
    short: "LotP",
    scope: "party",
    category: "damage",
    effect: "Melee and ranged crit chance for the group.",
    sources: [{ wowClass: "Druid", specs: ["Feral", "Guardian", "Warden"], requires: "Feral talent" }],
    unloggedBecause: "TBC never emits the aura — only the druid's own form is visible.",
  },
  {
    id: "moonkin-aura",
    name: "Moonkin Aura",
    scope: "party",
    category: "damage",
    effect: "Spell crit chance for the group.",
    sources: [{ wowClass: "Druid", specs: ["Balance"], requires: "Moonkin Form" }],
    unloggedBecause: "TBC never emits the aura.",
  },
  {
    id: "trueshot-aura",
    name: "Trueshot Aura",
    scope: "party",
    category: "stat",
    effect: "Attack power for the group.",
    sources: [
      { wowClass: "Hunter", specs: ["Marksmanship"], requires: "Marksmanship talent" },
    ],
    unloggedBecause: "TBC never emits the aura.",
  },
  {
    id: "ferocious-inspiration",
    name: "Ferocious Inspiration",
    short: "Ferocious Insp.",
    scope: "party",
    category: "damage",
    effect: "All damage the group deals, up — procced by the hunter's pet.",
    sources: [
      { wowClass: "Hunter", specs: ["BeastMastery", "Beast Mastery"], requires: "Beast Mastery talent" },
    ],
    unloggedBecause: "TBC never emits the proc as a raid-visible aura.",
  },
  {
    id: "blood-pact",
    name: "Blood Pact",
    scope: "party",
    category: "stat",
    effect: "Stamina for the group.",
    sources: [{ wowClass: "Warlock", requires: "Imp out" }],
    unloggedBecause: "Pet auras don't reach the combat log.",
  },
  {
    id: "vampiric-touch",
    name: "Vampiric Touch",
    scope: "party",
    category: "resource",
    effect: "Mana back to the group from the priest's shadow damage — the reason casters share a group with one.",
    sources: [{ wowClass: "Priest", specs: ["Shadow"] }],
    loggedAs: ["Vampiric Touch"],
  },
  {
    id: "vampiric-embrace",
    name: "Vampiric Embrace",
    scope: "party",
    category: "resource",
    effect: "Healing to the group from the priest's shadow damage.",
    sources: [{ wowClass: "Priest", specs: ["Shadow"] }],
    loggedAs: ["Vampiric Embrace"],
  },
  {
    id: "bloodlust",
    name: "Bloodlust / Heroism",
    short: "Bloodlust",
    scope: "party",
    category: "haste",
    effect: "30% haste to the group for 40 seconds. Party-wide in TBC — which group it lands on is a decision.",
    sources: [{ wowClass: "Shaman" }],
    loggedAs: ["Bloodlust"],
  },
  {
    id: "mana-tide-totem",
    name: "Mana Tide Totem",
    short: "Mana Tide",
    scope: "party",
    category: "resource",
    effect: "A burst of mana to the group — the healer group's cooldown.",
    sources: [
      { wowClass: "Shaman", specs: ["Restoration"], requires: "Restoration talent" },
    ],
    loggedAs: ["Mana Tide Totem"],
  },
  {
    id: "windfury-totem",
    name: "Windfury Totem",
    scope: "party",
    category: "damage",
    effect: "Extra melee attacks for the group — the melee group's totem.",
    sources: [{ wowClass: "Shaman" }],
    exclusiveWith: "air totem",
    loggedAs: ["Windfury Totem"],
  },
  {
    id: "strength-of-earth-totem",
    name: "Strength of Earth Totem",
    short: "Strength of Earth",
    scope: "party",
    category: "stat",
    effect: "Strength for the group.",
    sources: [{ wowClass: "Shaman" }],
    exclusiveWith: "earth totem",
    loggedAs: ["Strength of Earth Totem"],
  },
  {
    id: "grace-of-air-totem",
    name: "Grace of Air Totem",
    short: "Grace of Air",
    scope: "party",
    category: "stat",
    effect: "Agility for the group.",
    sources: [{ wowClass: "Shaman" }],
    exclusiveWith: "air totem",
    loggedAs: ["Grace of Air Totem"],
  },
  {
    id: "wrath-of-air-totem",
    name: "Wrath of Air Totem",
    short: "Wrath of Air",
    scope: "party",
    category: "damage",
    effect: "Spell damage for the group — the caster group's totem.",
    sources: [{ wowClass: "Shaman" }],
    exclusiveWith: "air totem",
    loggedAs: ["Wrath of Air Totem"],
  },
  {
    id: "totem-of-wrath",
    name: "Totem of Wrath",
    scope: "party",
    category: "damage",
    effect: "Spell crit and spell hit for the group.",
    sources: [
      { wowClass: "Shaman", specs: ["Elemental"], requires: "Elemental talent" },
    ],
    exclusiveWith: "fire totem",
    loggedAs: ["Totem of Wrath"],
  },
  {
    id: "mana-spring-totem",
    name: "Mana Spring Totem",
    short: "Mana Spring",
    scope: "party",
    category: "resource",
    effect: "Mana regeneration for the group.",
    sources: [{ wowClass: "Shaman" }],
    exclusiveWith: "water totem",
    loggedAs: ["Mana Spring Totem"],
  },
  {
    id: "healing-stream-totem",
    name: "Healing Stream Totem",
    short: "Healing Stream",
    scope: "party",
    category: "survival",
    effect: "A trickle of healing to the group.",
    sources: [{ wowClass: "Shaman" }],
    exclusiveWith: "water totem",
    loggedAs: ["Healing Stream Totem"],
  },
  {
    id: "flametongue-totem",
    name: "Flametongue Totem",
    short: "Flametongue",
    scope: "party",
    category: "damage",
    effect: "Spell damage on the group's weapons.",
    sources: [{ wowClass: "Shaman" }],
    exclusiveWith: "fire totem",
    loggedAs: ["Flametongue Totem"],
  },
  {
    id: "tranquil-air-totem",
    name: "Tranquil Air Totem",
    short: "Tranquil Air",
    scope: "party",
    category: "survival",
    effect: "Threat reduction for the group.",
    sources: [{ wowClass: "Shaman" }],
    exclusiveWith: "air totem",
    loggedAs: ["Tranquil Air Totem"],
  },
  {
    id: "blessing-of-might",
    name: "Blessing of Might",
    short: "Might",
    scope: "party",
    category: "stat",
    effect: "Attack power. Greater Blessing reaches every raider of one class.",
    sources: [{ wowClass: "Paladin" }],
    exclusiveWith: "blessing",
    unloggedBecause: "Blessings never appear in TBC combat logs.",
  },
  {
    id: "blessing-of-wisdom",
    name: "Blessing of Wisdom",
    short: "Wisdom",
    scope: "party",
    category: "resource",
    effect: "Mana regeneration. Greater Blessing reaches every raider of one class.",
    sources: [{ wowClass: "Paladin" }],
    exclusiveWith: "blessing",
    unloggedBecause: "Blessings never appear in TBC combat logs.",
  },
  {
    id: "blessing-of-kings",
    name: "Blessing of Kings",
    short: "Kings",
    scope: "party",
    category: "stat",
    effect: "All attributes up 10%. Greater Blessing reaches every raider of one class.",
    sources: [
      { wowClass: "Paladin", specs: ["Protection", "Justicar"], requires: "Protection talent" },
    ],
    exclusiveWith: "blessing",
    unloggedBecause: "Blessings never appear in TBC combat logs.",
  },
  {
    id: "blessing-of-salvation",
    name: "Blessing of Salvation",
    short: "Salvation",
    scope: "party",
    category: "survival",
    effect: "Threat reduction — what lets the damage dealers open up.",
    sources: [{ wowClass: "Paladin" }],
    exclusiveWith: "blessing",
    unloggedBecause: "Blessings never appear in TBC combat logs.",
  },
  {
    id: "devotion-aura",
    name: "Devotion Aura",
    scope: "party",
    category: "survival",
    effect: "Armor for the group.",
    sources: [{ wowClass: "Paladin" }],
    exclusiveWith: "paladin aura",
    unloggedBecause: "Paladin auras never appear in TBC combat logs.",
  },
  {
    id: "concentration-aura",
    name: "Concentration Aura",
    scope: "party",
    category: "resource",
    effect: "The group's casts can't be pushed back — the healer group's aura.",
    sources: [{ wowClass: "Paladin" }],
    exclusiveWith: "paladin aura",
    unloggedBecause: "Paladin auras never appear in TBC combat logs.",
  },
  {
    id: "sanctity-aura",
    name: "Sanctity Aura",
    scope: "party",
    category: "damage",
    effect: "Holy damage done by the group, and — talented — damage from every school.",
    /*
     * The talent is Retribution's, but the aura is not a Retribution paladin's:
     * a Holy paladin who spends the points brings it just as well, which is a
     * real choice this guild makes. So the source is the class, and `requires`
     * carries the actual cost — listing specs here would report a holy paladin
     * who took it as "missing", which is worse than the honest "unconfirmed".
     */
    sources: [{ wowClass: "Paladin", requires: "Sanctity Aura talent" }],
    exclusiveWith: "paladin aura",
    unloggedBecause: "Paladin auras never appear in TBC combat logs.",
  },
  {
    id: "party-neck",
    name: "Jewelcrafting neck",
    short: "JC neck",
    scope: "party",
    category: "damage",
    effect:
      "Braided Eternium Chain, Chain of the Twilight Owl or Eye of the Night — one wearer buffs their whole group.",
    sources: [],
    openTo: "anyone with Jewelcrafting",
    // The one party buff TBC does log, which is what makes group recovery
    // possible at all — see analysis/board.ts. All three behave
    // identically, so any of them proves the same thing about a group.
    loggedAs: ["Braided Eternium Chain", "Chain of the Twilight Owl", "Eye of the Night"],
  },

  /* ----------------------------------------------------------------- raid */

  {
    id: "arcane-brilliance",
    name: "Arcane Brilliance",
    scope: "raid",
    category: "stat",
    effect: "Intellect for every caster.",
    sources: [{ wowClass: "Mage" }],
    unloggedBecause: "Not tracked — it's a pre-pull buff, not something a pull can show going missing.",
  },
  {
    id: "prayer-of-fortitude",
    name: "Prayer of Fortitude",
    short: "Fortitude",
    scope: "raid",
    category: "stat",
    effect: "Stamina for the raid.",
    sources: [{ wowClass: "Priest" }],
    unloggedBecause: "Not tracked — a pre-pull buff.",
  },
  {
    id: "prayer-of-spirit",
    name: "Prayer of Spirit",
    short: "Divine Spirit",
    scope: "raid",
    category: "resource",
    effect: "Spirit for the raid.",
    sources: [
      { wowClass: "Priest", specs: ["Discipline"], requires: "Discipline talent" },
    ],
    unloggedBecause: "Not tracked — a pre-pull buff.",
  },
  {
    id: "prayer-of-shadow-protection",
    name: "Prayer of Shadow Protection",
    short: "Shadow Prot.",
    scope: "raid",
    category: "survival",
    effect: "Shadow resistance for the raid — a boss-by-boss requirement.",
    sources: [{ wowClass: "Priest" }],
    unloggedBecause: "Not tracked — a pre-pull buff.",
  },
  {
    id: "gift-of-the-wild",
    name: "Gift of the Wild",
    short: "Mark of the Wild",
    scope: "raid",
    category: "stat",
    effect: "Every attribute and every resistance, for the raid.",
    sources: [{ wowClass: "Druid" }],
    unloggedBecause: "Not tracked — a pre-pull buff.",
  },
  {
    id: "expose-weakness",
    name: "Expose Weakness",
    scope: "raid",
    category: "stat",
    effect: "Attack power for everyone hitting the target, off the hunter's agility.",
    sources: [{ wowClass: "Hunter", specs: ["Survival"], requires: "Survival talent" }],
    loggedAs: ["Expose Weakness"],
  },

  /* --------------------------------------------------------------- target */

  {
    id: "sunder-armor",
    name: "Sunder Armor",
    scope: "target",
    category: "survival",
    effect: "Strips the boss's armor, five stacks deep.",
    sources: [{ wowClass: "Warrior" }],
    loggedAs: ["Sunder Armor"],
  },
  {
    id: "expose-armor",
    name: "Expose Armor",
    scope: "target",
    category: "survival",
    effect: "The rogue's armor strip — does not stack with Sunder, so one or the other.",
    sources: [{ wowClass: "Rogue" }],
    loggedAs: ["Expose Armor"],
  },
  {
    id: "blood-frenzy",
    name: "Blood Frenzy",
    scope: "target",
    category: "damage",
    effect: "All physical damage on the target, up — off the Arms warrior's bleeds.",
    sources: [{ wowClass: "Warrior", specs: ["Arms"], requires: "Arms talent" }],
    loggedAs: ["Blood Frenzy"],
  },
  {
    id: "fire-vulnerability",
    name: "Improved Scorch",
    short: "Fire Vulnerability",
    scope: "target",
    category: "damage",
    effect: "Fire damage on the target, up five stacks.",
    sources: [{ wowClass: "Mage", specs: ["Fire"], requires: "Fire talent" }],
    loggedAs: ["Fire Vulnerability"],
  },
  {
    id: "winters-chill",
    name: "Winter's Chill",
    scope: "target",
    category: "damage",
    effect: "Frost crit chance against the target, up five stacks.",
    sources: [{ wowClass: "Mage", specs: ["Frost"], requires: "Frost talent" }],
    loggedAs: ["Winter's Chill"],
  },
  {
    id: "curse-of-the-elements",
    name: "Curse of the Elements",
    short: "CoE",
    scope: "target",
    category: "damage",
    effect: "Fire, frost, arcane and nature damage on the target, up. One curse at a time.",
    sources: [{ wowClass: "Warlock" }],
    exclusiveWith: "warlock curse",
    loggedAs: ["Curse of the Elements"],
  },
  {
    id: "curse-of-recklessness",
    name: "Curse of Recklessness",
    short: "CoR",
    scope: "target",
    category: "survival",
    effect: "Strips armor. Competes with the warlock's other curses.",
    sources: [{ wowClass: "Warlock" }],
    exclusiveWith: "warlock curse",
    loggedAs: ["Curse of Recklessness"],
  },
  {
    id: "misery",
    name: "Misery",
    scope: "target",
    category: "damage",
    effect: "Spell damage taken by the target, up — from the shadow priest's dots.",
    sources: [{ wowClass: "Priest", specs: ["Shadow"], requires: "Shadow talent" }],
    loggedAs: ["Misery"],
  },
  {
    id: "judgement-of-wisdom",
    name: "Judgement of Wisdom",
    short: "JoW",
    scope: "target",
    category: "resource",
    effect: "Mana back to everyone hitting the target.",
    sources: [{ wowClass: "Paladin" }],
    loggedAs: ["Judgement of Wisdom"],
  },
  {
    id: "judgement-of-the-crusader",
    name: "Judgement of the Crusader",
    short: "JotC",
    scope: "target",
    category: "damage",
    effect: "Holy damage taken by the target, up — the retribution paladin's judgement.",
    sources: [{ wowClass: "Paladin" }],
    loggedAs: ["Judgement of the Crusader"],
  },
  {
    id: "faerie-fire",
    name: "Faerie Fire",
    scope: "target",
    category: "survival",
    effect: "Armor off the target; the feral version stacks with the warrior's.",
    sources: [{ wowClass: "Druid" }],
    loggedAs: ["Faerie Fire"],
  },
  {
    id: "hunters-mark",
    name: "Hunter's Mark",
    scope: "target",
    category: "stat",
    effect: "Ranged attack power against the target.",
    sources: [{ wowClass: "Hunter" }],
    loggedAs: ["Hunter's Mark"],
  },
  {
    id: "demoralizing-shout",
    name: "Demoralizing Shout",
    short: "Demo Shout",
    scope: "target",
    category: "survival",
    effect: "The boss's attack power, down.",
    sources: [{ wowClass: "Warrior" }],
    loggedAs: ["Demoralizing Shout"],
  },
  {
    id: "thunder-clap",
    name: "Thunder Clap",
    scope: "target",
    category: "survival",
    effect: "The boss's attack speed, down.",
    sources: [{ wowClass: "Warrior" }],
    loggedAs: ["Thunder Clap"],
  },

  /* ------------------------------------------------------------ cooldowns */

  {
    id: "innervate",
    name: "Innervate",
    scope: "raid",
    category: "cooldown",
    effect: "Hands a healer their mana bar back.",
    sources: [{ wowClass: "Druid" }],
    loggedAs: ["Innervate"],
  },
  {
    id: "power-infusion",
    name: "Power Infusion",
    short: "PI",
    scope: "raid",
    category: "cooldown",
    effect: "20% spell haste on one caster for 15 seconds.",
    sources: [
      { wowClass: "Priest", specs: ["Discipline"], requires: "Discipline talent" },
    ],
    loggedAs: ["Power Infusion"],
  },
  {
    id: "rebirth",
    name: "Rebirth",
    short: "Battle rez",
    scope: "raid",
    category: "cooldown",
    effect: "A combat resurrection — one per druid, per fight.",
    sources: [{ wowClass: "Druid" }],
    loggedAs: ["Rebirth"],
  },
  {
    id: "soulstone",
    name: "Soulstone",
    scope: "raid",
    category: "cooldown",
    effect: "A self-resurrection banked before the pull — the wipe recovery.",
    sources: [{ wowClass: "Warlock" }],
    unloggedBecause: "Applied out of combat; nothing in a pull records it.",
  },
  {
    id: "misdirection",
    name: "Misdirection",
    short: "MD",
    scope: "raid",
    category: "cooldown",
    effect: "Hands the hunter's threat to a tank — the pull itself, on many fights.",
    sources: [{ wowClass: "Hunter" }],
    loggedAs: ["Misdirection"],
  },
  {
    id: "shield-wall",
    name: "Tank cooldowns",
    scope: "raid",
    category: "cooldown",
    effect: "Shield Wall, Pain Suppression, Lay on Hands — the saves a tank survives a spike on.",
    sources: [
      { wowClass: "Warrior", specs: ["Protection"] },
      { wowClass: "Priest", specs: ["Discipline"], requires: "Pain Suppression talent" },
      { wowClass: "Paladin" },
    ],
    loggedAs: ["Shield Wall"],
  },

  /* --------------------------------------------------------------- dispel */

  {
    id: "dispel-magic",
    name: "Magic dispel",
    scope: "raid",
    category: "dispel",
    effect: "Removing a magic effect from a raider.",
    sources: [{ wowClass: "Priest" }, { wowClass: "Paladin" }],
    unloggedBecause: "Dispels aren't tracked — they're a per-boss assignment, not a raid-wide uptime.",
  },
  {
    id: "dispel-curse",
    name: "Curse removal",
    scope: "raid",
    category: "dispel",
    effect: "Removing a curse from a raider.",
    sources: [{ wowClass: "Mage" }, { wowClass: "Druid" }],
    unloggedBecause: "Dispels aren't tracked.",
  },
  {
    id: "dispel-poison",
    name: "Poison cleansing",
    scope: "raid",
    category: "dispel",
    effect: "Removing poison from a raider.",
    sources: [{ wowClass: "Druid" }, { wowClass: "Paladin" }, { wowClass: "Shaman" }],
    unloggedBecause: "Dispels aren't tracked.",
  },
  {
    id: "dispel-disease",
    name: "Disease cleansing",
    scope: "raid",
    category: "dispel",
    effect: "Removing disease from a raider.",
    sources: [{ wowClass: "Priest" }, { wowClass: "Paladin" }, { wowClass: "Shaman" }],
    unloggedBecause: "Dispels aren't tracked.",
  },
];

export const BUFF_BY_ID = new Map<string, RaidBuff>(RAID_BUFFS.map((b) => [b.id, b]));

export const SCOPE_LABELS: Record<BuffScope, string> = {
  party: "Party",
  raid: "Raid",
  target: "On the boss",
};

export const buffLabel = (buff: RaidBuff): string => buff.short ?? buff.name;

/** Every buff a class can bring — the "what am I worth in a comp" answer. */
export function buffsForClass(wowClass: WowClass): RaidBuff[] {
  return RAID_BUFFS.filter((b) => b.sources.some((s) => s.wowClass === wowClass));
}

/** Buffs whose coverage depends on who is standing in which group. */
export const PARTY_BUFFS = RAID_BUFFS.filter((b) => b.scope === "party");
