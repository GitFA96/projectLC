import { costPerUseMap, goldOfBreakdown } from "@/lib/wcl/consumable-prices";
import type {
  RaiderUsage,
  SeasonNotable,
  SeasonRaiderStat,
  SeasonRankingsView,
  SeasonReportInput,
  SeasonUptimeRow,
} from "@/lib/types";

/**
 * Cross-raid rollup over a set of reports: per-raider consumable/gold/death
 * tallies with per-raid MEDIANS (a single wild night doesn't crown anyone),
 * best average buff/debuff keepers, and a curated notables strip of season
 * leaders and laggards. Pure — the page picks which reports feed it.
 */

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** One raider's total gold for a report: in-fight items + prep buffs. */
function reportGold(u: RaiderUsage, costPerUse: Record<string, number>): number {
  return goldOfBreakdown(u.itemBreakdown, costPerUse) + goldOfBreakdown(u.prepBreakdown, costPerUse);
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

export function summarizeSeason(reports: SeasonReportInput[]): SeasonRankingsView {
  const byRaider = new Map<string, RaiderAcc>();
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
    const costPerUse = costPerUseMap(names, report.overrides);

    for (const u of report.usage) {
      const key = u.name.toLowerCase();
      const acc =
        byRaider.get(key) ??
        { name: u.name, slug: u.slug, className: u.className, role: u.role, golds: [], consumes: [], deaths: [] };
      acc.slug = u.slug ?? acc.slug;
      acc.className = u.className ?? acc.className;
      acc.golds.push(reportGold(u, costPerUse));
      acc.consumes.push(u.consumablesTotal);
      acc.deaths.push(u.deaths);
      byRaider.set(key, acc);
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

  const raiders: SeasonRaiderStat[] = [...byRaider.values()]
    .map((a) => ({
      name: a.name,
      slug: a.slug,
      className: a.className,
      role: a.role,
      raids: a.golds.length,
      goldTotal: Math.round(a.golds.reduce((s, n) => s + n, 0)),
      goldMedianPerRaid: Math.round(median(a.golds)),
      consumablesTotal: a.consumes.reduce((s, n) => s + n, 0),
      consumablesMedianPerRaid: round1(median(a.consumes)),
      deathsTotal: a.deaths.reduce((s, n) => s + n, 0),
      deathsMedianPerRaid: round1(median(a.deaths)),
    }))
    .sort((a, b) => b.goldTotal - a.goldTotal || a.name.localeCompare(b.name));

  const uptime: SeasonUptimeRow[] = [...trackMap]
    .map(([name, t]) => ({
      name,
      kind: t.kind,
      className: t.className,
      providers: [...t.providers.values()]
        .map((p) => ({ name: p.name, slug: p.slug, pct: Math.round(p.sum / Math.max(1, p.raids)), raids: p.raids }))
        .sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (b.providers[0]?.pct ?? 0) - (a.providers[0]?.pct ?? 0) || a.name.localeCompare(b.name));

  return {
    reportCount: reports.length,
    raiders,
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
      detail: `≈${topGold.goldTotal.toLocaleString("en-US")}g over ${raidWord(topGold.raids)}`,
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
      detail: `≈${lightest.goldTotal.toLocaleString("en-US")}g over ${raidWord(lightest.raids)}`,
    });
  }

  return out;
}
