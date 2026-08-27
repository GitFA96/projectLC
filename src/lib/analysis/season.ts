import { costPerUseMap } from "@/lib/wcl/consumable-prices";
import {
  adjustmentsFor,
  applyAdjustments,
  goldOfLines,
  type ConsumableLine,
} from "@/lib/analysis/consumable-adjustments";
import type { CharacterStatus } from "@/lib/constants/wow";
import type {
  ConsumableAdjustment,
  RaiderUsage,
  SeasonConsumableStat,
  SeasonConsumableUser,
  SeasonNotable,
  SeasonRaiderStat,
  SeasonRankingsView,
  SeasonReportInput,
  SeasonRosterEntry,
  SeasonUptimeRow,
} from "@/lib/types";

import { compareText } from "@/lib/sort";

/**
 * Cross-raid rollup over a set of reports: per-raider consumable/gold/death
 * tallies with per-raid MEDIANS (a single wild night doesn't crown anyone), the
 * same spend pivoted per CONSUMABLE with everyone who used it, best average
 * buff/debuff keepers, and a curated notables strip of season leaders and
 * laggards. Pure — the page picks which reports feed it.
 *
 * The two consumable views are built in one pass over one list of corrected
 * lines, so "what the raid spent on flasks" and "what this raider spent" can't
 * drift apart — see `reportLines` and docs/change-chains.md §5.
 */

/**
 * Whether a logged name is one of the guild's own characters.
 *
 * A pug is somebody else's raider who came along — real spend, real pulls, but
 * not the guild's, and 28% of this season's consumable gold on the deployment
 * this was written against. An unmatched name is treated the same way: the
 * roster is what makes somebody ours, and "the log has never heard of them" is
 * not evidence of membership.
 *
 * `inactive` counts. They raided with us and their nights still have to add up
 * — history is unlinked here, never rewritten.
 */
export function isGuildCharacter(status?: CharacterStatus): boolean {
  return status !== undefined && status !== "pug";
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * One raider's consumables for a report: in-fight items + prep buffs, with the
 * night's hand corrections applied. The season view has to agree with the raid
 * page it's summing, or the same night reads two different ways — so the gold
 * and the per-consumable rollup are both built from this one list rather than
 * each walking the breakdowns their own way.
 */
function reportLines(u: RaiderUsage, adjustments: ConsumableAdjustment[]): ConsumableLine[] {
  const logged = [...u.itemBreakdown, ...u.prepBreakdown];
  return applyAdjustments(logged, adjustmentsFor(adjustments, u.name));
}

const KIND_ORDER = { debuff: 0, selfbuff: 1, buff: 1 } as const;

interface RaiderAcc {
  name: string;
  slug?: string;
  className?: string;
  role: RaiderUsage["role"];
  golds: number[];
  consumes: number[];
  deaths: number[];
}

interface ConsumableAcc {
  name: string;
  uses: number;
  gold: number;
  reports: Set<string>;
  /** Raider key (lowercased name) → their share of it. */
  users: Map<string, { name: string; uses: number; gold: number }>;
}

export function summarizeSeason(
  reports: SeasonReportInput[],
  /** Roster lookup by slug. Absent for callers that don't need the guild/pug split. */
  roster: Record<string, SeasonRosterEntry> = {},
): SeasonRankingsView {
  const byRaider = new Map<string, RaiderAcc>();
  const byConsumable = new Map<string, ConsumableAcc>();
  // track name → { kind, className, provider(lower) → { name, slug, sum, raids } }
  const trackMap = new Map<
    string,
    {
      kind: SeasonUptimeRow["kind"];
      className?: string;
      providers: Map<string, { name: string; slug?: string; sum: number; raids: number }>;
    }
  >();

  for (const report of reports) {
    const names = new Set<string>();
    for (const u of report.usage) {
      for (const b of u.itemBreakdown) names.add(b.name);
      for (const b of u.prepBreakdown) names.add(b.name);
    }
    // A hand-added consumable still needs a price, even if the log never saw it.
    const adjustments = report.adjustments ?? [];
    for (const a of adjustments) names.add(a.name);
    const costPerUse = costPerUseMap(names, report.overrides);

    for (const u of report.usage) {
      const key = u.name.toLowerCase();
      const acc =
        byRaider.get(key) ??
        { name: u.name, slug: u.slug, className: u.className, role: u.role, golds: [], consumes: [], deaths: [] };
      acc.slug = u.slug ?? acc.slug;
      acc.className = u.className ?? acc.className;
      const lines = reportLines(u, adjustments);
      acc.golds.push(Math.max(0, goldOfLines(lines, costPerUse)));
      acc.consumes.push(u.consumablesTotal);
      acc.deaths.push(u.deaths);
      byRaider.set(key, acc);

      for (const line of lines) {
        const c =
          byConsumable.get(line.name) ??
          { name: line.name, uses: 0, gold: 0, reports: new Set<string>(), users: new Map() };
        const gold = (costPerUse[line.name] ?? 0) * line.count;
        c.uses += line.count;
        c.gold += gold;
        c.reports.add(report.code);
        const user = c.users.get(key) ?? { name: u.name, uses: 0, gold: 0 };
        user.uses += line.count;
        user.gold += gold;
        c.users.set(key, user);
        byConsumable.set(line.name, c);
      }
    }

    for (const t of report.upkeep) {
      const track = trackMap.get(t.name) ?? { kind: t.kind, className: t.className, providers: new Map() };
      track.className = track.className ?? t.className;
      for (const p of t.providers) {
        const pk = p.name.toLowerCase();
        const pv = track.providers.get(pk) ?? { name: p.name, slug: p.slug, sum: 0, raids: 0 };
        pv.sum += p.pct;
        pv.raids += 1;
        pv.slug = p.slug ?? pv.slug;
        track.providers.set(pk, pv);
      }
      trackMap.set(t.name, track);
    }
  }

  /** What the roster says about a logged name, or nothing when it matched nobody. */
  const rosterOf = (slug?: string) => (slug === undefined ? undefined : roster[slug.toLowerCase()]);

  const raiders: SeasonRaiderStat[] = [...byRaider.values()]
    .map((a) => ({
      name: a.name,
      slug: a.slug,
      className: a.className,
      role: a.role,
      status: rosterOf(a.slug)?.status,
      mainName: rosterOf(a.slug)?.mainName,
      raids: a.golds.length,
      goldTotal: a.golds.reduce((s, n) => s + n, 0),
      goldMedianPerRaid: Math.round(median(a.golds)),
      consumablesTotal: a.consumes.reduce((s, n) => s + n, 0),
      consumablesMedianPerRaid: round1(median(a.consumes)),
      deathsTotal: a.deaths.reduce((s, n) => s + n, 0),
      deathsMedianPerRaid: round1(median(a.deaths)),
    }))
    .sort((a, b) => b.goldTotal - a.goldTotal || compareText(a.name, b.name));

  const consumables: SeasonConsumableStat[] = [...byConsumable.values()]
    .map((c) => ({
      name: c.name,
      uses: c.uses,
      gold: c.gold,
      raids: c.reports.size,
      users: [...c.users]
        .map(([key, u]): SeasonConsumableUser => {
          const raider = byRaider.get(key);
          return {
            name: u.name,
            slug: raider?.slug,
            className: raider?.className,
            status: rosterOf(raider?.slug)?.status,
            // The player's raids, not this consumable's: someone who drank ten
            // potions on their one night averages ten, not ten twenty-firsts.
            raids: raider?.golds.length ?? 0,
            uses: u.uses,
            gold: u.gold,
          };
        })
        .sort((a, b) => b.uses - a.uses || compareText(a.name, b.name)),
    }))
    .sort((a, b) => b.gold - a.gold || b.uses - a.uses || compareText(a.name, b.name));

  const uptime: SeasonUptimeRow[] = [...trackMap]
    .map(([name, t]) => ({
      name,
      kind: t.kind,
      className: t.className,
      providers: [...t.providers.values()]
        .map((p) => ({ name: p.name, slug: p.slug, pct: Math.round(p.sum / Math.max(1, p.raids)), raids: p.raids }))
        .sort((a, b) => b.pct - a.pct || compareText(a.name, b.name)),
    }))
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (b.providers[0]?.pct ?? 0) - (a.providers[0]?.pct ?? 0) || compareText(a.name, b.name));

  return {
    reportCount: reports.length,
    raiders,
    consumables,
    uptime,
    notables: buildNotables(raiders, uptime, reports.length),
  };
}

/** A handful of season leaders and laggards worth surfacing. */
function buildNotables(
  raiders: SeasonRaiderStat[],
  uptime: SeasonUptimeRow[],
  reportCount: number,
): SeasonNotable[] {
  const out: SeasonNotable[] = [];
  const ref = (r: SeasonRaiderStat) => ({ name: r.name, slug: r.slug, className: r.className });
  const raidWord = (n: number) => `${n} raid${n === 1 ? "" : "s"}`;
  // Regulars only for laggard calls — one no-consume guest shouldn't headline.
  const regulars = raiders.filter((r) => r.raids >= Math.ceil(reportCount / 2));

  const topGold = raiders.find((r) => r.goldTotal > 0);
  if (topGold) {
    out.push({
      tone: "positive",
      label: "Biggest spender",
      raider: ref(topGold),
      detail: `≈${Math.round(topGold.goldTotal).toLocaleString("en-US")}g over ${raidWord(topGold.raids)}`,
    });
  }

  const topConsume = [...raiders].sort((a, b) => b.consumablesMedianPerRaid - a.consumablesMedianPerRaid)[0];
  if (topConsume && topConsume.consumablesMedianPerRaid > 0) {
    out.push({
      tone: "positive",
      label: "Most consumables / raid",
      raider: ref(topConsume),
      detail: `${topConsume.consumablesMedianPerRaid} in-fight items (median)`,
    });
  }

  const topTrack = uptime.find((t) => t.providers.length > 0);
  if (topTrack) {
    const p = topTrack.providers[0];
    out.push({
      tone: "positive",
      label: `Best ${topTrack.name} uptime`,
      raider: { name: p.name, slug: p.slug, className: topTrack.className },
      detail: `${p.pct}% average over ${raidWord(p.raids)}`,
    });
  }

  const mostDeaths = [...regulars].sort((a, b) => b.deathsMedianPerRaid - a.deathsMedianPerRaid)[0];
  if (mostDeaths && mostDeaths.deathsMedianPerRaid > 0) {
    out.push({
      tone: "negative",
      label: "Most deaths / raid",
      raider: ref(mostDeaths),
      detail: `${mostDeaths.deathsMedianPerRaid} deaths (median)`,
    });
  }

  const lightest = [...regulars].sort((a, b) => a.goldTotal - b.goldTotal)[0];
  if (lightest && regulars.length > 1 && lightest.name !== topGold?.name) {
    out.push({
      tone: "negative",
      label: "Lightest on consumables",
      raider: ref(lightest),
      detail: `≈${Math.round(lightest.goldTotal).toLocaleString("en-US")}g over ${raidWord(lightest.raids)}`,
    });
  }

  return out;
}
