import { DatabaseSync } from "node:sqlite";
/**
 * What every other file here needs and nothing above this directory does.
 *
 * `Row` and `opt` are how a SQLite row is read — a column is `null`, never
 * `undefined`, and everything downstream wants the opposite. `withTx` and the
 * `data_version` pair are the two halves of invariant 3: a write is atomic, and
 * it tells the read model it happened. Deliberately absent from `db.ts`'s
 * re-exports except those three, which callers legitimately need.
 */

export type Row = Record<string, unknown>;

export function opt<T>(v: T | null | undefined): T | undefined {
  return v === null || v === undefined ? undefined : v;
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
