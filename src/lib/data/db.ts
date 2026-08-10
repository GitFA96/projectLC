import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  attendanceExemptionSchema,
  characterCommentSchema,
  itemCommentSchema,
  characterSchema,
  currentGearOverrideSchema,
  feedbackReportSchema,
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
import {
  GROUP_COUNT,
  emptyBoard,
  isEmptyBoard,
  sanitizeBoard,
  sanitizeGuildRoster,
  type Board,
  type GuildRoster,
} from "@/lib/analysis/raid-planner";
import type { StrandedSimSetting } from "@/lib/types";
import { UPTIME_TRACK_BY_LABEL } from "@/lib/wcl/class-tracks";
import { loadSeedStore } from "@/lib/data/seed-data";
import { validateStore, type EntityStore } from "@/lib/data/store";
import type {
  AttendanceExemption,
  ConsumableAdjustment,
  Character,
  CharacterComment,
  ItemComment,
  ConsumablePrice,
  CurrentGearOverride,
  FeedbackReport,
  GearSet,
  Guild,
  Item,
  LootAward,
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
  phase       INTEGER,
  /* 1 once Wowhead answered for this id. See verifyItemProvenance() in
     migrate() — this table shipped without it, and every row in it was a
     guess nothing had checked. */
  verified    INTEGER NOT NULL DEFAULT 0,
  /* 1 when Wowhead files this id under its "Armor Tokens" subclass, 0 when it
     answered and it isn't one. NULL means nobody has asked — which is what
     the token backfill queues on. */
  armor_token INTEGER,
  /* For a tier piece: the armor token that buys it. See mergeTokenRedemptions. */
  redeems_from INTEGER,
  /* 1 once Wowhead has been asked about this id since the phase became
     something we read off its answer. Not the same as having a phase: most of
     TBC's launch items carry no phase tag at all, so "we asked and there was
     none" and "we never asked" are different states, and only the second is
     worth a request. See the STALE_PHASE tier in store.ts. */
  phase_checked INTEGER NOT NULL DEFAULT 0
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
-- The council's priority sheet per phase, as the markdown an officer pasted.
-- A document rather than a setting, which is why it earns a table: it is the
-- source the per-item rules above are layered on top of.
--
-- Absent for a phase means "nothing pasted": phase 3 then falls back to the
-- seeded sheet in src/data/seed, and every other phase is simply empty until
-- someone pastes one. So deleting a row is how you revert to the seed, exactly
-- as clearing an item_priority_rules row hands that item back to the sheet.
-- Alternatives a raider will take for a slot when their BiS doesn't drop.
--
-- The wishlist itself stays a whole imported gear set — that's what
-- SixtyUpgrades exports and what the stat diff needs. This sits BESIDE it: the
-- set names the BiS, and these name what else they'd accept, in order. Rank 1
-- is the first fallback, so the imported item is implicitly rank 0 and never
-- stored here.
--
-- Keyed by phase as well as slot, because "what I'd take instead" is a
-- statement about a tier, not about a character forever.
CREATE TABLE IF NOT EXISTS wishlist_alternatives (
  character_id TEXT NOT NULL,
  phase        INTEGER NOT NULL,
  slot         TEXT NOT NULL,
  item_id      INTEGER NOT NULL,
  item_name    TEXT,
  /* 1 = first fallback. Ties are broken by item id so ordering is total. */
  rank         INTEGER NOT NULL,
  note         TEXT,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (character_id, phase, slot, item_id)
);
-- The guild's own class/spec guides: what a class should be bringing, in the
-- officers' words. A class-level guide has spec = ''.
--
-- Deliberately the guild's summary WITH a source link, not a copy of somebody
-- else's page: the house rule is to name what a source actually says, and a
-- pasted guide rots silently while a summary an officer wrote gets corrected
-- when it stops being true.
CREATE TABLE IF NOT EXISTS class_guides (
  wow_class  TEXT NOT NULL,
  spec       TEXT NOT NULL,
  body       TEXT NOT NULL,
  /* Newline-separated URLs the summary was drawn from. */
  sources    TEXT,
  /* Free text — there is no auth. Same compromise as character_comments. */
  author     TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (wow_class, spec)
);
CREATE TABLE IF NOT EXISTS priority_sheets (
  phase      INTEGER PRIMARY KEY,
  markdown   TEXT NOT NULL,
  /* Free text — there is no auth. Same compromise as character_comments. */
  author     TEXT,
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
  note            TEXT,
  /* How the council's board read when this was awarded, as JSON. NULL means
     the award never came from the ranking (a Gargul import, a hand-added
     drop) — never that the winner scored zero. See awardDecisionSchema. */
  decision_json   TEXT
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
  prepot_label          TEXT,
  death_times_json      TEXT NOT NULL DEFAULT '[]',
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
/*
 * Notes on one item — a raider's about their own claim, an officer's about the
 * council's. Deliberately NOT joined to a wishlist row: the note has to survive
 * the raider re-ordering their list, and it has to be readable next to an award
 * made years ago. character_id is nullable and means "about this raider's
 * claim" when set, "about the item" when not.
 *
 * Nothing here is scored. It exists because the council decided the
 * BiS-versus-second-choice call is too situational to automate.
 */
CREATE TABLE IF NOT EXISTS item_comments (
  id           TEXT PRIMARY KEY,
  item_id      INTEGER NOT NULL,
  character_id TEXT,
  voice        TEXT NOT NULL DEFAULT 'officer',
  body         TEXT NOT NULL,
  /* Free text — there is no auth. Same compromise as character_comments. */
  author       TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS item_comments_by_item ON item_comments(item_id);

/*
 * Bug reports filed from inside the app. Deliberately references nothing —
 * a report has to stay readable after the page it describes has been rewritten
 * and after any character it mentions has been deleted, so the page is stored
 * as text and there are no foreign keys to go stale.
 */
CREATE TABLE IF NOT EXISTS feedback (
  id             TEXT PRIMARY KEY,
  /* 'bug' | 'feedback'. See the addColumn() in migrate() — this table shipped
     without it, so the CREATE here only covers databases made since. */
  kind           TEXT NOT NULL DEFAULT 'bug',
  reporter       TEXT,
  body           TEXT NOT NULL,
  route          TEXT NOT NULL,
  url            TEXT NOT NULL,
  /* NULL when the reporter declined to share page context. */
  context_json   TEXT,
  status         TEXT NOT NULL DEFAULT 'open',
  /* Triage, both added after the table shipped — see migrate(). */
  priority       TEXT NOT NULL DEFAULT 'unset',
  admin_note     TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS feedback_by_status ON feedback(status, created_at DESC);
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
  addColumn("wcl_player_fights", "prepot_label", "prepot_label TEXT");
  addColumn("wcl_player_fights", "death_times_json", "death_times_json TEXT NOT NULL DEFAULT '[]'");
  addColumn("wcl_player_fights", "boss_parse_percent", "boss_parse_percent REAL");
  addColumn("wcl_player_fights", "boss_amount", "boss_amount REAL");
  addColumn("wcl_reports", "upkeep_tracks_json", "upkeep_tracks_json TEXT NOT NULL DEFAULT '[]'");
  // The feedback table shipped with only bug reports. Existing rows were filed
  // as bugs and the DEFAULT says so, so the backfill is the default itself.
  addColumn("feedback", "kind", "kind TEXT NOT NULL DEFAULT 'bug'");
  // Triage. Everything filed before these existed is untriaged, which is what
  // the default says — no backfill can invent a judgement nobody made.
  addColumn("feedback", "priority", "priority TEXT NOT NULL DEFAULT 'unset'");
  addColumn("feedback", "admin_note", "admin_note TEXT");
  // Awards made before this shipped have no snapshot, and cannot gain one: the
  // policy that produced them is gone. NULL says exactly that.
  addColumn("loot_awards", "decision_json", "decision_json TEXT");
  // The four loot weights moved into the `guild_policy` record, which holds
  // every other number the council can set too. The old value is deliberately
  // NOT carried across (the officers called it: the project is pre-release, and
  // a half-migrated policy is worse than a clean default). Dropping the row
  // rather than leaving it means nobody later mistakes it for live config.
  db.prepare("DELETE FROM meta WHERE key = ?").run("loot_priority_weights");
  verifyItemProvenance(db);
  backfillUpkeepTracks(db);
  relaxItemColumns(db);
  addAbilityKind(db);
  splitGearOverridesBySpec(db);
  promoteSimSettingsToProfiles(db);
  // AFTER relaxItemColumns, not with the addColumn block above. That rebuild
  // copies a fixed list of columns into a new table, so a column added to
  // `items` before it runs is created and then silently dropped on exactly the
  // databases old enough to need the rebuild — and nowhere else.
  addColumn("items", "armor_token", "armor_token INTEGER");
  // Every row confirmed before the phase was read off Wowhead's answer is
  // unchecked, which is what the default says: they get one more lookup each,
  // once, and are never asked again whether or not a phase came back.
  addColumn("items", "phase_checked", "phase_checked INTEGER NOT NULL DEFAULT 0");
  addColumn("items", "redeems_from", "redeems_from INTEGER");
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
 * The item cache used to have no idea where any of its rows came from, so a
 * hand-written guess and Wowhead's own answer were indistinguishable — and
 * `listUnresolvedItemIds` only ever offered up rows with a *missing* field.
 * A wrong icon has no missing field, so it could never be corrected: eight
 * reports of the wrong item picture all landed on curated seed rows.
 *
 * `verified` splits the two apart. Backfilling it needs a rule for rows that
 * predate the column, and the honest one is narrow: at the time this ran, the
 * seed was the only writer of `source_json` (Wowhead's XML has no zone/boss,
 * and neither do logs or wishlists), so a row carrying one is hand-written and
 * a row without one came from a machine that read the game's own data.
 *
 * Machine-sourced rows are therefore trusted and the curated ones are queued
 * for re-resolution. Nothing is deleted — a guessed icon keeps rendering until
 * Wowhead replaces it, which is strictly better than a blank.
 */
function verifyItemProvenance(db: DatabaseSync): void {
  const cols = db.prepare("PRAGMA table_info(items)").all() as { name: string }[];
  if (cols.length === 0 || cols.some((c) => c.name === "verified")) return;
  db.exec("ALTER TABLE items ADD COLUMN verified INTEGER NOT NULL DEFAULT 0");
  db.exec("UPDATE items SET verified = 1 WHERE source_json IS NULL");
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
 *
 * Only those three are asked about. `verified` is NOT NULL on purpose, so a
 * blanket "any NOT NULL column means rebuild" would fire on every fresh
 * database forever — and the rebuild below would drop the column on the way
 * through. It runs after verifyItemProvenance for the same reason: by here the
 * column always exists, so it can be copied unconditionally.
 */
const RELAXED_ITEM_COLUMNS = ["name", "quality", "icon"];

function relaxItemColumns(db: DatabaseSync): void {
  const cols = db.prepare("PRAGMA table_info(items)").all() as { name: string; notnull: number }[];
  const required = cols.filter((c) => RELAXED_ITEM_COLUMNS.includes(c.name) && c.notnull === 1);
  if (required.length === 0) return;
  db.exec(`
    CREATE TABLE items_relaxed (
      id          INTEGER PRIMARY KEY,
      name        TEXT,
      quality     TEXT,
      icon        TEXT,
      slot        TEXT,
      source_json TEXT,
      phase       INTEGER,
      verified    INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO items_relaxed (id, name, quality, icon, slot, source_json, phase, verified)
      SELECT id, name, quality, icon, slot, source_json, phase, verified FROM items;
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

/*
 * Per-report raid board: who stood in which group that night.
 *
 * Same meta-table pattern as prices, and it has to be stored rather than
 * derived, because Warcraft Logs does not record group assignments at all —
 * the pull rows know everyone who was there and nothing about how they were
 * arranged. So this is an officer's record, seeded from the log's attendees.
 *
 * Absent means nobody has laid the night out yet, which the page offers to do.
 */

const raidBoardKey = (code: string) => `raid_board:${code}`;

/**
 * The template's board — guild-wide, so no suffix, like
 * `loot_priority_weights`. Deliberately a different key from any raid's: a plan
 * for next Wednesday is not a record of a night that happened, and the two must
 * never be able to overwrite each other.
 */
const TEMPLATE_BOARD_KEY = "template_board";

export function getTemplateBoard(db: DatabaseSync): Board {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(TEMPLATE_BOARD_KEY) as
    | { value: string }
    | undefined;
  return readBoard(row?.value);
}

export function setTemplateBoard(db: DatabaseSync, comp: Board): void {
  const clean = sanitizeBoard(comp, { groups: comp.groups.length });
  if (nothingToRemember(clean)) {
    db.prepare("DELETE FROM meta WHERE key = ?").run(TEMPLATE_BOARD_KEY);
    return;
  }
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(TEMPLATE_BOARD_KEY, JSON.stringify(clean));
}

/*
 * The guild's own named rosters: `guild_roster:<id>`.
 *
 * Several, because a guild that runs a split has more than one roster at once.
 * One row each rather than one row holding a list, so two officers on two
 * rosters can't overwrite each other's work — the boards autosave, and a shared
 * row would make every save a full rewrite of every roster.
 *
 * The one rule that differs from every other board here: **an empty board
 * still gets a row.** A raid night's empty board means "never laid out", which
 * is worth nothing to store; a roster exists because somebody made and named
 * it, and deleting it on the first Clear would take the name with it.
 */

const GUILD_ROSTER_PREFIX = "guild_roster:";
const guildRosterKey = (id: string) => `${GUILD_ROSTER_PREFIX}${id}`;

/*
 * `_` is a single-character wildcard in SQL LIKE, so the obvious
 * `LIKE 'guild_roster:%'` also matches `guildXroster:…`. Nothing writes such a
 * key today, which is exactly why this would go unnoticed if one ever did.
 */
const GUILD_ROSTER_LIKE = "guild\\_roster:%";

/** Every guild roster, oldest first — the order the picker shows them in. */
export function listGuildRosters(db: DatabaseSync): GuildRoster[] {
  const rows = db
    .prepare("SELECT value FROM meta WHERE key LIKE ? ESCAPE '\\'")
    .all(GUILD_ROSTER_LIKE) as { value: string }[];
  return rows
    .map((r) => readGuildRoster(r.value))
    .filter((b): b is GuildRoster => b !== undefined)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export function getGuildRoster(db: DatabaseSync, id: string): GuildRoster | undefined {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(guildRosterKey(id)) as
    | { value: string }
    | undefined;
  return readGuildRoster(row?.value);
}

function readGuildRoster(value: string | undefined): GuildRoster | undefined {
  if (!value) return undefined;
  try {
    return sanitizeGuildRoster(JSON.parse(value));
  } catch {
    return undefined;
  }
}

export function setGuildRoster(db: DatabaseSync, board: GuildRoster): void {
  const clean = sanitizeGuildRoster(board);
  if (!clean) throw new Error("A roster needs an id and a name.");
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(guildRosterKey(clean.id), JSON.stringify(clean));
}

/**
 * Change part of a board, leaving the rest alone.
 *
 * Read-modify-write inside the caller's transaction, because the three things a
 * board holds are edited by three different controls: the board
 * autosaves as an officer drags, the name as they type it, the prospects when
 * they add one. A blind full write from any of those would drop the other two.
 *
 * A board that has been deleted is not resurrected — the officer who deleted it
 * meant it, and the autosave still in flight from another tab did not.
 */
export function updateGuildRoster(
  db: DatabaseSync,
  id: string,
  patch: Partial<Pick<GuildRoster, "name" | "prospects" | "board">>,
): void {
  const existing = getGuildRoster(db, id);
  if (!existing) return;
  setGuildRoster(db, { ...existing, ...patch });
}

export function deleteGuildRoster(db: DatabaseSync, id: string): void {
  db.prepare("DELETE FROM meta WHERE key = ?").run(guildRosterKey(id));
}

/** A report's saved board, or an empty board when none was written. */
export function getRaidBoard(db: DatabaseSync, code: string): Board {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(raidBoardKey(code)) as
    | { value: string }
    | undefined;
  return readBoard(row?.value);
}

/**
 * Parse a stored board, keeping the number of groups it was saved with.
 *
 * Group count is part of the record now — an officer who runs five groups
 * shouldn't reopen the page to three empty ones tacked on the end — so it comes
 * from the blob rather than from the eight a raid frame allows. A missing or
 * corrupt row reads as an empty board rather than throwing a page.
 */
/**
 * Is this board worth a row?
 *
 * Nobody placed *and* nothing else set. A board can be empty of raiders and
 * still carry work — five groups named for the assignments, or a bench of
 * planned slots — and dropping that because the groups happen to be empty would
 * lose an officer's setup the moment they cleared the board to start again.
 */
function nothingToRemember(comp: Board): boolean {
  return (
    isEmptyBoard(comp) &&
    !comp.groupNames?.some(Boolean) &&
    (comp.bench?.length ?? 0) === 0 &&
    comp.groups.length === GROUP_COUNT
  );
}

function readBoard(value: string | undefined): Board {
  if (!value) return emptyBoard();
  try {
    const parsed = JSON.parse(value) as { groups?: unknown };
    const groups = Array.isArray(parsed?.groups) ? parsed.groups.length : undefined;
    return sanitizeBoard(parsed, groups ? { groups } : {});
  } catch {
    return emptyBoard();
  }
}

/**
 * Persist a report's board (replaces the whole board). A board with
 * nobody on it deletes the row, so "never laid out" and "laid out, then
 * cleared" read the same — there is nothing to remember about an empty board.
 */
export function setRaidBoard(db: DatabaseSync, code: string, comp: Board): void {
  const clean = sanitizeBoard(comp, { groups: comp.groups.length });
  const key = raidBoardKey(code);
  if (nothingToRemember(clean)) {
    db.prepare("DELETE FROM meta WHERE key = ?").run(key);
    return;
  }
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, JSON.stringify(clean));
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

/*
 * Sim setups belong to a class and spec, not to a raider.
 *
 * A wowsims export supplies the rotation, the buffs and the consumables a spec
 * is expected to run; the gear, the talents and the fight length come from the
 * pull instead. Almost none of that is personal, so keying it per character —
 * the `sim_settings:<slug>` rows this replaced — meant every raider needed their
 * own pasted link before they could be simmed at all. Whatever IS personal, like
 * race and professions, is stated as an assumption by the pre-run check rather
 * than silently applied. See src/lib/sim/profile.ts.
 */

const SIM_PROFILE_PREFIX = "sim_profile:";
/** The per-character key this replaced. Still read, once, by the promotion below. */
const LEGACY_SIM_SETTINGS_PREFIX = "sim_settings:";

const simProfileKey = (wowClass: string, spec: string) =>
  `${SIM_PROFILE_PREFIX}${wowClass}:${spec}`;

export interface SimProfileRow {
  wowClass: string;
  spec: string;
  /** The raw protojson the CLI printed. */
  json: string;
}

export function getSimProfile(db: DatabaseSync, wowClass: string, spec: string): string | undefined {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(simProfileKey(wowClass, spec)) as
    | { value: string }
    | undefined;
  if (!row) return undefined;
  // Parsed on read so a corrupted blob reads as "not configured" rather than
  // crashing the page.
  try {
    JSON.parse(row.value);
    return row.value;
  } catch {
    return undefined;
  }
}

/** Every saved spec profile. The key carries the class and spec verbatim. */
export function listSimProfiles(db: DatabaseSync): SimProfileRow[] {
  const rows = db
    .prepare("SELECT key, value FROM meta WHERE key LIKE ? ORDER BY key")
    .all(`${SIM_PROFILE_PREFIX}%`) as { key: string; value: string }[];
  const out: SimProfileRow[] = [];
  for (const { key, value } of rows) {
    const rest = key.slice(SIM_PROFILE_PREFIX.length);
    const sep = rest.indexOf(":");
    if (sep <= 0 || sep === rest.length - 1) continue;
    try {
      JSON.parse(value);
    } catch {
      continue;
    }
    out.push({ wowClass: rest.slice(0, sep), spec: rest.slice(sep + 1), json: value });
  }
  return out;
}

/** Save (or clear, with undefined) one spec's sim setup. */
export function setSimProfile(
  db: DatabaseSync,
  wowClass: string,
  spec: string,
  json: string | undefined,
): void {
  const key = simProfileKey(wowClass, spec);
  if (json === undefined) {
    db.prepare("DELETE FROM meta WHERE key = ?").run(key);
    return;
  }
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, json);
}

/**
 * The per-character setups, with the spec each one resolves to.
 *
 * Resolved the way the app resolves a spec everywhere else: the setup's talent
 * tree totals, matched against the builds this guild's own logs have already
 * named (see sim/profile.ts). Nothing is hard-coded — a talent tree is never
 * assumed here to mean a spec.
 */
export function listStrandedSimSettings(db: DatabaseSync): StrandedSimSetting[] {
  const saved = db
    .prepare("SELECT key, value FROM meta WHERE key LIKE ?")
    .all(`${LEGACY_SIM_SETTINGS_PREFIX}%`) as { key: string; value: string }[];
  if (saved.length === 0) return [];

  /* class + build → the spec names the logs used for it. */
  const named = db
    .prepare(
      `SELECT class_name AS cls, spec, talents_json AS talents, COUNT(*) AS n
         FROM wcl_player_fights
        WHERE spec IS NOT NULL AND class_name IS NOT NULL
        GROUP BY cls, spec, talents`,
    )
    .all() as { cls: string; spec: string; talents: string | null; n: number }[];
  const byBuild = new Map<string, Map<string, number>>();
  for (const r of named) {
    const points = parseTreePoints(r.talents);
    if (!points) continue;
    const key = `${r.cls}|${points}`;
    const inner = byBuild.get(key) ?? new Map<string, number>();
    inner.set(r.spec, (inner.get(r.spec) ?? 0) + Number(r.n));
    byBuild.set(key, inner);
  }

  const out: StrandedSimSetting[] = [];
  for (const { key, value } of saved) {
    const slug = key.slice(LEGACY_SIM_SETTINGS_PREFIX.length);
    let settings: { player?: { class?: unknown; talentsString?: unknown } };
    try {
      settings = JSON.parse(value) as typeof settings;
    } catch {
      continue;
    }
    const stated =
      typeof settings.player?.class === "string"
        ? settings.player.class.replace(/^Class/, "")
        : undefined;
    // The character's own class wins where we have it — an export could have
    // been pasted onto the wrong raider.
    const owner = db
      .prepare("SELECT class FROM characters WHERE lower(name) = ?")
      .get(slug.toLowerCase()) as { class: string } | undefined;
    const wowClass = owner?.class ?? stated;
    const build =
      typeof settings.player?.talentsString === "string"
        ? treePointsFromString(settings.player.talentsString)
        : undefined;
    const specs =
      wowClass && build ? [...(byBuild.get(`${wowClass}|${build}`)?.keys() ?? [])].sort() : [];
    out.push({ slug, json: value, wowClass, build, specs });
  }
  return out;
}

/**
 * Promote those setups into spec profiles.
 *
 * Deliberately a COPY, not a move. Where the build is ambiguous — the logs
 * genuinely call 0/44/17 Feral, Guardian and Warden — this writes nothing, and
 * the spec page offers the setup for the officer to adopt by hand instead.
 * Deleting the only wowsims link they ever pasted because a fingerprint couldn't
 * decide is not a failure mode worth having.
 *
 * Idempotent: an existing profile is never overwritten, so one edited by hand
 * survives every later boot.
 */
function promoteSimSettingsToProfiles(db: DatabaseSync): void {
  const stranded = listStrandedSimSettings(db);
  if (stranded.length === 0) return;
  const existing = new Set(
    (
      db.prepare("SELECT key FROM meta WHERE key LIKE ?").all(`${SIM_PROFILE_PREFIX}%`) as {
        key: string;
      }[]
    ).map((r) => r.key),
  );
  for (const s of stranded) {
    if (!s.wowClass || s.specs.length !== 1) continue;
    const target = simProfileKey(s.wowClass, s.specs[0]);
    if (existing.has(target)) continue;
    db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(target, s.json);
    existing.add(target);
  }
}

/** "3400502130201-55000005505012050115" → "21/40/0". */
function treePointsFromString(talentsString: string): string {
  return padTrees(
    talentsString
      .split("-")
      .map((tree) => [...tree].reduce((sum, ch) => sum + (Number.parseInt(ch, 10) || 0), 0)),
  );
}

/** The logs' `talents_json` in the same shape, or undefined when it has none. */
function parseTreePoints(json: string | null): string | undefined {
  if (!json) return undefined;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
    return padTrees(parsed.map((n) => (typeof n === "number" ? n : 0)));
  } catch {
    return undefined;
  }
}

/**
 * Both sides padded to three trees. wowsims drops trailing empty ones ("21/40")
 * and the logs never do ("21/40/0") — compared unpadded they match nothing, and
 * every setup would look stranded.
 */
function padTrees(trees: number[]): string {
  const width = Math.max(3, trees.length);
  return Array.from({ length: width }, (_, i) => trees[i] ?? 0).join("/");
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

const POLICY_KEY = "guild_policy";

/** A number the officer may set, clamped to a range that can't break a ranking. */
function num(raw: unknown, min: number, max: number, round?: "int"): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < min || raw > max) return undefined;
  return round === "int" ? Math.round(raw) : Math.round(raw * 100) / 100;
}

function group<T extends string>(
  raw: unknown,
  keys: readonly T[],
  read: (value: unknown) => number | boolean | string | undefined,
): Partial<Record<T, number | boolean | string>> | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const out: Partial<Record<T, number | boolean | string>> = {};
  for (const key of keys) {
    const value = read((raw as Record<string, unknown>)[key]);
    if (value !== undefined) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Drop anything a hand-edited or stale blob shouldn't be able to do.
 *
 * Every field is optional on the way in and on the way out: a policy that only
 * names one number is valid, and the resolver fills the rest from the code
 * defaults. Junk is discarded rather than rejected, so one bad key can never
 * take a working policy — or a page — down with it.
 */
function isObject(raw: unknown): raw is Record<string, unknown> {
  return raw !== null && typeof raw === "object";
}

/** The boolean `preparation.coverage` replaced, if a stored policy still has it. */
function legacyElixirCounts(raw: unknown): boolean | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const value = (raw as Record<string, unknown>).elixirCounts;
  return typeof value === "boolean" ? value : undefined;
}

function sanitizePolicy(raw: unknown): Record<string, unknown> {
  if (raw === null || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  const weights = group(r.weights, ["attendance", "lootDebt", "performance", "preparation"] as const,
    (v) => num(v, 0, 100, "int"));
  if (weights) out.weights = weights;

  // Multipliers, not percentages: 0 would zero a contender out entirely, which
  // is a ban rather than a ranking, so the floor is deliberately above it.
  const standing = group(r.standing, ["main", "trial", "alt", "inactive", "pug"] as const,
    (v) => num(v, 0.01, 1));
  if (standing) out.standing = standing;

  const slotServed = group(r.slotServed, ["drop", "floor", "fillerDrop", "offListDrop"] as const,
    (v) => num(v, 0, 1));
  if (slotServed) out.slotServed = slotServed;

  const attendance = group(r.attendance, ["recentRaids", "weeks"] as const,
    (v) => num(v, 1, 100, "int"));
  if (attendance) out.attendance = attendance;

  const perf = group(r.performance, ["parseMetric"] as const,
    (v) => (v === "all" || v === "bracket" ? v : undefined));
  if (perf) out.performance = perf;

  const loot = group(r.loot, ["altsContend"] as const,
    (v) => (typeof v === "boolean" ? v : undefined));
  if (loot) out.loot = loot;

  const preparation: Record<string, unknown> = {
    ...group(r.preparation, ["coverage"] as const,
      (v) => (v === "any" || v === "full" || v === "flaskOnly" ? v : undefined)),
  };
  // The excused-encounter list is names, not a number, so it can't go through
  // `group`. Bounded on both axes: a blob with ten thousand of them is junk,
  // and every entry is compared against a boss name from a log.
  const excused = (r.preparation as Record<string, unknown> | undefined)?.excusedEncounters;
  if (Array.isArray(excused)) {
    preparation.excusedEncounters = [
      ...new Set(
        excused
          .filter((v): v is string => typeof v === "string")
          .map((v) => v.trim())
          .filter((v) => v.length > 0 && v.length <= 80),
      ),
    ].slice(0, 200);
  }
  if (Object.keys(preparation).length > 0) out.preparation = preparation;
  else if (legacyElixirCounts(r.preparation) !== undefined) {
    // The field this replaced was a boolean, "does an elixir count at all".
    // A stored `false` was a real decision by an officer, so carry it to the
    // mode that means the same thing rather than dropping it back to default.
    out.preparation = { coverage: legacyElixirCounts(r.preparation) ? "any" : "flaskOnly" };
  }

  // Nested, unlike every other group: the weights are a record inside the
  // record. Sanitize both halves or a junk weight reaches a ranking.
  if (isObject(r.roster)) {
    const roster: Record<string, unknown> = {};
    const rosterWeights = group(
      (r.roster as Record<string, unknown>).weights,
      ["attendance", "performance", "preparation"] as const,
      (v) => num(v, 0, 100, "int"),
    );
    if (rosterWeights) roster.weights = rosterWeights;
    const minRaids = num((r.roster as Record<string, unknown>).minRaids, 0, 100, "int");
    if (minRaids !== undefined) roster.minRaids = minRaids;
    if (Object.keys(roster).length > 0) out.roster = roster;
  }

  const severity = group(r.improvementSeverity, ["high", "medium", "low"] as const,
    (v) => num(v, 0, 1000, "int"));
  if (severity) out.improvementSeverity = severity;

  return out;
}

/** The council's policy. Empty means the code defaults are in force. */
export function getGuildPolicy(db: DatabaseSync): Record<string, unknown> {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(POLICY_KEY) as
    | { value: string }
    | undefined;
  if (!row) return {};
  try {
    return sanitizePolicy(JSON.parse(row.value));
  } catch {
    return {};
  }
}

/** Replace the policy. An empty object hands everything back to the defaults. */
export function setGuildPolicy(db: DatabaseSync, policy: unknown): void {
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(POLICY_KEY, JSON.stringify(sanitizePolicy(policy)));
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

export interface StoredWishlistAlternative {
  characterId: string;
  phase: number;
  slot: string;
  itemId: number;
  itemName?: string;
  rank: number;
  note?: string;
}

export function getWishlistAlternatives(db: DatabaseSync): StoredWishlistAlternative[] {
  const rows = db
    .prepare(
      "SELECT character_id, phase, slot, item_id, item_name, rank, note FROM wishlist_alternatives ORDER BY rank, item_id",
    )
    .all() as {
    character_id: string;
    phase: number;
    slot: string;
    item_id: number;
    item_name: string | null;
    rank: number;
    note: string | null;
  }[];
  return rows.map((r) => ({
    characterId: r.character_id,
    phase: r.phase,
    slot: r.slot,
    itemId: r.item_id,
    itemName: r.item_name ?? undefined,
    rank: r.rank,
    note: r.note ?? undefined,
  }));
}

export function setWishlistAlternative(
  db: DatabaseSync,
  alt: StoredWishlistAlternative,
): void {
  db.prepare(
    `INSERT INTO wishlist_alternatives
       (character_id, phase, slot, item_id, item_name, rank, note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(character_id, phase, slot, item_id) DO UPDATE SET
       item_name = excluded.item_name, rank = excluded.rank,
       note = excluded.note, updated_at = excluded.updated_at`,
  ).run(
    alt.characterId,
    alt.phase,
    alt.slot,
    alt.itemId,
    alt.itemName ?? null,
    alt.rank,
    alt.note ?? null,
    new Date().toISOString(),
  );
}

export function deleteWishlistAlternative(
  db: DatabaseSync,
  characterId: string,
  phase: number,
  slot: string,
  itemId: number,
): boolean {
  return (
    Number(
      db
        .prepare(
          "DELETE FROM wishlist_alternatives WHERE character_id = ? AND phase = ? AND slot = ? AND item_id = ?",
        )
        .run(characterId, phase, slot, itemId).changes,
    ) > 0
  );
}

export interface StoredClassGuide {
  wowClass: string;
  /** Empty string for the class-level guide. */
  spec: string;
  body: string;
  sources: string[];
  author?: string;
  updatedAt: string;
}

const splitSources = (raw: string | null): string[] =>
  (raw ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

export function getClassGuides(db: DatabaseSync): StoredClassGuide[] {
  const rows = db
    .prepare("SELECT wow_class, spec, body, sources, author, updated_at FROM class_guides")
    .all() as {
    wow_class: string;
    spec: string;
    body: string;
    sources: string | null;
    author: string | null;
    updated_at: string;
  }[];
  return rows.map((r) => ({
    wowClass: r.wow_class,
    spec: r.spec,
    body: r.body,
    sources: splitSources(r.sources),
    author: r.author ?? undefined,
    updatedAt: r.updated_at,
  }));
}

export function setClassGuide(
  db: DatabaseSync,
  guide: { wowClass: string; spec: string; body: string; sources: string[]; author?: string },
): void {
  db.prepare(
    `INSERT INTO class_guides (wow_class, spec, body, sources, author, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(wow_class, spec) DO UPDATE SET
       body = excluded.body, sources = excluded.sources,
       author = excluded.author, updated_at = excluded.updated_at`,
  ).run(
    guide.wowClass,
    guide.spec,
    guide.body,
    guide.sources.join("\n") || null,
    guide.author ?? null,
    new Date().toISOString(),
  );
}

/** Remove a guide entirely — an empty one would read as "we have nothing to say". */
export function deleteClassGuide(db: DatabaseSync, wowClass: string, spec: string): boolean {
  return (
    Number(
      db.prepare("DELETE FROM class_guides WHERE wow_class = ? AND spec = ?").run(wowClass, spec)
        .changes,
    ) > 0
  );
}

/** A pasted sheet, as stored. The markdown is kept verbatim, never pre-parsed. */
export interface StoredPrioritySheet {
  markdown: string;
  author?: string;
  note?: string;
  updatedAt: string;
}

/** Every pasted sheet, keyed by phase. Phases with none are simply absent. */
export function getPrioritySheets(db: DatabaseSync): Record<number, StoredPrioritySheet> {
  const rows = db
    .prepare("SELECT phase, markdown, author, note, updated_at FROM priority_sheets")
    .all() as {
    phase: number;
    markdown: string;
    author: string | null;
    note: string | null;
    updated_at: string;
  }[];
  const out: Record<number, StoredPrioritySheet> = {};
  for (const r of rows) {
    out[r.phase] = {
      markdown: r.markdown,
      author: r.author ?? undefined,
      note: r.note ?? undefined,
      updatedAt: r.updated_at,
    };
  }
  return out;
}

export function setPrioritySheet(
  db: DatabaseSync,
  phase: number,
  sheet: { markdown: string; author?: string; note?: string },
): void {
  db.prepare(
    `INSERT INTO priority_sheets (phase, markdown, author, note, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(phase) DO UPDATE SET
       markdown = excluded.markdown, author = excluded.author,
       note = excluded.note, updated_at = excluded.updated_at`,
  ).run(phase, sheet.markdown, sheet.author ?? null, sheet.note ?? null, new Date().toISOString());
}

/** Drop a pasted sheet, handing the phase back to the seed (or to empty). */
export function deletePrioritySheet(db: DatabaseSync, phase: number): boolean {
  return Number(db.prepare("DELETE FROM priority_sheets WHERE phase = ?").run(phase).changes) > 0;
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

export function insertItemComment(db: DatabaseSync, c: ItemComment): void {
  db.prepare(
    `INSERT OR REPLACE INTO item_comments (id, item_id, character_id, voice, body, author, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(c.id, c.itemId, c.characterId ?? null, c.voice, c.body, c.author ?? null, c.createdAt);
}

export function deleteItemComment(db: DatabaseSync, id: string): boolean {
  return db.prepare("DELETE FROM item_comments WHERE id = ?").run(id).changes > 0;
}

export function insertFeedback(db: DatabaseSync, f: FeedbackReport): void {
  db.prepare(
    `INSERT OR REPLACE INTO feedback
       (id, kind, reporter, body, route, url, context_json, status, priority, admin_note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    f.id, f.kind, f.reporter ?? null, f.body, f.route, f.url,
    f.context ? JSON.stringify(f.context) : null, f.status, f.priority,
    f.adminNote ?? null, f.createdAt,
  );
}

/**
 * Seed an item row verbatim. `verified` is left to its DEFAULT 0 on purpose:
 * the curated seed is a hand-written starting point, not Wowhead's answer, and
 * saying so is what lets the resolver come back and correct it later.
 */
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
/**
 * Fold partial item knowledge into the cache. Two modes, and the difference
 * between them is provenance, not SQL:
 *
 * - **Filling gaps** (default) is for every local source — the curated seed, a
 *   name typed into a wishlist, an icon lifted off a log. A field already
 *   present always wins, so imports can run in any order without fighting.
 * - **Authoritative** is for `resolveItemsFromWowhead` and nothing else. It
 *   overwrites what it knows and stamps `verified`, because a guess that
 *   survived is exactly the bug this exists to fix.
 *
 * Even authoritative writes never *overwrite* `source_json` or `phase`. Zone
 * and boss are the guild's own answers and the XML says nothing about them.
 * Phase it does say — the grey "Phase 2" beside the item's name — so an empty
 * column is filled from Wowhead while a curated one still wins: an officer who
 * files a token under the phase their guild uses it in has made a decision,
 * and a backfill must not quietly overrule it.
 *
 * With one exception, and it is the whole reason this got written. When an
 * unverified row's name and Wowhead's name for the same id disagree, the row
 * was never about this item — someone curated "Serpent Spine Longbow" onto the
 * id of a Barrel-Blade Longrifle. The zone, boss and phase written next to that
 * name describe the item the author meant, not the item the id is, so carrying
 * them across would pin a Karazhan drop onto a PvP glove and every phase filter
 * downstream would believe it. They are dropped instead: no source beats a
 * confident wrong one, and re-curating against a correct id is a person's job.
 *
 * Returns rows touched. In gap-filling mode that equals rows that learned
 * something, because the WHERE says so. An authoritative write always touches
 * every row it is given — it has a `verified` stamp to apply even when the
 * data already agreed — so a caller wanting "how many were actually wrong"
 * has to diff, which is what `saveResolvedItems` does.
 */
/**
 * "This row was curated onto the wrong id" — an unverified name that Wowhead
 * contradicts. Only ever true of a row nothing has confirmed: once verified,
 * both names came from the same place and cannot disagree.
 */
const MISIDENTIFIED = `items.verified = 0
  AND items.name IS NOT NULL
  AND excluded.name IS NOT NULL
  AND items.name <> excluded.name`;

export function mergeItems(
  db: DatabaseSync,
  items: Item[],
  { authoritative = false }: { authoritative?: boolean } = {},
): number {
  const stmt = db.prepare(
    authoritative
      ? `INSERT INTO items (id, name, quality, icon, slot, source_json, phase, verified, armor_token, phase_checked)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 1)
         ON CONFLICT(id) DO UPDATE SET
           name        = COALESCE(excluded.name,    items.name),
           quality     = COALESCE(excluded.quality, items.quality),
           icon        = COALESCE(excluded.icon,    items.icon),
           /* "This is an armor token" is a positive statement that it has no
              slot, unlike the silence COALESCE exists to respect — and the
              shipped seed did invent slots for tokens. So this is the one
              field an authoritative answer may clear rather than only set. */
           slot        = CASE WHEN excluded.armor_token = 1 THEN NULL
                              ELSE COALESCE(excluded.slot, items.slot) END,
           armor_token = COALESCE(excluded.armor_token, items.armor_token),
           source_json = CASE WHEN ${MISIDENTIFIED} THEN NULL
                              ELSE COALESCE(items.source_json, excluded.source_json) END,
           phase       = CASE WHEN ${MISIDENTIFIED} THEN NULL
                              ELSE COALESCE(items.phase, excluded.phase) END,
           /* Asked and answered, even when the answer was "no phase". Without
              this the queue would hand back the same ids every press. */
           phase_checked = 1,
           verified    = 1`
      : `INSERT INTO items (id, name, quality, icon, slot, source_json, phase, verified)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)
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
    const common = [
      i.id, i.name ?? null, i.quality ?? null, i.icon ?? null, i.slot ?? null,
      i.source ? JSON.stringify(i.source) : null, i.phase ?? null,
    ] as const;
    // `armor_token` rides the authoritative path only: Wowhead's subclass is
    // the sole source for it, and a gap-filling caller has nothing to say.
    const changes = authoritative
      ? stmt.run(...common, i.armorToken === undefined ? null : i.armorToken ? 1 : 0).changes
      : stmt.run(...common).changes;
    learned += Number(changes) > 0 ? 1 : 0;
  }
  return learned;
}

/** One tier piece and the armor token that buys it. */
export interface TokenRedemption {
  pieceId: number;
  tokenId: number;
}

/**
 * Record which token buys which tier piece, and mark the tokens as tokens.
 *
 * Overwrites, unlike `mergeItems`' gap-filling mode: Wowhead's vendor listing
 * is the only source for this edge and nothing else writes it, so an existing
 * value is an older reading of the same page rather than someone's answer to
 * protect. Rows are created if missing so an edge can be recorded for a piece
 * the cache has never seen — it arrives naming nothing but its id, and the
 * item resolver picks it up from `listUnresolvedItemIds` like any other.
 *
 * Returns the number of edges written.
 */
export function mergeTokenRedemptions(db: DatabaseSync, edges: TokenRedemption[]): number {
  const piece = db.prepare(
    `INSERT INTO items (id, redeems_from) VALUES (?, ?)
     ON CONFLICT(id) DO UPDATE SET redeems_from = excluded.redeems_from`,
  );
  const token = db.prepare(
    `INSERT INTO items (id, armor_token) VALUES (?, 1)
     ON CONFLICT(id) DO UPDATE SET armor_token = 1`,
  );
  const tokens = new Set<number>();
  let written = 0;
  for (const edge of edges) {
    if (!Number.isInteger(edge.pieceId) || !Number.isInteger(edge.tokenId)) continue;
    if (edge.pieceId <= 0 || edge.tokenId <= 0 || edge.pieceId === edge.tokenId) continue;
    piece.run(edge.pieceId, edge.tokenId);
    tokens.add(edge.tokenId);
    written++;
  }
  for (const id of tokens) token.run(id);
  return written;
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
    `INSERT INTO loot_awards (id, raid_session_id, character_id, raw_winner_name, item_id, item_name, awarded_at, offspec, external, note, decision_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    a.id, a.raidSessionId, a.characterId, a.rawWinnerName, a.itemId, a.itemName,
    a.awardedAt, a.offspec ? 1 : 0, a.external ? 1 : 0, a.note ?? null,
    a.decision ? JSON.stringify(a.decision) : null,
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
       prepot, prepot_label, death_times_json, potions_json, other_casts_json, extras_json, cooldowns_json, cast_times_json,
       upkeep_json, gear_json, talents_json, drums, runes, healthstones, sappers, missing_enchants_json, fight_start_ms,
       boss_parse_percent, boss_amount
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    f.id, f.reportCode, f.fightId, f.encounterId, f.encounterName, f.kill ? 1 : 0,
    f.fightPercentage ?? null, f.durationMs, f.actorName, f.characterId, f.className ?? null,
    f.spec ?? null, f.role, f.parsePercent ?? null, f.bracketPercent ?? null, f.amount ?? null,
    f.deaths, f.flask ?? null, JSON.stringify(f.elixirs), JSON.stringify(f.scrolls), f.food ? 1 : 0,
    f.weaponBuff ? 1 : 0, f.prepot ? 1 : 0, f.prepotLabel ?? null,
    JSON.stringify(f.deathTimes),
    JSON.stringify(f.potions), JSON.stringify(f.otherCasts),
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

function rowToItemComment(r: Row): unknown {
  return {
    id: r.id, itemId: r.item_id, characterId: opt(r.character_id), voice: r.voice,
    body: r.body, author: opt(r.author), createdAt: r.created_at,
  };
}

function rowToFeedback(r: Row): unknown {
  return {
    id: r.id, kind: r.kind, reporter: opt(r.reporter), body: r.body, route: r.route, url: r.url,
    context: r.context_json ? JSON.parse(r.context_json as string) : undefined,
    status: r.status, priority: r.priority, adminNote: opt(r.admin_note),
    createdAt: r.created_at,
  };
}

function rowToItem(r: Row): unknown {
  return {
    id: r.id, name: opt(r.name), quality: opt(r.quality), icon: opt(r.icon), slot: opt(r.slot),
    source: r.source_json ? JSON.parse(r.source_json as string) : undefined,
    phase: opt(r.phase),
    verified: r.verified === 1,
    // Three-valued on purpose: undefined is "never asked", false is "asked,
    // and it's an ordinary item". `=== 1` alone would flatten them into one.
    armorToken: r.armor_token === null || r.armor_token === undefined ? undefined : r.armor_token === 1,
    redeemsFrom: opt(r.redeems_from),
    phaseChecked: r.phase_checked === 1,
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
    decision: parseDecision(r.decision_json),
  };
}

/**
 * A stored snapshot, or undefined. Never throws: a decision that can't be read
 * back is a lost explanation, not a reason to fail the whole ledger.
 */
function parseDecision(raw: unknown): unknown {
  if (typeof raw !== "string" || raw === "") return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
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
    prepotLabel: opt(r.prepot_label),
    deathTimes: JSON.parse((r.death_times_json as string | null) ?? "[]"),
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
    itemComments: parseAll("item_comments", itemCommentSchema, (db.prepare("SELECT * FROM item_comments ORDER BY created_at DESC").all() as Row[]).map(rowToItemComment)),
    feedback: parseAll("feedback", feedbackReportSchema, (db.prepare("SELECT * FROM feedback ORDER BY created_at DESC").all() as Row[]).map(rowToFeedback)),
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
