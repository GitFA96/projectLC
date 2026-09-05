import { DatabaseSync } from "node:sqlite";
import type { ConsumablePrice, ReportPayback } from "@/lib/types";
/**
 * `consumable_prices:<code>` and `gold_payback:<code>`.
 *
 * A raid's prices are the officer's, per report: what a flask cost the guild in
 * the week it was drunk is not what it costs now, and a night already argued
 * over must not silently re-price itself.
 */

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

/* Per-report payback: the marks the raid banked, what a mark is worth this
   week, and what has actually been handed back. Same meta-key shape as the
   prices above — see change-chains §3 — because it is the same kind of thing:
   an officer's record about one night, that no derived model reads. */

const paybackKey = (code: string) => `gold_payback:${code}`;

/** Unset, and the value every night starts at: no pot, nothing paid. */
const EMPTY_PAYBACK: ReportPayback = { marks: 0, markGold: 0, paid: {} };

/**
 * Keep only well-formed numbers so a hand-edited blob can never crash a read.
 *
 * The caps are deliberate rather than defensive: a raid banks tens of marks,
 * not millions, and a paid figure larger than a guild bank is a typo somebody
 * should see rejected rather than saved.
 */
function sanitizePayback(raw: unknown): ReportPayback {
  if (raw === null || typeof raw !== "object") return EMPTY_PAYBACK;
  const r = raw as Record<string, unknown>;
  const bounded = (v: unknown, max: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(v, max) : 0;
  const paid: Record<string, number> = {};
  if (r.paid !== null && typeof r.paid === "object") {
    for (const [name, value] of Object.entries(r.paid as Record<string, unknown>)) {
      const gold = bounded(value, 1_000_000);
      // A zero is the same statement as an absent name, and storing it would
      // grow the blob by a row every time somebody typed into a box and
      // cleared it again.
      if (gold > 0 && name.trim().length > 0 && name.length <= 80) paid[name] = gold;
    }
  }
  return {
    marks: Math.floor(bounded(r.marks, 10_000)),
    markGold: bounded(r.markGold, 100_000),
    paid,
  };
}

/** A report's payback record (all zeroes when the officers haven't set one). */
export function getReportPayback(db: DatabaseSync, code: string): ReportPayback {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(paybackKey(code)) as
    | { value: string }
    | undefined;
  if (!row) return EMPTY_PAYBACK;
  try {
    return sanitizePayback(JSON.parse(row.value));
  } catch {
    return EMPTY_PAYBACK;
  }
}

/** Persist a report's payback record (replaces the whole blob for that report). */
export function setReportPayback(db: DatabaseSync, code: string, payback: ReportPayback): void {
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(paybackKey(code), JSON.stringify(sanitizePayback(payback)));
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
