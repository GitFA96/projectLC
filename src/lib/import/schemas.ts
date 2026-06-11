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

/* Seed file schemas */
export const seedGuildSchema = guildSchema;
export const seedRosterSchema = z.array(characterSchema);
export const seedItemsSchema = z.array(itemSchema);
export const seedGearSetsSchema = z.array(gearSetSchema);
export const seedRaidSessionsSchema = z.array(raidSessionSchema);
export const seedLootAwardsSchema = z.array(lootAwardSchema);

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
