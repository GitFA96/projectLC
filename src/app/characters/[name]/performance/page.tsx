import type * as React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { format, parseISO } from "date-fns";
import { ArrowLeft, Check, ExternalLink, X } from "lucide-react";
import { getRepo } from "@/lib/data/repo";
import { attendanceTitle } from "@/lib/analysis/performance";
import { cooldownsForClass, uptimeTracksForClass } from "@/lib/wcl/class-tracks";
import { CLASS_TEXT_COLORS } from "@/lib/constants/wow";
import type { PerformanceReportView, WclPlayerFight } from "@/lib/types";
import { FightRows } from "@/components/performance/fight-rows";
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

/** Total uses per label (a pot can be used twice on a long pull). */
function usesOf(rows: WclPlayerFight[], pick: (r: WclPlayerFight) => string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const label of pick(row)) {
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return counts;
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
  const { character, reports, career, attendance } = perf;

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
            {attendance && attendance.raidsAttended > 0 && (
              <Badge
                variant={attendance.raidPct < 50 ? "warning" : "secondary"}
                title={attendanceTitle(attendance)}
              >
                {attendance.raidPct}% attendance
              </Badge>
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
                <span
                  title={
                    active.rows.length < active.reportPulls
                      ? "Missing pulls usually mean a late join or early leave"
                      : undefined
                  }
                >
                  · present for {active.rows.length} of {active.reportPulls} boss pulls
                </span>
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
                    <TableHead className="w-6" />
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
                    <TableHead className="w-16" title="Consumables used during the pull — potions, healthstones, runes, mana gems, seeds, drums (pre-pot shown as +)">
                      Used
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <FightRows
                    colSpan={10}
                    rows={active.rows.map((row) => ({
                      id: row.id,
                      detail: fightDetail(row),
                      cells: (
                        <>
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
                            {row.potions.length + row.otherCasts.length > 0 || row.prepot ? (
                              <span
                                title={[...(row.prepot ? ["pre-pot"] : []), ...row.potions, ...row.otherCasts].join(", ")}
                              >
                                {row.potions.length + row.otherCasts.length}
                                {row.prepot && <span className="text-emerald-600">+</span>}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/50">0</span>
                            )}
                          </TableCell>
                        </>
                      ),
                    }))}
                  />
                </TableBody>
              </Table>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Parses are Warcraft Logs percentiles (healers on HPS, tanks within the tank
                bracket); wipes don&apos;t parse. A <span className="text-emerald-600">+</span> in
                Used means a pre-pot was already running at the pull. Click a row for the
                pull&apos;s items, cooldowns and upkeep.
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
                    <ConsumableRows label="Scrolls" entries={coverage(active.rows, (r) => r.scrolls)} total={active.rows.length} />
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
                    <ConsumableRows
                      label="Potions"
                      entries={coverage(active.rows, (r) => r.potions)}
                      total={active.rows.length}
                      uses={usesOf(active.rows, (r) => r.potions)}
                    />
                    <ConsumableRows
                      label="In-fight items"
                      entries={coverage(active.rows, (r) => r.otherCasts)}
                      total={active.rows.length}
                      uses={usesOf(active.rows, (r) => r.otherCasts)}
                    />
                    {active.rows.some((r) => r.extras.length > 0) && (
                      <ConsumableRows
                        label="Other buffs"
                        entries={coverage(active.rows, (r) => r.extras)}
                        total={active.rows.length}
                      />
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <ToolkitCard rows={active.rows} />

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

/** "Haste Potion ×2 · Master Healthstone" from a list with repeats. */
function countedList(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, n]) => (n > 1 ? `${name} ×${n}` : name))
    .join(" · ");
}

function UpkeepPct({ pct }: { pct: number }) {
  return (
    <span
      className={cn(
        "font-medium tabular-nums",
        pct >= 90 ? "text-emerald-700" : pct < 60 ? "text-amber-600" : undefined,
      )}
    >
      {pct}%
    </span>
  );
}

/** Expanded per-pull detail: items used, cooldowns cast, maintained uptime. */
function fightDetail(row: WclPlayerFight): React.ReactNode {
  const items = [...row.potions, ...row.otherCasts];
  const trackedCds = cooldownsForClass(row.className);
  const trackedUptime = uptimeTracksForClass(row.className);
  const hasAnything =
    items.length > 0 || row.prepot || row.cooldowns.length > 0 || row.upkeep.length > 0 ||
    trackedCds.length > 0 || trackedUptime.length > 0;
  if (!hasAnything) return null;

  return (
    <div className="grid gap-x-8 gap-y-2 text-xs sm:grid-cols-3">
      <div>
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Items used
        </p>
        <p className="mt-0.5">
          {row.prepot && <span className="text-emerald-700">pre-pot · </span>}
          {items.length > 0 ? (
            countedList(items)
          ) : row.prepot ? null : (
            <span className="text-muted-foreground/60">none</span>
          )}
        </p>
      </div>
      <div>
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Cooldowns
        </p>
        <p className="mt-0.5">
          {row.cooldowns.length > 0 ? (
            countedList(row.cooldowns)
          ) : (
            <span className="text-muted-foreground/60">
              {trackedCds.length > 0 ? "none of the tracked cooldowns used" : "—"}
            </span>
          )}
        </p>
      </div>
      <div>
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Upkeep
        </p>
        {row.upkeep.length > 0 ? (
          <p className="mt-0.5 space-x-2">
            {row.upkeep.map((u) => (
              <span key={u.name} className="inline-block whitespace-nowrap">
                {u.name} <UpkeepPct pct={u.pct} />
              </span>
            ))}
          </p>
        ) : (
          <p className="mt-0.5 text-muted-foreground/60">
            {trackedUptime.length > 0 ? "no tracked debuff/buff upkeep detected" : "—"}
          </p>
        )}
      </div>
    </div>
  );
}

/** Pull-length-weighted average upkeep per label across the report's pulls. */
function upkeepAverages(rows: WclPlayerFight[]): Map<string, number> {
  const labels = [...new Set(rows.flatMap((r) => r.upkeep.map((u) => u.name)))];
  const totalDur = rows.reduce((s, r) => s + r.durationMs, 0);
  return new Map(
    labels
      .map((label): [string, number] => {
        const weighted = rows.reduce(
          (s, r) => s + (r.upkeep.find((u) => u.name === label)?.pct ?? 0) * r.durationMs,
          0,
        );
        return [label, Math.round(weighted / Math.max(1, totalDur))];
      })
      .sort((a, b) => b[1] - a[1]),
  );
}

function ToolkitCard({ rows }: { rows: WclPlayerFight[] }) {
  const cooldownTotals = usesOf(rows, (r) => r.cooldowns);
  const upkeep = upkeepAverages(rows);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cooldowns &amp; upkeep this report</CardTitle>
        <p className="text-xs text-muted-foreground">
          The class toolkit: major cooldowns cast, and the debuffs/buffs this player kept
          running. Pulls missing an upkeep drag its average down.
        </p>
      </CardHeader>
      <CardContent>
        {cooldownTotals.size === 0 && upkeep.size === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            Nothing tracked in this report. Reports imported before cooldown/upkeep tracking
            existed need a re-import to backfill.
          </p>
        ) : (
          <Table>
            <TableBody>
              {[...cooldownTotals].map(([name, count], i) => (
                <TableRow key={name}>
                  <TableCell className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {i === 0 ? "Cooldowns" : ""}
                  </TableCell>
                  <TableCell className="text-sm">{name}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">×{count}</TableCell>
                </TableRow>
              ))}
              {[...upkeep].map(([name, pct], i) => (
                <TableRow key={name}>
                  <TableCell className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {i === 0 ? "Upkeep" : ""}
                  </TableCell>
                  <TableCell className="text-sm">{name}</TableCell>
                  <TableCell className="text-right text-sm">
                    <UpkeepPct pct={pct} /> <span className="text-xs text-muted-foreground">avg</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function ConsumableRows({
  label,
  entries,
  total,
  uses,
}: {
  label: string;
  entries: Map<string, number>;
  total: number;
  /** When given, rows show total uses (×n) instead of pull coverage. */
  uses?: Map<string, number>;
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
  return (
    <>
      {[...entries].map(([name, count], i) => (
        <TableRow key={name}>
          <TableCell className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {i === 0 ? label : ""}
          </TableCell>
          <TableCell className="text-sm">{name}</TableCell>
          <TableCell className="text-right text-sm tabular-nums">
            {uses ? `×${uses.get(name) ?? count}` : `${count}/${total} pulls`}
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}
