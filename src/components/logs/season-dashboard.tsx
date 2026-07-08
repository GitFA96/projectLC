"use client";

import * as React from "react";
import { format, parseISO } from "date-fns";
import { Coins, Trophy, TriangleAlert } from "lucide-react";
import type { SeasonReportInput } from "@/lib/types";
import { summarizeSeason } from "@/lib/analysis/season";
import { RankBadge, Raider } from "@/components/logs/rank-bits";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

function uptimeClass(pct: number): string {
  return pct >= 90 ? "text-emerald-700" : pct < 60 ? "text-amber-600" : "";
}

/**
 * Cross-raid rankings: pick which imported raids to include, then see who
 * spends the most gold on consumables, who keeps the key debuffs up, and the
 * season's notable leaders and laggards — all on per-raid medians so one wild
 * night doesn't distort the picture.
 */
export function SeasonDashboard({ reports }: { reports: SeasonReportInput[] }) {
  const sorted = React.useMemo(
    () => [...reports].sort((a, b) => b.startTime.localeCompare(a.startTime)),
    [reports],
  );
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set(sorted.map((r) => r.code)));

  const chosen = sorted.filter((r) => selected.has(r.code));
  const view = React.useMemo(() => summarizeSeason(chosen), [chosen]);

  const toggle = (code: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Raids in this ranking</CardTitle>
          <p className="text-xs text-muted-foreground">
            {selected.size} of {sorted.length} imported raids selected. Click to include or exclude a
            night.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {sorted.map((r) => {
              const on = selected.has(r.code);
              return (
                <button
                  key={r.code}
                  type="button"
                  onClick={() => toggle(r.code)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs transition-colors",
                    on
                      ? "border-foreground/30 bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  {format(parseISO(r.startTime), "d MMM")} · {r.zone ?? r.title}
                </button>
              );
            })}
          </div>
          <div className="flex gap-3 text-xs">
            <button type="button" className="text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => setSelected(new Set(sorted.map((r) => r.code)))}>
              Select all
            </button>
            <button type="button" className="text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => setSelected(new Set())}>
              Clear
            </button>
          </div>
        </CardContent>
      </Card>

      {chosen.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            Select at least one raid to build the ranking.
          </CardContent>
        </Card>
      ) : (
        <>
          {view.notables.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {view.notables.map((n) => (
                <div
                  key={n.label}
                  className={cn(
                    "rounded-xl border p-3",
                    n.tone === "positive" ? "border-emerald-200 bg-emerald-50/60" : "border-amber-200 bg-amber-50/60",
                  )}
                >
                  <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {n.tone === "positive" ? (
                      <Trophy className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <TriangleAlert className="h-3.5 w-3.5 text-amber-600" />
                    )}
                    {n.label}
                  </p>
                  <p className="mt-1 text-sm">
                    <Raider name={n.raider.name} slug={n.raider.slug} className={n.raider.className} />
                  </p>
                  <p className="text-xs text-muted-foreground">{n.detail}</p>
                </div>
              ))}
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Coins className="h-4 w-4 text-amber-500" />
                Consumable spend across {chosen.length} raid{chosen.length === 1 ? "" : "s"}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Total and typical (median) gold and in-fight items per raid, ranked by total spend.
              </p>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Raider</TableHead>
                    <TableHead className="w-16 text-right">Raids</TableHead>
                    <TableHead className="w-28 text-right">Items / raid</TableHead>
                    <TableHead className="w-24 text-right">Gold / raid</TableHead>
                    <TableHead className="w-24 text-right">Total gold</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.raiders.map((r, i) => (
                    <TableRow key={r.name} className={cn(i === 0 && "bg-amber-50/70 hover:bg-amber-50/70")}>
                      <TableCell>
                        <RankBadge rank={i + 1} />
                      </TableCell>
                      <TableCell>
                        <Raider name={r.name} slug={r.slug} className={r.className} />
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                        {r.raids}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {r.consumablesMedianPerRaid}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                        {r.goldMedianPerRaid.toLocaleString("en-US")}g
                      </TableCell>
                      <TableCell className="text-right text-sm font-semibold tabular-nums">
                        {r.goldTotal.toLocaleString("en-US")}g
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Debuff &amp; buff uptime leaders</CardTitle>
              <p className="text-xs text-muted-foreground">
                Best average uptime per track across the selected raids — boss debuffs first.
              </p>
            </CardHeader>
            <CardContent>
              {view.uptime.length === 0 ? (
                <p className="py-1 text-sm text-muted-foreground">No tracked debuffs/buffs in these raids.</p>
              ) : (
                <Table>
                  <TableBody>
                    {view.uptime.map((t) => (
                      <TableRow key={t.name}>
                        <TableCell className="align-top text-sm font-medium">
                          {t.name}
                          {t.kind === "debuff" && (
                            <span className="ml-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                              on boss
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm">
                            {t.providers.slice(0, 5).map((p) => (
                              <span key={p.name} className="whitespace-nowrap">
                                <Raider name={p.name} slug={p.slug} className={t.className} />
                                <span className={cn("ml-1 text-xs tabular-nums", uptimeClass(p.pct))}>{p.pct}%</span>
                              </span>
                            ))}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
