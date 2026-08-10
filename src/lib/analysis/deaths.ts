/**
 * "Hvorfor sliter vi på denne bossen?" — the same boss, pull after pull, read
 * through when people die rather than how many.
 *
 * A death count says a raid loses people. It cannot tell an opener nobody
 * survives from attrition at 40%, and those are different problems with
 * different fixes: one is a mechanic somebody isn't handling, the other is a
 * healing or damage-time problem. The timestamps separate them.
 *
 * What this deliberately does **not** do is name a cause. It has no idea what
 * ability killed anybody — the app doesn't fetch that, and inventing "died to
 * Flame Wreath" from a clock reading would be exactly the domain knowledge the
 * house rules forbid. It says *when*, *who* and *how consistently*, and the
 * officer who was in the raid supplies the rest.
 *
 * Pure.
 */

import type { WclPlayerFight } from "@/lib/types";

export interface DeathEvent {
  actorName: string;
  className?: string;
  role: WclPlayerFight["role"];
  /** ms from the pull start. */
  atMs: number;
}

export interface BossPullDeaths {
  fightId: number;
  kill: boolean;
  durationMs: number;
  /** How far the boss got, for a wipe. */
  fightPercentage?: number;
  deaths: DeathEvent[];
  /** The first death of the pull, when there was one. */
  firstAtMs?: number;
}

export interface RepeatOffender {
  actorName: string;
  className?: string;
  deaths: number;
  /** Pulls of this boss they were present for. */
  pulls: number;
  /** How often they were the first to die on a pull that had a death. */
  firstDeaths: number;
  /** Median moment of their deaths, ms from the pull start. */
  medianAtMs?: number;
}

export interface BossDeathProfile {
  encounterId: number;
  encounterName: string;
  pulls: BossPullDeaths[];
  wipes: number;
  kills: number;
  deathsTotal: number;
  /**
   * Median first death across pulls that had one. The single most useful number
   * here: 30 seconds in is an opener nobody is handling, four minutes in is
   * attrition.
   */
  medianFirstDeathMs?: number;
  /**
   * Deaths bucketed by tenth of the *pull's own* duration, so pulls of
   * different lengths can be compared at all. Index 0 is the first tenth.
   *
   * Wipes are shorter than kills by definition, which is exactly why a raw
   * clock would cluster every wipe's deaths near the start and read as "we die
   * early" when the truth is "we die and the pull ends".
   */
  byTenth: number[];
  /** Who dies here, worst first. */
  offenders: RepeatOffender[];
  /**
   * True when no pull carries timing. The report predates the timestamp being
   * stored, and a re-import is what fills it in — distinct from "nobody died".
   */
  timingMissing: boolean;
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * One boss's death profile from every pull of it in a report.
 *
 * `rows` is every player-pull for the boss; each carries its own `deathTimes`.
 */
export function buildBossDeathProfile(rows: WclPlayerFight[]): BossDeathProfile | undefined {
  if (rows.length === 0) return undefined;
  const first = rows[0];

  const byFight = new Map<number, WclPlayerFight[]>();
  for (const row of rows) {
    byFight.set(row.fightId, [...(byFight.get(row.fightId) ?? []), row]);
  }

  const byTenth = Array<number>(10).fill(0);
  const pulls: BossPullDeaths[] = [];
  let deathsTotal = 0;
  let anyTiming = false;

  for (const [fightId, fightRows] of [...byFight].sort((a, b) => a[0] - b[0])) {
    const sample = fightRows[0];
    const deaths: DeathEvent[] = [];
    for (const row of fightRows) {
      deathsTotal += row.deaths;
      for (const atMs of row.deathTimes) {
        anyTiming = true;
        deaths.push({
          actorName: row.actorName,
          className: row.className,
          role: row.role,
          atMs,
        });
        const duration = Math.max(1, row.durationMs);
        const tenth = Math.min(9, Math.floor((atMs / duration) * 10));
        byTenth[Math.max(0, tenth)]++;
      }
    }
    deaths.sort((a, b) => a.atMs - b.atMs);
    pulls.push({
      fightId,
      kill: sample.kill,
      durationMs: sample.durationMs,
      fightPercentage: sample.fightPercentage,
      deaths,
      firstAtMs: deaths[0]?.atMs,
    });
  }

  const firstDeathCount = new Map<string, number>();
  for (const pull of pulls) {
    const firstName = pull.deaths[0]?.actorName;
    if (firstName) firstDeathCount.set(firstName, (firstDeathCount.get(firstName) ?? 0) + 1);
  }

  const offenders: RepeatOffender[] = [...new Set(rows.map((r) => r.actorName))]
    .map((actorName) => {
      const mine = rows.filter((r) => r.actorName === actorName);
      return {
        actorName,
        className: mine[0]?.className,
        deaths: mine.reduce((s, r) => s + r.deaths, 0),
        pulls: mine.length,
        firstDeaths: firstDeathCount.get(actorName) ?? 0,
        medianAtMs: median(mine.flatMap((r) => r.deathTimes)),
      };
    })
    .filter((o) => o.deaths > 0)
    .sort(
      (a, b) =>
        b.deaths - a.deaths || b.firstDeaths - a.firstDeaths || a.actorName.localeCompare(b.actorName),
    );

  return {
    encounterId: first.encounterId,
    encounterName: first.encounterName,
    pulls,
    wipes: pulls.filter((p) => !p.kill).length,
    kills: pulls.filter((p) => p.kill).length,
    deathsTotal,
    medianFirstDeathMs: median(
      pulls.map((p) => p.firstAtMs).filter((v): v is number => v !== undefined),
    ),
    byTenth,
    offenders,
    // Somebody died but no pull carries a timestamp: the report predates the
    // timing being stored. Saying "no deaths" there would be a lie.
    timingMissing: deathsTotal > 0 && !anyTiming,
  };
}

/** Every boss in a report, hardest first — most wipes, then most deaths. */
export function buildDeathProfiles(rows: WclPlayerFight[]): BossDeathProfile[] {
  const byEncounter = new Map<number, WclPlayerFight[]>();
  for (const row of rows) {
    byEncounter.set(row.encounterId, [...(byEncounter.get(row.encounterId) ?? []), row]);
  }
  return [...byEncounter.values()]
    .map((group) => buildBossDeathProfile(group))
    .filter((p): p is BossDeathProfile => p !== undefined)
    .sort(
      (a, b) =>
        b.wipes - a.wipes ||
        b.deathsTotal - a.deathsTotal ||
        a.encounterName.localeCompare(b.encounterName),
    );
}
