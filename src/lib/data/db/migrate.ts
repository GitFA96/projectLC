import { DatabaseSync } from "node:sqlite";
import { UPTIME_TRACK_BY_LABEL } from "@/lib/wcl/class-tracks";
import { normalizeItemName } from "@/lib/loot/priority-sheet";
import { type Row } from "@/lib/data/db/core";
import {
  SIM_PROFILE_PREFIX,
  listStrandedSimSettings,
  simProfileKey,
} from "@/lib/data/db/meta/sim-profiles";
/**
 * Bringing an existing database up to the current schema.
 *
 * The half of persistence that fails silently: `SCHEMA` only ever runs against
 * a database that does not exist yet, so a column added there and nowhere else
 * works perfectly in tests and throws on the user's real file. Everything in
 * here exists to close that gap, and `migrations.test.ts` walks all of it.
 *
 * Order matters and is not alphabetical. The rebuilds run in the sequence they
 * were written in, because several assume the shape a previous one left.
 */

/**
 * Fold `class_guides` into the general `guides` table.
 *
 * A key change rather than a column, so `addColumn` cannot do it — the rows are
 * copied and the old table dropped, once. Every existing guide was written by
 * the guild, so it is copied under the guild's own id; nothing becomes an
 * operator baseline by accident, because nobody has written one yet.
 *
 * Runs before the `addColumn` block so a database that never had class_guides
 * (a fresh one) does nothing and costs one PRAGMA.
 */
function migrateClassGuidesToGuides(db: DatabaseSync): void {
  const cols = db.prepare("PRAGMA table_info(class_guides)").all() as { name: string }[];
  if (cols.length === 0) return;
  const pending = db.prepare("SELECT COUNT(*) c FROM class_guides").get() as { c: number };
  if (pending.c > 0) {
    // The guild that wrote them. Single-guild deployments are the only ones
    // that can have rows here, so "the first guild" is exact rather than a
    // guess — but if there is somehow none, the rows are left in place rather
    // than filed under an owner nobody can read.
    const guild = db.prepare("SELECT id FROM guild LIMIT 1").get() as { id: string } | undefined;
    if (!guild) return;
    db.prepare(
      `INSERT OR IGNORE INTO guides (kind, subject, section, owner, body, sources, author, updated_at)
       SELECT 'class', wow_class, spec, ?, body, sources, author, updated_at FROM class_guides`,
    ).run(guild.id);
  }
  db.exec("DROP TABLE class_guides");
}

/** Additive migrations for databases created by earlier versions of the schema. */

/**
 * One column added to a table after that table shipped.
 *
 * A new column has to go in two places: the `CREATE TABLE` in `SCHEMA`, which
 * is what a fresh database gets, and an entry here, which is what every
 * database that already exists gets. Miss the second and it works everywhere
 * except on the user's real data — the one failure mode a from-scratch suite
 * is blind to. A whole new *table* needs neither: `SCHEMA` is all
 * `CREATE TABLE IF NOT EXISTS` and runs on every boot.
 *
 * These are a list rather than a run of calls so `migrations.test.ts` can walk
 * them — build a database without the column, open the repo, and check the
 * column came back looking exactly the way `SCHEMA` declares it. That test also
 * pins which columns *aren't* here, so adding one to `SCHEMA` and forgetting
 * the entry fails rather than waiting for the user to find it.
 *
 * **The order is history. Do not rearrange it**, and read
 * `POST_REBUILD_COLUMN_MIGRATIONS` before adding to the end of this one.
 */
export interface ColumnMigration {
  table: string;
  column: string;
  /** Everything after the name in `ALTER TABLE <table> ADD COLUMN <column> …`. */
  type: string;
}

export const COLUMN_MIGRATIONS: ColumnMigration[] = [
  { table: "guild", column: "visibility", type: "TEXT NOT NULL DEFAULT 'private'" },
  { table: "guild", column: "succession_admin_days", type: "INTEGER" },
  { table: "guild", column: "succession_member_days", type: "INTEGER" },
  { table: "loot_awards", column: "external", type: "INTEGER NOT NULL DEFAULT 0" },
  { table: "wcl_player_fights", column: "scrolls_json", type: "TEXT NOT NULL DEFAULT '[]'" },
  { table: "wcl_player_fights", column: "other_casts_json", type: "TEXT NOT NULL DEFAULT '[]'" },
  { table: "wcl_player_fights", column: "extras_json", type: "TEXT NOT NULL DEFAULT '[]'" },
  { table: "wcl_player_fights", column: "cooldowns_json", type: "TEXT NOT NULL DEFAULT '[]'" },
  { table: "wcl_player_fights", column: "cast_times_json", type: "TEXT NOT NULL DEFAULT '[]'" },
  { table: "wcl_player_fights", column: "upkeep_json", type: "TEXT NOT NULL DEFAULT '[]'" },
  { table: "wcl_player_fights", column: "gear_json", type: "TEXT NOT NULL DEFAULT '[]'" },
  { table: "wcl_player_fights", column: "talents_json", type: "TEXT NOT NULL DEFAULT '[]'" },
  { table: "characters", column: "main_character_id", type: "TEXT" },
  // Every existing character starts unclaimed, which is the honest backfill:
  // nothing recorded who plays what, and nothing can now.
  { table: "characters", column: "membership_id", type: "TEXT" },
  { table: "characters", column: "off_spec", type: "TEXT" },
  { table: "characters", column: "off_spec_role", type: "TEXT" },
  // Existing characters backfill to "unknown", which is what an empty list
  // means everywhere it is read — the roster never recorded this before.
  { table: "characters", column: "professions_json", type: "TEXT NOT NULL DEFAULT '[]'" },
  { table: "wcl_player_fights", column: "sappers", type: "INTEGER NOT NULL DEFAULT 0" },
  { table: "wcl_player_fights", column: "late_consumables_json", type: "TEXT NOT NULL DEFAULT '[]'" },
  { table: "wcl_player_fights", column: "fight_start_ms", type: "INTEGER" },
  { table: "wcl_player_fights", column: "prepot_label", type: "TEXT" },
  { table: "wcl_player_fights", column: "death_times_json", type: "TEXT NOT NULL DEFAULT '[]'" },
  { table: "wcl_player_fights", column: "boss_parse_percent", type: "REAL" },
  { table: "wcl_player_fights", column: "boss_amount", type: "REAL" },
  { table: "wcl_player_fights", column: "dispels_json", type: "TEXT NOT NULL DEFAULT '[]'" },
  { table: "wcl_player_fights", column: "interrupts_json", type: "TEXT NOT NULL DEFAULT '[]'" },
  { table: "wcl_player_offpull", column: "trash_interrupts_json", type: "TEXT NOT NULL DEFAULT '[]'" },
  { table: "wcl_player_offpull", column: "trash_dispels_json", type: "TEXT NOT NULL DEFAULT '[]'" },
  { table: "wcl_player_offpull", column: "pet_buffs_seen_json", type: "TEXT NOT NULL DEFAULT '[]'" },
  { table: "wcl_reports", column: "upkeep_tracks_json", type: "TEXT NOT NULL DEFAULT '[]'" },
  { table: "wcl_reports", column: "enemy_casts_json", type: "TEXT NOT NULL DEFAULT '[]'" },
  // Reports imported before this get an empty list, which is honest: the dump
  // was computed and shown at the time, and nothing kept it. It is not the same
  // as "this night had no unknown auras", so readers say "not recorded" rather
  // than "none" — the same distinction upkeep_tracks_json exists to make.
  { table: "wcl_reports", column: "unclassified_auras_json", type: "TEXT NOT NULL DEFAULT '[]'" },
  // The feedback table shipped with only bug reports. Existing rows were filed
  // as bugs and the DEFAULT says so, so the backfill is the default itself.
  { table: "feedback", column: "kind", type: "TEXT NOT NULL DEFAULT 'bug'" },
  // Triage. Everything filed before these existed is untriaged, which is what
  // the default says — no backfill can invent a judgement nobody made.
  { table: "feedback", column: "priority", type: "TEXT NOT NULL DEFAULT 'unset'" },
  { table: "feedback", column: "admin_note", type: "TEXT" },
  // Notes written before anyone signed them keep no author, which is honest:
  // nothing recorded who wrote them and nothing can now.
  { table: "feedback", column: "admin_note_author", type: "TEXT" },
  { table: "feedback", column: "admin_note_at", type: "TEXT" },
  // Reports closed before this stay unsigned, and no backfill can fix that:
  // nothing recorded who closed them or when. NULL says exactly that, which is
  // the honest answer for a tool whose point is decisions you can defend later.
  { table: "feedback", column: "resolved_by", type: "TEXT" },
  { table: "feedback", column: "resolved_at", type: "TEXT" },
  // Awards made before this shipped have no snapshot, and cannot gain one: the
  // policy that produced them is gone. NULL says exactly that.
  { table: "loot_awards", column: "decision_json", type: "TEXT" },
];

/**
 * Columns that must be added **after** `relaxItemColumns`, not with the block
 * above.
 *
 * That rebuild copies a fixed list of columns into a new `items` table, so a
 * column added to `items` before it runs is created and then silently dropped —
 * on exactly the databases old enough to need the rebuild, and nowhere else.
 * The list is separate rather than a comment in the middle of one list because
 * the split is the thing that has to survive somebody tidying up.
 */
export const POST_REBUILD_COLUMN_MIGRATIONS: ColumnMigration[] = [
  { table: "items", column: "armor_token", type: "INTEGER" },
  // Every row confirmed before the phase was read off Wowhead's answer is
  // unchecked, which is what the default says: they get one more lookup each,
  // once, and are never asked again whether or not a phase came back.
  { table: "items", column: "phase_checked", type: "INTEGER NOT NULL DEFAULT 0" },
  { table: "items", column: "redeems_from", type: "INTEGER" },
];

export function migrate(db: DatabaseSync): void {
  const addColumn = ({ table, column, type }: ColumnMigration) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (cols.length === 0 || cols.some((c) => c.name === column)) return;
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    } catch (e) {
      // Parallel build workers can race the same migration; losing is fine.
      if (!/duplicate column/i.test(String(e))) throw e;
    }
  };
  migrateClassGuidesToGuides(db);
  // Co-owners: ownership stopped being unique per guild. Idempotent, and the
  // rule it enforced ("at least one owner") moved into removeGuildOwner, which
  // can count rows and this cannot.
  //
  // Ahead of the column block rather than in the middle of it, which is where
  // it used to sit: the index is on `memberships` and no column migration
  // touches that table, so the two cannot interact in either order.
  db.exec("DROP INDEX IF EXISTS memberships_one_guild_master");
  for (const migration of COLUMN_MIGRATIONS) addColumn(migration);
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
  for (const migration of POST_REBUILD_COLUMN_MIGRATIONS) addColumn(migration);
  // AFTER relaxItemColumns too, and for a second reason: the backfill reads
  // `items.phase` to place each existing chain, so it has to run against the
  // rebuilt table rather than the one about to be dropped.
  scopePriorityRulesByPhase(db);
  // Last, and it has to be: this reads `armor_token` and `redeems_from`, and
  // both are created directly above — after the rebuild that would otherwise
  // drop them.
  repairArmorTokenClass(db);
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

/**
 * Un-file the rings that were filed as tier tokens.
 *
 * `parseWowheadItemXml` tested Wowhead's subclass without its class, and -2
 * under the Armor class means Rings rather than Armor Tokens. Two things
 * followed, both silent: the token-mapping queue filled with rings whose pages
 * name no pieces, so it never drained however many times an officer pressed;
 * and an authoritative write clears the slot of anything it believes is a
 * token, so every ring in the cache lost its slot — which is what the wishlist
 * slot families and the "already served this slot" loot penalty read.
 *
 * The flag is cleared rather than corrected, because "not a token" and "nobody
 * has asked" are the same state as far as the queue is concerned. **Rows
 * something redeems from are left alone**: a piece pointing at them is proof
 * the vendor listing named pieces, which no ring will ever do.
 *
 * `verified` goes with it, and that is what actually repairs the damage. The
 * token queue skips any row a gear set names, so clearing the flag alone would
 * leave every ring somebody wishlisted flagless *and* slotless for ever —
 * invisible to both queues. Un-verifying is also the honest description: these
 * rows were written by a classifier that was wrong about them, so the one thing
 * `verified` is supposed to promise isn't true. The item backfill re-asks, and
 * the same authoritative write puts the slot back.
 *
 * Runs once. Without the sentinel it would clear a real token that simply has
 * no pieces mapped yet, on every boot, and the queue would ping-pong for ever —
 * which is the exact symptom this exists to fix.
 */
function repairArmorTokenClass(db: DatabaseSync): void {
  const KEY = "repair:armor_token_needs_class";
  if (db.prepare("SELECT 1 FROM meta WHERE key = ?").get(KEY)) return;
  db.prepare(
    `UPDATE items SET armor_token = NULL, verified = 0
      WHERE armor_token = 1
        AND id NOT IN (SELECT redeems_from FROM items WHERE redeems_from IS NOT NULL)`,
  ).run();
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
    KEY,
    new Date().toISOString(),
  );
}

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
 * Officer chains used to be one row per item, applying to every phase at once.
 *
 * That put both Warglaives — chains an officer wrote against the tier they drop
 * in — on the phase 2 sheet, as "unlisted" officer edits, because a chain the
 * phase's sheet didn't name is shown on every phase's page. The key gains
 * `phase`, which SQLite can't do with ALTER TABLE.
 *
 * **The backfill resolves each chain's phase from the item, not from the guild's
 * current one.** The alternative — stamping every existing chain with the active
 * phase — would move each one onto the sheet the officer was *not* looking at
 * when they wrote it, and there is a better answer available: the same name → id
 * resolution the sheet view uses (an officer's `sheet_item_ids` pin first,
 * because they pinned it precisely because the name is ambiguous, then an exact
 * name match), and then that item's own phase. A chain whose item the cache
 * can't place keeps applying to the guild's current phase, and the sheet row
 * shows which phase it belongs to so an officer can move it.
 */
function scopePriorityRulesByPhase(db: DatabaseSync): void {
  const cols = db.prepare("PRAGMA table_info(item_priority_rules)").all() as { name: string }[];
  if (cols.length === 0 || cols.some((c) => c.name === "phase")) return;

  const rules = db.prepare("SELECT item_key, item_name, chain, note, updated_at FROM item_priority_rules").all() as {
    item_key: string;
    item_name: string;
    chain: string;
    note: string | null;
    updated_at: string;
  }[];

  const activePhase =
    (db.prepare("SELECT active_phase FROM guild LIMIT 1").get() as { active_phase?: number } | undefined)
      ?.active_phase ?? 1;

  // The officer's pins, keyed the same way the read model keys them.
  const pinRow = db.prepare("SELECT value FROM meta WHERE key = 'sheet_item_ids'").get() as
    | { value?: string }
    | undefined;
  let pins: Record<string, number> = {};
  if (pinRow?.value) {
    try {
      pins = JSON.parse(pinRow.value) as Record<string, number>;
    } catch {
      // A corrupt pin blob must not cost the guild their chains — fall through
      // to name matching, which is what an unpinned row gets anyway.
    }
  }

  const phaseById = new Map<number, number>();
  for (const row of db.prepare("SELECT id, phase FROM items WHERE phase IS NOT NULL").all() as {
    id: number;
    phase: number;
  }[]) {
    phaseById.set(row.id, row.phase);
  }
  const idByName = new Map<string, number>();
  for (const row of db.prepare("SELECT id, name FROM items WHERE name IS NOT NULL").all() as {
    id: number;
    name: string;
  }[]) {
    idByName.set(normalizeItemName(row.name), row.id);
  }

  const phaseOf = (itemKey: string): number => {
    const itemId = pins[itemKey] ?? idByName.get(itemKey);
    return (itemId === undefined ? undefined : phaseById.get(itemId)) ?? activePhase;
  };

  db.exec(`
    CREATE TABLE item_priority_rules_phased (
      item_key   TEXT NOT NULL,
      phase      INTEGER NOT NULL,
      item_name  TEXT NOT NULL,
      chain      TEXT NOT NULL,
      note       TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (item_key, phase)
    );
  `);
  const insert = db.prepare(
    `INSERT OR REPLACE INTO item_priority_rules_phased
       (item_key, phase, item_name, chain, note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const rule of rules) {
    insert.run(rule.item_key, phaseOf(rule.item_key), rule.item_name, rule.chain, rule.note, rule.updated_at);
  }
  db.exec(`
    DROP TABLE item_priority_rules;
    ALTER TABLE item_priority_rules_phased RENAME TO item_priority_rules;
  `);
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
export function treePointsFromString(talentsString: string): string {
  return padTrees(
    talentsString
      .split("-")
      .map((tree) => [...tree].reduce((sum, ch) => sum + (Number.parseInt(ch, 10) || 0), 0)),
  );
}

/** The logs' `talents_json` in the same shape, or undefined when it has none. */
export function parseTreePoints(json: string | null): string | undefined {
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
