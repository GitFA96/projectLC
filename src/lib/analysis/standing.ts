/**
 * Where each raider stands against the rest of the roster — the "who should we
 * replace?" board.
 *
 * Two deliberate differences from the loot score, because it answers a
 * different question:
 *
 * **Loot owed is absent.** Being owed loot is not a demerit. It belongs in
 * "who should get this item" and nowhere near "who is carrying their weight".
 *
 * **Everything is relative to this roster.** A raider is placed by where they
 * sit among the guild's own raiders, not against a threshold somebody invented.
 * "95% uptime is good" is exactly the kind of number this app has no business
 * asserting; "third from bottom of nineteen on preparation" is a fact about
 * the guild, and it is the sentence an officer can actually act on.
 *
 * That also makes the board self-correcting. When the whole roster improves,
 * the bar moves with it — which is what the officers asked for when they said
 * the KPIs have to keep tracking objective data rather than a fixed target.
 *
 * Missing data drops out rather than scoring zero, and the row says how many
 * KPIs it was measured on, because a raider placed on one KPI is not
 * comparable to one placed on three.
 *
 * Pure.
 */

import { DEFAULT_POLICY, type GuildPolicy } from "@/lib/analysis/policy";
import type { CharacterStatus, RaiderMetrics } from "@/lib/types";

export const STANDING_KPIS = ["attendance", "performance", "preparation"] as const;
export type StandingKpiKey = (typeof STANDING_KPIS)[number];

export const STANDING_KPI_LABELS: Record<StandingKpiKey, string> = {
  attendance: "Attendance",
  performance: "Median parse",
  preparation: "Preparation",
};

export interface StandingInput {
  characterId: string;
  name: string;
  status: CharacterStatus;
  metrics?: RaiderMetrics;
  /**
   * Recent parse mean minus everything earlier, in points — from
   * `analysis/development`. Passed through and shown, never scored: a placing
   * says where they are and this says which way they are going, and folding
   * one into the other would lose both.
   */
  parseTrend?: number;
}

export interface StandingKpi {
  key: StandingKpiKey;
  label: string;
  /** Their own figure, in the KPI's own units. Absent when never measured. */
  value?: number;
  /**
   * Where that sits among the raiders who have a figure at all: 0 is the
   * bottom of the roster, 100 the top. Ties share the midpoint, so two raiders
   * on the same number can never be ordered against each other by accident.
   */
  percentile?: number;
  /** What the figure is made of, for the tooltip. */
  detail: string;
}

/**
 * Which quarter of the roster a placing falls in.
 *
 * Quartiles are arithmetic, not a standard: "bottom quarter" is a description
 * of where somebody sits, and stays true however good or bad the guild is. It
 * is deliberately NOT a verdict — the bottom quarter of a strong roster may be
 * doing fine, and that judgement stays with the council.
 */
export type StandingBand = "bottom" | "lower" | "upper" | "top";

export const STANDING_BAND_LABELS: Record<StandingBand, string> = {
  bottom: "Bottom quarter",
  lower: "Below the middle",
  upper: "Above the middle",
  top: "Top quarter",
};

export function bandOf(standing: number): StandingBand {
  if (standing < 25) return "bottom";
  if (standing < 50) return "lower";
  if (standing < 75) return "upper";
  return "top";
}

export interface StandingRow {
  characterId: string;
  name: string;
  status: CharacterStatus;
  kpis: StandingKpi[];
  /** Weighted mean of the percentiles they have. Absent when unranked. */
  standing?: number;
  /** Which quarter of the roster that falls in. Absent when unranked. */
  band?: StandingBand;
  /** How many of the KPIs they have a figure for. */
  measured: number;
  /** Set when they are listed but deliberately not placed. */
  unranked?: string;
  /**
   * Recent attendance beside the all-time figure. Context, never scored: a
   * raider at 90% all-time and 30% lately is the conversation, and a composite
   * that averaged the two would hide exactly that.
   */
  recentAttendancePct?: number;
  raidsAttended?: number;
  raidsTracked?: number;
  /** Which way their parse is going, in points. Context, never scored. */
  parseTrend?: number;
}

/** One KPI's shape across the roster — the instrument for reading the board. */
export interface StandingDistribution {
  key: StandingKpiKey;
  label: string;
  /** Raiders with a figure, and raiders without one. */
  measured: number;
  missing: number;
  min?: number;
  median?: number;
  max?: number;
  /**
   * max − min. A KPI where this is tiny separates nobody, and a board built on
   * it is measuring noise. No threshold is applied: the number is reported and
   * the council decides whether it is telling them anything.
   */
  spread?: number;
}

export interface StandingBoard {
  /** Lowest standing first — the board exists to answer a hard question. */
  rows: StandingRow[];
  distributions: StandingDistribution[];
  /**
   * How many raiders the placings are drawn from.
   *
   * Only raiders the board will actually place. Someone with two logged nights
   * is not ranked, so they must not set the scale either — a handful of trials
   * and half-linked alts sitting at the bottom of the data would lift every
   * regular's percentile and flatter the whole roster.
   */
  pool: number;
  /** Listed but not placed, and why. */
  unplaced: number;
}

function median(sorted: number[]): number | undefined {
  if (sorted.length === 0) return undefined;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
}

/**
 * Percentile of `value` within `sorted`, ties sharing the midpoint.
 *
 * A roster of one has no distribution to sit in, so it returns 50 rather than
 * 0 or 100 — being the only measured raider is not a verdict either way.
 */
function percentileOf(value: number, sorted: number[]): number {
  if (sorted.length <= 1) return 50;
  let below = 0;
  let equal = 0;
  for (const v of sorted) {
    if (v < value) below++;
    else if (v === value) equal++;
  }
  return Math.round(((below + equal / 2) / sorted.length) * 100);
}

/** The three figures the board reads, straight off the metrics they already have. */
function kpiValues(metrics: RaiderMetrics | undefined): Record<StandingKpiKey, number | undefined> {
  return {
    attendance: metrics?.attendance?.raidsTracked ? metrics.attendance.raidPct : undefined,
    performance: metrics?.career?.medianParse,
    preparation: metrics?.career?.fights ? metrics.career.preparedPct : undefined,
  };
}

function detailFor(key: StandingKpiKey, metrics: RaiderMetrics | undefined): string {
  const attendance = metrics?.attendance;
  const career = metrics?.career;
  switch (key) {
    case "attendance":
      return attendance?.raidsTracked
        ? `${attendance.raidsAttended} of ${attendance.raidsTracked} logged raids`
        : "no logged raids yet";
    case "performance":
      return career?.medianParse !== undefined
        ? `median of ${career.kills} ranked kill${career.kills === 1 ? "" : "s"}`
        : "no ranked kills yet";
    case "preparation":
      return career?.fights
        ? `flask or elixirs and food, across ${career.fights} pulls`
        : "no logged pulls yet";
  }
}

/**
 * Build one board.
 *
 * The comparison pool is exactly what you pass in — this doesn't decide who
 * counts as a raider. Pass one group at a time: mains are weighed against
 * mains, because an alt raiding once a fortnight would otherwise drag every
 * regular's placing up and flatter the whole roster. `rosterStanding` below
 * does that split.
 */
export function buildStandingBoard(
  raiders: StandingInput[],
  policy: GuildPolicy = DEFAULT_POLICY,
): StandingBoard {
  const { weights, minRaids } = policy.roster;

  // Who the board will place, decided before anything is measured: only these
  // raiders contribute to the distributions, so the people we decline to rank
  // can't quietly set the bar for the people we do.
  const placeable = (raider: StandingInput) =>
    (raider.metrics?.attendance?.raidsAttended ?? 0) >= minRaids;

  const valuesByKpi = new Map<StandingKpiKey, number[]>();
  for (const key of STANDING_KPIS) valuesByKpi.set(key, []);
  const perRaider = new Map<string, Record<StandingKpiKey, number | undefined>>();
  for (const raider of raiders) {
    const values = kpiValues(raider.metrics);
    perRaider.set(raider.characterId, values);
    if (!placeable(raider)) continue;
    for (const key of STANDING_KPIS) {
      const v = values[key];
      if (v !== undefined) valuesByKpi.get(key)!.push(v);
    }
  }
  const sortedByKpi = new Map(
    [...valuesByKpi].map(([key, list]) => [key, [...list].sort((a, b) => a - b)] as const),
  );

  const rows: StandingRow[] = raiders.map((raider) => {
    const values = perRaider.get(raider.characterId)!;
    const attendance = raider.metrics?.attendance;
    // Too few nights to place: they are listed, so nobody vanishes from the
    // board, but a trial with two raids doesn't belong at the bottom of a
    // replace list next to a regular who stopped turning up. Their figures are
    // still shown — just without a placing, which they haven't earned either way.
    const tooNew = !placeable(raider);
    const kpis: StandingKpi[] = STANDING_KPIS.map((key) => {
      const value = values[key];
      return {
        key,
        label: STANDING_KPI_LABELS[key],
        value,
        percentile:
          value === undefined || tooNew ? undefined : percentileOf(value, sortedByKpi.get(key)!),
        detail: detailFor(key, raider.metrics),
      };
    });

    const measured = tooNew
      ? STANDING_KPIS.filter((key) => values[key] !== undefined).length
      : kpis.filter((k) => k.percentile !== undefined).length;
    const unranked = tooNew
      ? `only ${attendance?.raidsAttended ?? 0} logged raid${(attendance?.raidsAttended ?? 0) === 1 ? "" : "s"}`
      : measured === 0
        ? "nothing logged yet"
        : undefined;

    let standing: number | undefined;
    if (unranked === undefined) {
      let weighted = 0;
      let totalWeight = 0;
      for (const kpi of kpis) {
        if (kpi.percentile === undefined) continue;
        const w = weights[kpi.key];
        weighted += kpi.percentile * w;
        totalWeight += w;
      }
      standing = totalWeight > 0 ? Math.round(weighted / totalWeight) : undefined;
    }

    return {
      characterId: raider.characterId,
      name: raider.name,
      status: raider.status,
      kpis,
      standing,
      band: standing === undefined ? undefined : bandOf(standing),
      measured,
      unranked,
      parseTrend: raider.parseTrend,
      recentAttendancePct: attendance?.recentTotal ? attendance.recentPct : undefined,
      raidsAttended: attendance?.raidsAttended,
      raidsTracked: attendance?.raidsTracked,
    };
  });

  // Lowest first; the unranked sit at the end, because they are a question
  // rather than an answer.
  rows.sort((a, b) => {
    if (a.standing === undefined && b.standing === undefined) return a.name.localeCompare(b.name);
    if (a.standing === undefined) return 1;
    if (b.standing === undefined) return -1;
    return a.standing - b.standing || a.name.localeCompare(b.name);
  });

  const pool = raiders.filter(placeable).length;
  const distributions: StandingDistribution[] = STANDING_KPIS.map((key) => {
    const sorted = sortedByKpi.get(key)!;
    return {
      key,
      label: STANDING_KPI_LABELS[key],
      measured: sorted.length,
      missing: pool - sorted.length,
      min: sorted[0],
      median: median(sorted),
      max: sorted[sorted.length - 1],
      spread:
        sorted.length > 0
          ? Math.round((sorted[sorted.length - 1] - sorted[0]) * 10) / 10
          : undefined,
    };
  });

  return { rows, distributions, pool, unplaced: raiders.length - pool };
}

/**
 * The boards an officer actually reads: mains against mains, everyone else
 * against everyone else.
 *
 * One pooled board was wrong in a way that looked fine. Percentiles are
 * relative, so an alt who raids occasionally sits at the bottom of the data and
 * lifts every regular above them — the guild reads as healthier than it is, and
 * the raider you were asking about moves for reasons that have nothing to do
 * with them. Alts also aren't people you replace; they're somebody's second
 * character, and "should we bench this alt" is not a question the roster asks.
 *
 * Pugs are in neither. They aren't the guild.
 */
export interface RosterStanding {
  mains: StandingBoard;
  /** Alts and inactive raiders, placed among themselves. */
  alts: StandingBoard;
}

export function buildRosterStanding(
  raiders: StandingInput[],
  policy: GuildPolicy = DEFAULT_POLICY,
): RosterStanding {
  return {
    // Trials sit with the mains, which is the whole point of a trial: the
    // question is whether they hold up against the raiding core, and a board
    // of their own would answer a question nobody is asking. `roster.minRaids`
    // still keeps a two-night trial off the list rather than at the bottom.
    mains: buildStandingBoard(
      raiders.filter((r) => r.status === "main" || r.status === "trial"),
      policy,
    ),
    alts: buildStandingBoard(
      raiders.filter((r) => r.status === "alt" || r.status === "inactive"),
      policy,
    ),
  };
}
