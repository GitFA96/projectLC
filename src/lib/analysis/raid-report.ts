import { UPTIME_TRACK_BY_LABEL } from "@/lib/wcl/class-tracks";
import type {
  ImprovementFinding,
  PlayerImprovements,
  RaidCooldownRow,
  RaidFight,
  RaidPrepStats,
  RaidReportView,
  RaidUpkeepRow,
  RaidSession,
  WclPlayerFight,
  WclReport,
} from "@/lib/types";

/**
 * Raid-wide rollup of one report (one raid night): preparation coverage,
 * maintained debuff/buff uptime, cooldown usage, and per-raider preparation
 * gaps. Pure — the store resolves roster slugs and hands them in so matched
 * players can deep-link to their performance page.
 */

const SEVERITY_WEIGHT = { high: 100, medium: 40, low: 12 } as const;

/** "Hydross, Lurker +2 more" — keeps boss lists short. */
function bossList(names: string[], cap = 3): string {
  if (names.length <= cap) return names.join(", ");
  return `${names.slice(0, cap).join(", ")} +${names.length - cap} more`;
}

function pct(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 100);
}

function isPrepared(row: WclPlayerFight): boolean {
  // A flask or any elixir counts — a single battle elixir is still coverage.
  return row.flask !== undefined || row.elixirs.length >= 1;
}

export interface RaidReportInput {
  report: WclReport;
  session?: RaidSession;
  rows: WclPlayerFight[];
  reportPulls: number;
  /** Lowercased actor name → roster slug, for deep-linking matched raiders. */
  slugByActor: Map<string, string>;
}

export function summarizeRaidReport(input: RaidReportInput): RaidReportView {
  const { report, session, rows, reportPulls, slugByActor } = input;
  const slugOf = (actorName: string) => slugByActor.get(actorName.toLowerCase());

  /* Distinct boss pulls, in pull order. */
  const fightById = new Map<number, RaidFight>();
  for (const r of rows) {
    if (!fightById.has(r.fightId)) {
      fightById.set(r.fightId, {
        fightId: r.fightId,
        encounterName: r.encounterName,
        kill: r.kill,
        fightPercentage: r.fightPercentage,
        durationMs: r.durationMs,
      });
    }
  }
  const fights = [...fightById.values()].sort((a, b) => a.fightId - b.fightId);

  /* Rows grouped per raider (by logged name). */
  const byActor = new Map<string, WclPlayerFight[]>();
  for (const r of rows) {
    const list = byActor.get(r.actorName) ?? [];
    list.push(r);
    byActor.set(r.actorName, list);
  }

  /* ---- Preparation + in-fight totals ---- */
  const potionTypes = new Map<string, number>();
  const inFightTypes = new Map<string, number>();
  let potionsTotal = 0;
  let prepots = 0;
  for (const r of rows) {
    for (const p of r.potions) {
      potionTypes.set(p, (potionTypes.get(p) ?? 0) + 1);
      potionsTotal++;
    }
    for (const c of r.otherCasts) inFightTypes.set(c, (inFightTypes.get(c) ?? 0) + 1);
    if (r.prepot) prepots++;
  }
  const prep: RaidPrepStats = {
    rows: rows.length,
    raiders: byActor.size,
    flaskOrElixirPct: pct(rows.filter(isPrepared).length, rows.length),
    foodPct: pct(rows.filter((r) => r.food).length, rows.length),
    weaponBuffPct: pct(rows.filter((r) => r.weaponBuff).length, rows.length),
    prepotPct: pct(prepots, rows.length),
    potionsTotal,
    prepots,
    potionTypes: [...potionTypes].map(([name, uses]) => ({ name, uses })).sort((a, b) => b.uses - a.uses),
    inFightTypes: [...inFightTypes].map(([name, uses]) => ({ name, uses })).sort((a, b) => b.uses - a.uses),
  };

  /* ---- Maintained debuff/buff uptime ---- */
  // Per track → per provider: average their pct across the pulls they were in.
  const upkeepByTrack = new Map<string, Map<string, { sum: number; pulls: number; className?: string }>>();
  for (const r of rows) {
    for (const u of r.upkeep) {
      const providers = upkeepByTrack.get(u.name) ?? new Map();
      const acc = providers.get(r.actorName) ?? { sum: 0, pulls: 0, className: r.className };
      acc.sum += u.pct;
      acc.pulls += 1;
      providers.set(r.actorName, acc);
      upkeepByTrack.set(u.name, providers);
    }
  }
  const upkeep: RaidUpkeepRow[] = [...upkeepByTrack].map(([name, providerMap]) => {
    const providers = [...providerMap]
      .map(([actorName, acc]) => ({
        name: actorName,
        slug: slugOf(actorName),
        pct: Math.round(acc.sum / Math.max(1, acc.pulls)),
      }))
      .sort((a, b) => b.pct - a.pct);
    const track = UPTIME_TRACK_BY_LABEL.get(name.toLowerCase());
    const dominantClass = [...providerMap.values()][0]?.className;
    return {
      name,
      className: dominantClass,
      kind: track?.kind ?? "debuff",
      providers,
      bestPct: providers[0]?.pct ?? 0,
    };
  });
  // Debuffs (on the boss) first, then by best uptime descending.
  const kindOrder = { debuff: 0, selfbuff: 1, buff: 1 } as const;
  upkeep.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || b.bestPct - a.bestPct || a.name.localeCompare(b.name));

  /* ---- Cooldown usage ---- */
  const cooldownByName = new Map<string, Map<string, number>>();
  for (const r of rows) {
    for (const cd of r.cooldowns) {
      const providers = cooldownByName.get(cd) ?? new Map<string, number>();
      providers.set(r.actorName, (providers.get(r.actorName) ?? 0) + 1);
      cooldownByName.set(cd, providers);
    }
  }
  const cooldowns: RaidCooldownRow[] = [...cooldownByName]
    .map(([name, providerMap]) => ({
      name,
      uses: [...providerMap.values()].reduce((s, n) => s + n, 0),
      providers: [...providerMap]
        .map(([actorName, count]) => ({ name: actorName, slug: slugOf(actorName), count }))
        .sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name));

  /* ---- Per-raider preparation gaps ---- */
  const improvements: PlayerImprovements[] = [];
  for (const [actorName, playerRows] of byActor) {
    const ordered = [...playerRows].sort((a, b) => a.fightId - b.fightId);
    const findings: ImprovementFinding[] = [];

    // Enchants come from the latest pull's gear snapshot.
    const latest = ordered[ordered.length - 1];
    const missing = latest?.missingEnchants ?? [];
    if (missing.includes("Main hand")) {
      findings.push({ severity: "high", label: "No weapon enchant", detail: "main-hand has no permanent enchant" });
    }
    const otherEnchants = missing.filter((m) => m !== "Main hand");
    if (otherEnchants.length > 0) {
      findings.push({ severity: "medium", label: "Missing enchants", detail: otherEnchants.join(", ") });
    }

    // Flask/elixir + food are at-pull facts (fair on wipes too).
    const noPrep = ordered.filter((r) => !isPrepared(r));
    if (noPrep.length > 0) {
      findings.push({
        severity: noPrep.length === ordered.length ? "high" : "medium",
        label: noPrep.length === ordered.length ? "No flask/elixir all night" : "No flask/elixir",
        detail: noPrep.length === ordered.length ? undefined : `on ${bossList(noPrep.map((r) => r.encounterName))}`,
      });
    }
    const noFood = ordered.filter((r) => !r.food);
    if (noFood.length > 0) {
      findings.push({
        severity: "low",
        label: noFood.length === ordered.length ? "No food buff" : "No food",
        detail: noFood.length === ordered.length ? undefined : `on ${bossList(noFood.map((r) => r.encounterName))}`,
      });
    }
    // No potion on a KILL (wipes can end before a repot — don't punish those).
    const killsNoPot = ordered.filter((r) => r.kill && r.potions.length === 0 && !r.prepot);
    if (killsNoPot.length > 0) {
      findings.push({
        severity: "low",
        label: "No potion on a kill",
        detail: `on ${bossList(killsNoPot.map((r) => r.encounterName))}`,
      });
    }

    if (findings.length === 0) continue;
    const score = findings.reduce((s, f) => s + SEVERITY_WEIGHT[f.severity], 0);
    improvements.push({
      name: actorName,
      slug: slugOf(actorName),
      className: latest?.className,
      role: latest?.role ?? "dps",
      score,
      findings: findings.sort((a, b) => SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity]),
    });
  }
  improvements.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  return { report, session, fights, reportPulls, prep, upkeep, cooldowns, improvements };
}
