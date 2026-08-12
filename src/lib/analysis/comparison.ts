import { UPTIME_TRACK_BY_LABEL } from "@/lib/wcl/class-tracks";
import { PREP_HOURS, prepApplications } from "@/lib/analysis/raid-report";
import { costPerUseMap } from "@/lib/wcl/consumable-prices";
import { adjustmentsFor, applyAdjustments } from "@/lib/analysis/consumable-adjustments";
import { potionsUsed } from "@/lib/analysis/potions";
import { hasConsumableCoverage, hasFood, isPrepared } from "@/lib/analysis/preparation";
import { DEFAULT_POLICY, type GuildPolicy } from "@/lib/analysis/policy";
import type {
  AttendanceSummary,
  Character,
  CharacterComment,
  CharacterComparisonView,
  ComparedCharacter,
  ConsumableAdjustment,
  ComparedReportRef,
  ComparedUpkeep,
  WclPlayerFight,
  WclPlayerOffPull,
  WclRole,
} from "@/lib/types";

import { compareText } from "@/lib/sort";

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
      let weighted = 0;
      // Boss-only + effort stats come from the per-target timeline breakdown
      // (absent on pre-timeline imports — those pulls just don't contribute).
      let bossWeighted = 0;
      let bossDur = 0;
      let applications = 0;
      let pullsWithEntry = 0;
      for (const r of rows) {
        const entry = r.upkeep.find((u) => u.name === name);
        if (!entry) continue;
        pullsWithEntry++;
        weighted += entry.pct * r.durationMs;
        if (entry.targets) {
          const bossPct = Math.max(0, ...entry.targets.filter((t) => t.boss).map((t) => t.pct));
          bossWeighted += bossPct * r.durationMs;
          bossDur += r.durationMs;
          applications += entry.targets.reduce((s, t) => s + (t.applications ?? 0), 0);
        }
      }
      return {
        name,
        kind: UPTIME_TRACK_BY_LABEL.get(name.toLowerCase())?.kind ?? "debuff",
        pct: Math.round(weighted / Math.max(1, totalDur)),
        bossPct: bossDur > 0 ? Math.round(bossWeighted / bossDur) : undefined,
        appliesPerFight:
          bossDur > 0 && pullsWithEntry > 0
            ? Math.round((applications / pullsWithEntry) * 10) / 10
            : undefined,
      };
    })
    .sort((a, b) => b.pct - a.pct);
}

/**
 * ≈ gold per raid on consumables at DEFAULT prices — comparable across
 * columns even when individual raids have logged price overrides. Reuses the
 * logs-page prep model per report: consumed buffs re-buy on death, timed buffs
 * re-buy across a night longer than they last. Raid span and early/late pulls
 * are approximated from the character's own pulls (compare inputs don't carry
 * the whole raid).
 *
 * Exported because the loot-priority drawer asks the same question of a
 * contender ("what does this raider actually spend on a night?") and there
 * should only ever be one answer to it.
 */
export function goldPerRaid(
  rows: WclPlayerFight[],
  /** Consumables used away from the boss pulls — same gold, no fight row. */
  offPull: WclPlayerOffPull[] = [],
  /** Officer corrections per report code, applied on top of the logged counts. */
  adjustmentsByCode: Record<string, ConsumableAdjustment[]> = {},
): number | undefined {
  if (rows.length === 0) return undefined;
  const byReport = new Map<string, WclPlayerFight[]>();
  for (const r of rows) {
    const list = byReport.get(r.reportCode) ?? [];
    list.push(r);
    byReport.set(r.reportCode, list);
  }
  const offPullByReport = new Map(offPull.map((o) => [o.reportCode, o] as const));

  let total = 0;
  for (const reportRows of byReport.values()) {
    const ordered = [...reportRows].sort((a, b) => a.fightId - b.fightId);
    const starts = ordered.map((r) => r.fightStartMs).filter((s): s is number => s !== undefined);
    const spanMs =
      starts.length > 0
        ? Math.max(...ordered.map((r) => (r.fightStartMs ?? 0) + r.durationMs)) - Math.min(...starts)
        : 0;
    const spanHours = spanMs > 0 ? spanMs / 3_600_000 : 0;
    const deaths = ordered.reduce((s, r) => s + r.deaths, 0);

    const half = Math.ceil(ordered.length / 2);
    const present = { flask: { early: false, late: false }, elixir: { early: false, late: false }, scroll: { early: false, late: false }, food: { early: false, late: false }, weapon: { early: false, late: false } };
    const flaskNames = new Set<string>();
    const elixirNames = new Set<string>();
    const scrollNames = new Set<string>();
    const extraNames = new Set<string>();
    const itemCounts = new Map<string, number>();
    let anyFood = false;
    let anyWeapon = false;
    ordered.forEach((r, i) => {
      const early = i < half;
      const late = i >= ordered.length - half;
      const mark = (k: keyof typeof present) => {
        present[k].early ||= early;
        present[k].late ||= late;
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
      if (hasFood(r)) {
        anyFood = true;
        mark("food");
      }
      if (r.weaponBuff) {
        anyWeapon = true;
        mark("weapon");
      }
      for (const p of r.potions) itemCounts.set(p, (itemCounts.get(p) ?? 0) + 1);
      for (const c of r.otherCasts) itemCounts.set(c, (itemCounts.get(c) ?? 0) + 1);
    });
    // A potion drunk on trash is bought and paid for exactly like one drunk on
    // the boss; pet food is the hunter's own gold too.
    const off = offPullByReport.get(ordered[0].reportCode);
    for (const name of [...(off?.potions ?? []), ...(off?.otherCasts ?? []), ...(off?.petConsumables ?? [])]) {
      itemCounts.set(name, (itemCounts.get(name) ?? 0) + 1);
    }
    const apps = (kind: keyof typeof PREP_HOURS, persistsDeath: boolean) =>
      prepApplications({ durationHours: PREP_HOURS[kind], persistsDeath, spanHours, deaths, ...present[kind] });
    const logged = [
      ...[...itemCounts].map(([name, count]) => ({ name, count })),
      ...[...flaskNames].map((name) => ({ name, count: apps("flask", true) })),
      ...[...elixirNames].map((name) => ({ name, count: apps("elixir", false) })),
      ...[...scrollNames].map((name) => ({ name, count: apps("scroll", false) })),
      ...[...extraNames].map((name) => ({ name, count: 1 + deaths })),
      ...(anyFood ? [{ name: "Food", count: apps("food", false) }] : []),
      ...(anyWeapon ? [{ name: "Weapon oil/stone", count: apps("weapon", false) }] : []),
    ];
    // The officer's corrections for this night, so career gold agrees with what
    // the raid page shows rather than quietly disagreeing with it.
    const lines = applyAdjustments(
      logged,
      adjustmentsFor(adjustmentsByCode[ordered[0].reportCode] ?? [], ordered[0].actorName),
    );
    const costPerUse = costPerUseMap(new Set(lines.map((l) => l.name)), {});
    total += Math.max(0, lines.reduce((s, l) => s + (costPerUse[l.name] ?? 0) * l.count, 0));
  }
  return Math.round(total / byReport.size);
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
  /** Off-pull consumables for the reports in `rows`. */
  offPull?: WclPlayerOffPull[];
  /** Officer corrections to consumable counts, keyed by report code. */
  adjustmentsByCode?: Record<string, ConsumableAdjustment[]>;
  attendance?: AttendanceSummary;
  comments: CharacterComment[];
  loggedSpec?: string;
  mainCharacterName?: string;
}

const KIND_ORDER = { debuff: 0, selfbuff: 1, buff: 1 } as const;

export function summarizeComparison(
  inputs: ComparisonInput[],
  policy: GuildPolicy = DEFAULT_POLICY,
): CharacterComparisonView {
  const prep = policy.preparation;
  const characters: ComparedCharacter[] = inputs.map((input) => {
    const { character, rows, attendance, comments } = input;
    const role = dominantRole(rows);
    const parses = rows.map((r) => r.parsePercent).filter((p): p is number => p !== undefined);
    const brackets = rows.map((r) => r.bracketPercent).filter((p): p is number => p !== undefined);
    const amounts = rows.map((r) => r.amount).filter((a): a is number => a !== undefined);
    const flaskOrElixirs = rows.filter((r) => hasConsumableCoverage(r, prep)).length;
    const prepared = rows.filter((r) => isPrepared(r, prep)).length;
    const deaths = rows.reduce((s, r) => s + r.deaths, 0);
    const potionsTotal = rows.reduce((s, r) => s + potionsUsed(r), 0);

    const cdCounts = new Map<string, number>();
    for (const r of rows) {
      for (const cd of r.cooldowns) cdCounts.set(cd, (cdCounts.get(cd) ?? 0) + 1);
    }
    const cooldownsTotal = [...cdCounts.values()].reduce((s, n) => s + n, 0);

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
      flaskPct: pct(rows.filter((r) => r.flask !== undefined).length, rows.length),
      elixirsPct: pct(rows.filter((r) => r.elixirs.length >= 1).length, rows.length),
      foodPct: pct(rows.filter((r) => hasFood(r)).length, rows.length),
      weaponBuffPct: pct(rows.filter((r) => r.weaponBuff).length, rows.length),
      potionsPerFight: rows.length === 0 ? 0 : Math.round((potionsTotal / rows.length) * 10) / 10,
      prepots: rows.filter((r) => r.prepot).length,
      cooldownsTotal,
      cooldownsPerFight: rows.length === 0 ? 0 : Math.round((cooldownsTotal / rows.length) * 10) / 10,
      cooldownBreakdown: [...cdCounts]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || compareText(a.name, b.name)),
      sappers: rows.reduce((s, r) => s + r.sappers, 0),
      healthstones: rows.reduce((s, r) => s + r.healthstones, 0),
      runes: rows.reduce((s, r) => s + r.runes, 0),
      drums: rows.reduce((s, r) => s + r.drums, 0),
      goldPerRaid: goldPerRaid(rows, input.offPull ?? [], input.adjustmentsByCode ?? {}),
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
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || compareText(a.name, b.name));

  return { characters, upkeepTracks };
}
