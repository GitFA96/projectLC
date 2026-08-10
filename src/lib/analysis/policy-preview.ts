/**
 * "What would this change actually do?"
 *
 * A policy field is a number with no obvious blast radius. Turning off "a
 * single elixir counts as coverage" reads like a small tightening; on this
 * guild's real data it takes 21 of 39 raiders from near-100% preparation to
 * zero, because they run elixirs and never flask. An officer should meet that
 * fact before saving, not next Wednesday when the loot score has moved.
 *
 * So this measures the roster twice — once under the policy in force, once
 * under the proposed one — and reports what moved. Pure: the caller builds both
 * read models and hands in the two sets of figures.
 */

/** One raider's before/after on the figures a policy change can move. */
export interface PolicyPreviewRow {
  name: string;
  slug?: string;
  className?: string;
  /** Preparation coverage %, the figure the elixir rule moves. */
  preparedBefore?: number;
  preparedAfter?: number;
  /** Recent attendance %, which the attendance window moves. */
  attendanceBefore?: number;
  attendanceAfter?: number;
}

export interface PolicyPreview {
  /** Raiders whose numbers changed at all, biggest mover first. */
  moved: PolicyPreviewRow[];
  /** How many raiders were measured. */
  measured: number;
  /**
   * Raiders who fall from some preparation coverage to none. Called out
   * separately because it is the difference between "scores a bit lower" and
   * "reads as having brought nothing", and the second one starts arguments.
   */
  toZero: PolicyPreviewRow[];
  /** Roster-wide average preparation, before and after. */
  avgPreparedBefore: number;
  avgPreparedAfter: number;
}

const avg = (ns: number[]) =>
  ns.length === 0 ? 0 : Math.round(ns.reduce((s, n) => s + n, 0) / ns.length);

/** Signed size of a raider's move, for ordering worst-hit first. */
function magnitude(row: PolicyPreviewRow): number {
  const prep = Math.abs((row.preparedAfter ?? 0) - (row.preparedBefore ?? 0));
  const att = Math.abs((row.attendanceAfter ?? 0) - (row.attendanceBefore ?? 0));
  return prep + att;
}

export function buildPolicyPreview(rows: PolicyPreviewRow[]): PolicyPreview {
  const moved = rows
    .filter(
      (r) =>
        r.preparedBefore !== r.preparedAfter || r.attendanceBefore !== r.attendanceAfter,
    )
    .sort((a, b) => magnitude(b) - magnitude(a) || a.name.localeCompare(b.name));

  return {
    moved,
    measured: rows.length,
    toZero: moved.filter((r) => (r.preparedBefore ?? 0) > 0 && r.preparedAfter === 0),
    avgPreparedBefore: avg(rows.map((r) => r.preparedBefore ?? 0)),
    avgPreparedAfter: avg(rows.map((r) => r.preparedAfter ?? 0)),
  };
}
