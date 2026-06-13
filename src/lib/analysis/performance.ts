import { format, parseISO } from "date-fns";
import type { AttendanceSummary, PerformanceSummary, WclPlayerFight, WclRole } from "@/lib/types";

/**
 * Raid weeks follow the EU reset: Wednesday. Returns the ISO date (UTC) of the
 * Wednesday opening the week containing `iso`. A Tuesday-night raid belongs to
 * the closing week; a Wednesday-night raid opens the new one. (The true reset
 * is Wednesday morning — the midnight-UTC boundary only misclassifies raids
 * logged between 00:00 and ~07:00 UTC on Wednesday, which don't happen.)
 */
export function resetWeekStart(iso: string): string {
  const date = parseISO(iso);
  const daysSinceWednesday = (date.getUTCDay() - 3 + 7) % 7;
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysSinceWednesday));
  return start.toISOString().slice(0, 10);
}

/** One tooltip string explaining exactly how an attendance % was counted. */
export function attendanceTitle(a: AttendanceSummary): string {
  const parts = [
    a.firstSeenAt
      ? `Counted since their first logged raid (${format(parseISO(a.firstSeenAt), "d MMM yyyy")}): ${a.raidsAttended} of ${a.raidsTracked}`
      : `${a.raidsAttended} of ${a.raidsTracked} logged raids`,
    `raided in ${a.weeksAttended} of the last ${a.weeksTracked} counted reset week${a.weeksTracked === 1 ? "" : "s"}`,
    `last ${a.recentTotal} raid${a.recentTotal === 1 ? "" : "s"}: ${a.recentAttended}/${a.recentTotal}`,
    `in ${a.pullPct}% of boss pulls when present`,
  ];
  if (a.weeksExcused > 0) {
    parts.push(`${a.weeksExcused} reset week${a.weeksExcused === 1 ? "" : "s"} excused (not counted)`);
  }
  if (a.raidsTracked < a.raidsTotal) {
    parts.push(`${a.raidsTotal - a.raidsTracked} earlier log(s)/excused week(s) don't count`);
  }
  return parts.join(" · ");
}

/**
 * Rollups over player-fight rows. Parses use the median (a raid night with one
 * padded farm boss shouldn't define a player); preparation is coverage across
 * pulls. "Flask or two elixirs" mirrors how TBC raiders actually consume —
 * a flask occupies both elixir slots.
 */

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(value);
}

function pct(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 100);
}

function dominant<T extends string>(values: (T | undefined)[]): T | undefined {
  const counts = new Map<T, number>();
  for (const v of values) {
    if (v === undefined) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: T | undefined;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

export function summarizePerformance(rows: WclPlayerFight[]): PerformanceSummary | undefined {
  if (rows.length === 0) return undefined;

  const parses = rows.map((r) => r.parsePercent).filter((p): p is number => p !== undefined);
  const brackets = rows.map((r) => r.bracketPercent).filter((p): p is number => p !== undefined);
  const flaskOrElixirs = rows.filter((r) => r.flask !== undefined || r.elixirs.length >= 2).length;
  const fed = rows.filter((r) => r.food).length;
  const prepared = rows.filter((r) => (r.flask !== undefined || r.elixirs.length >= 2) && r.food).length;
  const potionsTotal = rows.reduce((sum, r) => sum + r.potions.length, 0);
  // Callers pass rows in chronological order — the last row is the latest pull.
  const latest = rows.at(-1);

  return {
    fights: rows.length,
    kills: rows.filter((r) => r.kill).length,
    wipes: rows.filter((r) => !r.kill).length,
    deaths: rows.reduce((sum, r) => sum + r.deaths, 0),
    medianParse: median(parses),
    bestParse: parses.length > 0 ? Math.round(Math.max(...parses)) : undefined,
    medianBracket: median(brackets),
    role: dominant<WclRole>(rows.map((r) => r.role)) ?? "dps",
    spec: dominant(rows.map((r) => r.spec)),
    flaskOrElixirsPct: pct(flaskOrElixirs, rows.length),
    foodPct: pct(fed, rows.length),
    weaponBuffPct: pct(rows.filter((r) => r.weaponBuff).length, rows.length),
    preparedPct: pct(prepared, rows.length),
    potionsTotal,
    potionsPerFight: rows.length === 0 ? 0 : Math.round((potionsTotal / rows.length) * 10) / 10,
    prepots: rows.filter((r) => r.prepot).length,
    drums: rows.reduce((sum, r) => sum + r.drums, 0),
    runes: rows.reduce((sum, r) => sum + r.runes, 0),
    healthstones: rows.reduce((sum, r) => sum + r.healthstones, 0),
    missingEnchants: latest?.missingEnchants ?? [],
  };
}
