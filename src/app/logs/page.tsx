import type { Metadata } from "next";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { ExternalLink, TriangleAlert } from "lucide-react";
import { getRepo } from "@/lib/data/repo";
import { CLASS_TEXT_COLORS } from "@/lib/constants/wow";
import type {
  ImprovementSeverity,
  RaidReportView,
  WclRole,
  WowClass,
} from "@/lib/types";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

export const metadata: Metadata = { title: "Raid logs" };

type Search = Promise<Record<string, string | string[] | undefined>>;

function classColor(className?: string): string | undefined {
  return className && className in CLASS_TEXT_COLORS
    ? CLASS_TEXT_COLORS[className as WowClass]
    : undefined;
}

const ROLE_LABEL: Record<WclRole, string> = { tank: "Tank", healer: "Healer", dps: "DPS" };

/** Class-colored raider name, linking matched roster characters to their logs. */
function Raider({ name, slug, className }: { name: string; slug?: string; className?: string }) {
  const color = classColor(className);
  if (slug) {
    return (
      <Link
        href={`/characters/${encodeURIComponent(slug)}/performance`}
        className="font-medium hover:underline"
        style={color ? { color } : undefined}
      >
        {name}
      </Link>
    );
  }
  return (
    <span className="font-medium" style={color ? { color } : undefined} title="Not matched to a roster character">
      {name}
    </span>
  );
}

function uptimeClass(pct: number): string {
  return pct >= 90 ? "text-emerald-700" : pct < 60 ? "text-amber-600" : "";
}

const SEVERITY_VARIANT: Record<ImprovementSeverity, "destructive" | "warning" | "muted"> = {
  high: "destructive",
  medium: "warning",
  low: "muted",
};

export default async function LogsPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const requested = Array.isArray(sp.report) ? sp.report[0] : sp.report;

  const repo = await getRepo();
  const [reports, raid] = await Promise.all([repo.listWclReports(), repo.getRaidReport(requested)]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Raid logs"
        description="Buff & debuff uptime, consumable and cooldown usage, and who to nudge — per raid night, from imported Warcraft Logs."
      />

      {!raid ? (
        <EmptyState
          title="No Warcraft Logs imported yet"
          description="Import a report on the Warcraft Logs tab of the import page — the whole raid's preparation, uptime and cooldown usage rolls up here."
          action={
            <Button asChild size="sm">
              <Link href="/admin/import?tab=wcl">Import a report</Link>
            </Button>
          }
        />
      ) : (
        <RaidDashboard raid={raid} reports={reports} />
      )}
    </div>
  );
}

function RaidDashboard({
  raid,
  reports,
}: {
  raid: RaidReportView;
  reports: Awaited<ReturnType<Awaited<ReturnType<typeof getRepo>>["listWclReports"]>>;
}) {
  const { report, session, prep, upkeep, cooldowns, improvements, fights } = raid;
  const kills = fights.filter((f) => f.kill).length;

  return (
    <>
      {reports.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {reports.map(({ report: r }) => {
            const active = r.code === report.code;
            return (
              <Link
                key={r.code}
                href={`/logs?report=${encodeURIComponent(r.code)}`}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-accent",
                  active && "border-foreground/30 bg-primary text-primary-foreground hover:bg-primary",
                )}
              >
                {format(parseISO(r.startTime), "d MMM")} · {r.zone ?? r.title}
              </Link>
            );
          })}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            {report.title}
            {report.zone && <Badge variant="secondary">{report.zone}</Badge>}
          </CardTitle>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {format(parseISO(report.startTime), "EEE d MMM yyyy")} · {prep.raiders} raiders ·{" "}
            {kills}/{fights.length} bosses killed
            {session && (
              <>
                ·{" "}
                <Link
                  href={`/loot?session=${encodeURIComponent(session.id)}`}
                  className="font-medium text-foreground underline-offset-2 hover:underline"
                >
                  loot session
                </Link>
              </>
            )}
            ·{" "}
            <a
              href={`https://classic.warcraftlogs.com/reports/${encodeURIComponent(report.code)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
            >
              open on Warcraft Logs <ExternalLink className="h-3 w-3" />
            </a>
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {fights.map((f) => (
              <Badge key={f.fightId} variant={f.kill ? "success" : "warning"} className="font-normal">
                {f.encounterName}
                {!f.kill && f.fightPercentage !== undefined && ` ${Math.round(f.fightPercentage)}%`}
              </Badge>
            ))}
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label="Flask / elixirs" value={`${prep.flaskOrElixirPct}%`} sub="of player-pulls covered" />
        <KpiCard label="Food" value={`${prep.foodPct}%`} sub="Well Fed at pull" />
        <KpiCard label="Weapon buff" value={`${prep.weaponBuffPct}%`} sub="oil / stone / poison" />
        <KpiCard label="Pre-pots" value={`${prep.prepotPct}%`} sub={`${prep.prepots} pulls opened potted`} />
        <KpiCard label="Potions used" value={prep.potionsTotal} sub="combat potions, all raiders" />
      </div>

      {/* Section 1: buff & debuff uptime */}
      <Card>
        <CardHeader>
          <CardTitle>Buff &amp; debuff uptime</CardTitle>
          <p className="text-xs text-muted-foreground">
            Maintained raid debuffs (on the boss) and self/assigned buffs, averaged across the
            night per provider. Boss debuffs first.
          </p>
        </CardHeader>
        <CardContent>
          {upkeep.length === 0 ? (
            <p className="py-1 text-sm text-muted-foreground">
              No tracked debuffs/buffs in this report. Re-import reports from before uptime
              tracking to backfill.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Debuff / buff</TableHead>
                  <TableHead className="w-20 text-right">Best</TableHead>
                  <TableHead>Kept up by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {upkeep.map((u) => (
                  <TableRow key={u.name}>
                    <TableCell>
                      <span className="text-sm font-medium">{u.name}</span>
                      {u.kind === "debuff" && (
                        <span className="ml-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          on boss
                        </span>
                      )}
                    </TableCell>
                    <TableCell className={cn("text-right text-sm font-medium tabular-nums", uptimeClass(u.bestPct))}>
                      {u.bestPct}%
                    </TableCell>
                    <TableCell>
                      <span className="flex flex-wrap gap-x-2 gap-y-0.5 text-sm">
                        {u.providers.map((p) => (
                          <span key={p.name} className="whitespace-nowrap">
                            <Raider name={p.name} slug={p.slug} className={u.className} />
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

      {/* Section 2: cooldowns + in-fight consumable types */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Cooldown usage</CardTitle>
            <p className="text-xs text-muted-foreground">Major class cooldowns cast across the night.</p>
          </CardHeader>
          <CardContent>
            {cooldowns.length === 0 ? (
              <p className="py-1 text-sm text-muted-foreground">No tracked cooldowns cast.</p>
            ) : (
              <Table>
                <TableBody>
                  {cooldowns.map((c) => (
                    <TableRow key={c.name}>
                      <TableCell className="text-sm font-medium">{c.name}</TableCell>
                      <TableCell className="w-12 text-right text-sm tabular-nums">×{c.uses}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {c.providers.map((p, i) => (
                          <span key={p.name}>
                            {i > 0 && ", "}
                            {p.name}
                            {p.count > 1 && ` ×${p.count}`}
                          </span>
                        ))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Potions &amp; in-fight items</CardTitle>
            <p className="text-xs text-muted-foreground">Everything consumed mid-fight, by type.</p>
          </CardHeader>
          <CardContent>
            {prep.potionTypes.length === 0 && prep.inFightTypes.length === 0 ? (
              <p className="py-1 text-sm text-muted-foreground">No in-fight consumables used.</p>
            ) : (
              <Table>
                <TableBody>
                  {prep.potionTypes.map((t, i) => (
                    <TableRow key={`pot-${t.name}`}>
                      <TableCell className="w-24 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {i === 0 ? "Potions" : ""}
                      </TableCell>
                      <TableCell className="text-sm">{t.name}</TableCell>
                      <TableCell className="w-12 text-right text-sm tabular-nums">×{t.uses}</TableCell>
                    </TableRow>
                  ))}
                  {prep.inFightTypes.map((t, i) => (
                    <TableRow key={`item-${t.name}`}>
                      <TableCell className="w-24 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {i === 0 ? "Items" : ""}
                      </TableCell>
                      <TableCell className="text-sm">{t.name}</TableCell>
                      <TableCell className="w-12 text-right text-sm tabular-nums">×{t.uses}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Section 3: player improvements */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TriangleAlert className="h-4 w-4 text-amber-600" />
            Player improvements
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Preparation gaps this night, worst first — missing enchants, flask/food, and skipped
            potions. The pre-raid nudge list.
          </p>
        </CardHeader>
        <CardContent>
          {improvements.length === 0 ? (
            <p className="flex items-center gap-1.5 py-2 text-sm text-emerald-700">
              Nothing to flag — everyone showed up enchanted, flasked and fed. Clean night.
            </p>
          ) : (
            <ul className="divide-y">
              {improvements.map((p) => (
                <li key={p.name} className="flex flex-col gap-1.5 py-2.5 sm:flex-row sm:items-start sm:justify-between">
                  <span className="flex items-center gap-2">
                    <Raider name={p.name} slug={p.slug} className={p.className} />
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {ROLE_LABEL[p.role]}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-1.5 sm:max-w-[70%] sm:justify-end">
                    {p.findings.map((f, i) => (
                      <Badge key={i} variant={SEVERITY_VARIANT[f.severity]} className="font-normal">
                        {f.label}
                        {f.detail && <span className="ml-1 opacity-80">· {f.detail}</span>}
                      </Badge>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
