/**
 * What a raider did, per pull and per report.
 *
 * Part of `@/lib/types`, which re-exports every one of these — import from
 * there, not from this file, so a type moving between domains costs nothing.
 */

import type { RaidScope } from "@/lib/analysis/raid-scope";
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
  /**
   * Whose night this was. `guild` unless an officer said otherwise, and the
   * only value that counts towards attendance, gold or performance.
   */
  scope: RaidScope;
  /**
   * The raids this night actually ran, from its bosses — the picker's sections.
   * Empty when nothing matched `TBC_RAIDS`. Deliberately not `report.zone`,
   * which is free text an officer typed; see `raidsOfEncounters`.
   */
  raids: string[];
  playerCount: number;
  encounterCount: number;
  killCount: number;
}

/**
 * One logged name's whole record, across every night they appear on.
 *
 * The un-guilded twin of `CharacterPerformance`, and the differences are the
 * point. It is keyed by the name a Warcraft Logs report spells rather than by a
 * roster character, so it answers for people the guild has never tracked; and
 * it reads **every scope**, because a pug's nights are pug nights and filtering
 * to the guild's own would leave the page permanently empty for exactly the
 * raider it exists to show.
 *
 * Nothing here is guild accounting — no attendance, no standing, no gold per
 * raid, no loot score — because there is no roster row to count it against, and
 * building this read must never add one. See change-chains §3a: accounting is
 * scoped, evidence is not.
 */
export interface LogPlayerPerformance {
  /** The name as the newest report spells it. */
  name: string;
  /** From their pulls. Absent only when no pull recorded a class. */
  wowClass?: string;
  /** Dominant role across their pulls — the log answers in three buckets. */
  role: WclRole;
  /** Newest night first, whatever its scope. */
  reports: PerformanceReportView[];
  /** Rollup over every counted pull. Undefined when nothing counted. */
  career?: PerformanceSummary;
  /** Off-pull consumable records, one per report that had any. */
  offPull: WclPlayerOffPull[];
  /** Each night's scope by report code, so the picker can label a pug a pug. */
  scopeByCode: Record<string, RaidScope>;
  /**
   * The roster character this name matches, if any — their slug.
   *
   * Present means the page is looking at somebody the guild already tracks, and
   * it says so and points at their guild record rather than quietly showing a
   * second, differently-scoped version of a raider who has a page already.
   */
  rosterSlug?: string;
}
