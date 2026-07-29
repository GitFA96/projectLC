import type * as React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { format, parseISO } from "date-fns";
import { ArrowLeft, Check, ExternalLink, X } from "lucide-react";
import { getRepo } from "@/lib/data/repo";
import { attendanceTitle } from "@/lib/analysis/performance";
import { ENCHANTABLE_GEAR_SLOTS } from "@/lib/wcl/consumables";
import { cooldownsForClass, uptimeTracksForClass } from "@/lib/wcl/class-tracks";
import {
  GEAR_SLOT_LABELS,
  P2_ENCHANT_GUIDE,
  wowheadEnchantSearchUrl,
  wowheadItemUrl,
} from "@/lib/wcl/enchants";
import { CLASS_TEXT_COLORS, QUALITY_TEXT_COLORS } from "@/lib/constants/wow";
import { itemDisplayName, normalizeIcon } from "@/lib/items/item-data";
import {
  gradeEnchant,
  type EnchantGrade,
  type EnchantReference,
  type EnchantRef,
} from "@/lib/analysis/enchants";
import type { GearSet, Item, PerformanceReportView, Quality, WclPlayerFight, WowClass } from "@/lib/types";
import { FightRows } from "@/components/performance/fight-rows";
import { FightGraphPanel } from "@/components/performance/fight-graph";
import { PerformanceTabs } from "@/components/performance/performance-tabs";
import { AttendanceWeeks } from "@/components/performance/attendance-weeks";
import { ItemIcon } from "@/components/item-icon";
import { SpecBadge } from "@/components/spec-badge";
import { WeekDots } from "@/components/week-dots";
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
  const [items, enchants, bundle] = await Promise.all([
    repo.listItems(),
    repo.getEnchantReference(),
    repo.getCharacterBundle(decodeURIComponent(name)),
  ]);
  const itemsById = new Map(items.map((i) => [i.id, i] as const));
  // Their own lists, active phase first — the enchant grading's first choice.
  const ownWishlists = (bundle?.wishlists ?? []).map((w) => w.set);

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
            <ClassBadge wowClass={character.class} />
            <SpecBadge
              spec={career?.spec ?? character.spec}
              wowClass={character.class}
              title={career?.spec ? "Spec from their logged pulls" : "Roster spec (no logged spec yet)"}
              className="text-sm"
            />
            <RoleBadge role={character.role} />
            {career && (
              <span className="text-xs">
                {career.fights} pulls over {reports.length} report{reports.length === 1 ? "" : "s"} ·
                career median parse <ParseBadge pct={career.medianParse} /> · best{" "}
                <ParseBadge pct={career.bestParse} />
              </span>
            )}
            {attendance && attendance.raidsAttended > 0 && (
              <>
                <Badge
                  variant={attendance.raidPct < 50 ? "warning" : "secondary"}
                  title={attendanceTitle(attendance)}
                >
                  raided {attendance.weeksAttended}/{attendance.weeksTracked} reset weeks
                </Badge>
                <WeekDots weeks={attendance.weeks} />
              </>
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

          <PerformanceTabs
            overview={
              <>
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {active.report.title}
                {active.report.zone && <Badge variant="secondary">{active.report.zone}</Badge>}
                {active.summary.spec && (
                  <span className="text-xs font-normal text-muted-foreground">
                    played as{" "}
                    <SpecBadge
                      spec={active.summary.spec}
                      wowClass={character.class}
                      title="Spec in this report's pulls"
                    />
                  </span>
                )}
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
                    <TableHead className="w-14" title="Flask or at least one elixir at pull">Flask</TableHead>
                    <TableHead className="w-14" title="Well Fed at pull">Food</TableHead>
                    <TableHead className="w-16" title="Consumables used during the pull — potions, healthstones, runes, mana gems, seeds, drums, sapper charges (pre-pot shown as +)">
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
                            {row.spec && row.spec !== active.summary.spec && (
                              <SpecBadge
                                spec={row.spec}
                                wowClass={character.class}
                                title="Played a different spec on this pull"
                                className="ml-2"
                              />
                            )}
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
                              ok={row.flask !== undefined || row.elixirs.length >= 1}
                              title={row.flask ?? (row.elixirs.length > 0 ? row.elixirs.join(" + ") : "no flask or elixirs")}
                            />
                          </TableCell>
                          <TableCell>
                            <Mark ok={row.food} />
                          </TableCell>
                          <TableCell className="text-sm tabular-nums">
                            {row.potions.length + row.otherCasts.length + row.sappers > 0 || row.prepot ? (
                              <span
                                title={[
                                  ...(row.prepot ? ["pre-pot"] : []),
                                  ...row.potions,
                                  ...row.otherCasts,
                                  ...(row.sappers > 0 ? [`sapper ×${row.sappers}`] : []),
                                ].join(", ")}
                              >
                                {row.potions.length + row.otherCasts.length + row.sappers}
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

          {attendance && attendance.weeks.length > 0 && (
            <AttendanceWeeks characterId={character.id} attendance={attendance} />
          )}

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
                    {active.summary.sappers > 0 && (
                      <TableRow>
                        <TableCell className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sappers</TableCell>
                        <TableCell className="text-sm">Sapper charges thrown</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">×{active.summary.sappers}</TableCell>
                      </TableRow>
                    )}
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
          </div>

          <GearPanel
            rows={active.rows}
            missingEnchants={active.summary.missingEnchants}
            itemsById={itemsById}
            wowClass={character.class}
            ownWishlists={ownWishlists}
            enchants={enchants}
          />
              </>
            }
            graph={
              <FightGraphPanel
                code={active.report.code}
                actorName={active.rows[0]?.actorName ?? character.name}
                fights={[...active.rows]
                  .sort((a, b) => a.fightId - b.fightId)
                  .map((r) => ({
                    fightId: r.fightId,
                    encounterName: r.encounterName,
                    kill: r.kill,
                    fightPercentage: r.fightPercentage,
                  }))}
              />
            }
          />
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
  const sapperEntries = Array<string>(row.sappers).fill("Sapper charge");
  const items = [...row.potions, ...row.otherCasts, ...sapperEntries];
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

/**
 * External Wowhead-linked item (worn gear and gems live outside the item
 * pages). The hover tooltip is given the enchant and the socketed gems, so it
 * renders the item exactly as it was worn — which is the only place an
 * enchant's real name shows up: Wowhead has no page for enchantment ids.
 */
function WornItemLink({
  gearItem,
  cached,
  size = 20,
}: {
  gearItem: { id: number; name?: string; icon?: string; quality?: Quality; enchant?: number; gems?: { id: number }[] };
  cached?: Item;
  size?: number;
}) {
  const name = itemDisplayName(gearItem.id, gearItem.name, cached?.name);
  const quality = gearItem.quality ?? cached?.quality;
  const gems = (gearItem.gems ?? []).map((g) => g.id).join(":");
  const tooltip = [
    `item=${gearItem.id}`,
    gearItem.enchant !== undefined ? `ench=${gearItem.enchant}` : undefined,
    gems ? `gems=${gems}` : undefined,
    "domain=tbc",
  ]
    .filter(Boolean)
    .join("&");
  return (
    <a
      href={wowheadItemUrl(gearItem.id)}
      target="_blank"
      rel="noreferrer"
      data-wowhead={tooltip}
      className="inline-flex min-w-0 items-center gap-1.5 hover:underline"
    >
      <ItemIcon
        icon={normalizeIcon(gearItem.icon) ?? cached?.icon}
        quality={quality ?? "common"}
        size={size}
      />
      <span
        className="truncate text-sm font-medium"
        style={quality ? { color: QUALITY_TEXT_COLORS[quality] } : undefined}
      >
        {name}
      </span>
    </a>
  );
}

/**
 * One socketed gem: its icon comes from the log, its name from the item cache
 * (filled by the import page's backfill). An unnamed gem shows its id rather
 * than a fake name — the icon and the hover tooltip still identify it.
 */
function GemChip({ gem, cached }: { gem: { id: number; icon?: string }; cached?: Item }) {
  const quality = cached?.quality;
  return (
    <a
      href={wowheadItemUrl(gem.id)}
      target="_blank"
      rel="noreferrer"
      data-wowhead={`item=${gem.id}&domain=tbc`}
      className="inline-flex min-w-0 items-center gap-1 hover:underline"
      title={cached?.name ?? `Gem ${gem.id} — hover for the Wowhead tooltip`}
    >
      <ItemIcon icon={normalizeIcon(gem.icon) ?? cached?.icon} quality={quality ?? "common"} size={16} />
      {cached?.name ? (
        <span
          className="truncate text-xs"
          style={quality ? { color: QUALITY_TEXT_COLORS[quality] } : undefined}
        >
          {cached.name}
        </span>
      ) : (
        <span className="truncate text-xs tabular-nums text-muted-foreground">#{gem.id}</span>
      )}
    </a>
  );
}

/**
 * The enchant on a worn item, named and judged.
 *
 * Names come from the guild's own imported sets (the only source that maps an
 * enchantment id to a name — see lib/analysis/enchants), and the verdict is
 * only ever stated against a real reference: the raider's own list, or what
 * their class's other lists picked for that slot. An enchant nobody's list has
 * named stays an id rather than becoming a guess.
 */
function EnchantCell({ grade, itemsById }: { grade: EnchantGrade; itemsById: Map<number, Item> }) {
  const { verdict, worn, wanted, source, agreement } = grade;

  if (verdict === "not-enchantable") return <span className="text-muted-foreground/50">—</span>;

  if (verdict === "missing") {
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium text-destructive">missing</span>
        {wanted && (
          <span className="text-xs text-muted-foreground">
            wants <EnchantName enchant={wanted} itemsById={itemsById} />
            <SourceNote source={source} agreement={agreement} />
          </span>
        )}
      </span>
    );
  }

  if (!worn) return <span className="text-muted-foreground/50">—</span>;

  // An id nobody's list has named yet: say exactly that, and point at the fix.
  if (!worn.name) {
    return (
      <span
        className="text-xs text-muted-foreground"
        title="No imported set names this enchant. Hover the item for Wowhead's tooltip, or import a set that uses it."
      >
        unnamed enchant <span className="tabular-nums">#{worn.id}</span>
      </span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <EnchantName enchant={worn} itemsById={itemsById} />
      {verdict === "bis" && (
        <Badge variant="success" className="font-normal">
          BiS
          <SourceNote source={source} agreement={agreement} />
        </Badge>
      )}
      {verdict === "off-bis" && wanted && (
        <span className="text-xs text-amber-700">
          list wants <EnchantName enchant={wanted} itemsById={itemsById} />
          <SourceNote source={source} agreement={agreement} />
        </span>
      )}
    </span>
  );
}

/** Enchant name with the icon of the item that applies it, when there is one. */
function EnchantName({ enchant, itemsById }: { enchant: EnchantRef; itemsById: Map<number, Item> }) {
  const cached = enchant.itemId !== undefined ? itemsById.get(enchant.itemId) : undefined;
  const label = enchant.name || `#${enchant.id}`;
  return (
    <a
      href={
        enchant.itemId !== undefined ? wowheadItemUrl(enchant.itemId) : wowheadEnchantSearchUrl(label)
      }
      target="_blank"
      rel="noreferrer"
      {...(enchant.itemId !== undefined ? { "data-wowhead": `item=${enchant.itemId}&domain=tbc` } : {})}
      className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
    >
      {cached?.icon && <ItemIcon icon={cached.icon} quality={cached.quality ?? "common"} size={14} />}
      <span>{label}</span>
    </a>
  );
}

/** Where a "wants" came from — their list, or how many of the class's lists agree. */
function SourceNote({
  source,
  agreement,
}: {
  source?: "own-list" | "guild-lists";
  agreement?: { sets: number; totalSets: number };
}) {
  if (source === "own-list") return <span className="ml-1 opacity-70">(their list)</span>;
  if (source === "guild-lists" && agreement) {
    return (
      <span className="ml-1 opacity-70">
        ({agreement.sets}/{agreement.totalSets} class lists)
      </span>
    );
  }
  return null;
}

function GearPanel({
  rows,
  missingEnchants,
  itemsById,
  wowClass,
  ownWishlists,
  enchants,
}: {
  rows: WclPlayerFight[];
  missingEnchants: string[];
  itemsById: Map<number, Item>;
  wowClass: WowClass;
  /** The character's own wishlists — the first reference for "is this BiS". */
  ownWishlists: GearSet[];
  enchants: EnchantReference;
}) {
  // Rows are in pull order; the last snapshot is what they currently wear.
  const latest = [...rows].reverse().find((r) => r.gear.length > 0);
  const expectedEnchant = new Set(ENCHANTABLE_GEAR_SLOTS.map((s) => s.index));
  const bySlot = new Map((latest?.gear ?? []).map((g) => [g.slot, g] as const));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Gear worn{latest ? ` on ${latest.encounterName}` : ""}</CardTitle>
        <p className="text-xs text-muted-foreground">
          {missingEnchants.length === 0 ? (
            <span className="inline-flex items-center gap-1 text-emerald-700">
              <Check className="h-3.5 w-3.5" /> Every expected slot carries a permanent enchant.
            </span>
          ) : (
            <>
              Missing permanent enchants on{" "}
              <span className="font-medium text-foreground">{missingEnchants.join(", ")}</span> —
              worth a nudge before next raid (freshly awarded items show here until enchanted).
            </>
          )}
        </p>
      </CardHeader>
      <CardContent>
        {!latest ? (
          <p className="py-2 text-sm text-muted-foreground">
            No gear snapshot stored for this report — imports from before gear tracking only kept
            the enchant audit. Re-import the report to capture items, enchants and gems.
          </p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Slot</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="w-16 text-right">ilvl</TableHead>
                  <TableHead className="w-56">Enchant</TableHead>
                  <TableHead>Gems</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {GEAR_SLOT_LABELS.flatMap(({ index, label }) => {
                  const g = bySlot.get(index);
                  if (!g) return [];
                  const isWeapon = index === 15;
                  const expectsEnchant = expectedEnchant.has(index);
                  return [
                    <TableRow key={index}>
                      <TableCell
                        className={cn(
                          "text-xs uppercase tracking-wide text-muted-foreground",
                          isWeapon && "font-semibold text-foreground",
                        )}
                      >
                        {label}
                      </TableCell>
                      <TableCell>
                        <WornItemLink gearItem={g} cached={itemsById.get(g.id)} />
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                        {g.ilvl ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        <EnchantCell
                          grade={gradeEnchant({
                            slotIndex: index,
                            wornEnchantId: g.enchant,
                            enchantable: expectsEnchant,
                            wowClass,
                            ownWishlists,
                            reference: enchants,
                          })}
                          itemsById={itemsById}
                        />
                        {isWeapon && (
                          <p
                            className={cn(
                              "mt-0.5 text-xs",
                              g.temp !== undefined ? "text-emerald-700" : "font-medium text-amber-600",
                            )}
                          >
                            {g.temp !== undefined
                              ? "temp buff up at the last pull"
                              : "no temp buff at the last pull"}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        {g.gems.length > 0 ? (
                          <span className="flex flex-col gap-0.5">
                            {g.gems.map((gem, i) => (
                              <GemChip key={`${gem.id}-${i}`} gem={gem} cached={itemsById.get(gem.id)} />
                            ))}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/50">—</span>
                        )}
                      </TableCell>
                    </TableRow>,
                  ];
                })}
              </TableBody>
            </Table>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Enchants are named — and judged — from the guild&apos;s own imported SixtyUpgrades
              sets: they list each slot&apos;s enchant with the same id the logs report, so a set
              names that enchant in <em>everyone&apos;s</em> logs and says what this slot should
              have. BiS means it matches the reference shown next to it. An enchant no imported set
              has named stays an id: hover the item for Wowhead&apos;s tooltip, which renders it
              with this enchant and these gems applied. Importing more lists names more of them.
              The log doesn&apos;t carry socket counts, so an empty socket is invisible here:
              compare the gems column against the tooltip&apos;s sockets.
            </p>
          </>
        )}
        <details className="mt-3 rounded-md border bg-muted/30 p-2.5 text-xs">
          <summary className="cursor-pointer font-medium">
            Phase 2 enchant reference — what good looks like right now
          </summary>
          <ul className="mt-2 space-y-1">
            {P2_ENCHANT_GUIDE.map((row) => (
              <li key={row.slot}>
                <span className="font-medium">{row.slot}:</span>{" "}
                <span className="text-muted-foreground">{row.picks}</span>
              </li>
            ))}
          </ul>
        </details>
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
