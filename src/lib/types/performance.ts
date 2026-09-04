/**
 * What a raider did, per pull and per report.
 *
 * Part of `@/lib/types`, which re-exports every one of these — import from
 * there, not from this file, so a type moving between domains costs nothing.
 */

import type { AttendanceSummary } from "./roster";
import type { Character, RaidSession, WclPlayerFight, WclPlayerOffPull, WclReport, WclRole } from "./entities";

/* Warcraft Logs performance views (derived) */

/** Rollup over a set of player-fight rows (one report, or a whole career). */
export interface PerformanceSummary {
  fights: number;
  kills: number;
  wipes: number;
  deaths: number;
  medianParse?: number;
  bestParse?: number;
  medianBracket?: number;
  /** Dominant role/spec across the rows. */
  role: WclRole;
  spec?: string;
  /** % of pulls covered: flask or at least one elixir / food / temp weapon buff. */
  flaskOrElixirsPct: number;
  /** The flask half of `flaskOrElixirsPct` — a night-long buff that survives death. */
  flaskPct: number;
  /** The elixir half — cheaper, shorter, and gone the moment they die. */
  elixirsPct: number;
  foodPct: number;
  weaponBuffPct: number;
  /** Both flask-or-elixirs AND food up — the headline preparation number. */
  preparedPct: number;
  potionsTotal: number;
  potionsPerFight: number;
  prepots: number;
  drums: number;
  runes: number;
  healthstones: number;
  sappers: number;
  /** From the most recent pull in the rows. */
  missingEnchants: string[];
}

export interface PerformanceReportView {
  report: WclReport;
  session?: RaidSession;
  /**
   * Every pull they were on, excused ones included.
   *
   * The table shows them all — an officer who excused the farm boss still wants
   * to see how it went — so the exclusion lives in `excusedFightIds` rather than
   * in what's missing from this array. `summary` is over the counted ones only.
   */
  rows: WclPlayerFight[];
  /** Pulls the officer took out of the count on the raid page. */
  excusedFightIds: number[];
  summary: PerformanceSummary;
  /** What they used away from the boss pulls that night. Absent = nothing logged. */
  offPull?: WclPlayerOffPull;
  /** Total boss pulls in the report (all players) — rows.length of them attended. */
  reportPulls: number;
}

export interface CharacterPerformance {
  character: Character;
  /** Newest report first. */
  reports: PerformanceReportView[];
  /** Rollup across every report the character appears in (undefined when none). */
  career?: PerformanceSummary;
  /** Off-pull consumable records, one per report that had any. */
  offPull: WclPlayerOffPull[];
  /** Undefined until at least one report is imported. */
  attendance?: AttendanceSummary;
}

export interface WclReportView {
  report: WclReport;
  session?: RaidSession;
  playerCount: number;
  encounterCount: number;
  killCount: number;
}
