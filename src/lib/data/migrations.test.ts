import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  COLUMN_MIGRATIONS,
  POST_REBUILD_COLUMN_MIGRATIONS,
  SCHEMA,
  getDb,
  type ColumnMigration,
} from "@/lib/data/db";
import { getSqliteRepo } from "@/lib/data/sqlite-repo";
import { getWriteRepo } from "@/lib/data/repo";
import type { Repo } from "@/lib/data/repo";

/**
 * **A column added to `SCHEMA` alone works on every machine except the user's.**
 *
 * That is the failure `docs/pitfalls.md` §5 and `src/lib/data/AGENTS.md` both
 * warn about, and until this file existed nothing caught it: a from-scratch
 * suite creates every table from `SCHEMA`, so the missing `ALTER TABLE` never
 * shows. The database it breaks is the guild's real one, which exists, and
 * which nothing in CI resembles.
 *
 * Two halves, and the second is the one that matters more:
 *
 * 1. **Every listed migration works.** For each entry: build a database whose
 *    table is missing that one column, open the repo, and assert the column is
 *    back and shaped exactly the way `SCHEMA` declares it — same type, same
 *    NOT NULL, same DEFAULT. That last comparison is what catches `SCHEMA` and
 *    `migrate()` drifting apart, which they had: `fight_start_ms` was in
 *    `migrate()` and not in `SCHEMA` at all.
 * 2. **The list is complete.** A pinned baseline records, per table, the
 *    columns that no migration covers. Add a column to `SCHEMA` and forget the
 *    entry and it lands in that file, in the diff, where a reviewer sees it.
 *    Delete an entry and the same thing happens for the other reason. A new
 *    *table* is the legitimate case: its columns join the baseline wholesale,
 *    because `CREATE TABLE IF NOT EXISTS` gives old databases the whole table
 *    on the next boot.
 *
 * ## Why the schema is stripped of comments first
 *
 * SQLite's `ALTER TABLE … DROP COLUMN` rewrites the stored `CREATE TABLE` text
 * by cutting the column out. When the column is the **last** one and a block
 * comment sits in front of it, the cut leaves the comment's opening `/*`
 * behind with nothing to close it, and SQLite rejects its own output with
 * "incomplete input". Three of these columns are in that position. Stripping
 * the comments to build the old database changes nothing SQLite stores about
 * the table, and it is only ever done here — `getDb()` runs the real thing.
 */

const ALL: ColumnMigration[] = [...COLUMN_MIGRATIONS, ...POST_REBUILD_COLUMN_MIGRATIONS];

/** See the header: comments and `DROP COLUMN` do not get on. */
const DROPPABLE = SCHEMA.replace(/\/\*[\s\S]*?\*\//g, "");

interface ColumnShape {
  type: string;
  notnull: number;
  dflt_value: string | null;
}

const columnsOf = (db: DatabaseSync, table: string): Map<string, ColumnShape> =>
  new Map(
    (db.prepare(`PRAGMA table_info(${table})`).all() as unknown as (ColumnShape & { name: string })[]).map(
      ({ name, type, notnull, dflt_value }) => [name, { type, notnull, dflt_value }],
    ),
  );

/** Every table `SCHEMA` declares, in declaration order. */
function schemaTables(db: DatabaseSync): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[]
  ).map((r) => r.name);
}

/** A database built from `SCHEMA` and nothing else — the shape to match. */
function reference(): { db: DatabaseSync; tables: string[] } {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  return { db, tables: schemaTables(db) };
}

/**
 * One read per table a migration touches, so the walk proves the column is
 * usable rather than merely present. A migration on a table with no read here
 * fails the check below until somebody names one.
 */
const READS: Record<string, (repo: Repo) => Promise<unknown>> = {
  guild: (r) => r.getGuild(),
  characters: (r) => r.listCharacters(),
  items: (r) => r.listItems(),
  loot_awards: (r) => r.listLootAwards(),
  feedback: (r) => r.listFeedback(),
  wcl_reports: (r) => r.listWclReports(),
  wcl_player_fights: (r) => r.getCharacterPerformance("thrainn"),
  wcl_player_offpull: (r) => r.getCharacterPerformance("thrainn"),
};

describe("column migrations", () => {
  const { db: ref } = reference();

  it("finds the list at all, so an empty import cannot pass", () => {
    expect(ALL.length).toBeGreaterThan(40);
  });

  it("names each column once", () => {
    const seen = new Set<string>();
    const twice = ALL.map((m) => `${m.table}.${m.column}`).filter((k) => seen.has(k) || !seen.add(k));
    expect(twice, "a column migrated twice is a merge that went wrong").toEqual([]);
  });

  it("has a read for every table it migrates", () => {
    const unread = [...new Set(ALL.map((m) => m.table))].filter((t) => !READS[t]).sort();
    expect(
      unread,
      "Add an entry to READS naming one repo call that reads this table, so the walk proves " +
        "the restored column can actually be read back and not merely that it exists.",
    ).toEqual([]);
  });

  it.each(ALL.map((m) => [`${m.table}.${m.column}`, m] as const))("restores %s", async (_label, m) => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "projectlc-mig-")), "test.db");

    // A database from before this column: the whole schema, minus the one column.
    const old = new DatabaseSync(file);
    old.exec(DROPPABLE);
    // The drift in the other direction, which reads as an opaque SQLite error
    // if it is left to the DROP: a column `migrate()` adds and `SCHEMA` never
    // declares. It works — getDb() runs both — but the two definitions have
    // come apart, and only one of them is the record of what a table holds.
    expect(
      columnsOf(old, m.table).has(m.column),
      `${m.table}.${m.column} has a migration but SCHEMA does not declare it. A fresh ` +
        "database gets it only because migrate() happens to run after the CREATE TABLE. " +
        "Add it to SCHEMA; the entry here stays, for the databases that already exist.",
    ).toBe(true);
    old.exec(`ALTER TABLE ${m.table} DROP COLUMN ${m.column}`);
    // Proving the setup, not the code: a drop that quietly failed would make
    // every assertion below pass without migrate() having done anything.
    expect(columnsOf(old, m.table).has(m.column), `${m.column} was not actually dropped`).toBe(false);
    old.close();

    process.env.PROJECTLC_DB = file;
    const repo = getSqliteRepo();
    // Force the open: getSqliteRepo() is lazy, and migrate() runs inside getDb().
    await READS[m.table](repo);

    const got = columnsOf(getDb(), m.table).get(m.column);
    expect(
      got,
      `${m.table}.${m.column} is in SCHEMA but no migration puts it on a database that ` +
        "predates it. Fresh databases get it from the CREATE TABLE and every real one " +
        "does not — the one failure a from-scratch suite is blind to.",
    ).toBeDefined();
    expect(
      got,
      `${m.table}.${m.column} came back shaped differently from the way SCHEMA declares it. ` +
        "A fresh database and a migrated one would then disagree about the same column, " +
        "which is how a NOT NULL or a DEFAULT ends up applying to only half the deployments.",
    ).toEqual(columnsOf(ref, m.table).get(m.column));
  });
});

/**
 * The columns no migration covers, per table — the pinned half of the claim.
 *
 * Read the diff, not the file. A line appearing under an existing table means
 * a column was added to `SCHEMA` without the `COLUMN_MIGRATIONS` entry that
 * gives it to databases which already exist, **or** an entry was deleted. A
 * whole new block means a new table, which needs no migration and is the one
 * change that should simply be accepted.
 */
describe("the schema baseline", () => {
  it("pins every column that no migration covers", async () => {
    const { db: ref, tables } = reference();
    const migrated = new Set(ALL.map((m) => `${m.table}.${m.column}`));

    const lines = [
      "# Columns with no migration behind them",
      "",
      "Generated by `src/lib/data/migrations.test.ts`. Every column here is one a",
      "database gets from `SCHEMA` alone — either because it shipped with its table,",
      "or because its whole table is newer than the deployment and arrived through",
      "`CREATE TABLE IF NOT EXISTS`.",
      "",
      "A column appearing under an existing table is the bug this file exists to",
      "catch: it needs an entry in `COLUMN_MIGRATIONS`, or every database that",
      "already exists will never get it.",
      "",
    ];
    for (const table of [...tables].sort()) {
      const bare = [...columnsOf(ref, table).keys()].filter((c) => !migrated.has(`${table}.${c}`));
      lines.push(`## ${table}`, "", ...bare.map((c) => `- ${c}`), "");
    }
    ref.close();

    await expect(lines.join("\n")).toMatchFileSnapshot("./__snapshots__/schema-baseline.md");
  });
});

/**
 * The migrations that move data rather than add a column.
 *
 * A walk cannot reach these: they rebuild a table, drop one, or fill a column
 * from evidence elsewhere in the database, and the only way to test one is to
 * build the state it exists to fix. Each case below does that by hand.
 *
 * They matter more than the column walk, not less. A column migration that
 * fails throws on the next boot and is obvious; a rebuild that drops a column,
 * or a backfill that writes the wrong value, is silent — and the database it
 * happens to is the guild's only copy of its own history.
 *
 * Measured before these were written, by neutering each call in `migrate()` in
 * turn and running the suite: four of the nine were already covered
 * (`migrateClassGuidesToGuides`, `verifyItemProvenance`,
 * `scopePriorityRulesByPhase` and `repairArmorTokenClass`, each by a case in
 * `sqlite-repo.test.ts`) and five went unnoticed. These are the five.
 */
describe("rebuild and repair migrations", () => {
  /** A seeded database, opened and closed, ready to be edited into an old one. */
  async function seeded(): Promise<DatabaseSync> {
    process.env.PROJECTLC_DB = path.join(
      mkdtempSync(path.join(tmpdir(), "projectlc-seed-")),
      "test.db",
    );
    await getSqliteRepo().getGuild();
    return new DatabaseSync(process.env.PROJECTLC_DB!);
  }

  /**
   * Hand the edited database to a fresh path and open the repo on it.
   *
   * A copy rather than a reopen because `getDb()` keeps one handle per path and
   * would give back the connection that has already migrated. The checkpoint is
   * not optional: WAL mode leaves recent writes in `-wal`, so copying without it
   * produces a file in which the legacy state was never written at all.
   */
  function reopen(raw: DatabaseSync): Repo {
    raw.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    raw.close();
    const to = path.join(mkdtempSync(path.join(tmpdir(), "projectlc-old-")), "old.db");
    copyFileSync(process.env.PROJECTLC_DB!, to);
    process.env.PROJECTLC_DB = to;
    return getSqliteRepo();
  }

  it("backfills a report's track list from the pulls it already has", async () => {
    // A lower bound, deliberately: an aura that appears in a row was provably
    // collected, and one that does not could have been requested and never
    // landed. Reports imported before the list was recorded get the first and
    // never the second, which is why this reads rows rather than assuming.
    const raw = await seeded();
    raw.exec("UPDATE wcl_reports SET upkeep_tracks_json = '[]'");

    const repo = reopen(raw);
    const report = (await repo.listWclReports())[0].report;
    // Named by this report's own pulls, not by the app's current track list.
    expect(report.upkeepTracks).toContain("Battle Shout");
  });

  it("relaxes the item cache's NOT NULLs, keeping the rows and the later columns", async () => {
    // The rebuild the item cache needed once Wowhead became the authority: a
    // harvested id is a row with nothing in it but an id, and the old table
    // refused to hold one.
    const raw = await seeded();
    raw.exec(`
      DROP TABLE items;
      CREATE TABLE items (
        id          INTEGER PRIMARY KEY,
        name        TEXT NOT NULL,
        quality     TEXT NOT NULL,
        icon        TEXT NOT NULL,
        slot        TEXT,
        source_json TEXT,
        phase       INTEGER,
        verified    INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO items (id, name, quality, icon, slot, verified)
        VALUES (28773, 'Gorehowl', 'epic', 'inv_axe_09', 'mainHand', 1);
    `);

    const repo = reopen(raw);
    // The row survived the rebuild — this table is years of curation.
    expect((await repo.getItem(28773))!.name).toBe("Gorehowl");
    // A row with nothing but an id now fits, which is the whole point.
    expect(await (await getWriteRepo()).addItemsIfMissing([{ id: 99940 }])).toBe(1);

    const cols = columnsOf(getDb(), "items");
    for (const c of ["name", "quality", "icon"]) {
      expect(cols.get(c)!.notnull, `${c} is still NOT NULL`).toBe(0);
    }
    // And the three columns that must be added AFTER this rebuild really were.
    // Ordered before it they are created and then dropped again by the copy —
    // on exactly the databases old enough to need the rebuild, and nowhere else.
    for (const { column } of POST_REBUILD_COLUMN_MIGRATIONS) {
      expect(cols.has(column), `${column} did not survive the items rebuild`).toBe(true);
    }
  });

  it("drops the spells table the abilities cache replaced", async () => {
    // A key change, not a column: the same id means different things in the
    // spell and item spaces, so a row had to gain a kind. Nothing is carried
    // across — every entry is one Wowhead lookup, and re-asking is cheap.
    const raw = await seeded();
    raw.exec(`
      CREATE TABLE spells (id INTEGER PRIMARY KEY, name TEXT NOT NULL, icon TEXT);
      INSERT INTO spells (id, name) VALUES (12292, 'Death Wish');
    `);

    const repo = reopen(raw);
    const tables = (
      getDb().prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as unknown as {
        name: string;
      }[]
    ).map((r) => r.name);
    expect(tables).not.toContain("spells");
    expect(await repo.listAbilities()).toEqual([]);
  });

  it("files pre-existing gear pins as main-spec when the off-spec kit arrives", async () => {
    // A primary key change: pins used to be one per (character, slot) and are
    // now one per (character, spec, slot). Everything written before the
    // off-spec kit existed was somebody's main-spec answer, so that is what it
    // becomes — the alternative is a pin belonging to no kit at all.
    const raw = await seeded();
    const thrainn = (
      raw.prepare("SELECT id FROM characters WHERE name = 'Thrainn'").get() as unknown as {
        id: string;
      }
    ).id;
    raw.exec(`
      DROP TABLE current_gear_overrides;
      CREATE TABLE current_gear_overrides (
        character_id TEXT NOT NULL REFERENCES characters(id),
        slot         TEXT NOT NULL,
        item_id      INTEGER NOT NULL,
        item_name    TEXT NOT NULL,
        source       TEXT NOT NULL,
        set_at       TEXT NOT NULL,
        PRIMARY KEY (character_id, slot)
      );
    `);
    raw
      .prepare(
        `INSERT INTO current_gear_overrides (character_id, slot, item_id, item_name, source, set_at)
         VALUES (?, 'head', 29761, 'Helm of the Fallen Defender', 'manual', '2026-08-01T00:00:00.000Z')`,
      )
      .run(thrainn);

    const repo = reopen(raw);
    expect(columnsOf(getDb(), "current_gear_overrides").has("spec")).toBe(true);
    // It reads back on the kit loot is judged on, which is the claim.
    const bundle = (await repo.getCharacterBundle("thrainn"))!;
    expect(bundle.current!.slots.find((s) => s.slot === "head")!.itemId).toBe(29761);
  });

  it("promotes a stranded wowsims setup onto the spec its logs name", async () => {
    // Copied, never moved, and only when the build is unambiguous: the logs
    // genuinely call 0/44/17 Feral, Guardian and Warden, and deleting the one
    // wowsims link an officer ever pasted because a fingerprint could not
    // decide is not a failure mode worth having.
    const raw = await seeded();
    // Give one spec's pulls a build to fingerprint against. "5-3" sums per tree
    // to the same 5/3/0 the rows report, which is what joins the two.
    raw.exec(
      "UPDATE wcl_player_fights SET talents_json = '[5,3,0]' WHERE class_name = 'Warrior' AND spec = 'Arms'",
    );
    raw
      .prepare("INSERT INTO meta (key, value) VALUES ('sim_settings:thrainn', ?)")
      .run(JSON.stringify({ player: { class: "ClassWarrior", talentsString: "5-3" } }));

    const repo = reopen(raw);
    const withProfile = (await repo.listSimSpecs())
      .filter((s) => s.wowClass === "Warrior" && s.hasProfile)
      .map((s) => s.spec);
    // Arms is what this guild's logs call that build, and the only thing they
    // call it — so it is the one spec the setup can be placed on.
    expect(withProfile).toEqual(["Arms"]);
  });

  it("leaves a setup alone when the logs call its build two different things", async () => {
    // The other half, and the reason this migration copies rather than moves.
    // Thrainn is Protection and Kazrak is Arms; give both specs the same build
    // and no fingerprint can say which one the officer pasted. Writing either
    // would be a guess, and the spec page offers it for adoption by hand
    // instead — which only works if the setup is still there to offer.
    const raw = await seeded();
    raw.exec("UPDATE wcl_player_fights SET talents_json = '[5,3,0]' WHERE class_name = 'Warrior'");
    raw
      .prepare("INSERT INTO meta (key, value) VALUES ('sim_settings:thrainn', ?)")
      .run(JSON.stringify({ player: { class: "ClassWarrior", talentsString: "5-3" } }));

    const repo = reopen(raw);
    expect((await repo.listSimSpecs()).filter((s) => s.hasProfile)).toEqual([]);
    // Still on file, so nothing an officer pasted was thrown away.
    const kept = getDb()
      .prepare("SELECT value FROM meta WHERE key = 'sim_settings:thrainn'")
      .get() as { value: string } | undefined;
    expect(kept).toBeDefined();
  });
});
