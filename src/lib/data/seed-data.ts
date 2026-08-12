import guildJson from "@/data/seed/guild.json";
import rosterJson from "@/data/seed/roster.json";
import itemsJson from "@/data/seed/items.json";
import gearSetsJson from "@/data/seed/gear-sets.json";
import raidSessionsJson from "@/data/seed/raid-sessions.json";
import lootAwardsJson from "@/data/seed/loot-awards.json";
import wclReportsJson from "@/data/seed/wcl-reports.json";
import wclPlayerFightsJson from "@/data/seed/wcl-player-fights.json";
import attendanceExemptionsJson from "@/data/seed/attendance-exemptions.json";
import characterCommentsJson from "@/data/seed/character-comments.json";
import {
  seedAttendanceExemptionsSchema,
  seedCharacterCommentsSchema,
  seedGearSetsSchema,
  seedGuildSchema,
  seedItemsSchema,
  seedLootAwardsSchema,
  seedRaidSessionsSchema,
  seedRosterSchema,
  seedWclPlayerFightsSchema,
  seedWclReportsSchema,
} from "@/lib/import/schemas";
import { validateStore, type EntityStore } from "@/lib/data/store";

function fail(file: string, error: unknown): never {
  throw new Error(`Seed data invalid (${file}): ${error instanceof Error ? error.message : String(error)}`);
}

function parse<T>(file: string, schema: { parse: (d: unknown) => T }, data: unknown): T {
  try {
    return schema.parse(data);
  } catch (e) {
    fail(file, e);
  }
}

/**
 * The seed dataset, validated against the SAME zod schemas the import parsers
 * emit. Used directly by the read-only seed backend and as the initial content
 * of a freshly created SQLite database.
 */
export function loadSeedStore(): EntityStore {
  const store: EntityStore = {
    guild: parse("guild.json", seedGuildSchema, guildJson),
    roster: parse("roster.json", seedRosterSchema, rosterJson),
    items: parse("items.json", seedItemsSchema, itemsJson),
    gearSets: parse("gear-sets.json", seedGearSetsSchema, gearSetsJson),
    // Pinning is an officer action, never seeded — the demo starts from what
    // the fictional raiders "exported".
    currentGearOverrides: [],
    raidSessions: parse("raid-sessions.json", seedRaidSessionsSchema, raidSessionsJson),
    lootAwards: parse("loot-awards.json", seedLootAwardsSchema, lootAwardsJson),
    wclReports: parse("wcl-reports.json", seedWclReportsSchema, wclReportsJson),
    wclPlayerFights: parse("wcl-player-fights.json", seedWclPlayerFightsSchema, wclPlayerFightsJson),
    // Off-pull consumables come from real imports only — the demo's fights are
    // hand-written pulls with no trash between them.
    wclPlayerOffPull: [],
    attendanceExemptions: parse("attendance-exemptions.json", seedAttendanceExemptionsSchema, attendanceExemptionsJson),
    characterComments: parse("character-comments.json", seedCharacterCommentsSchema, characterCommentsJson),
    // Notes on an item are the council arguing with itself — there is nothing
    // to demo, and a fabricated one would read like a real decision.
    itemComments: [],
    // Bug reports are filed by whoever is running the app; the demo has none.
    feedback: [],
    // The seed demo has no accounts, so it has no memberships, roles or
    // invites either. A seed backend is read-only and can never gain them.
    memberships: [],
    guildRoles: [],
    guildInvites: [],
    guildAudit: [],
  };
  validateStore(store, "seed data");
  return store;
}
