import { UPTIME_TRACK_BY_LABEL } from "@/lib/wcl/class-tracks";
import type {
  ConsumableTypeRow,
  ImprovementFinding,
  PlayerImprovements,
  RaidCooldownRow,
  RaidFight,
  RaidPrepStats,
  RaidReportView,
  RaiderUsage,
  RaidUpkeepRow,
  RaidSession,
  UpkeepFightProvider,
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

/**
 * Prep-buff re-application model for the gold estimate. Approximate hours each
 * timed buff lasts — a buff kept up across a raid longer than this (present in
 * an early AND a late pull) was re-applied, so it's counted more than once
 * (e.g. a flask, 2h, on a 3-hour night ≈ 2 flasks). Easy to tune.
 */
export const PREP_HOURS = { flask: 2, elixir: 1, food: 1, weapon: 1, scroll: 1 } as const;

/**
 * How many times a prep buff was bought this raid. Base 1; consumed buffs (not
 * flask, which survives death) add one per death; and a buff maintained across
 * a raid longer than it lasts is scaled by how many of its windows the night
 * spans. The largest of these wins.
 */
export function prepApplications(opts: {
  durationHours: number;
  persistsDeath: boolean;
  spanHours: number;
  deaths: number;
  early: boolean;
  late: boolean;
}): number {
  const { durationHours, persistsDeath, spanHours, deaths, early, late } = opts;
  const deathApps = persistsDeath ? 1 : 1 + deaths;
  const durationApps =
    early && late && spanHours > durationHours ? Math.ceil(spanHours / durationHours) : 1;
  return Math.max(1, deathApps, durationApps);
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
        startMs: r.fightStartMs,
      });
    }
  }
  const fights = [...fightById.values()].sort((a, b) => a.fightId - b.fightId);

  // Raid span + early/late pull halves feed the duration-based prep model:
  // a buff present in both halves of a long night was re-applied.
  const spanMs = Date.parse(report.endTime) - Date.parse(report.startTime);
  const spanHours = Number.isFinite(spanMs) && spanMs > 0 ? spanMs / 3_600_000 : 0;
  const nFights = fights.length;
  const fightHalf = new Map<number, { early: boolean; late: boolean }>();
  fights.forEach((f, i) =>
    fightHalf.set(f.fightId, { early: i < Math.ceil(nFights / 2), late: i >= Math.floor(nFights / 2) }),
  );

  /* Rows grouped per raider (by logged name). */
  const byActor = new Map<string, WclPlayerFight[]>();
  for (const r of rows) {
    const list = byActor.get(r.actorName) ?? [];
    list.push(r);
    byActor.set(r.actorName, list);
  }

  /* ---- Preparation + in-fight totals ---- */
  // Each consumable type tracks who used it (actor → count) for the per-type
  // provider breakdown the overview folds out.
  const potionTypes = new Map<string, Map<string, number>>();
  const inFightTypes = new Map<string, Map<string, number>>();
  let potionsTotal = 0;
  let prepots = 0;
  let sappersTotal = 0;
  const bump = (m: Map<string, Map<string, number>>, name: string, actorName: string) => {
    const providers = m.get(name) ?? new Map<string, number>();
    providers.set(actorName, (providers.get(actorName) ?? 0) + 1);
    m.set(name, providers);
  };
  for (const r of rows) {
    for (const p of r.potions) {
      bump(potionTypes, p, r.actorName);
      potionsTotal++;
    }
    for (const c of r.otherCasts) bump(inFightTypes, c, r.actorName);
    if (r.prepot) prepots++;
    sappersTotal += r.sappers;
  }
  const toTypeRows = (m: Map<string, Map<string, number>>): ConsumableTypeRow[] =>
    [...m]
      .map(([name, providerMap]) => ({
        name,
        uses: [...providerMap.values()].reduce((s, n) => s + n, 0),
        providers: [...providerMap]
          .map(([actorName, count]) => ({ name: actorName, slug: slugOf(actorName), count }))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name));
  const prep: RaidPrepStats = {
    rows: rows.length,
    raiders: byActor.size,
    flaskOrElixirPct: pct(rows.filter(isPrepared).length, rows.length),
    foodPct: pct(rows.filter((r) => r.food).length, rows.length),
    weaponBuffPct: pct(rows.filter((r) => r.weaponBuff).length, rows.length),
    prepotPct: pct(prepots, rows.length),
    potionsTotal,
    prepots,
    potionTypes: toTypeRows(potionTypes),
    inFightTypes: toTypeRows(inFightTypes),
    sappersTotal,
  };

  /* ---- Per-raider usage tallies (rankings tab) ---- */
  const usage: RaiderUsage[] = [...byActor]
    .map(([actorName, playerRows]): RaiderUsage => {
      const itemCounts = new Map<string, number>();
      const cdCounts = new Map<string, number>();
      let potions = 0;
      let sappers = 0;
      let otherCastsTotal = 0;
      let prepotCount = 0;
      let cooldownsTotal = 0;
      let deaths = 0;
      let className: string | undefined;
      let role = playerRows[0]?.role ?? "dps";
      // Prep/passive buffs are per-pull coverage, not casts — collect the
      // distinct ones the player ran plus whether they held each in an early
      // AND a late pull (→ re-applied over a long night), for the model below.
      const flaskNames = new Set<string>();
      const elixirNames = new Set<string>();
      const scrollNames = new Set<string>();
      const extraNames = new Set<string>();
      let anyFood = false;
      let anyWeapon = false;
      const present = {
        flask: { early: false, late: false },
        elixir: { early: false, late: false },
        scroll: { early: false, late: false },
        food: { early: false, late: false },
        weapon: { early: false, late: false },
      };
      for (const r of playerRows) {
        for (const p of r.potions) {
          itemCounts.set(p, (itemCounts.get(p) ?? 0) + 1);
          potions++;
        }
        for (const c of r.otherCasts) itemCounts.set(c, (itemCounts.get(c) ?? 0) + 1);
        for (const cd of r.cooldowns) {
          cdCounts.set(cd, (cdCounts.get(cd) ?? 0) + 1);
          cooldownsTotal++;
        }
        otherCastsTotal += r.otherCasts.length;
        sappers += r.sappers;
        deaths += r.deaths;
        if (r.prepot) prepotCount++;
        const pos = fightHalf.get(r.fightId) ?? { early: false, late: false };
        const mark = (k: keyof typeof present) => {
          present[k].early ||= pos.early;
          present[k].late ||= pos.late;
        };
        if (r.flask) {
          flaskNames.add(r.flask);
          mark("flask");
        }
        if (r.elixirs.length > 0) mark("elixir");
        for (const e of r.elixirs) elixirNames.add(e);
        if (r.scrolls.length > 0) mark("scroll");
        for (const s of r.scrolls) scrollNames.add(s);
        for (const x of r.extras) extraNames.add(x);
        if (r.food) {
          anyFood = true;
          mark("food");
        }
        if (r.weaponBuff) {
          anyWeapon = true;
          mark("weapon");
        }
        className = r.className ?? className;
        role = r.role ?? role;
      }
      const rank = (m: Map<string, number>) =>
        [...m]
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      // Duration + death aware: flask survives death but re-buys over a long
      // night; consumed buffs add one per death; situational extras stay death-aware.
      const apps = (kind: keyof typeof present, persistsDeath: boolean) =>
        prepApplications({ durationHours: PREP_HOURS[kind], persistsDeath, spanHours, deaths, ...present[kind] });
      const prepBreakdown = [
        ...[...flaskNames].map((name) => ({ name, count: apps("flask", true) })),
        ...[...elixirNames].map((name) => ({ name, count: apps("elixir", false) })),
        ...[...scrollNames].map((name) => ({ name, count: apps("scroll", false) })),
        ...[...extraNames].map((name) => ({ name, count: 1 + deaths })),
        ...(anyFood ? [{ name: "Food", count: apps("food", false) }] : []),
        ...(anyWeapon ? [{ name: "Weapon oil/stone", count: apps("weapon", false) }] : []),
      ].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      return {
        name: actorName,
        slug: slugOf(actorName),
        className,
        role,
        potions,
        sappers,
        otherItems: otherCastsTotal - sappers,
        consumablesTotal: potions + otherCastsTotal,
        prepots: prepotCount,
        cooldowns: cooldownsTotal,
        itemBreakdown: rank(itemCounts),
        cooldownBreakdown: rank(cdCounts),
        deaths,
        prepBreakdown,
      };
    })
    .sort((a, b) => b.consumablesTotal - a.consumablesTotal || a.name.localeCompare(b.name));

  /* ---- Maintained debuff/buff uptime ---- */
  // Per track → per provider: average their pct across the pulls they were in.
  // Alongside, keep the raw per-pull numbers for the boss-by-boss breakdown.
  const upkeepByTrack = new Map<string, Map<string, { sum: number; pulls: number; className?: string }>>();
  const upkeepByTrackFight = new Map<string, Map<number, UpkeepFightProvider[]>>();
  for (const r of rows) {
    for (const u of r.upkeep) {
      const providers = upkeepByTrack.get(u.name) ?? new Map();
      const acc = providers.get(r.actorName) ?? { sum: 0, pulls: 0, className: r.className };
      acc.sum += u.pct;
      acc.pulls += 1;
      providers.set(r.actorName, acc);
      upkeepByTrack.set(u.name, providers);

      const fightMap = upkeepByTrackFight.get(u.name) ?? new Map<number, UpkeepFightProvider[]>();
      const fightProviders = fightMap.get(r.fightId) ?? [];
      fightProviders.push({
        name: r.actorName,
        slug: slugOf(r.actorName),
        className: r.className,
        pct: u.pct,
        targets: u.targets,
      });
      fightMap.set(r.fightId, fightProviders);
      upkeepByTrackFight.set(u.name, fightMap);
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
    const perFight = [...(upkeepByTrackFight.get(name) ?? new Map<number, UpkeepFightProvider[]>())]
      .map(([fightId, fightProviders]) => ({
        fightId,
        providers: fightProviders.sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.fightId - b.fightId);
    return {
      name,
      className: dominantClass,
      kind: track?.kind ?? "debuff",
      providers,
      bestPct: providers[0]?.pct ?? 0,
      perFight,
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

  return { report, session, fights, reportPulls, prep, upkeep, cooldowns, improvements, usage };
}
