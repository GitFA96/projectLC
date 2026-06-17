import { UPTIME_TRACK_BY_LABEL } from "@/lib/wcl/class-tracks";
import type {
  AttendanceSummary,
  Character,
  CharacterComment,
  CharacterComparisonView,
  ComparedCharacter,
  ComparedReportRef,
  ComparedUpkeep,
  WclPlayerFight,
  WclRole,
} from "@/lib/types";

/**
 * Character-vs-character comparison (up to 4): the "important aspects of
 * contribution to the raid" — damage/output, performance, attendance,
 * consumables, maintained buff/debuff uptime — side-by-side, plus the officer
 * comment log. Pure: the store gathers each character's career rows, attendance
 * and comments and hands them in.
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

function dominantRole(rows: WclPlayerFight[]): WclRole {
  const counts = new Map<WclRole, number>();
  for (const r of rows) counts.set(r.role, (counts.get(r.role) ?? 0) + 1);
  let best: WclRole = "dps";
  let bestCount = 0;
  for (const [role, count] of counts) {
    if (count > bestCount) {
      best = role;
      bestCount = count;
    }
  }
  return best;
}

/** Pull-length-weighted average uptime per maintained track across the rows. */
function upkeepAverages(rows: WclPlayerFight[]): ComparedUpkeep[] {
  const names = [...new Set(rows.flatMap((r) => r.upkeep.map((u) => u.name)))];
  const totalDur = rows.reduce((s, r) => s + r.durationMs, 0);
  return names
    .map((name): ComparedUpkeep => {
      const weighted = rows.reduce(
        (s, r) => s + (r.upkeep.find((u) => u.name === name)?.pct ?? 0) * r.durationMs,
        0,
      );
      return {
        name,
        kind: UPTIME_TRACK_BY_LABEL.get(name.toLowerCase())?.kind ?? "debuff",
        pct: Math.round(weighted / Math.max(1, totalDur)),
      };
    })
    .sort((a, b) => b.pct - a.pct);
}

export interface ComparisonInput {
  character: Character;
  /**
   * Rows feeding the log-derived metrics, chronological (oldest first) — the
   * store pre-filters these to the selected logs. May be a subset of the
   * character's career.
   */
  rows: WclPlayerFight[];
  /** Every report the character appears in (newest first) — the picker options. */
  availableReports: ComparedReportRef[];
  attendance?: AttendanceSummary;
  comments: CharacterComment[];
  loggedSpec?: string;
  mainCharacterName?: string;
}

const KIND_ORDER = { debuff: 0, selfbuff: 1, buff: 1 } as const;

export function summarizeComparison(inputs: ComparisonInput[]): CharacterComparisonView {
  const characters: ComparedCharacter[] = inputs.map((input) => {
    const { character, rows, attendance, comments } = input;
    const role = dominantRole(rows);
    const parses = rows.map((r) => r.parsePercent).filter((p): p is number => p !== undefined);
    const brackets = rows.map((r) => r.bracketPercent).filter((p): p is number => p !== undefined);
    const amounts = rows.map((r) => r.amount).filter((a): a is number => a !== undefined);
    const flaskOrElixirs = rows.filter((r) => r.flask !== undefined || r.elixirs.length >= 1).length;
    const prepared = rows.filter(
      (r) => (r.flask !== undefined || r.elixirs.length >= 1) && r.food,
    ).length;
    const deaths = rows.reduce((s, r) => s + r.deaths, 0);
    const potionsTotal = rows.reduce((s, r) => s + r.potions.length, 0);

    return {
      character,
      loggedSpec: input.loggedSpec,
      mainCharacterName: input.mainCharacterName,
      hasLogs: rows.length > 0,
      reports: new Set(rows.map((r) => r.reportCode)).size,
      fights: rows.length,
      availableReports: input.availableReports,
      selectedReportCodes: [...new Set(rows.map((r) => r.reportCode))],
      output: median(amounts),
      outputUnit: role === "healer" ? "hps" : "dps",
      medianParse: median(parses),
      bestParse: parses.length > 0 ? Math.round(Math.max(...parses)) : undefined,
      medianBracket: median(brackets),
      deaths,
      deathsPerFight: rows.length === 0 ? 0 : Math.round((deaths / rows.length) * 100) / 100,
      attendance,
      preparedPct: pct(prepared, rows.length),
      flaskOrElixirsPct: pct(flaskOrElixirs, rows.length),
      foodPct: pct(rows.filter((r) => r.food).length, rows.length),
      weaponBuffPct: pct(rows.filter((r) => r.weaponBuff).length, rows.length),
      potionsPerFight: rows.length === 0 ? 0 : Math.round((potionsTotal / rows.length) * 10) / 10,
      prepots: rows.filter((r) => r.prepot).length,
      upkeep: upkeepAverages(rows),
      comments,
    } satisfies ComparedCharacter;
  });

  // Union of every track on any compared character — the upkeep row set.
  const trackKinds = new Map<string, "debuff" | "buff" | "selfbuff">();
  for (const c of characters) {
    for (const u of c.upkeep) if (!trackKinds.has(u.name)) trackKinds.set(u.name, u.kind);
  }
  const upkeepTracks = [...trackKinds]
    .map(([name, kind]) => ({ name, kind }))
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name));

  return { characters, upkeepTracks };
}
