import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  attendanceExemptionSchema,
  characterCommentSchema,
  characterSchema,
  currentGearOverrideSchema,
  gearSetSchema,
  guildSchema,
  itemSchema,
  lootAwardSchema,
  raidSessionSchema,
  wclPlayerFightSchema,
  wclPlayerOffPullSchema,
  wclReportSchema,
} from "@/lib/import/schemas";
import type { AbilityInfo } from "@/lib/items/ability-data";
import { UPTIME_TRACK_BY_LABEL } from "@/lib/wcl/class-tracks";
import { loadSeedStore } from "@/lib/data/seed-data";
import { validateStore, type EntityStore } from "@/lib/data/store";
import type {
  AttendanceExemption,
  ConsumableAdjustment,
  Character,
  CharacterComment,
  ConsumablePrice,
  CurrentGearOverride,
  GearSet,
  Guild,
  Item,
  LootAward,
  LootPriorityWeights,
  RaidSession,
  WclPlayerFight,
  WclPlayerOffPull,
  WclReport,
} from "@/lib/types";

/**
 * SQLite persistence on Node's built-in driver (node:sqlite) — no native
 * modules to compile. Nested values (slots, stats, zones) are stored as JSON
 * columns; every load re-validates rows against the canonical zod schemas so
 * schema drift surfaces as a loud error, never as a half-rendered page.
 *
 * The database file lives at data/projectlc.db (override: PROJECTLC_DB).
 * A fresh database is seeded from src/data/seed — delete the file to reset.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS guild (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  realm        TEXT NOT NULL,
  faction      TEXT NOT NULL,
  active_phase INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS characters (
  id                TEXT PRIMARY KEY,
  guild_id          TEXT NOT NULL,
  name              TEXT NOT NULL COLLATE NOCASE UNIQUE,
  class             TEXT NOT NULL,
  spec              TEXT NOT NULL,
  role              TEXT NOT NULL,
  off_spec          TEXT,
  off_spec_role     TEXT,
  race              TEXT,
  status            TEXT NOT NULL,
  main_character_id TEXT,
  note              TEXT
);
-- Only the id is required: the cache is filled from whatever each import
-- knew (a Gargul link has a name, a log's gear snapshot only an icon) and
-- later sources fill the gaps in place. NULL means "not known yet".
CREATE TABLE IF NOT EXISTS items (
  id          INTEGER PRIMARY KEY,
  name        TEXT,
  quality     TEXT,
  icon        TEXT,
  slot        TEXT,
  source_json TEXT,
  phase       INTEGER
);
CREATE TABLE IF NOT EXISTS gear_sets (
  id           TEXT PRIMARY KEY,
  character_id TEXT NOT NULL REFERENCES characters(id),
  kind         TEXT NOT NULL,
  phase        INTEGER,
  name         TEXT NOT NULL,
  source       TEXT NOT NULL,
  source_url   TEXT,
  imported_at  TEXT NOT NULL,
  stats_json   TEXT NOT NULL,
  slots_json   TEXT NOT NULL
);
-- One "current" set per character, one wishlist per character+phase: the
-- update flow is replace, never accumulate.
CREATE UNIQUE INDEX IF NOT EXISTS gear_sets_one_current
  ON gear_sets(character_id) WHERE kind = 'current';
CREATE UNIQUE INDEX IF NOT EXISTS gear_sets_one_wishlist_per_phase
  ON gear_sets(character_id, phase) WHERE kind = 'wishlist';
-- What an officer says a raider ACTUALLY has in one slot right now, pinned
-- from their recent logs. Overrides that slot of the imported set (and stands
-- alone when there is no import); deleting the row hands the slot back.
-- The spec column splits the main-spec kit from the off-spec one: a raider who
-- tanks on the side has two answers for the same slot, and only the main one
-- is what loot gets judged on.
CREATE TABLE IF NOT EXISTS current_gear_overrides (
  character_id TEXT NOT NULL REFERENCES characters(id),
  spec         TEXT NOT NULL DEFAULT 'main',
  slot         TEXT NOT NULL,
  item_id      INTEGER NOT NULL,
  item_name    TEXT NOT NULL,
  source       TEXT NOT NULL,
  set_at       TEXT NOT NULL,
  PRIMARY KEY (character_id, spec, slot)
);
-- Consumables used away from the boss pulls: trash, running back, buffing up.
-- One row per player per report — there is no fight to hang them on, and a
-- potion drunk on trash costs the same gold as one drunk on the boss. Pet food
-- and pet scrolls live here too, whenever in the night they were applied.
CREATE TABLE IF NOT EXISTS wcl_player_offpull (
  id                   TEXT PRIMARY KEY,
  report_code          TEXT NOT NULL REFERENCES wcl_reports(code),
  actor_name           TEXT NOT NULL,
  character_id         TEXT,
  potions_json         TEXT NOT NULL DEFAULT '[]',
  other_casts_json     TEXT NOT NULL DEFAULT '[]',
  drums                INTEGER NOT NULL DEFAULT 0,
  runes                INTEGER NOT NULL DEFAULT 0,
  healthstones         INTEGER NOT NULL DEFAULT 0,
  sappers              INTEGER NOT NULL DEFAULT 0,
  pet_consumables_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS wcl_player_offpull_report ON wcl_player_offpull(report_code);
-- Ability names resolved from Wowhead, so a simulation's actions have names.
-- Warcraft Logs only names what somebody cast, which leaves exactly the
-- interesting rows ("the sim used Execute, you never did") as bare ids.
-- "spell" and "item" are separate id spaces that overlap (23827 is a sapper
-- charge AND Master Demonologist), so the kind is half the key.
CREATE TABLE IF NOT EXISTS abilities (
  kind          TEXT NOT NULL,
  id            INTEGER NOT NULL,
  name          TEXT NOT NULL,
  icon          TEXT,
  description   TEXT,
  -- For an item: the spell its Use effect casts, which is what the combat log
  -- records. Without it the same click is two rows in the sim comparison.
  use_spell_id  INTEGER,
  resolved_at   TEXT NOT NULL,
  PRIMARY KEY (kind, id)
);
-- SpellItemEnchantment id -> the effect text an item tooltip shows for it.
-- Its own id space, so it can't share the items table. Filled one lookup per
-- unknown id, ever; an id nothing can name simply has no row.
CREATE TABLE IF NOT EXISTS enchant_names (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  resolved_at TEXT NOT NULL
);
-- Officer edits to the council's spec priority sheet. Keyed by NORMALIZED item
-- name, not id: a sheet covers everything a boss can drop, most of which the
-- item cache has never heard of. Absent = the seeded sheet stands.
CREATE TABLE IF NOT EXISTS item_priority_rules (
  item_key   TEXT PRIMARY KEY,
  item_name  TEXT NOT NULL,
  chain      TEXT NOT NULL,
  note       TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS raid_sessions (
  id         TEXT PRIMARY KEY,
  guild_id   TEXT NOT NULL,
  date       TEXT NOT NULL,
  zones_json TEXT NOT NULL,
  note       TEXT,
  source     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS loot_awards (
  id              TEXT PRIMARY KEY,
  raid_session_id TEXT NOT NULL REFERENCES raid_sessions(id),
  character_id    TEXT,
  raw_winner_name TEXT NOT NULL,
  item_id         INTEGER NOT NULL,
  item_name       TEXT NOT NULL,
  awarded_at      TEXT NOT NULL,
  offspec         INTEGER NOT NULL,
  external        INTEGER NOT NULL DEFAULT 0,
  note            TEXT
);
CREATE INDEX IF NOT EXISTS loot_awards_dedupe
  ON loot_awards(item_id, raw_winner_name COLLATE NOCASE, awarded_at);
CREATE TABLE IF NOT EXISTS wcl_reports (
  code               TEXT PRIMARY KEY,
  title              TEXT NOT NULL,
  zone               TEXT,
  start_time         TEXT NOT NULL,
  end_time           TEXT NOT NULL,
  fetched_at         TEXT NOT NULL,
  -- Aura names requested at fetch time; see TRACKED_AURA_NAMES.
  upkeep_tracks_json TEXT NOT NULL DEFAULT '[]',
  raid_session_id    TEXT
);
CREATE TABLE IF NOT EXISTS wcl_player_fights (
  id                    TEXT PRIMARY KEY,
  report_code           TEXT NOT NULL REFERENCES wcl_reports(code),
  fight_id              INTEGER NOT NULL,
  encounter_id          INTEGER NOT NULL,
  encounter_name        TEXT NOT NULL,
  kill                  INTEGER NOT NULL,
  fight_percentage      REAL,
  duration_ms           INTEGER NOT NULL,
  actor_name            TEXT NOT NULL,
  character_id          TEXT,
  class_name            TEXT,
  spec                  TEXT,
  role                  TEXT NOT NULL,
  parse_percent         REAL,
  bracket_percent       REAL,
  boss_parse_percent    REAL,
  boss_amount           REAL,
  amount                REAL,
  deaths                INTEGER NOT NULL DEFAULT 0,
  flask                 TEXT,
  elixirs_json          TEXT NOT NULL DEFAULT '[]',
  scrolls_json          TEXT NOT NULL DEFAULT '[]',
  food                  INTEGER NOT NULL DEFAULT 0,
  weapon_buff           INTEGER NOT NULL DEFAULT 0,
  prepot                INTEGER NOT NULL DEFAULT 0,
  potions_json          TEXT NOT NULL DEFAULT '[]',
  other_casts_json      TEXT NOT NULL DEFAULT '[]',
  extras_json           TEXT NOT NULL DEFAULT '[]',
  cooldowns_json        TEXT NOT NULL DEFAULT '[]',
  cast_times_json       TEXT NOT NULL DEFAULT '[]',
  upkeep_json           TEXT NOT NULL DEFAULT '[]',
  gear_json             TEXT NOT NULL DEFAULT '[]',
  talents_json          TEXT NOT NULL DEFAULT '[]',
  drums                 INTEGER NOT NULL DEFAULT 0,
  runes                 INTEGER NOT NULL DEFAULT 0,
  healthstones          INTEGER NOT NULL DEFAULT 0,
  sappers               INTEGER NOT NULL DEFAULT 0,
  missing_enchants_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS wcl_player_fights_by_report ON wcl_player_fights(report_code);
CREATE INDEX IF NOT EXISTS wcl_player_fights_by_character ON wcl_player_fights(character_id);
-- Excused absences: one row per character × reset week that shouldn't count.
CREATE TABLE IF NOT EXISTS attendance_exemptions (
  character_id TEXT NOT NULL REFERENCES characters(id),
  week_start   TEXT NOT NULL,
  note         TEXT,
  PRIMARY KEY (character_id, week_start)
);
-- Officer comment log: many per character, richer than the inline note.
CREATE TABLE IF NOT EXISTS character_comments (
  id           TEXT PRIMARY KEY,
  character_id TEXT NOT NULL REFERENCES characters(id),
  category     TEXT NOT NULL DEFAULT 'note',
  body         TEXT NOT NULL,
  author       TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS character_comments_by_character ON character_comments(character_id);
`;

export function defaultDbPath(): string {
  return process.env.PROJECTLC_DB ?? path.join(process.cwd(), "data", "projectlc.db");
}

/* Keep one handle per path across dev HMR module re-evaluations. */
const globalDbs = globalThis as unknown as { __projectlcDbs?: Map<string, DatabaseSync> };

export function getDb(): DatabaseSync {
  const file = defaultDbPath();
  globalDbs.__projectlcDbs ??= new Map();
  const existing = globalDbs.__projectlcDbs.get(file);
  if (existing) return existing;

  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  migrate(db);
  seedIfEmpty(db);
  globalDbs.__projectlcDbs.set(file, db);
  return db;
}

/** Additive migrations for databases created by earlier versions of the schema. */
function migrate(db: DatabaseSync): void {
  const addColumn = (table: string, column: string, ddl: string) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (cols.length === 0 || cols.some((c) => c.name === column)) return;
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    } catch (e) {
      // Parallel build workers can race the same migration; losing is fine.
      if (!/duplicate column/i.test(String(e))) throw e;
    }
  };
  addColumn("loot_awards", "external", "external INTEGER NOT NULL DEFAULT 0");
  addColumn("wcl_player_fights", "scrolls_json", "scrolls_json TEXT NOT NULL DEFAULT '[]'");
  addColumn("wcl_player_fights", "other_casts_json", "other_casts_json TEXT NOT NULL DEFAULT '[]'");
  addColumn("wcl_player_fights", "extras_json", "extras_json TEXT NOT NULL DEFAULT '[]'");
  addColumn("wcl_player_fights", "cooldowns_json", "cooldowns_json TEXT NOT NULL DEFAULT '[]'");
  addColumn("wcl_player_fights", "cast_times_json", "cast_times_json TEXT NOT NULL DEFAULT '[]'");
  addColumn("wcl_player_fights", "upkeep_json", "upkeep_json TEXT NOT NULL DEFAULT '[]'");
  addColumn("wcl_player_fights", "gear_json", "gear_json TEXT NOT NULL DEFAULT '[]'");
  addColumn("wcl_player_fights", "talents_json", "talents_json TEXT NOT NULL DEFAULT '[]'");
  addColumn("characters", "main_character_id", "main_character_id TEXT");
  addColumn("characters", "off_spec", "off_spec TEXT");
  addColumn("characters", "off_spec_role", "off_spec_role TEXT");
  addColumn("wcl_player_fights", "sappers", "sappers INTEGER NOT NULL DEFAULT 0");
  addColumn("wcl_player_fights", "fight_start_ms", "fight_start_ms INTEGER");
  addColumn("wcl_player_fights", "boss_parse_percent", "boss_parse_percent REAL");
  addColumn("wcl_player_fights", "boss_amount", "boss_amount REAL");
  addColumn("wcl_reports", "upkeep_tracks_json", "upkeep_tracks_json TEXT NOT NULL DEFAULT '[]'");
  backfillUpkeepTracks(db);
  relaxItemColumns(db);
  addAbilityKind(db);
  splitGearOverridesBySpec(db);
}

/**
 * Reports imported before the track list was recorded get a **lower bound**:
 * every aura that actually appears in their rows was, provably, collected.
 *
 * Deliberately not a guess at the whole list. A track that was requested but
 * never landed can't be distinguished from one that was never requested, so it
 * stays out — that report will say "refetch to check" for it, which is true.
 * What this does buy is the common case: an aura the raid used all night is
 * confirmed as tracked without asking the officer to refetch everything again.
 */
function backfillUpkeepTracks(db: DatabaseSync): void {
  const stale = db
    .prepare("SELECT code FROM wcl_reports WHERE upkeep_tracks_json = '[]' OR upkeep_tracks_json IS NULL")
    .all() as { code: string }[];
  if (stale.length === 0) return;
  const rowsFor = db.prepare("SELECT upkeep_json FROM wcl_player_fights WHERE report_code = ?");
  const update = db.prepare("UPDATE wcl_reports SET upkeep_tracks_json = ? WHERE code = ?");
  for (const { code } of stale) {
    const seen = new Set<string>();
    for (const r of rowsFor.all(code) as Row[]) {
      for (const track of JSON.parse((r.upkeep_json as string | null) ?? "[]") as { name: string }[]) {
        // Rows store the display label; the stamp is in track names.
        const known = UPTIME_TRACK_BY_LABEL.get(track.name.toLowerCase());
        seen.add(known?.name ?? track.name);
      }
    }
    if (seen.size > 0) update.run(JSON.stringify([...seen].sort()), code);
  }
}

/**
 * The Wowhead name cache used to be keyed on a bare id, which cannot hold both
 * spell 23827 and item 23827 — and looking every sim action up as a spell is
 * how Bloodlust Brooch came back named "Holy Light".
 *
 * Dropped rather than copied across. Its descriptions came from a parser that
 * read a spell tooltip's requirements instead of its effect, and rows are never
 * overwritten once written — so migrating them would preserve wrong text
 * permanently, with no way to ask again. It is a cache of public data behind
 * one button press, and re-resolving it is cheap.
 */
function addAbilityKind(db: DatabaseSync): void {
  const old = db.prepare("PRAGMA table_info(spells)").all() as { name: string }[];
  if (old.length === 0) return;
  db.exec("DROP TABLE spells;");
}

/**
 * Current-gear pins used to be one row per character × slot. Off-spec gear
 * needs two answers for the same slot, so the key gains `spec` — which SQLite
 * can't do with ALTER TABLE. Rebuilt once; every existing pin is main-spec.
 */
function splitGearOverridesBySpec(db: DatabaseSync): void {
  const cols = db.prepare("PRAGMA table_info(current_gear_overrides)").all() as { name: string }[];
  if (cols.length === 0 || cols.some((c) => c.name === "spec")) return;
  db.exec(`
    CREATE TABLE current_gear_overrides_spec (
      character_id TEXT NOT NULL REFERENCES characters(id),
      spec         TEXT NOT NULL DEFAULT 'main',
      slot         TEXT NOT NULL,
      item_id      INTEGER NOT NULL,
      item_name    TEXT NOT NULL,
      source       TEXT NOT NULL,
      set_at       TEXT NOT NULL,
      PRIMARY KEY (character_id, spec, slot)
    );
    INSERT INTO current_gear_overrides_spec
        (character_id, spec, slot, item_id, item_name, source, set_at)
      SELECT character_id, 'main', slot, item_id, item_name, source, set_at
        FROM current_gear_overrides;
    DROP TABLE current_gear_overrides;
    ALTER TABLE current_gear_overrides_spec RENAME TO current_gear_overrides;
  `);
}

/**
 * Older databases declared items.name/quality/icon NOT NULL, which blocks the
 * partial entries the cache now stores. SQLite can't drop a NOT NULL, so the
 * table is rebuilt once — contents preserved.
 */
function relaxItemColumns(db: DatabaseSync): void {
  const cols = db.prepare("PRAGMA table_info(items)").all() as { name: string; notnull: number }[];
  const required = cols.filter((c) => c.name !== "id" && c.notnull === 1);
  if (required.length === 0) return;
  db.exec(`
    CREATE TABLE items_relaxed (
      id          INTEGER PRIMARY KEY,
      name        TEXT,
      quality     TEXT,
      icon        TEXT,
      slot        TEXT,
      source_json TEXT,
      phase       INTEGER
    );
    INSERT INTO items_relaxed (id, name, quality, icon, slot, source_json, phase)
      SELECT id, name, quality, icon, slot, source_json, phase FROM items;
    DROP TABLE items;
    ALTER TABLE items_relaxed RENAME TO items;
  `);
}

export function withTx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** Monotonic data version — bumped on every mutation so cached read models know to reload. */
export function getDataVersion(db: DatabaseSync): number {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'data_version'").get() as
    | { value: string }
    | undefined;
  return row ? Number(row.value) : 0;
}

export function bumpDataVersion(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('data_version', '1')
     ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)`,
  ).run();
}

/* Per-report consumable prices: editable, per raid night, stored as a JSON blob
   in the meta table keyed by report code. Absent = the raid uses code defaults. */

const consumablePriceKey = (code: string) => `consumable_prices:${code}`;

/** Keep only well-formed { gold, charges } numbers so a hand-edited blob can't crash a read. */
function sanitizePrices(raw: unknown): Record<string, ConsumablePrice> {
  if (raw === null || typeof raw !== "object") return {};
  const out: Record<string, ConsumablePrice> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === null || typeof value !== "object") continue;
    const { gold, charges } = value as Record<string, unknown>;
    if (typeof gold === "number" && Number.isFinite(gold) && gold >= 0) {
      const c = typeof charges === "number" && Number.isFinite(charges) && charges >= 1 ? charges : 1;
      out[name] = { gold, charges: c };
    }
  }
  return out;
}

/** A report's logged consumable prices (empty when the raid hasn't set any). */
export function getReportConsumablePrices(db: DatabaseSync, code: string): Record<string, ConsumablePrice> {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(consumablePriceKey(code)) as
    | { value: string }
    | undefined;
  if (!row) return {};
  try {
    return sanitizePrices(JSON.parse(row.value));
  } catch {
    return {};
  }
}

/** Persist a report's consumable prices (replaces the whole blob for that report). */
export function setReportConsumablePrices(
  db: DatabaseSync,
  code: string,
  prices: Record<string, ConsumablePrice>,
): void {
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(consumablePriceKey(code), JSON.stringify(sanitizePrices(prices)));
}

/* Per-character wowsims setup: the decoded export a raider's comparison runs
   against. Same meta-table pattern as prices, keyed by character slug — a
   build, a rotation and a buff set belong to one raider, not to the guild.
   Absent means that character has no sim configured yet. */

export function getAbilities(db: DatabaseSync): AbilityInfo[] {
  return (
    db.prepare("SELECT kind, id, name, icon, description, use_spell_id FROM abilities").all() as Row[]
  ).map((r) => ({
    kind: r.kind === "item" ? "item" : "spell",
    id: Number(r.id),
    name: String(r.name),
    icon: (r.icon as string | null) ?? undefined,
    description: (r.description as string | null) ?? undefined,
    useSpellId: (r.use_spell_id as number | null) ?? undefined,
  }));
}

/** Record resolved abilities. Refs already known are left alone. */
export function addAbilities(db: DatabaseSync, abilities: AbilityInfo[]): number {
  const stmt = db.prepare(
    `INSERT INTO abilities (kind, id, name, icon, description, use_spell_id, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(kind, id) DO NOTHING`,
  );
  const now = new Date().toISOString();
  let written = 0;
  for (const a of abilities) {
    if (!Number.isFinite(a.id) || a.id <= 0 || !a.name) continue;
    written += Number(
      stmt.run(a.kind, a.id, a.name, a.icon ?? null, a.description ?? null, a.useSpellId ?? null, now)
        .changes,
    );
  }
  return written;
}

const simSettingsKey = (slug: string) => `sim_settings:${slug.toLowerCase()}`;

export function getSimSettings(db: DatabaseSync, slug: string): string | undefined {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(simSettingsKey(slug)) as
    | { value: string }
    | undefined;
  if (!row) return undefined;
  // Stored as the raw protojson the CLI printed. Parsed on read so a corrupted
  // blob reads as "not configured" rather than crashing the page.
  try {
    JSON.parse(row.value);
    return row.value;
  } catch {
    return undefined;
  }
}

/** Save (or clear, with undefined) one character's sim setup. */
export function setSimSettings(db: DatabaseSync, slug: string, json: string | undefined): void {
  if (json === undefined) {
    db.prepare("DELETE FROM meta WHERE key = ?").run(simSettingsKey(slug));
    return;
  }
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(simSettingsKey(slug), json);
}

/* Per-report consumable adjustments: an officer's corrections to what the log
   says each raider got through. Same meta-table pattern as prices; absent
   means the raid's gold is exactly what the log implied. */

const consumableAdjustmentKey = (code: string) => `consumable_adjustments:${code}`;

/** Drop anything malformed so a hand-edited blob can't crash a read. */
function sanitizeAdjustments(raw: unknown): ConsumableAdjustment[] {
  if (!Array.isArray(raw)) return [];
  const out: ConsumableAdjustment[] = [];
  for (const value of raw) {
    if (value === null || typeof value !== "object") continue;
    const { actorName, name, delta, note, at } = value as Record<string, unknown>;
    if (typeof actorName !== "string" || actorName.trim() === "") continue;
    if (typeof name !== "string" || name.trim() === "") continue;
    if (typeof delta !== "number" || !Number.isInteger(delta) || delta === 0) continue;
    out.push({
      actorName: actorName.trim(),
      name: name.trim(),
      delta,
      note: typeof note === "string" && note.trim() !== "" ? note.trim() : undefined,
      at: typeof at === "string" && at !== "" ? at : new Date(0).toISOString(),
    });
  }
  return out;
}

/** One report's hand adjustments (empty when nobody has corrected anything). */
export function getReportConsumableAdjustments(db: DatabaseSync, code: string): ConsumableAdjustment[] {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(consumableAdjustmentKey(code)) as
    | { value: string }
    | undefined;
  if (!row) return [];
  try {
    return sanitizeAdjustments(JSON.parse(row.value));
  } catch {
    return [];
  }
}

/** Every report's adjustments in one query — the career gold rollup needs them all. */
export function getAllConsumableAdjustments(db: DatabaseSync): Record<string, ConsumableAdjustment[]> {
  const rows = db
    .prepare("SELECT key, value FROM meta WHERE key LIKE 'consumable_adjustments:%'")
    .all() as { key: string; value: string }[];
  const out: Record<string, ConsumableAdjustment[]> = {};
  for (const { key, value } of rows) {
    try {
      out[key.slice("consumable_adjustments:".length)] = sanitizeAdjustments(JSON.parse(value));
    } catch {
      // A mangled blob just means "nothing adjusted" for that report.
    }
  }
  return out;
}

/** Replace a report's adjustments (an empty list clears them all). */
export function setReportConsumableAdjustments(
  db: DatabaseSync,
  code: string,
  adjustments: ConsumableAdjustment[],
): void {
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(consumableAdjustmentKey(code), JSON.stringify(sanitizeAdjustments(adjustments)));
}

/* Per-report excluded pulls: the fight ids an officer switched off for a raid
   night, so a farm wipe or a gimmick pull stops skewing the night's numbers.
   Same meta-table pattern as prices — absent means "every pull counts". */

const excludedFightsKey = (code: string) => `excluded_fights:${code}`;

function sanitizeFightIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const ids = raw.filter((v): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0);
  return [...new Set(ids)].sort((a, b) => a - b);
}

/** The pulls excluded from one report's rollups (empty when the raid counts them all). */
export function getReportExcludedFights(db: DatabaseSync, code: string): number[] {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(excludedFightsKey(code)) as
    | { value: string }
    | undefined;
  if (!row) return [];
  try {
    return sanitizeFightIds(JSON.parse(row.value));
  } catch {
    return [];
  }
}

/**
 * Every report's excluded pulls, keyed by report code — one query, so a rollup
 * over many reports doesn't hit the meta table per report.
 */
export function getAllExcludedFights(db: DatabaseSync): Record<string, number[]> {
  const rows = db
    .prepare("SELECT key, value FROM meta WHERE key LIKE 'excluded_fights:%'")
    .all() as { key: string; value: string }[];
  const out: Record<string, number[]> = {};
  for (const { key, value } of rows) {
    try {
      out[key.slice("excluded_fights:".length)] = sanitizeFightIds(JSON.parse(value));
    } catch {
      // A hand-mangled blob just means "nothing excluded" for that report.
    }
  }
  return out;
}

/** Replace a report's excluded pulls (an empty list clears the filter). */
export function setReportExcludedFights(db: DatabaseSync, code: string, fightIds: number[]): void {
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(excludedFightsKey(code), JSON.stringify(sanitizeFightIds(fightIds)));
}

/* The council's loot policy: the factor weighting, and per-item overrides of
   the seeded spec priority sheet. Both are settings rather than entities —
   the weighting lives in meta, the overrides in their own small table. */

const WEIGHTS_KEY = "loot_priority_weights";

/** Keep only sane percentages so a hand-edited blob can't break a ranking. */
function sanitizeWeights(raw: unknown): Partial<LootPriorityWeights> {
  if (raw === null || typeof raw !== "object") return {};
  const out: Partial<LootPriorityWeights> = {};
  for (const key of ["attendance", "lootDebt", "performance", "preparation"] as const) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100) {
      out[key] = Math.round(value);
    }
  }
  return out;
}

/** The council's weighting. Empty means the code defaults are in force. */
export function getLootPriorityWeights(db: DatabaseSync): Partial<LootPriorityWeights> {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(WEIGHTS_KEY) as
    | { value: string }
    | undefined;
  if (!row) return {};
  try {
    return sanitizeWeights(JSON.parse(row.value));
  } catch {
    return {};
  }
}

/** Replace the weighting. An empty object hands it back to the code defaults. */
export function setLootPriorityWeights(db: DatabaseSync, weights: Partial<LootPriorityWeights>): void {
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(WEIGHTS_KEY, JSON.stringify(sanitizeWeights(weights)));
}

export interface StoredPriorityRule {
  itemName: string;
  chain: string;
  note?: string;
}

/** Every officer-edited chain, keyed by normalized item name. */
export function getItemPriorityRules(db: DatabaseSync): Record<string, StoredPriorityRule> {
  const rows = db.prepare("SELECT item_key, item_name, chain, note FROM item_priority_rules").all() as {
    item_key: string;
    item_name: string;
    chain: string;
    note: string | null;
  }[];
  const out: Record<string, StoredPriorityRule> = {};
  for (const r of rows) {
    out[r.item_key] = { itemName: r.item_name, chain: r.chain, note: r.note ?? undefined };
  }
  return out;
}

export function setItemPriorityRule(
  db: DatabaseSync,
  itemKey: string,
  rule: StoredPriorityRule,
): void {
  db.prepare(
    `INSERT INTO item_priority_rules (item_key, item_name, chain, note, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(item_key) DO UPDATE SET
       item_name = excluded.item_name, chain = excluded.chain,
       note = excluded.note, updated_at = excluded.updated_at`,
  ).run(itemKey, rule.itemName, rule.chain, rule.note ?? null, new Date().toISOString());
}

/** Drop an override so the seeded sheet takes the item back. */
export function deleteItemPriorityRule(db: DatabaseSync, itemKey: string): boolean {
  return Number(db.prepare("DELETE FROM item_priority_rules WHERE item_key = ?").run(itemKey).changes) > 0;
}

/** Every enchant id the app has resolved a name for. */
export function getEnchantNames(db: DatabaseSync): Record<number, string> {
  const rows = db.prepare("SELECT id, name FROM enchant_names").all() as {
    id: number;
    name: string;
  }[];
  const out: Record<number, string> = {};
  for (const r of rows) out[r.id] = r.name;
  return out;
}

/**
 * Record resolved enchant names. A name already known is left alone: the first
 * one recorded is as good as any later one, and nothing should churn.
 */
export function addEnchantNames(db: DatabaseSync, names: { id: number; name: string }[]): number {
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO enchant_names (id, name, resolved_at) VALUES (?, ?, ?)",
  );
  const at = new Date().toISOString();
  let written = 0;
  for (const { id, name } of names) {
    if (!Number.isInteger(id) || id <= 0 || !name.trim()) continue;
    written += Number(stmt.run(id, name.trim(), at).changes);
  }
  return written;
}

/* Entity <-> row mapping. SQLite has no undefined: optionals become NULL and
   are stripped again on load so zod sees exactly the canonical shapes. */

type Row = Record<string, unknown>;

function opt<T>(v: T | null | undefined): T | undefined {
  return v === null || v === undefined ? undefined : v;
}

export function insertGuild(db: DatabaseSync, g: Guild): void {
  db.prepare("INSERT OR REPLACE INTO guild (id, name, realm, faction, active_phase) VALUES (?, ?, ?, ?, ?)").run(
    g.id, g.name, g.realm, g.faction, g.activePhase,
  );
}

export function insertCharacter(db: DatabaseSync, c: Character): void {
  db.prepare(
    `INSERT OR REPLACE INTO characters (id, guild_id, name, class, spec, role, off_spec, off_spec_role, race, status, main_character_id, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    c.id, c.guildId, c.name, c.class, c.spec, c.role, c.offSpec ?? null, c.offSpecRole ?? null,
    c.race ?? null, c.status, c.mainCharacterId ?? null, c.note ?? null,
  );
}

export function insertAttendanceExemption(db: DatabaseSync, e: AttendanceExemption): void {
  db.prepare(
    `INSERT OR REPLACE INTO attendance_exemptions (character_id, week_start, note) VALUES (?, ?, ?)`,
  ).run(e.characterId, e.weekStart, e.note ?? null);
}

export function insertCharacterComment(db: DatabaseSync, c: CharacterComment): void {
  db.prepare(
    `INSERT OR REPLACE INTO character_comments (id, character_id, category, body, author, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(c.id, c.characterId, c.category, c.body, c.author ?? null, c.createdAt);
}

export function insertItem(db: DatabaseSync, i: Item): void {
  db.prepare(
    `INSERT OR REPLACE INTO items (id, name, quality, icon, slot, source_json, phase)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    i.id, i.name ?? null, i.quality ?? null, i.icon ?? null, i.slot ?? null,
    i.source ? JSON.stringify(i.source) : null, i.phase ?? null,
  );
}

/**
 * Fill the item cache from an import without ever overwriting what's already
 * known: a new row is inserted whole, an existing one only gains the fields it
 * was missing (COALESCE keeps the curated value). Returns how many rows were
 * created or learned something — nothing else touches the cache, so that count
 * is what the import panel reports.
 */
export function mergeItems(db: DatabaseSync, items: Item[]): number {
  const stmt = db.prepare(
    `INSERT INTO items (id, name, quality, icon, slot, source_json, phase)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name        = COALESCE(items.name, excluded.name),
       quality     = COALESCE(items.quality, excluded.quality),
       icon        = COALESCE(items.icon, excluded.icon),
       slot        = COALESCE(items.slot, excluded.slot),
       source_json = COALESCE(items.source_json, excluded.source_json),
       phase       = COALESCE(items.phase, excluded.phase)
     WHERE (items.name        IS NULL AND excluded.name        IS NOT NULL)
        OR (items.quality     IS NULL AND excluded.quality     IS NOT NULL)
        OR (items.icon        IS NULL AND excluded.icon        IS NOT NULL)
        OR (items.slot        IS NULL AND excluded.slot        IS NOT NULL)
        OR (items.source_json IS NULL AND excluded.source_json IS NOT NULL)
        OR (items.phase       IS NULL AND excluded.phase       IS NOT NULL)`,
  );
  let learned = 0;
  for (const i of items) {
    const changes = stmt.run(
      i.id, i.name ?? null, i.quality ?? null, i.icon ?? null, i.slot ?? null,
      i.source ? JSON.stringify(i.source) : null, i.phase ?? null,
    ).changes;
    learned += Number(changes) > 0 ? 1 : 0;
  }
  return learned;
}

export function insertGearSet(db: DatabaseSync, s: GearSet): void {
  db.prepare(
    `INSERT INTO gear_sets (id, character_id, kind, phase, name, source, source_url, imported_at, stats_json, slots_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    s.id, s.characterId, s.kind, s.phase ?? null, s.name, s.source, s.sourceUrl ?? null,
    s.importedAt, JSON.stringify(s.stats), JSON.stringify(s.slots),
  );
}

/** Pin one slot of one kit (replacing whatever was pinned there before). */
export function insertCurrentGearOverride(db: DatabaseSync, o: CurrentGearOverride): void {
  db.prepare(
    `INSERT OR REPLACE INTO current_gear_overrides (character_id, spec, slot, item_id, item_name, source, set_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(o.characterId, o.spec, o.item.slot, o.item.itemId, o.item.itemName, o.source, o.setAt);
}

export function insertRaidSession(db: DatabaseSync, s: RaidSession): void {
  db.prepare(
    "INSERT INTO raid_sessions (id, guild_id, date, zones_json, note, source) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(s.id, s.guildId, s.date, JSON.stringify(s.zones), s.note ?? null, s.source);
}

export function insertLootAward(db: DatabaseSync, a: LootAward): void {
  db.prepare(
    `INSERT INTO loot_awards (id, raid_session_id, character_id, raw_winner_name, item_id, item_name, awarded_at, offspec, external, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    a.id, a.raidSessionId, a.characterId, a.rawWinnerName, a.itemId, a.itemName,
    a.awardedAt, a.offspec ? 1 : 0, a.external ? 1 : 0, a.note ?? null,
  );
}

export function insertWclReport(db: DatabaseSync, r: WclReport): void {
  db.prepare(
    `INSERT OR REPLACE INTO wcl_reports
       (code, title, zone, start_time, end_time, fetched_at, upkeep_tracks_json, raid_session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    r.code,
    r.title,
    r.zone ?? null,
    r.startTime,
    r.endTime,
    r.fetchedAt,
    JSON.stringify(r.upkeepTracks ?? []),
    r.raidSessionId,
  );
}

export function insertWclPlayerFight(db: DatabaseSync, f: WclPlayerFight): void {
  db.prepare(
    `INSERT INTO wcl_player_fights (
       id, report_code, fight_id, encounter_id, encounter_name, kill, fight_percentage,
       duration_ms, actor_name, character_id, class_name, spec, role, parse_percent,
       bracket_percent, amount, deaths, flask, elixirs_json, scrolls_json, food, weapon_buff,
       prepot, potions_json, other_casts_json, extras_json, cooldowns_json, cast_times_json,
       upkeep_json, gear_json, talents_json, drums, runes, healthstones, sappers, missing_enchants_json, fight_start_ms,
       boss_parse_percent, boss_amount
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    f.id, f.reportCode, f.fightId, f.encounterId, f.encounterName, f.kill ? 1 : 0,
    f.fightPercentage ?? null, f.durationMs, f.actorName, f.characterId, f.className ?? null,
    f.spec ?? null, f.role, f.parsePercent ?? null, f.bracketPercent ?? null, f.amount ?? null,
    f.deaths, f.flask ?? null, JSON.stringify(f.elixirs), JSON.stringify(f.scrolls), f.food ? 1 : 0,
    f.weaponBuff ? 1 : 0, f.prepot ? 1 : 0, JSON.stringify(f.potions), JSON.stringify(f.otherCasts),
    JSON.stringify(f.extras), JSON.stringify(f.cooldowns), JSON.stringify(f.castTimes),
    JSON.stringify(f.upkeep),
    JSON.stringify(f.gear), JSON.stringify(f.talents),
    f.drums, f.runes, f.healthstones, f.sappers, JSON.stringify(f.missingEnchants),
    f.fightStartMs ?? null, f.bossParsePercent ?? null, f.bossAmount ?? null,
  );
}

export function insertWclPlayerOffPull(db: DatabaseSync, o: WclPlayerOffPull): void {
  db.prepare(
    `INSERT OR REPLACE INTO wcl_player_offpull (
       id, report_code, actor_name, character_id, potions_json, other_casts_json,
       drums, runes, healthstones, sappers, pet_consumables_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    o.id, o.reportCode, o.actorName, o.characterId,
    JSON.stringify(o.potions), JSON.stringify(o.otherCasts),
    o.drums, o.runes, o.healthstones, o.sappers, JSON.stringify(o.petConsumables),
  );
}

function rowToWclPlayerOffPull(r: Row): unknown {
  return {
    id: r.id,
    reportCode: r.report_code,
    actorName: r.actor_name,
    characterId: (r.character_id as string | null) ?? null,
    potions: JSON.parse(r.potions_json as string),
    otherCasts: JSON.parse(r.other_casts_json as string),
    drums: r.drums,
    runes: r.runes,
    healthstones: r.healthstones,
    sappers: r.sappers,
    petConsumables: JSON.parse(r.pet_consumables_json as string),
  };
}

function rowToGuild(r: Row): unknown {
  return { id: r.id, name: r.name, realm: r.realm, faction: r.faction, activePhase: r.active_phase };
}

function rowToCharacter(r: Row): unknown {
  return {
    id: r.id, guildId: r.guild_id, name: r.name, class: r.class, spec: r.spec,
    role: r.role, offSpec: opt(r.off_spec), offSpecRole: opt(r.off_spec_role),
    race: opt(r.race), status: r.status,
    mainCharacterId: (r.main_character_id as string | null) ?? null, note: opt(r.note),
  };
}

function rowToAttendanceExemption(r: Row): unknown {
  return { characterId: r.character_id, weekStart: r.week_start, note: opt(r.note) };
}

function rowToCharacterComment(r: Row): unknown {
  return {
    id: r.id, characterId: r.character_id, category: r.category, body: r.body,
    author: opt(r.author), createdAt: r.created_at,
  };
}

function rowToItem(r: Row): unknown {
  return {
    id: r.id, name: opt(r.name), quality: opt(r.quality), icon: opt(r.icon), slot: opt(r.slot),
    source: r.source_json ? JSON.parse(r.source_json as string) : undefined,
    phase: opt(r.phase),
  };
}

function rowToGearSet(r: Row): unknown {
  return {
    id: r.id, characterId: r.character_id, kind: r.kind, phase: opt(r.phase),
    name: r.name, source: r.source, sourceUrl: opt(r.source_url), importedAt: r.imported_at,
    stats: JSON.parse(r.stats_json as string), slots: JSON.parse(r.slots_json as string),
  };
}

function rowToCurrentGearOverride(r: Row): unknown {
  return {
    characterId: r.character_id,
    item: { slot: r.slot, itemId: r.item_id, itemName: r.item_name },
    source: r.source,
    spec: r.spec ?? "main",
    setAt: r.set_at,
  };
}

function rowToRaidSession(r: Row): unknown {
  return {
    id: r.id, guildId: r.guild_id, date: r.date, zones: JSON.parse(r.zones_json as string),
    note: opt(r.note), source: r.source,
  };
}

function rowToLootAward(r: Row): unknown {
  return {
    id: r.id, raidSessionId: r.raid_session_id, characterId: (r.character_id as string | null) ?? null,
    external: r.external === 1, rawWinnerName: r.raw_winner_name, itemId: r.item_id, itemName: r.item_name,
    awardedAt: r.awarded_at, offspec: r.offspec === 1, note: opt(r.note),
  };
}

function rowToWclReport(r: Row): unknown {
  return {
    code: r.code, title: r.title, zone: opt(r.zone), startTime: r.start_time,
    endTime: r.end_time, fetchedAt: r.fetched_at,
    upkeepTracks: JSON.parse((r.upkeep_tracks_json as string | null) ?? "[]"),
    raidSessionId: (r.raid_session_id as string | null) ?? null,
  };
}

function rowToWclPlayerFight(r: Row): unknown {
  return {
    id: r.id, reportCode: r.report_code, fightId: r.fight_id, encounterId: r.encounter_id,
    encounterName: r.encounter_name, kill: r.kill === 1, fightPercentage: opt(r.fight_percentage),
    durationMs: r.duration_ms, fightStartMs: opt(r.fight_start_ms), actorName: r.actor_name,
    characterId: (r.character_id as string | null) ?? null,
    className: opt(r.class_name), spec: opt(r.spec), role: r.role,
    parsePercent: opt(r.parse_percent), bracketPercent: opt(r.bracket_percent),
    bossParsePercent: opt(r.boss_parse_percent), bossAmount: opt(r.boss_amount),
    amount: opt(r.amount), deaths: r.deaths, flask: opt(r.flask),
    elixirs: JSON.parse(r.elixirs_json as string),
    scrolls: JSON.parse((r.scrolls_json as string | null) ?? "[]"), food: r.food === 1,
    weaponBuff: r.weapon_buff === 1, prepot: r.prepot === 1,
    potions: JSON.parse(r.potions_json as string),
    otherCasts: JSON.parse((r.other_casts_json as string | null) ?? "[]"),
    extras: JSON.parse((r.extras_json as string | null) ?? "[]"),
    cooldowns: JSON.parse((r.cooldowns_json as string | null) ?? "[]"),
    castTimes: JSON.parse((r.cast_times_json as string | null) ?? "[]"),
    upkeep: JSON.parse((r.upkeep_json as string | null) ?? "[]"),
    gear: JSON.parse((r.gear_json as string | null) ?? "[]"),
    talents: JSON.parse((r.talents_json as string | null) ?? "[]"),
    drums: r.drums, runes: r.runes,
    healthstones: r.healthstones, sappers: r.sappers ?? 0,
    missingEnchants: JSON.parse(r.missing_enchants_json as string),
  };
}

function parseAll<T>(label: string, schema: { parse: (d: unknown) => T }, rows: unknown[]): T[] {
  return rows.map((row) => {
    try {
      return schema.parse(row);
    } catch (e) {
      throw new Error(`SQLite row invalid (${label}): ${e instanceof Error ? e.message : String(e)}`);
    }
  });
}

export function loadStore(db: DatabaseSync): EntityStore {
  const guildRow = db.prepare("SELECT * FROM guild LIMIT 1").get() as Row | undefined;
  if (!guildRow) throw new Error("SQLite database has no guild row — delete the db file to re-seed.");
  const store: EntityStore = {
    guild: guildSchema.parse(rowToGuild(guildRow)),
    roster: parseAll("characters", characterSchema, (db.prepare("SELECT * FROM characters ORDER BY name").all() as Row[]).map(rowToCharacter)),
    items: parseAll("items", itemSchema, (db.prepare("SELECT * FROM items").all() as Row[]).map(rowToItem)),
    gearSets: parseAll("gear_sets", gearSetSchema, (db.prepare("SELECT * FROM gear_sets").all() as Row[]).map(rowToGearSet)),
    currentGearOverrides: parseAll(
      "current_gear_overrides",
      currentGearOverrideSchema,
      (db.prepare("SELECT * FROM current_gear_overrides").all() as Row[]).map(rowToCurrentGearOverride),
    ),
    raidSessions: parseAll("raid_sessions", raidSessionSchema, (db.prepare("SELECT * FROM raid_sessions").all() as Row[]).map(rowToRaidSession)),
    lootAwards: parseAll("loot_awards", lootAwardSchema, (db.prepare("SELECT * FROM loot_awards").all() as Row[]).map(rowToLootAward)),
    wclReports: parseAll("wcl_reports", wclReportSchema, (db.prepare("SELECT * FROM wcl_reports").all() as Row[]).map(rowToWclReport)),
    wclPlayerFights: parseAll("wcl_player_fights", wclPlayerFightSchema, (db.prepare("SELECT * FROM wcl_player_fights").all() as Row[]).map(rowToWclPlayerFight)),
    wclPlayerOffPull: parseAll("wcl_player_offpull", wclPlayerOffPullSchema, (db.prepare("SELECT * FROM wcl_player_offpull").all() as Row[]).map(rowToWclPlayerOffPull)),
    attendanceExemptions: parseAll("attendance_exemptions", attendanceExemptionSchema, (db.prepare("SELECT * FROM attendance_exemptions").all() as Row[]).map(rowToAttendanceExemption)),
    characterComments: parseAll("character_comments", characterCommentSchema, (db.prepare("SELECT * FROM character_comments ORDER BY created_at DESC").all() as Row[]).map(rowToCharacterComment)),
  };
  validateStore(store, "sqlite database");
  return store;
}

function seedIfEmpty(db: DatabaseSync): void {
  const hasGuild = db.prepare("SELECT 1 FROM guild LIMIT 1").get();
  if (hasGuild) return;
  const seed = loadSeedStore();
  try {
    withTx(db, () => {
      insertGuild(db, seed.guild);
      for (const c of seed.roster) insertCharacter(db, c);
      for (const i of seed.items) insertItem(db, i);
      for (const s of seed.gearSets) insertGearSet(db, s);
      for (const o of seed.currentGearOverrides) insertCurrentGearOverride(db, o);
      for (const s of seed.raidSessions) insertRaidSession(db, s);
      for (const a of seed.lootAwards) insertLootAward(db, a);
      for (const r of seed.wclReports) insertWclReport(db, r);
      for (const f of seed.wclPlayerFights) insertWclPlayerFight(db, f);
      for (const o of seed.wclPlayerOffPull) insertWclPlayerOffPull(db, o);
      for (const e of seed.attendanceExemptions) insertAttendanceExemption(db, e);
      for (const c of seed.characterComments) insertCharacterComment(db, c);
      bumpDataVersion(db);
    });
  } catch (e) {
    // Parallel build workers can race the first boot; losing the race is fine.
    const seededByOther = db.prepare("SELECT 1 FROM guild LIMIT 1").get();
    if (!seededByOther) throw e;
  }
}
