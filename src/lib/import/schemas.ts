import { z } from "zod";
import {
  CHARACTER_STATUSES,
  FACTIONS,
  GEAR_OVERRIDE_SOURCES,
  GEAR_SET_KINDS,
  GEAR_SET_SOURCES,
  GEAR_SPECS,
  PHASE_IDS,
  QUALITIES,
  ROLES,
  SESSION_SOURCES,
  SLOT_IDS,
  WOW_CLASSES,
} from "@/lib/constants/wow";
import { COMMENT_CATEGORIES, ITEM_COMMENT_VOICES } from "@/lib/comments";

/**
 * Canonical entity shapes — the single shape contract of the app.
 * Seed JSON is validated against these at load, and every import parser
 * (SixtyUpgrades, Gargul, Warcraft Logs) emits exactly these shapes. That
 * guarantees seed data and real imported data are interchangeable.
 */

export const phaseSchema = z
  .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])
  .refine((p) => (PHASE_IDS as readonly number[]).includes(p));

export const guildSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  realm: z.string().min(1),
  faction: z.enum(FACTIONS),
  activePhase: phaseSchema,
});

export const characterSchema = z.object({
  id: z.string().min(1),
  guildId: z.string().min(1),
  /** Unique within guild; lowercased it doubles as the URL slug. */
  name: z.string().min(1),
  class: z.enum(WOW_CLASSES),
  spec: z.string().min(1),
  role: z.enum(ROLES),
  /**
   * A second spec they actually raid in — the shadow priest who heals
   * progression, the fury warrior who tanks Hydross. Their logs show both, so
   * without recording it the app reads every off-spec night as a roster error.
   * Optional: most raiders only ever play one.
   */
  offSpec: z.string().min(1).optional(),
  /** What that second spec does in the raid; only meaningful with `offSpec`. */
  offSpecRole: z.enum(ROLES).optional(),
  race: z.string().optional(),
  status: z.enum(CHARACTER_STATUSES),
  /**
   * For an alt: the id of the character it belongs to (its main). Null for
   * mains and unlinked alts. Stored regardless of status so toggling alt↔main
   * doesn't lose the link, but only meaningful while status is "alt".
   */
  mainCharacterId: z.string().nullable().default(null),
  note: z.string().optional(),
});

/**
 * Item cache entry (WoW item ID is the primary key).
 *
 * Everything but the id is optional: the cache is filled from whatever each
 * source happens to know — a Gargul link carries a name and quality, a log's
 * gear snapshot carries only an icon — and later imports fill the gaps in
 * place. Partial knowledge beats a fabricated "Item #30048".
 */
export const itemSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).optional(),
  quality: z.enum(QUALITIES).optional(),
  /** Wowhead/zamimg icon name, e.g. "inv_axe_60" (no extension). */
  icon: z.string().min(1).optional(),
  slot: z.enum(SLOT_IDS).nullish(),
  source: z.object({ zone: z.string(), boss: z.string().optional() }).optional(),
  phase: phaseSchema.optional(),
  /**
   * True once Wowhead itself answered for this id. Everything else — the
   * curated seed, a name typed into a wishlist, an icon lifted off a log — is
   * a good guess that nothing has checked, and stays re-checkable forever.
   * Absent means unverified; only `resolveItemsFromWowhead` may set it.
   */
  verified: z.boolean().optional(),
  /**
   * Wowhead's "Armor Tokens" subclass: the raid drop an officer hands a vendor
   * for a tier piece. Absent means nobody has asked yet; `false` means Wowhead
   * answered and this is an ordinary item — the two are not the same, and the
   * backfill queue is built on the difference.
   */
  armorToken: z.boolean().optional(),
  /**
   * For a tier piece: the armor token that buys it.
   *
   * Stored on the piece, not the token, because that is the direction the
   * domain is one-to-one. One token buys nine pieces — three classes and, for
   * most, three spec variants each — so token→piece needs a judgement about
   * which variant a raider meant. Piece→token needs none, and "which of the
   * pieces this token buys did they wishlist" answers the judgement from the
   * raider's own list.
   */
  redeemsFrom: z.number().int().positive().optional(),
  /**
   * Wowhead has been asked about this id since the phase became something we
   * read off its answer.
   *
   * Not the same as having a phase: most of TBC's launch items carry no phase
   * tag at all, so without this the backfill would ask about them again on
   * every press, forever. Written by the resolver only; never seeded.
   */
  phaseChecked: z.boolean().optional(),
});

export const slotItemSchema = z.object({
  slot: z.enum(SLOT_IDS),
  itemId: z.number().int().positive(),
  /** Denormalized so a set renders even on item-cache misses. */
  itemName: z.string().min(1),
  /**
   * The permanent enchant the set calls for. `id` is the SpellItemEnchantment
   * id — the SAME id Warcraft Logs reports as permanentEnchant, which is what
   * lets an imported set both name and grade what a raider is actually wearing.
   * `itemId` is the glyph/inscription/armor kit that applies it, when one does.
   */
  enchant: z
    .object({
      id: z.number().int().optional(),
      itemId: z.number().int().optional(),
      name: z.string().min(1),
    })
    .optional(),
  gems: z
    .array(
      z.object({
        id: z.number().int().optional(),
        name: z.string().min(1),
        icon: z.string().optional(),
      }),
    )
    .optional(),
});

/**
 * Open stat map — resilient to whatever keys SixtyUpgrades exports.
 * Display order/labels come from STAT_META; unknown keys are shown prettified.
 */
export const statBlockSchema = z.record(z.string(), z.number());

export const gearSetSchema = z
  .object({
    id: z.string().min(1),
    characterId: z.string().min(1),
    kind: z.enum(GEAR_SET_KINDS),
    phase: phaseSchema.optional(),
    name: z.string().min(1),
    source: z.enum(GEAR_SET_SOURCES),
    sourceUrl: z.url().optional(),
    importedAt: z.string().min(1),
    stats: statBlockSchema,
    slots: z.array(slotItemSchema),
  })
  .refine((s) => s.kind !== "wishlist" || s.phase !== undefined, {
    message: "wishlist gear sets require a phase",
  });

/**
 * One slot of a character's current gear, pinned by an officer.
 *
 * A SixtyUpgrades export is a snapshot of intent, and it goes stale the moment
 * someone wins an upgrade — but the logs know exactly what was worn on every
 * pull. An override pins one slot to an item read off those recent raids, so
 * "currently" on a wishlist row, wishlist completion and item contention all
 * follow reality without waiting for the raider to re-export.
 *
 * One per character × spec × slot (the slot lives on `item`); clearing it
 * hands the slot back to the imported set. Enchant and gems are deliberately
 * not stored: the item is what loot decisions turn on, and the logs already
 * render the worn enchant and gems on the gear panel — inventing names here
 * would be worse than pointing at the pull that has them.
 */
export const currentGearOverrideSchema = z.object({
  characterId: z.string().min(1),
  item: slotItemSchema,
  source: z.enum(GEAR_OVERRIDE_SOURCES),
  /**
   * Which kit the slot belongs to. Absent means "main", so every override
   * written before off-spec gear existed keeps its meaning.
   */
  spec: z.enum(GEAR_SPECS).default("main"),
  /** ISO timestamp the officer pinned it. */
  setAt: z.string().min(1),
});

export const raidSessionSchema = z.object({
  id: z.string().min(1),
  guildId: z.string().min(1),
  /** ISO date of the raid night. */
  date: z.string().min(1),
  zones: z.array(z.string().min(1)).min(1),
  note: z.string().optional(),
  source: z.enum(SESSION_SOURCES),
});

/**
 * The arithmetic a loot decision was made on, frozen at the moment it was made.
 *
 * The council chose snapshot-at-decision over effective-dated policy: live
 * views always read current policy, and only a decision that WAS made gets
 * frozen. That's what makes "why was he ranked first in June" answerable after
 * the weights have moved on.
 *
 * **Absent means the award didn't come from the ranking** — a Gargul import, a
 * hand-added drop, an off-roster destination. It never means "scored zero".
 */
export const awardDecisionSchema = z.object({
  /** The winner's loot-priority score at award time. Absent = no data to score. */
  score: z.number().optional(),
  /** Where they sat on the board, and how many were contending. */
  rank: z.number().int().positive().optional(),
  contenders: z.number().int().nonnegative(),
  /** Each factor as it read: enough to reconstruct the sentence, not the model. */
  factors: z
    .array(
      z.object({
        label: z.string(),
        score: z.number().optional(),
        weight: z.number(),
        detail: z.string(),
      }),
    )
    .default([]),
  adjustments: z
    .array(z.object({ label: z.string(), multiplier: z.number(), note: z.string().optional() }))
    .default([]),
  /** The council's chain for this item, as written at the time. */
  chain: z.string().optional(),
  /** The tier the winner satisfied, when the chain named one. */
  tierLabel: z.string().optional(),
  /** The weighting in force — the numbers behind the score. */
  weights: z.object({
    attendance: z.number(),
    lootDebt: z.number(),
    performance: z.number(),
    preparation: z.number(),
  }),
  capturedAt: z.string().min(1),
});

export const lootAwardSchema = z.object({
  id: z.string().min(1),
  raidSessionId: z.string().min(1),
  /** null = winner not resolved to a roster character (e.g. disenchanted, pug). */
  characterId: z.string().nullable(),
  /**
   * True when the winner deliberately isn't a roster character (disenchanted,
   * banked, PUG). characterId null + external false = awaiting resolution.
   */
  external: z.boolean().default(false),
  /** Always keep exactly what Gargul said. */
  rawWinnerName: z.string().min(1),
  itemId: z.number().int().positive(),
  itemName: z.string().min(1),
  awardedAt: z.string().min(1),
  offspec: z.boolean(),
  note: z.string().optional(),
  /** How the council's board read when this was awarded. See the schema above. */
  decision: awardDecisionSchema.optional(),
});

/* Warcraft Logs performance entities (M4) */

export const wclRoleSchema = z.enum(["tank", "healer", "dps"]);

/** One worn item from a combatant-info gear array (slim, JSON-persisted). */
export const wclGearItemSchema = z.object({
  /** Equipment-slot index in WCL's gear-array order. */
  slot: z.number().int().nonnegative(),
  id: z.number().int().positive(),
  ilvl: z.number().int().optional(),
  /** Item quality straight from the log — colours the row with no lookup. */
  quality: z.enum(QUALITIES).optional(),
  /** Permanent enchantment id. Wowhead has no page for these; the item's hover tooltip renders it. */
  enchant: z.number().int().optional(),
  /** Temporary enchant id (oil / stone / poison / imbue). */
  temp: z.number().int().optional(),
  /**
   * Socketed gems, each with the icon the log carries (names come from the
   * item cache). Socket counts aren't logged, so empty sockets stay invisible.
   * Imports from before gem icons were kept are bare ids — read as {id}.
   */
  gems: z
    .array(
      z
        .union([z.number().int(), z.object({ id: z.number().int(), icon: z.string().optional() })])
        .transform((gem) => (typeof gem === "number" ? { id: gem } : gem)),
    )
    .default([]),
  /** Pass-throughs when WCL includes them. */
  name: z.string().optional(),
  icon: z.string().optional(),
});

/** One fetched Warcraft Logs report (refetching replaces it wholesale). */
export const wclReportSchema = z.object({
  /** The WCL report code — primary key, straight from the URL. */
  code: z.string().min(1),
  title: z.string().min(1),
  zone: z.string().optional(),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  fetchedAt: z.string().min(1),
  /**
   * The aura names this app asked WCL for when the report was fetched. Absence
   * of an aura from a report's rows only means "the raid didn't have it" if the
   * aura is in here; otherwise it means the report predates that track.
   * Empty on reports imported before this was recorded.
   */
  upkeepTracks: z.array(z.string()).default([]),
  /** Optional link to the Gargul raid session covering the same night. */
  raidSessionId: z.string().nullable().default(null),
});

/** One player × one boss pull, as extracted from a report. */
export const wclPlayerFightSchema = z.object({
  id: z.string().min(1),
  reportCode: z.string().min(1),
  fightId: z.number().int().nonnegative(),
  encounterId: z.number().int().nonnegative(),
  encounterName: z.string().min(1),
  kill: z.boolean(),
  /** Boss health % remaining — only meaningful on wipes. */
  fightPercentage: z.number().optional(),
  durationMs: z.number().nonnegative(),
  /** Fight start, ms from report start — absolute pull/kill clock times derive from it. Absent on pre-timeline imports. */
  fightStartMs: z.number().nonnegative().optional(),
  /** Player name exactly as logged (no realm — WCL keeps server separate). */
  actorName: z.string().min(1),
  /** Roster match by name, like Gargul winners; null = not on the roster. */
  characterId: z.string().nullable().default(null),
  /** WCL's class/spec strings — display-only, never forced into our enums. */
  className: z.string().optional(),
  spec: z.string().optional(),
  role: wclRoleSchema,
  /** Parse percentile (dps for tanks/dps, hps for healers). */
  parsePercent: z.number().min(0).max(100).optional(),
  /** Percentile within the item-level bracket — gear-adjusted skill signal. */
  bracketPercent: z.number().min(0).max(100).optional(),
  /**
   * Parse percentile on damage to the BOSS only — the metric that ignores adds
   * and cleave padding. Absent on imports from before it was fetched.
   */
  bossParsePercent: z.number().min(0).max(100).optional(),
  /** Boss-only dps behind `bossParsePercent`. */
  bossAmount: z.number().optional(),
  /** The metric value itself (dps or hps). */
  amount: z.number().optional(),
  deaths: z.number().int().nonnegative().default(0),
  flask: z.string().optional(),
  elixirs: z.array(z.string()).default([]),
  /** Scroll buffs at pull, rank included ("Scroll of Agility V"). */
  scrolls: z.array(z.string()).default([]),
  food: z.boolean().default(false),
  /** Temporary weapon enchant at pull (oil / stone / poison / imbue). */
  weaponBuff: z.boolean().default(false),
  /** A combat-potion aura was already up at pull (pre-pot). */
  prepot: z.boolean().default(false),
  /**
   * Which potion that was. Absent on reports imported before the name was
   * kept — the boolean above was all we stored, so those count the use under a
   * stand-in name until they are re-imported.
   */
  prepotLabel: z.string().optional(),
  potions: z.array(z.string()).default([]),
  /** Non-potion in-fight consumables (healthstones, runes, mana gems, seeds, drums). */
  otherCasts: z.array(z.string()).default([]),
  /** Off-slot consumable buffs at pull (alcohol, Bogling Root, …). */
  extras: z.array(z.string()).default([]),
  /** Major class cooldowns cast during the pull, one entry per use. */
  cooldowns: z.array(z.string()).default([]),
  /**
   * When those cooldowns — and the shaman totem drops — happened, ms from the
   * pull start. Empty on imports from before cast timing was tracked.
   */
  castTimes: z
    .array(
      z.object({
        name: z.string().min(1),
        atMs: z.number().nonnegative(),
        /** Friendly target, when it wasn't the caster themself. */
        target: z.string().optional(),
        /** A shaman totem drop rather than a class cooldown. */
        totem: z.boolean().optional(),
      }),
    )
    .default([]),
  /**
   * When they died, ms from the pull start, in order.
   *
   * The count alone says a raid loses people; the timing says whether they lose
   * them to an opener nobody survived or to attrition at 40%, and those are
   * different problems with different fixes. Empty on reports imported before
   * the timing was kept — the events were always fetched, the timestamp was
   * simply dropped — so a re-import is what fills them in.
   */
  deathTimes: z.array(z.number().nonnegative()).default([]),
  /**
   * Maintained debuff/buff uptimes (warlock curses, Thunder Clap, shouts…),
   * % of the pull for the best target. `targets` (absent on pre-timeline
   * imports) breaks it down per victim — boss, adds (with instance numbers)
   * or the buffed friendly — with the exact up-intervals inside the pull.
   */
  upkeep: z
    .array(
      z.object({
        name: z.string().min(1),
        pct: z.number().min(0).max(100),
        targets: z
          .array(
            z.object({
              /** Target name as logged (NPC or friendly player). */
              target: z.string().min(1),
              /** WCL instance number when several copies of the NPC exist. */
              instance: z.number().int().positive().optional(),
              /** True when the target is the encounter boss (WCL subType "Boss"). */
              boss: z.boolean(),
              /** True when the target is a friendly player — feeds the "uptime by player" view. */
              player: z.boolean().optional(),
              pct: z.number().min(0).max(100),
              /** [startMs, endMs] pairs relative to the fight start. */
              segments: z.array(z.tuple([z.number(), z.number()])),
              /** ≈ times the aura was applied/refreshed (stacking spam like Sunder Armor counts each landed cast). */
              applications: z.number().int().nonnegative().optional(),
            }),
          )
          .optional(),
      }),
    )
    .default([]),
  drums: z.number().int().nonnegative().default(0),
  runes: z.number().int().nonnegative().default(0),
  healthstones: z.number().int().nonnegative().default(0),
  sappers: z.number().int().nonnegative().default(0),
  /** Expected-to-be-enchanted gear slots missing a permanent enchant at pull. */
  missingEnchants: z.array(z.string()).default([]),
  /** Full worn-gear snapshot at the pull (empty for pre-gear-tracking imports). */
  gear: z.array(wclGearItemSchema).default([]),
  /**
   * Points per talent tree at the pull, in the game's tree order — the build as
   * actually played (a Warrior's [33,28,0] and [21,40,0] are different specs
   * wearing the same class name). Empty for imports predating talent capture.
   *
   * Opaque on purpose: compare arrays for equality, never infer which abilities
   * a build could use — see the note in wcl/normalize.
   */
  talents: z.array(z.number()).default([]),
});

/**
 * One player's consumable use away from the boss pulls, for one report.
 *
 * Boss pulls are a minority of a raid night. A potion drunk clearing trash
 * costs the same gold and shows the same habit as one drunk on the boss, and
 * pet food is applied between pulls by definition — neither has a fight row to
 * live on, so they get one record per player per report instead.
 */
export const wclPlayerOffPullSchema = z.object({
  /** `${reportCode}|${lowercased actor name}` — one per player per report. */
  id: z.string().min(1),
  reportCode: z.string().min(1),
  actorName: z.string().min(1),
  /** Roster match, null when the name belongs to nobody tracked. */
  characterId: z.string().nullable(),
  potions: z.array(z.string()).default([]),
  otherCasts: z.array(z.string()).default([]),
  drums: z.number().int().nonnegative().default(0),
  runes: z.number().int().nonnegative().default(0),
  healthstones: z.number().int().nonnegative().default(0),
  sappers: z.number().int().nonnegative().default(0),
  /** Food and scrolls put on their pet, whenever in the night it happened. */
  petConsumables: z.array(z.string()).default([]),
});

/**
 * One officer comment on a character — a timestamped log entry, richer than the
 * single inline `note`. Free-form body with an optional author and a category
 * for filing/coloring. Multiple per character, newest first when rendered.
 */
export const characterCommentSchema = z.object({
  id: z.string().min(1),
  characterId: z.string().min(1),
  /** What the comment is about — drives the colored chip. Defaults to a neutral note. */
  category: z.enum(COMMENT_CATEGORIES).default("note"),
  body: z.string().min(1),
  /** Who wrote it (free text — there's no auth). Optional. */
  author: z.string().optional(),
  /** ISO timestamp the comment was created. */
  createdAt: z.string().min(1),
});

/**
 * An excused absence: one character × one reset week (the EU-reset Wednesday
 * ISO date) that should not count toward that character's attendance markup.
 */
export const attendanceExemptionSchema = z.object({
  characterId: z.string().min(1),
  /** Reset-week start (Wednesday), as produced by resetWeekStart(). */
  weekStart: z.string().min(1),
  /** Optional reason ("told us in advance", "holiday"). */
  note: z.string().optional(),
});

/* Seed file schemas */
export const seedGuildSchema = guildSchema;
export const seedRosterSchema = z.array(characterSchema);
export const seedItemsSchema = z.array(itemSchema);
export const seedGearSetsSchema = z.array(gearSetSchema);
export const seedCurrentGearOverridesSchema = z.array(currentGearOverrideSchema);
export const seedRaidSessionsSchema = z.array(raidSessionSchema);
export const seedLootAwardsSchema = z.array(lootAwardSchema);
export const seedWclReportsSchema = z.array(wclReportSchema);
export const seedWclPlayerFightsSchema = z.array(wclPlayerFightSchema);
export const seedWclPlayerOffPullSchema = z.array(wclPlayerOffPullSchema);
export const seedAttendanceExemptionsSchema = z.array(attendanceExemptionSchema);
/**
 * A note on one item — from a raider about their own claim, or from an officer
 * about the council's.
 *
 * `characterId` is optional and means two different things on purpose: set, the
 * note is about that raider's claim ("2nd choice for Melige, he'd rather hold");
 * absent, it is about the item itself ("contested every week, flag it high
 * value"). Both belong on the same page, so they share a table.
 *
 * Nothing here feeds a score. That is the point — the council said the
 * BiS-versus-second-choice call is too situational to automate, so this carries
 * the situation instead.
 */
export const itemCommentSchema = z.object({
  id: z.string().min(1),
  itemId: z.number().int().positive(),
  /** Whose claim the note is about, when it is about one. */
  characterId: z.string().min(1).optional(),
  voice: z.enum(ITEM_COMMENT_VOICES).default("officer"),
  body: z.string().min(1),
  /** Who wrote it (free text — there's no auth). Optional. */
  author: z.string().optional(),
  createdAt: z.string().min(1),
});

export const seedItemCommentsSchema = z.array(itemCommentSchema);

export const seedCharacterCommentsSchema = z.array(characterCommentSchema);

/**
 * What the reporter's browser volunteered about where they were when something
 * looked wrong. Every field is optional and every field is shown to them before
 * they send it — see `FeedbackDialog`. Nothing here is collected passively.
 */
export const feedbackContextSchema = z.object({
  /** A readable name for the element they pointed at: `button "Award item"`. */
  elementLabel: z.string().max(200).optional(),
  /** CSS path to that element, for finding it again in the source. */
  elementSelector: z.string().max(500).optional(),
  /** Its visible text, trimmed — usually the fastest way to locate it. */
  elementText: z.string().max(300).optional(),
  /** "1512×945". Layout bugs are usually width bugs. */
  viewport: z.string().max(40).optional(),
  /** Which theme was active, since half the UI now depends on it. */
  theme: z.enum(["light", "dark"]).optional(),
  /** Coarse browser/OS string the widget derives — never the raw UA. */
  browser: z.string().max(120).optional(),
});

/**
 * A bug report someone filed from inside the app.
 *
 * Deliberately unlinked to any character or raid: this is about the tool, not
 * about the guild, and it must stay readable even after the page it describes
 * has been rewritten. `route` and `url` are stored as text for that reason.
 */
export const feedbackReportSchema = z.object({
  id: z.string().min(1),
  /**
   * What kind of report this is. Defaults to `bug` so reports filed before
   * the two entry points existed keep the meaning they were filed under.
   */
  kind: z.enum(["bug", "feedback"]).default("bug"),
  /** Free text — there's no auth here, same as character comments. */
  reporter: z.string().max(60).optional(),
  body: z.string().min(1),
  /** Pathname only, e.g. `/characters/stiligwarr/performance`. */
  route: z.string().min(1),
  /** Full URL including query, which often carries the state that broke. */
  url: z.string().min(1),
  /** Absent when the reporter opted out of sharing context. */
  context: feedbackContextSchema.optional(),
  /** Triage state. The reporter's words are never edited, only triaged. */
  status: z.enum(["open", "resolved"]).default("open"),
  /**
   * How much it matters, set by whoever triages it — never by the reporter.
   *
   * `unset` rather than a middle value: "nobody has looked at this yet" and
   * "somebody looked and called it minor" are different states, and a default
   * of "minor" would quietly turn the first into the second.
   */
  priority: z.enum(["unset", "minor", "major"]).default("unset"),
  /**
   * The triager's note back — what was decided, what it's waiting on, why it
   * was closed. Kept apart from `body`, which stays exactly as it was filed.
   */
  adminNote: z.string().max(2000).optional(),
  /**
   * Who left the note and when.
   *
   * Free text and self-declared, like every other name in this app — there is
   * no auth here. It is still what makes a note answerable: "somebody decided
   * this" and "Fredrik decided this on Tuesday" are different messages, and an
   * officer coming back to the page needs to know whether the note is theirs.
   */
  adminNoteAuthor: z.string().max(60).optional(),
  adminNoteAt: z.string().optional(),
  createdAt: z.string().min(1),
});

export const seedFeedbackSchema = z.array(feedbackReportSchema);

/* Parser output contracts (used by the M1 import preview; M2 parsers emit these) */

/** A gear set as parsed from a SixtyUpgrades export: GearSet minus identity fields. */
export const gearSetImportSchema = z.looseObject({
  name: z.string().optional(),
  character: z
    .looseObject({
      name: z.string().optional(),
      class: z.string().optional(),
      spec: z.string().optional(),
      race: z.string().optional(),
    })
    .optional(),
  stats: statBlockSchema.optional().default({}),
  slots: z.array(slotItemSchema).min(1),
});
export type GearSetImport = z.infer<typeof gearSetImportSchema>;

/** One award line as parsed from a Gargul export paste. */
export const gargulAwardLineSchema = z.object({
  awardedAt: z.string().min(1),
  itemId: z.number().int().positive(),
  itemName: z.string().min(1),
  rawWinnerName: z.string().min(1),
  offspec: z.boolean(),
});
export type GargulAwardLine = z.infer<typeof gargulAwardLineSchema>;
