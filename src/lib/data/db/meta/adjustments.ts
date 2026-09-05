import { DatabaseSync } from "node:sqlite";
import type { ConsumableAdjustment } from "@/lib/types";
/**
 * `consumable_adjustments:<code>` and `excluded_fights:<code>`.
 *
 * Both are an officer overruling the log for one report: uses it never saw, and
 * pulls that should not count. Additive and reversible — the logged numbers are
 * never overwritten.
 */

const consumableAdjustmentKey = (code: string) => `consumable_adjustments:${code}`;

/** Drop anything malformed so a hand-edited blob can't crash a read. */
function sanitizeAdjustments(raw: unknown): ConsumableAdjustment[] {
  if (!Array.isArray(raw)) return [];
  const out: ConsumableAdjustment[] = [];
  for (const value of raw) {
    if (value === null || typeof value !== "object") continue;
    const { actorName, name, delta, note, by, at } = value as Record<string, unknown>;
    if (typeof actorName !== "string" || actorName.trim() === "") continue;
    if (typeof name !== "string" || name.trim() === "") continue;
    if (typeof delta !== "number" || !Number.isInteger(delta) || delta === 0) continue;
    out.push({
      actorName: actorName.trim(),
      name: name.trim(),
      delta,
      note: typeof note === "string" && note.trim() !== "" ? note.trim() : undefined,
      by: typeof by === "string" && by.trim() !== "" ? by.trim() : undefined,
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
