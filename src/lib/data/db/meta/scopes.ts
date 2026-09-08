import { DatabaseSync } from "node:sqlite";
import {
  DEFAULT_RAID_SCOPE,
  parseRaidScope,
  type RaidScope,
} from "@/lib/analysis/raid-scope";

/**
 * `report_scope:<code>` — whose night an imported report was.
 *
 * A setting rather than a column, for the reason change-chains §3 gives, and
 * for one more that is specific to this table: `insertWclReport` is
 * `INSERT OR REPLACE` and a refetch replaces the report wholesale, so a column
 * here would have to be read back and passed through the fetch on every
 * refetch or it would silently reset to "guild" — the §2 trap, on the one
 * button an officer presses to keep an old import current.
 *
 * **The default writes nothing.** An absent row is a guild raid, so a report
 * nobody has classified reads exactly as it did before this key existed, and
 * un-tagging a night removes the row rather than storing the word "guild".
 */

const reportScopeKey = (code: string) => `report_scope:${code}`;

/** One report's scope. Unset — or unreadable — is a guild raid. */
export function getReportScope(db: DatabaseSync, code: string): RaidScope {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(reportScopeKey(code)) as
    | { value: string }
    | undefined;
  return parseRaidScope(row?.value) ?? DEFAULT_RAID_SCOPE;
}

/**
 * Every classified report, keyed by code — one query, because the read model
 * builds this for the whole history at once and a per-report lookup would be a
 * meta hit per raid night on every rebuild.
 *
 * Guild nights are absent from the result, not present with `"guild"`: that is
 * what the key stores, and a caller must default anyway for the reports that
 * predate this setting.
 */
export function getAllReportScopes(db: DatabaseSync): Record<string, RaidScope> {
  const rows = db
    .prepare("SELECT key, value FROM meta WHERE key LIKE 'report_scope:%'")
    .all() as { key: string; value: string }[];
  const out: Record<string, RaidScope> = {};
  for (const { key, value } of rows) {
    const scope = parseRaidScope(value);
    // A word this build doesn't know is dropped rather than kept: a night
    // filed under a heading that doesn't exist would be a night nobody can
    // find. It reads as a guild raid, which is the visible answer.
    if (scope) out[key.slice("report_scope:".length)] = scope;
  }
  return out;
}

/** Set a report's scope. Setting it back to the default clears the row. */
export function setReportScope(db: DatabaseSync, code: string, scope: RaidScope): void {
  if (scope === DEFAULT_RAID_SCOPE) {
    db.prepare("DELETE FROM meta WHERE key = ?").run(reportScopeKey(code));
    return;
  }
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(reportScopeKey(code), scope);
}
