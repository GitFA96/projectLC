import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { format, parseISO } from "date-fns";
import { ArrowLeft, Check, ExternalLink, X } from "lucide-react";
import { getRepo } from "@/lib/data/repo";
import { CLASS_TEXT_COLORS } from "@/lib/constants/wow";
import type { PerformanceReportView, WclPlayerFight } from "@/lib/types";
import { PageHeader } from "@/components/page-header";
import { ClassBadge } from "@/components/class-badge";
import { RoleBadge } from "@/components/role-badge";
import { EmptyState } from "@/components/empty-state";
import { ParseBadge, parseColor } from "@/components/parse-badge";
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

type Params = { name: string };
type Search = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  return { title: `${decoded.charAt(0).toUpperCase() + decoded.slice(1)} · Performance` };
}

function fmtDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function fmtAmount(row: WclPlayerFight): string {
  if (row.amount === undefined) return "—";
  return `${Math.round(row.amount).toLocaleString("en-US")} ${row.role === "healer" ? "hps" : "dps"}`;
}

function Mark({ ok, title }: { ok: boolean; title?: string }) {
  return ok ? (
    <Check className="h-3.5 w-3.5 text-emerald-600" aria-label={title ?? "yes"} />
  ) : (
    <X className="h-3.5 w-3.5 text-muted-foreground/40" aria-label={title ?? "no"} />
  );
}

/** Coverage line for the consumables card: label + pulls covered. */
function coverage(rows: WclPlayerFight[], pick: (r: WclPlayerFight) => string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const label of new Set(pick(row))) {
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return new Map([...counts].sort((a, b) => b[1] - a[1]));
}

export default async function PerformancePage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Search;
}) {
  const [{ name }, sp] = await Promise.all([params, searchParams]);
  const repo = await getRepo();
  const perf = await repo.getCharacterPerformance(decodeURIComponent(name));
  if (!perf) notFound();
  const { character, reports, career } = perf;

  const requested = Array.isArray(sp.report) ? sp.report[0] : sp.report;
  const active: PerformanceReportView | undefined =
    reports.find((r) => r.report.code === requested) ?? reports[0];

  return (
    <div className="space-y-5">
      <PageHeader
        title={
          <span className="flex flex-wrap items-baseline gap-2">
            <span style={{ color: CLASS_TEXT_COLORS[character.class] }}>{character.name}</span>
            <span className="text-base font-normal text-muted-foreground">Performance</span>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <ClassBadge wowClass={character.class} spec={character.spec} />
            <RoleBadge role={character.role} />
            {career && (
              <span className="text-xs">
                {career.fights} pulls over {reports.length} report{reports.length === 1 ? "" : "s"} ·
                career median parse <ParseBadge pct={career.medianParse} /> · best{" "}
                <ParseBadge pct={career.bestParse} />
              </span>
            )}
          </span>
        }
      >
        <Button asChild variant="outline" size="sm">
          <Link href={`/characters/${encodeURIComponent(character.name.toLowerCase())}`}>
            <ArrowLeft className="h-3.5 w-3.5" /> Profile
          </Link>
        </Button>
      </PageHeader>

      {!active ? (
        <EmptyState
          title={`No Warcraft Logs data for ${character.name} yet`}
          description="Import a report on the Warcraft Logs tab of the import page — every raider in the log gets their pulls, parses and consumable usage recorded."
          action={
            <Button asChild size="sm">
              <Link href="/admin/import?tab=wcl">Import a report</Link>
            </Button>
          }
        />
      ) : (
        <>
          {reports.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {reports.map(({ report }) => {
                const isActive = report.code === active.report.code;
                return (
                  <Link
                    key={report.code}
                    href={`/characters/${encodeURIComponent(character.name.toLowerCase())}/performance?report=${encodeURIComponent(report.code)}`}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-accent",
                      isActive && "border-foreground/30 bg-primary text-primary-foreground hover:bg-primary",
                    )}
                  >
                    {format(parseISO(report.startTime), "d MMM")} · {report.zone ?? report.title}
                  </Link>
                );
              })}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs font-medium text-muted-foreground">Median parse</p>
                <p
                  className="mt-1 text-2xl font-semibold tabular-nums tracking-tight"
                  style={
                    active.summary.medianParse !== undefined
                      ? { color: parseColor(active.summary.medianParse) }
                      : undefined
                  }
                >
                  {active.summary.medianParse ?? "—"}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  ilvl-bracket median {active.summary.medianBracket ?? "—"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs font-medium text-muted-foreground">Best parse</p>
                <p
                  className="mt-1 text-2xl font-semibold tabular-nums tracking-tight"
                  style={
                    active.summary.bestParse !== undefined
                      ? { color: parseColor(active.summary.bestParse) }
                      : undefined
                  }
                >
                  {active.summary.bestParse ?? "—"}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {active.summary.kills} kill{active.summary.kills === 1 ? "" : "s"},{" "}
                  {active.summary.wipes} wipe{active.summary.wipes === 1 ? "" : "s"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs font-medium text-muted-foreground">Deaths</p>
                <p
                  className={cn(
                    "mt-1 text-2xl font-semibold tabular-nums tracking-tight",
                    active.summary.deaths > 0 && "text-destructive",
                  )}
                >
                  {active.summary.deaths}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  across {active.summary.fights} pulls
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs font-medium text-muted-foreground">Prepared</p>
                <p
                  className={cn(
                    "mt-1 text-2xl font-semibold tabular-nums tracking-tight",
                    active.summary.preparedPct < 80 && "text-amber-600",
                  )}
                >
                  {active.summary.preparedPct}%
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  flask/elixirs + food at pull
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs font-medium text-muted-foreground">Potions / pull</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
                  {active.summary.potionsPerFight}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {active.summary.prepots} pre-pot{active.summary.prepots === 1 ? "" : "s"} ·{" "}
                  {active.summary.potionsTotal} total
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {active.report.title}
                {active.report.zone && <Badge variant="secondary">{active.report.zone}</Badge>}
              </CardTitle>
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                {format(parseISO(active.report.startTime), "d MMM yyyy")}
                {active.session && (
                  <>
                    · linked to the{" "}
                    <Link
                      href={`/loot?session=${encodeURIComponent(active.session.id)}`}
                      className="font-medium text-foreground underline-offset-2 hover:underline"
                    >
                      {format(parseISO(active.session.date), "d MMM")} loot session
                    </Link>
                  </>
                )}
                ·
                <a
                  href={`https://classic.warcraftlogs.com/reports/${encodeURIComponent(active.report.code)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
                >
                  open on Warcraft Logs <ExternalLink className="h-3 w-3" />
                </a>
              </p>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Boss</TableHead>
                    <TableHead className="w-24">Result</TableHead>
                    <TableHead className="w-20 text-right">Parse</TableHead>
                    <TableHead className="w-20 text-right" title="Percentile within the item-level bracket — gear-adjusted">
                      Bracket
                    </TableHead>
                    <TableHead className="w-28 text-right">Output</TableHead>
                    <TableHead className="w-16 text-right">Deaths</TableHead>
                    <TableHead className="w-14" title="Flask or two elixirs at pull">Flask</TableHead>
                    <TableHead className="w-14" title="Well Fed at pull">Food</TableHead>
                    <TableHead className="w-14" title="Potions used (pre-pot included as +)">Pots</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {active.rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <span className="text-sm font-medium">{row.encounterName}</span>
                        <span className="ml-2 text-xs tabular-nums text-muted-foreground">
                          {fmtDuration(row.durationMs)}
                        </span>
                      </TableCell>
                      <TableCell>
                        {row.kill ? (
                          <Badge variant="success">Kill</Badge>
                        ) : (
                          <Badge variant="warning">
                            Wipe{row.fightPercentage !== undefined && ` ${Math.round(row.fightPercentage)}%`}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <ParseBadge pct={row.parsePercent} />
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                        {row.bracketPercent !== undefined ? Math.round(row.bracketPercent) : "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{fmtAmount(row)}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {row.deaths > 0 ? (
                          <span className="font-medium text-destructive">{row.deaths}</span>
                        ) : (
                          <span className="text-muted-foreground/50">0</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Mark
                          ok={row.flask !== undefined || row.elixirs.length >= 2}
                          title={row.flask ?? (row.elixirs.length > 0 ? row.elixirs.join(" + ") : "no flask or elixirs")}
                        />
                      </TableCell>
                      <TableCell>
                        <Mark ok={row.food} />
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">
                        {row.potions.length > 0 || row.prepot ? (
                          <span title={[...(row.prepot ? ["pre-pot"] : []), ...row.potions].join(", ")}>
                            {row.potions.length}
                            {row.prepot && <span className="text-emerald-600">+</span>}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/50">0</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Parses are Warcraft Logs percentiles (healers on HPS, tanks within the tank
                bracket); wipes don&apos;t parse. A <span className="text-emerald-600">+</span> in
                Pots means a pre-pot was already running at the pull.
              </p>
            </CardContent>
          </Card>

          <div className="grid items-start gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Consumables this report</CardTitle>
                <p className="text-xs text-muted-foreground">
                  What was actually running at each pull — the cheapest performance there is.
                </p>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableBody>
                    <ConsumableRows label="Flask" entries={coverage(active.rows, (r) => (r.flask ? [r.flask] : []))} total={active.rows.length} />
                    <ConsumableRows label="Elixirs" entries={coverage(active.rows, (r) => r.elixirs)} total={active.rows.length} />
                    <TableRow>
                      <TableCell className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Food</TableCell>
                      <TableCell className="text-sm">Well Fed</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {active.rows.filter((r) => r.food).length}/{active.rows.length} pulls
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Weapon</TableCell>
                      <TableCell className="text-sm">Oil / stone / poison / imbue</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {active.rows.filter((r) => r.weaponBuff).length}/{active.rows.length} pulls
                      </TableCell>
                    </TableRow>
                    <ConsumableRows label="Potions" entries={coverage(active.rows, (r) => r.potions)} total={active.rows.length} mode="uses" rows={active.rows} />
                    {active.summary.drums > 0 && (
                      <TableRow>
                        <TableCell className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Drums</TableCell>
                        <TableCell className="text-sm">Drums cast for the group</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">×{active.summary.drums}</TableCell>
                      </TableRow>
                    )}
                    {active.summary.runes > 0 && (
                      <TableRow>
                        <TableCell className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Runes</TableCell>
                        <TableCell className="text-sm">Dark / Demonic Rune</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">×{active.summary.runes}</TableCell>
                      </TableRow>
                    )}
                    {active.summary.healthstones > 0 && (
                      <TableRow>
                        <TableCell className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Healthstone</TableCell>
                        <TableCell className="text-sm">Used in combat</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">×{active.summary.healthstones}</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Gear audit</CardTitle>
                <p className="text-xs text-muted-foreground">
                  From combatant info at the latest pull of this report.
                </p>
              </CardHeader>
              <CardContent>
                {active.summary.missingEnchants.length === 0 ? (
                  <p className="flex items-center gap-1.5 py-2 text-sm text-emerald-700">
                    <Check className="h-4 w-4" /> Every expected slot is enchanted.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm">
                      Missing permanent enchants on{" "}
                      <span className="font-medium">{active.summary.missingEnchants.join(", ")}</span>.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Freshly awarded items show up here until they&apos;re enchanted — worth a
                      nudge before the next raid.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function ConsumableRows({
  label,
  entries,
  total,
  mode = "pulls",
  rows,
}: {
  label: string;
  entries: Map<string, number>;
  total: number;
  mode?: "pulls" | "uses";
  rows?: WclPlayerFight[];
}) {
  if (entries.size === 0) {
    return (
      <TableRow>
        <TableCell className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</TableCell>
        <TableCell className="text-sm text-muted-foreground/60">none seen</TableCell>
        <TableCell className="text-right text-sm tabular-nums text-muted-foreground/60">0/{total} pulls</TableCell>
      </TableRow>
    );
  }
  // "uses" counts every cast (a pot can be used twice on long fights).
  const useCounts =
    mode === "uses" && rows
      ? new Map(
          [...entries.keys()].map((name) => [
            name,
            rows.reduce((sum, r) => sum + r.potions.filter((p) => p === name).length, 0),
          ]),
        )
      : undefined;
  return (
    <>
      {[...entries].map(([name, count], i) => (
        <TableRow key={name}>
          <TableCell className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {i === 0 ? label : ""}
          </TableCell>
          <TableCell className="text-sm">{name}</TableCell>
          <TableCell className="text-right text-sm tabular-nums">
            {useCounts ? `×${useCounts.get(name)}` : `${count}/${total} pulls`}
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}
