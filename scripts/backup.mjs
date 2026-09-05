#!/usr/bin/env node
/**
 * Take a backup of the guild's database, verify it, then prune the old ones.
 *
 * `npm run backup`. Reads `PROJECTLC_DB` — the same variable the app reads —
 * and falls back to `data/projectlc.db`, so on a host it needs no arguments and
 * a scheduler can run it as it stands.
 *
 * Three properties this file exists to hold, none of which a plain `cp` has:
 *
 * 1. **It opens the database read-only and never through `getDb()`.** The app's
 *    opener runs `SCHEMA`, then `migrate`, then seeds if empty, on every boot —
 *    so a backup written the app's way would *migrate the thing it is backing
 *    up*, on a schedule, unattended. Root AGENTS.md invariant 1 says never
 *    write to the live database; this is the script most likely to break it by
 *    accident.
 * 2. **`VACUUM INTO` reads through the connection, so it sees the `-wal`.**
 *    Recent writes live there until a checkpoint folds them in, and a file copy
 *    of the `.db` alone opens cleanly, answers every query, and is silently
 *    missing the newest rows — the worst possible way to be wrong about a
 *    backup.
 * 3. **Nothing is deleted until the new backup has been opened and read.**
 *    Retention that runs first would, on the day the source is damaged, prune a
 *    good backup to make room for a bad one.
 *
 * A backup written beside the database it protects survives a bad migration and
 * a wrong `DELETE`. It does not survive losing the disk. Copying the directory
 * off the host is the operator's half and belongs in the schedule that calls
 * this — see the deploy skill.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { backupName, isBackupName, toPrune, vacuumIntoSql, verifyReport } from "./backup-checks.mjs";

const source = process.env.PROJECTLC_DB ?? path.join(process.cwd(), "data", "projectlc.db");
const dir = process.env.PROJECTLC_BACKUP_DIR ?? path.join(path.dirname(source), "backups");
const keep = Number(process.env.PROJECTLC_BACKUP_KEEP ?? 14);

function fail(message) {
  console.error(`backup FAILED — ${message}`);
  process.exit(1);
}

if (!existsAsFile(source)) {
  fail(`no database at ${source}. Set PROJECTLC_DB to the one you mean.`);
}

mkdirSync(dir, { recursive: true });
const target = path.join(dir, backupName(Date.now()));
if (existsAsFile(target)) {
  // Same second, twice. Refusing is right: VACUUM INTO will not overwrite
  // either, and a backup that silently replaced another would be worse.
  fail(`${target} already exists`);
}

let written;
try {
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    db.exec(vacuumIntoSql(target));
  } finally {
    db.close();
  }
  written = statSync(target).size;
} catch (error) {
  fail(`${source} → ${target}: ${error instanceof Error ? error.message : error}`);
}

try {
  const copy = new DatabaseSync(target, { readOnly: true });
  try {
    const integrity = copy.prepare("PRAGMA integrity_check").get();
    const tables = copy
      .prepare("SELECT count(*) AS n FROM sqlite_schema WHERE type = 'table'")
      .get();
    const report = verifyReport(Object.values(integrity ?? {})[0], Number(tables?.n));
    if (report) fail(`${target} was written but ${report}`);
  } finally {
    copy.close();
  }
} catch (error) {
  fail(`${target} was written but will not open: ${error instanceof Error ? error.message : error}`);
}

console.log(`backup ${target} — ${(written / 1_000_000).toFixed(1)} MB, verified`);

let stale;
try {
  stale = toPrune(readdirSync(dir), keep);
} catch (error) {
  // A bad PROJECTLC_BACKUP_KEEP. The backup itself is already safe on disk, so
  // say so and fail: retention is broken and somebody has to know.
  fail(`${target} is safe, but PROJECTLC_BACKUP_KEEP is unusable: ${error.message}`);
}
for (const name of stale) {
  rmSync(path.join(dir, name));
  console.log(`  pruned ${name}`);
}
console.log(`${readdirSync(dir).filter(isBackupName).length} backups in ${dir}.`);

function existsAsFile(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}
