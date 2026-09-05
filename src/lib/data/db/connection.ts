import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { SCHEMA } from "@/lib/data/db/schema";
import { migrate } from "@/lib/data/db/migrate";
import { seedIfEmpty } from "@/lib/data/db/seed";
/**
 * Opening the database, once per file path.
 *
 * Every connection runs `SCHEMA`, then `migrate`, then seeds if empty — in that
 * order, and on every boot, because there is no separate migration step to
 * forget to run.
 */

function defaultDbPath(): string {
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
