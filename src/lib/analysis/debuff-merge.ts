import type { WclUpkeepTarget } from "@/lib/types";

import { compareText } from "@/lib/sort";

/**
 * "Was Sunder actually up on the boss?" — the raid-level question the stored
 * rows cannot answer on their own.
 *
 * Uptime is accumulated per **source**: each warrior's own intervals on each
 * target. That is the right shape for "did this raider do their job", and the
 * wrong shape for a debuff several people share. On a Karathress pull the sheet
 * read Scomb 33% on one add, Katzewarr 14% on another and 4% on the boss — three
 * true fragments, and no number anywhere for the thing the council actually asks
 * about. 92 of 175 pulls in this guild's logs have two or more warriors
 * sundering, so the fragmentation is the normal case, not an edge one.
 *
 * This merges them back: the union of every source's intervals on one target.
 * **Union, never sum** — two warriors holding Sunder through the same thirty
 * seconds kept it up for thirty seconds, and adding them would report sixty.
 *
 * Pure, and computed from `segments` that are already stored, so it answers for
 * raid nights imported months ago without a refetch.
 */

/** One up-interval, [startMs, endMs] from the pull start. */
export type Interval = [number, number];

export interface MergedDebuff {
  /** Target name as logged. */
  target: string;
  instance?: number;
  boss: boolean;
  /** Union of every source's intervals, in order and non-overlapping. */
  intervals: Interval[];
  /** Percent of the pull the target had it from anybody. */
  pct: number;
  /** Sources that contributed, most uptime first. */
  contributors: { source: string; pct: number; applications?: number }[];
  /** Landed casts across every source, when the rows recorded them. */
  applications?: number;
  /** Casts that raised the stack / only renewed it, across every source. */
  stackUps?: number;
  refreshes?: number;
  /** Highest stack any source pushed it to, when the rows recorded stacks. */
  maxStack?: number;
  /**
   * Milliseconds the target sat at `maxStack`, and that as a percent of the
   * pull. Absent on rows imported before the stack was kept — which is not the
   * same as "it never stacked", so callers must say "not recorded" rather than
   * "0%".
   */
  msAtMaxStack?: number;
  pctAtMaxStack?: number;
}

/** Merge overlapping/adjacent intervals into a minimal ordered set. */
export function unionIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals]
    .filter(([from, to]) => to > from)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: Interval[] = [];
  for (const [from, to] of sorted) {
    const last = out[out.length - 1];
    // Touching counts as continuous: a refresh landing exactly as the previous
    // window closes never let the debuff drop.
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}

/** Total covered time across a set of intervals. */
export function coveredMs(intervals: Interval[]): number {
  return unionIntervals(intervals).reduce((sum, [from, to]) => sum + (to - from), 0);
}

/** One stretch of the pull the target carried a given stack. */
export interface StackSpan {
  from: number;
  to: number;
  /** Stacks it held from the first ms of this span to the last. */
  stack: number;
}

/**
 * The stack a target actually carried, moment by moment, from every source's
 * stack points — **clipped to the windows the debuff was up**.
 *
 * The clipping is the whole point. A stack point says "somebody pushed it to N
 * at time T" and nothing more; the log announces the drop with a `removedebuff`,
 * which is a segment boundary, not a stack point. Reading the points alone
 * therefore carries the last value to the end of the pull — which is how a real
 * Hydross pull reported Sunder up 10% of the fight and *at five stacks for 90%
 * of it* at the same time. Probed: Scomb applied at 0:03, refreshed last at
 * 0:11, and the log removed the debuff at 0:12 of a 1:35 pull. Five stacks for
 * 2.7 seconds, not 86.
 *
 * Inside a window the stack opens at 1 — the application that opened it, since
 * the log only numbers stacks from 2 up — then holds each point's value until
 * something changes it or the window closes. A point repeating the current
 * value is not a change: a second warrior re-applying the same max must not end
 * the span between them.
 */
export function stackSpans(points: [number, number][], intervals: Interval[]): StackSpan[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: StackSpan[] = [];
  for (const [from, to] of unionIntervals(intervals)) {
    let at = from;
    let stack = 1;
    for (const [pointAt, pointStack] of sorted) {
      if (pointAt < from || pointAt >= to || pointStack === stack) continue;
      if (pointAt > at) out.push({ from: at, to: pointAt, stack });
      at = pointAt;
      stack = pointStack;
    }
    if (to > at) out.push({ from: at, to, stack });
  }
  return out;
}

/**
 * The peak stack the target held, and how long it held it — read off the spans,
 * so time the debuff was not up cannot count towards it.
 */
export function msAtStack(
  points: [number, number][],
  intervals: Interval[],
): { maxStack: number; msAtMax: number } | undefined {
  // No points is "this report never recorded stacks", which is not the same
  // claim as "it never stacked" — callers must keep saying nothing.
  if (points.length === 0) return undefined;
  const spans = stackSpans(points, intervals);
  if (spans.length === 0) return undefined;
  const maxStack = spans.reduce((m, s) => Math.max(m, s.stack), 0);
  const msAtMax = spans
    .filter((s) => s.stack === maxStack)
    .reduce((sum, s) => sum + (s.to - s.from), 0);
  return { maxStack, msAtMax };
}

/**
 * Every provider's contribution to one track on one pull, merged per target.
 *
 * Takes providers rather than stored rows because that is the shape both callers
 * hold: `raid-report` builds them per fight, and the timeline component renders
 * them. One pull at a time — merging across pulls would union intervals that
 * belong to different fights.
 */
export function mergeTargets(
  providers: { name: string; targets?: WclUpkeepTarget[] }[],
  durationMs: number,
): MergedDebuff[] {
  const pullMs = Math.max(1, durationMs);
  const pctOf = (ms: number) => Math.round(Math.min(100, (ms / pullMs) * 100));

  interface Group {
    target: string;
    instance?: number;
    boss: boolean;
    intervals: Interval[];
    contributors: { source: string; pct: number; applications?: number }[];
    applications: number;
    stackUps: number;
    refreshes: number;
    stackPoints: [number, number][];
    sawCounts: boolean;
    sawStacks: boolean;
  }
  const groups = new Map<string, Group>();

  for (const provider of providers) {
    for (const target of provider.targets ?? []) {
      // Friendly-target buffs are per recipient and never shared, so merging
      // them would claim a raid-wide fact about one player's Earth Shield.
      if (target.player) continue;
      const key = `${target.target.toLowerCase()}|${target.instance ?? 0}`;
      const group =
        groups.get(key) ??
        ({
          target: target.target,
          instance: target.instance,
          boss: target.boss,
          intervals: [],
          contributors: [],
          applications: 0,
          stackUps: 0,
          refreshes: 0,
          stackPoints: [],
          sawCounts: false,
          sawStacks: false,
        } satisfies Group);

      group.intervals.push(...(target.segments as Interval[]));
      group.contributors.push({
        source: provider.name,
        pct: target.pct,
        applications: target.applications,
      });
      addCounts(group, target);
      groups.set(key, group);
    }
  }

  return [...groups.values()]
    .map((group): MergedDebuff => {
      const intervals = unionIntervals(group.intervals);
      const ms = intervals.reduce((sum, [from, to]) => sum + (to - from), 0);
      const stacks = group.sawStacks ? msAtStack(group.stackPoints, intervals) : undefined;
      return {
        target: group.target,
        instance: group.instance,
        boss: group.boss,
        intervals,
        pct: pctOf(ms),
        contributors: group.contributors.sort((a, b) => b.pct - a.pct || compareText(a.source, b.source)),
        ...(group.sawCounts
          ? { applications: group.applications }
          : {}),
        ...(group.sawStacks
          ? { stackUps: group.stackUps, refreshes: group.refreshes }
          : {}),
        ...(stacks
          ? {
              maxStack: stacks.maxStack,
              msAtMaxStack: stacks.msAtMax,
              pctAtMaxStack: pctOf(stacks.msAtMax),
            }
          : {}),
      };
    })
    // Boss first, then by how much of the pull it was up — the same order the
    // per-player breakdown uses, so the two read the same way.
    .sort(
      (a, b) =>
        Number(b.boss) - Number(a.boss) ||
        b.pct - a.pct ||
        compareText(a.target, b.target) ||
        (a.instance ?? 0) - (b.instance ?? 0),
    );
}

/** Fold one stored target's counts into its group, tracking what was recorded. */
function addCounts(
  group: {
    applications: number;
    stackUps: number;
    refreshes: number;
    stackPoints: [number, number][];
    sawCounts: boolean;
    sawStacks: boolean;
  },
  target: WclUpkeepTarget,
): void {
  if (target.applications !== undefined) {
    group.applications += target.applications;
    group.sawCounts = true;
  }
  if (target.stackPoints !== undefined && target.stackPoints.length > 0) {
    group.stackPoints.push(...(target.stackPoints as [number, number][]));
    group.stackUps += target.stackUps ?? 0;
    group.refreshes += target.refreshes ?? 0;
    group.sawStacks = true;
  }
}
