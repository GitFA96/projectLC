import { format, parseISO } from "date-fns";
import { potionsUsed } from "@/lib/analysis/potions";
import { hasConsumableCoverage, hasFood, isPrepared } from "@/lib/analysis/preparation";
import { DEFAULT_POLICY, type GuildPolicy } from "@/lib/analysis/policy";
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

/** One line of the attendance breakdown: what was counted, and out of what. */
export interface AttendanceFact {
  label: string;
  value: string;
  /** Why the denominator is what it is — the part officers get asked about. */
  note?: string;
}

/**
 * How an attendance percentage was arrived at, one claim per line.
 *
 * This is the number a raider argues with, so the breakdown has to be legible
 * rather than merely present. Structured rather than prose because it is shown
 * two ways — a hover tooltip and a panel that opens on click — and both are
 * built from this, so neither can quietly start saying something the other
 * doesn't.
 */
export function attendanceFacts(a: AttendanceSummary): AttendanceFact[] {
  const skipped = a.raidsTotal - a.raidsTracked;
  const facts: AttendanceFact[] = [
    // One fraction, and the percentage is that same fraction — so there is
    // never a question of which number the percentage came from. The rolling
    // windows the score uses (last N raids, last N weeks) are deliberately not
    // here: three different "7 of 10"s on one card, each over a different
    // denominator, is what made this unreadable.
    {
      label: "Raids",
      value: `${a.raidsAttended} of ${a.raidsTracked} · ${a.raidPct}%`,
      note: a.firstSeenAt
        ? `every raid logged since their first, ${format(parseISO(a.firstSeenAt), "d MMM yyyy")}`
        : "every raid logged since their first",
    },
    { label: "Boss pulls", value: `${a.pullPct}% when present` },
  ];
  if (a.weeksExcused > 0) {
    facts.push({
      label: "Excused",
      value: `${a.weeksExcused} week${a.weeksExcused === 1 ? "" : "s"}`,
      note: "shown, never counted",
    });
  }
  if (skipped > 0) {
    facts.push({
      label: "Outside the count",
      value: `${skipped} raid${skipped === 1 ? "" : "s"}`,
      note: "logged before they joined, or in an excused week",
    });
  }
  if (a.weeks.length > 0) {
    facts.push({
      label: "Dots",
      value: `last ${a.weeks.length} reset week${a.weeks.length === 1 ? "" : "s"}`,
      note: "green = raided that week",
    });
  }
  return facts;
}

/** The same breakdown as one string, for a `title` on the figure itself. */
export function attendanceTitle(a: AttendanceSummary): string {
  return attendanceFacts(a)
    .map((f) => `${f.label}: ${f.value}${f.note ? ` (${f.note})` : ""}`)
    .join(" · ");
}

/**
 * Rollups over player-fight rows. Parses use the median (a raid night with one
 * padded farm boss shouldn't define a player); preparation is coverage across
 * pulls. "Flask or an elixir" counts as consumable coverage — many raiders
 * (hunters especially) run a single battle elixir rather than a full flask, and
 * that should register rather than read as "used nothing".
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

export function summarizePerformance(
  rows: WclPlayerFight[],
  policy: GuildPolicy = DEFAULT_POLICY,
): PerformanceSummary | undefined {
  if (rows.length === 0) return undefined;
  const prep = policy.preparation;

  /*
   * Pulls the preparation figures are measured over.
   *
   * The council can excuse whole encounters — last phase's raid, cleared on the
   * way past, that nobody is asked to flask for. Those pulls still parse, still
   * count as showing up, and still cost gold; they just stop being evidence
   * about whether somebody came prepared. When every pull in the set is
   * excused the denominator would be zero, and a 0% nobody earned is worse
   * than the honest answer, so the figures fall back to the whole set — the
   * same reasoning as a factor with no data dropping out of an average.
   */
  const excusedEncounters = new Set(prep.excusedEncounters ?? []);
  const preparedOn =
    excusedEncounters.size === 0
      ? rows
      : (() => {
          const kept = rows.filter((r) => !excusedEncounters.has(r.encounterName));
          return kept.length > 0 ? kept : rows;
        })();

  const parses = rows.map((r) => r.parsePercent).filter((p): p is number => p !== undefined);
  const brackets = rows.map((r) => r.bracketPercent).filter((p): p is number => p !== undefined);
  const flaskOrElixirs = preparedOn.filter((r) => hasConsumableCoverage(r, prep)).length;
  const fed = preparedOn.filter((r) => hasFood(r)).length;
  const prepared = preparedOn.filter((r) => isPrepared(r, prep)).length;
  const potionsTotal = rows.reduce((sum, r) => sum + potionsUsed(r), 0);
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
    flaskOrElixirsPct: pct(flaskOrElixirs, preparedOn.length),
    // The two halves of that number, kept apart. A flask lasts the night and
    // survives a death; a single cheap elixir does neither, and lumping them
    // together hides the difference between the raider who buys a 100g flask
    // every week and the one who drinks an Elixir of Mastery on pull one.
    flaskPct: pct(preparedOn.filter((r) => r.flask !== undefined).length, preparedOn.length),
    elixirsPct: pct(preparedOn.filter((r) => r.elixirs.length >= 1).length, preparedOn.length),
    foodPct: pct(fed, preparedOn.length),
    weaponBuffPct: pct(preparedOn.filter((r) => r.weaponBuff).length, preparedOn.length),
    preparedPct: pct(prepared, preparedOn.length),
    potionsTotal,
    potionsPerFight: rows.length === 0 ? 0 : Math.round((potionsTotal / rows.length) * 10) / 10,
    prepots: rows.filter((r) => r.prepot).length,
    drums: rows.reduce((sum, r) => sum + r.drums, 0),
    runes: rows.reduce((sum, r) => sum + r.runes, 0),
    healthstones: rows.reduce((sum, r) => sum + r.healthstones, 0),
    sappers: rows.reduce((sum, r) => sum + r.sappers, 0),
    missingEnchants: latest?.missingEnchants ?? [],
  };
}
