import { z } from "zod";
import {
  CHARACTER_STATUSES,
  FACTIONS,
  GEAR_SET_KINDS,
  GEAR_SET_SOURCES,
  PHASE_IDS,
  QUALITIES,
  ROLES,
  SESSION_SOURCES,
  SLOT_IDS,
  WOW_CLASSES,
} from "@/lib/constants/wow";
import { COMMENT_CATEGORIES } from "@/lib/comments";

/**
 * Canonical entity shapes — the single shape contract of the app.
 * Seed JSON is validated against these at load, and the future import parsers
 * (SixtyUpgrades / Gargul, M2) emit exactly these shapes. That guarantees the
 * seed data and real imported data are interchangeable.
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

/** Item cache entry (WoW item ID is the primary key). */
export const itemSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  quality: z.enum(QUALITIES),
  /** Wowhead/zamimg icon name, e.g. "inv_axe_60". */
  icon: z.string().min(1),
  slot: z.enum(SLOT_IDS).nullish(),
  source: z.object({ zone: z.string(), boss: z.string().optional() }).optional(),
  phase: phaseSchema.optional(),
});

export const slotItemSchema = z.object({
  slot: z.enum(SLOT_IDS),
  itemId: z.number().int().positive(),
  /** Denormalized so a set renders even on item-cache misses. */
  itemName: z.string().min(1),
  enchant: z
    .object({ id: z.number().int().optional(), name: z.string().min(1) })
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

export const raidSessionSchema = z.object({
  id: z.string().min(1),
  guildId: z.string().min(1),
  /** ISO date of the raid night. */
  date: z.string().min(1),
  zones: z.array(z.string().min(1)).min(1),
  note: z.string().optional(),
  source: z.enum(SESSION_SOURCES),
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
});

/* Warcraft Logs performance entities (M4) */

export const wclRoleSchema = z.enum(["tank", "healer", "dps"]);

/** One worn item from a combatant-info gear array (slim, JSON-persisted). */
export const wclGearItemSchema = z.object({
  /** Equipment-slot index in WCL's gear-array order. */
  slot: z.number().int().nonnegative(),
  id: z.number().int().positive(),
  ilvl: z.number().int().optional(),
  /** Permanent enchantment id (Wowhead /tbc/enchantment=…). */
  enchant: z.number().int().optional(),
  /** Temporary enchant id (oil / stone / poison / imbue). */
  temp: z.number().int().optional(),
  /** Socketed gem ITEM ids — socket counts aren't in the log, so empties are invisible. */
  gems: z.array(z.number().int()).default([]),
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
  potions: z.array(z.string()).default([]),
  /** Non-potion in-fight consumables (healthstones, runes, mana gems, seeds, drums). */
  otherCasts: z.array(z.string()).default([]),
  /** Off-slot consumable buffs at pull (alcohol, Bogling Root, …). */
  extras: z.array(z.string()).default([]),
  /** Major class cooldowns cast during the pull, one entry per use. */
  cooldowns: z.array(z.string()).default([]),
  /** Maintained debuff/buff uptimes (warlock curses, Thunder Clap, shouts…), % of the pull. */
  upkeep: z.array(z.object({ name: z.string().min(1), pct: z.number().min(0).max(100) })).default([]),
  drums: z.number().int().nonnegative().default(0),
  runes: z.number().int().nonnegative().default(0),
  healthstones: z.number().int().nonnegative().default(0),
  sappers: z.number().int().nonnegative().default(0),
  /** Expected-to-be-enchanted gear slots missing a permanent enchant at pull. */
  missingEnchants: z.array(z.string()).default([]),
  /** Full worn-gear snapshot at the pull (empty for pre-gear-tracking imports). */
  gear: z.array(wclGearItemSchema).default([]),
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
export const seedRaidSessionsSchema = z.array(raidSessionSchema);
export const seedLootAwardsSchema = z.array(lootAwardSchema);
export const seedWclReportsSchema = z.array(wclReportSchema);
export const seedWclPlayerFightsSchema = z.array(wclPlayerFightSchema);
export const seedAttendanceExemptionsSchema = z.array(attendanceExemptionSchema);
export const seedCharacterCommentsSchema = z.array(characterCommentSchema);

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
