/**
 * What a backup is called, which old ones may be deleted, and how the
 * destination is spelled to SQLite.
 *
 * Migrations here are additive and applied on first connection, and **there is
 * no down path** — redeploying the previous image does not roll the database
 * back, because it has already moved on. The snapshot *is* the rollback, which
 * makes this the one script whose failure is invisible until the day it
 * matters.
 *
 * Three things live here rather than in the CLI because each is a decision
 * somebody could get wrong quietly:
 *
 * - **The name sorts the way it reads.** Retention is "keep the newest N", and
 *   the cheapest correct sort is lexical over an ISO instant. A friendlier
 *   `2026-09-06 14.30` would prune the wrong file the first time a month
 *   rolled over.
 * - **Pruning only ever considers names this script writes.** The directory is
 *   an operator's; a hand-made `before-the-migration.db` in it is not ours to
 *   delete, and neither is the `-wal` beside a database somebody parked there.
 * - **The destination is a SQL string literal**, and SQLite reads a
 *   double-quoted token as an *identifier*. `VACUUM INTO "..."` therefore fails
 *   with a message about a missing column rather than about the path.
 *
 * Pure, and the CLI is `backup.mjs`. No shebang in this file — see the note on
 * `doctor-checks.mjs` for what one does to Vite's parser.
 */

/** `projectlc-20260906T143000.123Z.db` — an instant, sortable, legal on Windows. */
const PATTERN = /^projectlc-\d{8}T\d{6}\.\d{3}Z\.db$/;

export function backupName(now) {
  const at = new Date(now);
  if (Number.isNaN(at.getTime())) throw new Error("backupName needs a real date");
  // 2026-09-06T14:30:00.123Z → 20260906T143000.123Z. Colons are not filenames
  // on Windows, and the dashes go with them so the two halves stay legible.
  //
  // Milliseconds rather than seconds, and the test is why: an operator taking a
  // manual backup right after a scheduled one is an ordinary minute of an
  // ordinary day, and at second precision the second run refused instead of
  // running. The fraction still sorts correctly against a later whole second,
  // because "." orders below every digit.
  return `projectlc-${at.toISOString().slice(0, 23).replace(/[-:]/g, "")}Z.db`;
}

export function isBackupName(name) {
  return PATTERN.test(name);
}

/**
 * The backups to delete, oldest first.
 *
 * `keep` counts the backups that survive, the one just written included — so
 * `keep: 1` means "this one and nothing else", and `keep: 0` would mean the
 * script deletes what it just made. That is a retention policy nobody wants and
 * is far more likely to be an unset environment variable, so it is refused.
 */
export function toPrune(names, keep) {
  if (!Number.isInteger(keep) || keep < 1) {
    throw new Error(`keep must be a whole number of backups to retain, not ${JSON.stringify(keep)}`);
  }
  const ours = names.filter(isBackupName).sort();
  return ours.slice(0, Math.max(0, ours.length - keep));
}

/** `VACUUM INTO` with the destination as a string literal, not an identifier. */
export function vacuumIntoSql(target) {
  return `VACUUM INTO '${String(target).replace(/'/g, "''")}'`;
}

/**
 * Whether a file that was written is a database worth calling a backup.
 *
 * `VACUUM INTO` either succeeds or throws, so this is not about a torn write —
 * it is about the class of failure where the source was already damaged and the
 * copy faithfully reproduces it. A backup nobody has opened is a claim, and the
 * whole point of this script is to have made the claim before the day it is
 * needed rather than on it.
 *
 * @param integrity what `PRAGMA integrity_check` returned
 * @param tables how many tables the copy has
 */
export function verifyReport(integrity, tables) {
  if (integrity !== "ok") return `the copy fails integrity_check: ${integrity}`;
  if (!Number.isInteger(tables) || tables < 1) return "the copy has no tables in it";
  return null;
}
