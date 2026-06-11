import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  characterSchema,
  gearSetSchema,
  guildSchema,
  itemSchema,
  lootAwardSchema,
  raidSessionSchema,
} from "@/lib/import/schemas";
import { loadSeedStore } from "@/lib/data/seed-data";
import { validateStore, type EntityStore } from "@/lib/data/store";
import type { Character, GearSet, Guild, Item, LootAward, RaidSession } from "@/lib/types";

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
  id       TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  name     TEXT NOT NULL COLLATE NOCASE UNIQUE,
  class    TEXT NOT NULL,
  spec     TEXT NOT NULL,
  role     TEXT NOT NULL,
  race     TEXT,
  status   TEXT NOT NULL,
  note     TEXT
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
  note            TEXT
);
CREATE INDEX IF NOT EXISTS loot_awards_dedupe
  ON loot_awards(item_id, raw_winner_name COLLATE NOCASE, awarded_at);
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
  seedIfEmpty(db);
  globalDbs.__projectlcDbs.set(file, db);
  return db;
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
    `INSERT OR REPLACE INTO characters (id, guild_id, name, class, spec, role, race, status, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(c.id, c.guildId, c.name, c.class, c.spec, c.role, c.race ?? null, c.status, c.note ?? null);
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
    `INSERT INTO loot_awards (id, raid_session_id, character_id, raw_winner_name, item_id, item_name, awarded_at, offspec, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(a.id, a.raidSessionId, a.characterId, a.rawWinnerName, a.itemId, a.itemName, a.awardedAt, a.offspec ? 1 : 0, a.note ?? null);
}

function rowToGuild(r: Row): unknown {
  return { id: r.id, name: r.name, realm: r.realm, faction: r.faction, activePhase: r.active_phase };
}

function rowToCharacter(r: Row): unknown {
  return {
    id: r.id, guildId: r.guild_id, name: r.name, class: r.class, spec: r.spec,
    role: r.role, race: opt(r.race), status: r.status, note: opt(r.note),
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
    rawWinnerName: r.raw_winner_name, itemId: r.item_id, itemName: r.item_name,
    awardedAt: r.awarded_at, offspec: r.offspec === 1, note: opt(r.note),
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
      bumpDataVersion(db);
    });
  } catch (e) {
    // Parallel build workers can race the first boot; losing the race is fine.
    const seededByOther = db.prepare("SELECT 1 FROM guild LIMIT 1").get();
    if (!seededByOther) throw e;
  }
}
