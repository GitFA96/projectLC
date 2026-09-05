import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { backupName, isBackupName, toPrune, vacuumIntoSql, verifyReport } from "./backup-checks.mjs";

/**
 * `npm run backup`, which is the rollback.
 *
 * Migrations here are additive and applied on first connection with no down
 * path, so redeploying the previous image does not undo one. The snapshot is
 * the only way back, which makes this the script whose failure stays invisible
 * until the single day it matters — the same argument `doctor.test.ts` and the
 * build guards make, and the reason the CLI is exercised end to end below
 * rather than only through its pure half.
 *
 * The direction that matters is a **backup that looks taken and is not**: a
 * short copy, a pruned good one, or a file nobody has opened. Each has a case.
 */

const run = promisify(execFile);
const CLI = path.resolve(import.meta.dirname, "./backup.mjs");

/** A throwaway database with a row still sitting in the `-wal`. */
function seeded(): { dir: string; file: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "projectlc-backup-"));
  const file = path.join(dir, "projectlc.db");
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("CREATE TABLE characters (id TEXT PRIMARY KEY, name TEXT NOT NULL);");
  db.prepare("INSERT INTO characters VALUES (?, ?)").run("c1", "Thrainn");
  // Deliberately left open and uncheckpointed: this is the state a running
  // deployment is always in, and the state a file copy gets wrong.
  return { dir, file };
}

function tableNames(file: string): string[] {
  const db = new DatabaseSync(file, { readOnly: true });
  const rows = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all();
  db.close();
  return rows.map((r) => String((r as { name: unknown }).name));
}

async function backup(env: Record<string, string>) {
  return run(process.execPath, [CLI], { env: { ...process.env, ...env } });
}

describe("naming", () => {
  it("is an instant, and sorts the way it reads", () => {
    expect(backupName(Date.UTC(2026, 8, 6, 14, 30, 0) + 123)).toBe(
      "projectlc-20260906T143000.123Z.db",
    );
    // Lexical order is the retention order. A friendlier "6 Sep 2026" would
    // prune the wrong file the first time a month rolled over — and the
    // fractional second has to order below the next whole one, which is the
    // half that is easy to get wrong.
    const names = [
      backupName(Date.UTC(2026, 8, 30, 23, 0, 0)),
      backupName(Date.UTC(2026, 9, 1, 1, 0, 0)),
      backupName(Date.UTC(2026, 8, 6, 14, 30, 0)),
      backupName(Date.UTC(2026, 8, 6, 14, 30, 0) + 900),
      backupName(Date.UTC(2026, 8, 6, 14, 30, 1)),
    ];
    expect([...names].sort()).toEqual([names[2], names[3], names[4], names[0], names[1]]);
  });

  it("has no character Windows refuses", () => {
    expect(backupName(Date.now())).not.toMatch(/[:*?"<>|]/);
  });

  it("refuses a date that is not one", () => {
    expect(() => backupName(NaN)).toThrow(/real date/);
    expect(() => backupName("tuesday" as unknown as number)).toThrow(/real date/);
  });
});

describe("retention", () => {
  const ours = [
    "projectlc-20260901T010000.000Z.db",
    "projectlc-20260902T010000.000Z.db",
    "projectlc-20260903T010000.000Z.db",
  ];

  it("keeps the newest N, counting the one just written", () => {
    expect(toPrune(ours, 3)).toEqual([]);
    expect(toPrune(ours, 2)).toEqual([ours[0]]);
    expect(toPrune(ours, 1)).toEqual([ours[0], ours[1]]);
  });

  it("touches nothing it did not write", () => {
    // The directory belongs to an operator. A hand-made snapshot taken before a
    // risky migration is exactly the file most worth keeping, and exactly the
    // one an over-eager glob would delete first.
    const strangers = [
      "before-the-migration.db",
      "projectlc.db",
      "projectlc-20260901T010000.000Z.db-wal",
      "projectlc-2026-09-01.db",
      "README.md",
    ];
    expect(toPrune([...strangers, ...ours], 1)).toEqual([ours[0], ours[1]]);
  });

  it("refuses a retention that would delete what was just taken", () => {
    // The realistic cause is an unset or mistyped environment variable, not an
    // operator who means it.
    for (const bad of [0, -1, 1.5, NaN, undefined, "seven"]) {
      expect(() => toPrune(ours, bad as number), String(bad)).toThrow(/keep must be/);
    }
  });
});

describe("the destination is a string, not an identifier", () => {
  it("quotes with single quotes", () => {
    // SQLite reads a double-quoted token as an identifier, so VACUUM INTO "..."
    // fails with a message about a missing column and not about the path.
    expect(vacuumIntoSql("/backups/a.db")).toBe("VACUUM INTO '/backups/a.db'");
    expect(vacuumIntoSql("C:\\data\\a.db")).toBe("VACUUM INTO 'C:\\data\\a.db'");
  });

  it("escapes a quote in the path rather than ending the literal", () => {
    expect(vacuumIntoSql("/home/o'brien/a.db")).toBe("VACUUM INTO '/home/o''brien/a.db'");
  });
});

describe("verification", () => {
  it("accepts a database that opens and has tables", () => {
    expect(verifyReport("ok", 12)).toBeNull();
  });

  it("names what is wrong", () => {
    expect(verifyReport("*** in database main ***", 12)).toMatch(/integrity_check/);
    expect(verifyReport("ok", 0)).toMatch(/no tables/);
  });
});

describe("the CLI, end to end", () => {
  it("takes a backup that carries what is still in the -wal", async () => {
    const { dir, file } = seeded();
    const { stdout } = await backup({ PROJECTLC_DB: file });

    const backups = readdirSync(path.join(dir, "backups"));
    expect(backups.filter(isBackupName)).toHaveLength(1);
    expect(stdout).toMatch(/verified/);

    // The claim the whole script rests on. `cp projectlc.db` alone would give a
    // file that opens, answers every query, and does not have this row.
    const copy = new DatabaseSync(path.join(dir, "backups", backups[0]), { readOnly: true });
    expect(copy.prepare("SELECT name FROM characters").all()).toEqual([{ name: "Thrainn" }]);
    copy.close();
  });

  it("leaves the source untouched — no schema, no migration, no seed", async () => {
    const { file } = seeded();
    /*
     * The `-wal` is compared, and it is the whole test.
     *
     * In WAL mode a write lands in `projectlc.db-wal` and does not touch
     * `projectlc.db` until a checkpoint — so an earlier version of this case,
     * which compared the `.db` alone, stayed green while a deliberately broken
     * script ran CREATE TABLE against the source. That is the same mistake as
     * copying a database without its `-wal` and believing the copy, and this
     * project has made it before.
     *
     * The `-shm` is not compared: it is a shared-memory index, and even an
     * honest read-only reader may rewrite it.
     */
    const parts = [file, `${file}-wal`];
    const before = parts.map((p) => readFileSync(p));
    const tablesBefore = tableNames(file);

    await backup({ PROJECTLC_DB: file });

    // Invariant 1. The app's own opener runs SCHEMA, then migrate(), then seeds
    // if empty, on every boot — so a backup written the app's way would migrate
    // the thing it is backing up, unattended, on a schedule.
    parts.forEach((p, i) => expect(readFileSync(p).equals(before[i]), p).toBe(true));
    expect(tableNames(file)).toEqual(tablesBefore);
  });

  it("prunes the oldest once the new one is verified", async () => {
    const { dir, file } = seeded();
    const backupDir = path.join(dir, "backups");
    await backup({ PROJECTLC_DB: file, PROJECTLC_BACKUP_KEEP: "2" });
    // Two more, dated by hand, so the run below has something to prune.
    const older = ["projectlc-20260101T000000.000Z.db", "projectlc-20260102T000000.000Z.db"];
    for (const name of older) writeFileSync(path.join(backupDir, name), "not a database");

    const { stdout } = await backup({ PROJECTLC_DB: file, PROJECTLC_BACKUP_KEEP: "2" });
    const left = readdirSync(backupDir).filter(isBackupName).sort();
    expect(left).toHaveLength(2);
    expect(left).not.toContain(older[0]);
    expect(stdout).toMatch(/pruned projectlc-20260101/);
  });

  it("prunes nothing on a run that fails to take one", async () => {
    // The ordering that matters, and the only way to see it: pruning runs last,
    // so a run that cannot produce a backup must leave every old one standing.
    // Retention first would, on the day the source is unreadable, delete two
    // good backups to make room for one that was never written.
    const { dir, file } = seeded();
    await backup({ PROJECTLC_DB: file });
    const backupDir = path.join(dir, "backups");
    const older = ["projectlc-20260101T000000.000Z.db", "projectlc-20260102T000000.000Z.db"];
    for (const name of older) writeFileSync(path.join(backupDir, name), "not a database");

    const junk = path.join(dir, "junk.db");
    writeFileSync(junk, "this is not a database");
    await expect(
      backup({ PROJECTLC_DB: junk, PROJECTLC_BACKUP_DIR: backupDir, PROJECTLC_BACKUP_KEEP: "1" }),
    ).rejects.toMatchObject({ code: 1 });

    expect(readdirSync(backupDir).filter(isBackupName)).toHaveLength(3);
  });

  it("fails, and deletes nothing, when there is no database to back up", async () => {
    const { dir } = seeded();
    const missing = path.join(dir, "not-here.db");
    await expect(backup({ PROJECTLC_DB: missing })).rejects.toMatchObject({ code: 1 });
    expect(readdirSync(dir)).not.toContain("backups");
  });

  it("fails on a retention setting it cannot use, with the backup already safe", async () => {
    const { dir, file } = seeded();
    await expect(
      backup({ PROJECTLC_DB: file, PROJECTLC_BACKUP_KEEP: "0" }),
    ).rejects.toMatchObject({ code: 1 });
    // The backup is on disk; only the pruning is broken, and saying so is the
    // point — the alternative is a run that reports success and never prunes.
    expect(readdirSync(path.join(dir, "backups")).filter(isBackupName)).toHaveLength(1);
  });

  it("refuses a source that is not a database", async () => {
    const { dir } = seeded();
    const junk = path.join(dir, "junk.db");
    writeFileSync(junk, "this is not a database");
    await expect(backup({ PROJECTLC_DB: junk })).rejects.toMatchObject({ code: 1 });
    expect(readdirSync(path.join(dir, "backups")).filter(isBackupName)).toHaveLength(0);
  });
});
