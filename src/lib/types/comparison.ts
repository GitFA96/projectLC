/**
 * Two or more raiders set against each other.
 *
 * Part of `@/lib/types`, which re-exports every one of these — import from
 * there, not from this file, so a type moving between domains costs nothing.
 */

import type { AttendanceSummary } from "./roster";
import type { Character, CharacterComment } from "./entities";

/* Character-vs-character comparison (up to 4, the contribution side-by-side) */

/** One maintained debuff/buff a compared character kept up, averaged over the selected logs. */
export interface ComparedUpkeep {
  name: string;
  kind: "debuff" | "buff" | "selfbuff";
  pct: number;
  /** Uptime on boss targets only (undefined on pre-timeline imports). */
  bossPct?: number;
  /** ≈ landed casts per pull the track was up (Sunder effort vs. uptime). */
  appliesPerFight?: number;
}

/** A report a compared character appears in — the options for the per-column log picker. */
export interface ComparedReportRef {
  code: string;
  title: string;
  zone?: string;
  startTime: string;
}

/** One character's column in the comparison: the contribution metrics side-by-side. */
export interface ComparedCharacter {
  character: Character;
  /** Spec as actually played in logs (falls back to roster spec for display). */
  loggedSpec?: string;
  /** Resolved main name when this is a linked alt. */
  mainCharacterName?: string;
  /** True once at least one logged pull (within the selected logs) exists. */
  hasLogs: boolean;
  reports: number;
  fights: number;
  /** Every report this character appears in (newest first) — the log-picker options. */
  availableReports: ComparedReportRef[];
  /** The report codes currently feeding the log-derived metrics (a subset, or all). */
  selectedReportCodes: string[];
  /* Damage / output — median dps (hps for healers) across logged pulls. */
  output?: number;
  outputUnit: "dps" | "hps";
  /* Performance */
  medianParse?: number;
  bestParse?: number;
  medianBracket?: number;
  deaths: number;
  deathsPerFight: number;
  /* Attendance */
  attendance?: AttendanceSummary;
  /* Consumables (coverage across logged pulls) */
  preparedPct: number;
  flaskOrElixirsPct: number;
  /** Split out, because a flask and one cheap elixir are not the same night. */
  flaskPct: number;
  elixirsPct: number;
  foodPct: number;
  weaponBuffPct: number;
  potionsPerFight: number;
  prepots: number;
  /* Cooldown discipline — major class CDs pressed across the selected logs. */
  cooldownsTotal: number;
  cooldownsPerFight: number;
  /** Most-used first, e.g. Death Wish ×14. */
  cooldownBreakdown: { name: string; count: number }[];
  /* In-fight utility items (totals across the selected logs). */
  sappers: number;
  healthstones: number;
  runes: number;
  drums: number;
  /** ≈ gold per raid on consumables (default prices), prep + in-fight. */
  goldPerRaid?: number;
  /* Uptime of the buffs/debuffs their spec is responsible for, career-averaged. */
  upkeep: ComparedUpkeep[];
  /* Comments — the detailed officer log. */
  comments: CharacterComment[];
}

export interface CharacterComparisonView {
  characters: ComparedCharacter[];
  /** Every upkeep track present on any compared character, debuffs first — the row set. */
  upkeepTracks: { name: string; kind: "debuff" | "buff" | "selfbuff" }[];
}
