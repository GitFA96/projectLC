import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  attendanceExemptionSchema,
  characterCommentSchema,
  characterSchema,
  gearSetSchema,
  guildSchema,
  itemSchema,
  lootAwardSchema,
  raidSessionSchema,
  wclPlayerFightSchema,
  wclReportSchema,
} from "@/lib/import/schemas";
import { loadSeedStore } from "@/lib/data/seed-data";
import { validateStore, type EntityStore } from "@/lib/data/store";
import type {
  AttendanceExemption,
  Character,
  CharacterComment,
  ConsumablePrice,
  GearSet,
  Guild,
  Item,
  LootAward,
  RaidSession,
  WclPlayerFight,
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
  race              TEXT,
  status            TEXT NOT NULL,
  main_character_id TEXT,
  note              TEXT
);
CREATE TABLE IF NOT EXISTS items (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  quality     TEXT NOT NULL,
  icon        TEXT NOT NULL,
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
  code            TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  zone            TEXT,
  start_time      TEXT NOT NULL,
  end_time        TEXT NOT NULL,
  fetched_at      TEXT NOT NULL,
  raid_session_id TEXT
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
  upkeep_json           TEXT NOT NULL DEFAULT '[]',
  gear_json             TEXT NOT NULL DEFAULT '[]',
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
  addColumn("wcl_player_fights", "upkeep_json", "upkeep_json TEXT NOT NULL DEFAULT '[]'");
  addColumn("wcl_player_fights", "gear_json", "gear_json TEXT NOT NULL DEFAULT '[]'");
  addColumn("characters", "main_character_id", "main_character_id TEXT");
  addColumn("wcl_player_fights", "sappers", "sappers INTEGER NOT NULL DEFAULT 0");
  addColumn("wcl_player_fights", "fight_start_ms", "fight_start_ms INTEGER");
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
    `INSERT OR REPLACE INTO characters (id, guild_id, name, class, spec, role, race, status, main_character_id, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(c.id, c.guildId, c.name, c.class, c.spec, c.role, c.race ?? null, c.status, c.mainCharacterId ?? null, c.note ?? null);
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
  ).run(i.id, i.name, i.quality, i.icon, i.slot ?? null, i.source ? JSON.stringify(i.source) : null, i.phase ?? null);
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
    `INSERT OR REPLACE INTO wcl_reports (code, title, zone, start_time, end_time, fetched_at, raid_session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(r.code, r.title, r.zone ?? null, r.startTime, r.endTime, r.fetchedAt, r.raidSessionId);
}

export function insertWclPlayerFight(db: DatabaseSync, f: WclPlayerFight): void {
  db.prepare(
    `INSERT INTO wcl_player_fights (
       id, report_code, fight_id, encounter_id, encounter_name, kill, fight_percentage,
       duration_ms, actor_name, character_id, class_name, spec, role, parse_percent,
       bracket_percent, amount, deaths, flask, elixirs_json, scrolls_json, food, weapon_buff,
       prepot, potions_json, other_casts_json, extras_json, cooldowns_json, upkeep_json,
       gear_json, drums, runes, healthstones, sappers, missing_enchants_json, fight_start_ms
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    f.id, f.reportCode, f.fightId, f.encounterId, f.encounterName, f.kill ? 1 : 0,
    f.fightPercentage ?? null, f.durationMs, f.actorName, f.characterId, f.className ?? null,
    f.spec ?? null, f.role, f.parsePercent ?? null, f.bracketPercent ?? null, f.amount ?? null,
    f.deaths, f.flask ?? null, JSON.stringify(f.elixirs), JSON.stringify(f.scrolls), f.food ? 1 : 0,
    f.weaponBuff ? 1 : 0, f.prepot ? 1 : 0, JSON.stringify(f.potions), JSON.stringify(f.otherCasts),
    JSON.stringify(f.extras), JSON.stringify(f.cooldowns), JSON.stringify(f.upkeep),
    JSON.stringify(f.gear), f.drums, f.runes, f.healthstones, f.sappers, JSON.stringify(f.missingEnchants),
    f.fightStartMs ?? null,
  );
}

function rowToGuild(r: Row): unknown {
  return { id: r.id, name: r.name, realm: r.realm, faction: r.faction, activePhase: r.active_phase };
}

function rowToCharacter(r: Row): unknown {
  return {
    id: r.id, guildId: r.guild_id, name: r.name, class: r.class, spec: r.spec,
    role: r.role, race: opt(r.race), status: r.status,
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
    id: r.id, name: r.name, quality: r.quality, icon: r.icon, slot: opt(r.slot),
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
    amount: opt(r.amount), deaths: r.deaths, flask: opt(r.flask),
    elixirs: JSON.parse(r.elixirs_json as string),
    scrolls: JSON.parse((r.scrolls_json as string | null) ?? "[]"), food: r.food === 1,
    weaponBuff: r.weapon_buff === 1, prepot: r.prepot === 1,
    potions: JSON.parse(r.potions_json as string),
    otherCasts: JSON.parse((r.other_casts_json as string | null) ?? "[]"),
    extras: JSON.parse((r.extras_json as string | null) ?? "[]"),
    cooldowns: JSON.parse((r.cooldowns_json as string | null) ?? "[]"),
    upkeep: JSON.parse((r.upkeep_json as string | null) ?? "[]"),
    gear: JSON.parse((r.gear_json as string | null) ?? "[]"),
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
    raidSessions: parseAll("raid_sessions", raidSessionSchema, (db.prepare("SELECT * FROM raid_sessions").all() as Row[]).map(rowToRaidSession)),
    lootAwards: parseAll("loot_awards", lootAwardSchema, (db.prepare("SELECT * FROM loot_awards").all() as Row[]).map(rowToLootAward)),
    wclReports: parseAll("wcl_reports", wclReportSchema, (db.prepare("SELECT * FROM wcl_reports").all() as Row[]).map(rowToWclReport)),
    wclPlayerFights: parseAll("wcl_player_fights", wclPlayerFightSchema, (db.prepare("SELECT * FROM wcl_player_fights").all() as Row[]).map(rowToWclPlayerFight)),
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
      for (const s of seed.raidSessions) insertRaidSession(db, s);
      for (const a of seed.lootAwards) insertLootAward(db, a);
      for (const r of seed.wclReports) insertWclReport(db, r);
      for (const f of seed.wclPlayerFights) insertWclPlayerFight(db, f);
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
