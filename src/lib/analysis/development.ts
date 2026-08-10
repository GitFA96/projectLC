/**
 * One raider, night by night — "utviklingen av en spesiell spiller?".
 *
 * Every other view in the app answers with a single number: a career median, a
 * preparation percentage, a placing on the standing board. Those are the right
 * shape for ranking and the wrong shape for the question an officer actually
 * asks before a hard conversation, which is *which way is this going*. A raider
 * at the bottom and climbing and a raider at the bottom and sliding have the
 * same career median and need opposite conversations.
 *
 * So: one row per raid night, and a delta between the recent window and
 * everything before it.
 *
 * **No verdict.** The delta is reported as a number of points and nothing here
 * calls it improving or declining — that needs a threshold, and a threshold is
 * a judgement about a roster this module can't see. Both night counts come with
 * it so an officer can tell a trend from two lucky pulls.
 *
 * The recent window is `attendance.recentRaids` **capped at half their nights**.
 * Reusing the council's answer to "how far back is recent" avoids a second knob
 * meaning almost the same thing; the cap is what makes it a trend rather than a
 * restatement. Measured on the real roster, the uncapped window (ten) covered
 * every night twenty-six of twenty-seven raiders had ever logged, leaving
 * nothing earlier to compare against and no trend for anybody. A comparison
 * needs two sides, and with a short history the honest split is down the
 * middle.
 *
 * Pure.
 */

import { DEFAULT_POLICY, type GuildPolicy } from "@/lib/analysis/policy";
import { summarizePerformance } from "@/lib/analysis/performance";
import type { WclPlayerFight } from "@/lib/types";

/** The report facts a night needs. Any shape carrying them works. */
export interface DevelopmentReport {
  code: string;
  title: string;
  startTime: string;
  zone?: string;
}

export interface DevelopmentNight {
  reportCode: string;
  title: string;
  /** ISO start of the raid — the x axis. */
  date: string;
  zone?: string;
  pulls: number;
  kills: number;
  deaths: number;
  /** Median parse across the night's ranked kills. Absent when none ranked. */
  medianParse?: number;
  preparedPct: number;
  potionsPerFight: number;
}

export const DEVELOPMENT_METRICS = ["performance", "preparation"] as const;
export type DevelopmentMetricKey = (typeof DEVELOPMENT_METRICS)[number];

export interface DevelopmentTrend {
  key: DevelopmentMetricKey;
  label: string;
  /** Mean over the recent window, and over every night before it. */
  recent?: number;
  earlier?: number;
  /** recent − earlier, in the metric's own points. Absent unless both exist. */
  delta?: number;
  nightsRecent: number;
  nightsEarlier: number;
}

export interface DevelopmentSeries {
  /** Oldest first, so it reads left to right. */
  nights: DevelopmentNight[];
  trends: DevelopmentTrend[];
  /** How many of the latest nights counted as "recent". */
  window: number;
}

const LABELS: Record<DevelopmentMetricKey, string> = {
  performance: "Median parse",
  preparation: "Preparation",
};

function mean(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10;
}

function valueOf(night: DevelopmentNight, key: DevelopmentMetricKey): number | undefined {
  return key === "performance" ? night.medianParse : night.preparedPct;
}

/**
 * Build the series.
 *
 * Nights with no rows for this raider simply don't appear — an absence is a
 * gap in the line rather than a zero, the same rule the rest of the app
 * follows. Whether they *should* have been there is the attendance view's
 * question, not this one's.
 */
export function buildDevelopmentSeries(
  rows: WclPlayerFight[],
  reports: DevelopmentReport[],
  policy: GuildPolicy = DEFAULT_POLICY,
): DevelopmentSeries {
  const rowsByReport = new Map<string, WclPlayerFight[]>();
  for (const row of rows) {
    rowsByReport.set(row.reportCode, [...(rowsByReport.get(row.reportCode) ?? []), row]);
  }

  const nights: DevelopmentNight[] = [...reports]
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .flatMap((report) => {
      const mine = rowsByReport.get(report.code);
      if (mine === undefined || mine.length === 0) return [];
      const summary = summarizePerformance(mine, policy);
      if (summary === undefined) return [];
      return [
        {
          reportCode: report.code,
          title: report.title,
          date: report.startTime,
          zone: report.zone,
          pulls: summary.fights,
          kills: summary.kills,
          deaths: summary.deaths,
          medianParse: summary.medianParse,
          preparedPct: summary.preparedPct,
          potionsPerFight: summary.potionsPerFight,
        } satisfies DevelopmentNight,
      ];
    });

  // Never more than half their nights: a window that covers everything leaves
  // nothing to compare against, and "no trend" for a raider with a season of
  // logs is a bug wearing the clothes of a missing figure.
  const window = Math.max(0, Math.min(policy.attendance.recentRaids, Math.floor(nights.length / 2)));
  const recentNights = nights.slice(-window);
  const earlierNights = window === 0 ? [] : nights.slice(0, nights.length - window);

  const trends: DevelopmentTrend[] = DEVELOPMENT_METRICS.map((key) => {
    const recentValues = recentNights
      .map((n) => valueOf(n, key))
      .filter((v): v is number => v !== undefined);
    const earlierValues = earlierNights
      .map((n) => valueOf(n, key))
      .filter((v): v is number => v !== undefined);
    const recent = mean(recentValues);
    const earlier = mean(earlierValues);
    return {
      key,
      label: LABELS[key],
      recent,
      earlier,
      delta:
        recent === undefined || earlier === undefined
          ? undefined
          : Math.round((recent - earlier) * 10) / 10,
      nightsRecent: recentValues.length,
      nightsEarlier: earlierValues.length,
    };
  });

  return { nights, trends, window };
}

/**
 * The one number the standing board borrows: how far the recent window sits
 * above or below everything earlier, in parse points.
 *
 * Undefined when there is nothing earlier to compare against — a raider with
 * only recent nights has no trend, and showing them a zero would read as
 * "flat" when the truth is "too soon to say".
 */
export function parseTrend(series: DevelopmentSeries): number | undefined {
  return series.trends.find((t) => t.key === "performance")?.delta;
}
