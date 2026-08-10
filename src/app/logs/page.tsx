import type { Metadata } from "next";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { Coins, ExternalLink, Sparkles, TriangleAlert } from "lucide-react";
import { getRepo } from "@/lib/data/repo";
import {
  emptyBoard,
  partiesFromLogs,
  poolFromPullRows,
  withRosterSpecs,
  type Board,
  type PoolMember,
  type RecoveredParty,
} from "@/lib/analysis/raid-planner";
import type {
  ConsumableAdjustment,
  ConsumablePrice,
  ImprovementSeverity,
  RaidReportView,
  SeasonReportInput,
  WclRole,
} from "@/lib/types";
import { costPerUseMap, effectivePrice, goldOfBreakdown } from "@/lib/wcl/consumable-prices";
import {
  adjustmentGold,
  adjustmentsFor,
  applyAdjustments,
} from "@/lib/analysis/consumable-adjustments";
import type { WowClass } from "@/lib/constants/wow";
import { PageHeader } from "@/components/page-header";
import { DeathProfiles } from "@/components/logs/death-profiles";
import { KpiCard } from "@/components/kpi-card";
import { EmptyState } from "@/components/empty-state";
import { RaidLogTabs } from "@/components/logs/raid-log-tabs";
import { RaidBoard } from "@/components/raid-planner/board";
import { ConsumableUsageTable } from "@/components/logs/consumable-usage-table";
import { ConsumableLeaderboard } from "@/components/logs/consumable-leaderboard";
import { ParseBoards } from "@/components/logs/parse-boards";
import { ConsumablePricePanel } from "@/components/logs/consumable-price-panel";
import { ConsumableAdjustmentsPanel } from "@/components/logs/consumable-adjustments-panel";
import { SeasonDashboard } from "@/components/logs/season-dashboard";
import { UptimeByBoss } from "@/components/logs/uptime-by-boss";
import { UptimeByPlayer } from "@/components/logs/uptime-by-player";
import { FightFilter } from "@/components/logs/fight-filter";
import { TotemTimeline } from "@/components/logs/totem-timeline";
import { CollapsibleCard } from "@/components/logs/collapsible-card";
import { BreakdownBadges, RankBadge, Raider } from "@/components/logs/rank-bits";
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

const ROLE_LABEL: Record<WclRole, string> = { tank: "Tank", healer: "Healer", dps: "DPS" };

function uptimeClass(pct: number): string {
  return pct >= 90 ? "text-success-ink" : pct < 60 ? "text-warn-ink" : "";
}

const SEVERITY_VARIANT: Record<ImprovementSeverity, "destructive" | "warning" | "muted"> = {
  high: "destructive",
  medium: "warning",
  low: "muted",
};

type WclReportList = Awaited<ReturnType<Awaited<ReturnType<typeof getRepo>>["listWclReports"]>>;

export default async function LogsPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const requested = Array.isArray(sp.report) ? sp.report[0] : sp.report;
  const seasonMode = requested === "all";

  const repo = await getRepo();
  const reports = await repo.listWclReports();

  let raid: RaidReportView | null = null;
  let priceOverrides: Record<string, ConsumablePrice> = {};
  let adjustments: ConsumableAdjustment[] = [];
  let seasonInputs: SeasonReportInput[] = [];
  let board: Board = emptyBoard();
  let pool: PoolMember[] = [];
  let recovered: RecoveredParty[] = [];

  if (seasonMode) {
    const built = await Promise.all(
      reports.map(async ({ report }): Promise<SeasonReportInput | null> => {
        const view = await repo.getRaidReport(report.code);
        if (!view) return null;
        const [overrides, reportAdjustments] = await Promise.all([
          repo.getReportConsumablePrices(report.code),
          repo.getReportConsumableAdjustments(report.code),
        ]);
        return {
          code: report.code,
          title: report.title,
          zone: report.zone ?? undefined,
          startTime: report.startTime,
          usage: view.usage,
          // The season rollup only needs night averages — drop the (heavy)
          // per-fight timeline breakdown before it crosses to the client.
          upkeep: view.upkeep.map((u) => ({ ...u, perFight: undefined })),
          overrides,
          adjustments: reportAdjustments,
        };
      }),
    );
    seasonInputs = built.filter((x): x is SeasonReportInput => x !== null);
  } else {
    raid = await repo.getRaidReport(requested);
    priceOverrides = raid ? await repo.getReportConsumablePrices(raid.report.code) : {};
    adjustments = raid ? await repo.getReportConsumableAdjustments(raid.report.code) : [];
    if (raid) {
      const code = raid.report.code;
      /*
       * The board tab needs every player's row, not this raider's — group
       * membership is only visible in who a party buff reached, which is
       * recorded against whoever cast it.
       */
      const rows = (
        await Promise.all(raid.fights.map((f) => repo.listPullRows(code, f.fightId)))
      ).flat();
      board = await repo.getRaidBoard(code);
      // The log says what each raider played; the roster also knows what they
      // *can* play, which is what makes "count him as his off-spec" possible.
      pool = withRosterSpecs(
        poolFromPullRows(rows),
        (await repo.listCharacters()).map((c) => ({
          name: c.character.name,
          spec: c.character.spec,
          offSpec: c.character.offSpec,
        })),
      );
      recovered = partiesFromLogs(rows);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Raid logs"
        description="Buff & debuff uptime, consumable and cooldown usage, and who to nudge — per raid night, or ranked across every raid."
      />

      {reports.length === 0 ? (
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
        <>
          <ReportPicker reports={reports} activeCode={seasonMode ? "all" : raid?.report.code} />
          {seasonMode ? (
            seasonInputs.length > 0 ? (
              <SeasonDashboard reports={seasonInputs} />
            ) : (
              <EmptyState
                title="Nothing to rank yet"
                description="The imported reports don't have per-player rows to aggregate. Re-fetch them once Warcraft Logs has finished parsing."
              />
            )
          ) : raid ? (
            <RaidDashboard
              raid={raid}
              priceOverrides={priceOverrides}
              adjustments={adjustments}
              board={board}
              pool={pool}
              recovered={recovered}
            />
          ) : (
            <EmptyState
              title="Report not found"
              description="That raid isn't imported. Pick another from the list above."
            />
          )}
        </>
      )}
    </div>
  );
}

/** Raid switcher: an "All raids" season option plus one pill per imported night. */
function ReportPicker({ reports, activeCode }: { reports: WclReportList; activeCode?: string }) {
  const pill = "rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-accent";
  const activePill = "border-foreground/30 bg-primary text-primary-foreground hover:bg-primary";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Link href="/logs?report=all" className={cn(pill, activeCode === "all" && activePill)}>
        All raids
      </Link>
      {reports.map(({ report: r }) => (
        <Link
          key={r.code}
          href={`/logs?report=${encodeURIComponent(r.code)}`}
          className={cn(pill, r.code === activeCode && activePill)}
        >
          {format(parseISO(r.startTime), "d MMM")} · {r.zone ?? r.title}
        </Link>
      ))}
    </div>
  );
}

function RaidDashboard({
  raid,
  priceOverrides,
  adjustments,
  board,
  pool,
  recovered,
}: {
  raid: RaidReportView;
  priceOverrides: Record<string, ConsumablePrice>;
  adjustments: ConsumableAdjustment[];
  board: Board;
  pool: PoolMember[];
  recovered: RecoveredParty[];
}) {
  const { report, session, prep, fights } = raid;
  // A flask and a battle+guardian pair are both a full set; one elixir is half
  // of one, and the coverage percentage alone can't tell them apart.
  const share = (n: number) => (prep.rows === 0 ? 0 : Math.round((n / prep.rows) * 100));
  const fullSets = share(prep.coverage.flask + prep.coverage.full);
  const halfSets = share(prep.coverage.partial);
  const counted = fights.filter((f) => !f.excluded);
  const kills = counted.filter((f) => f.kill).length;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            {report.title}
            {report.zone && <Badge variant="secondary">{report.zone}</Badge>}
          </CardTitle>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {format(parseISO(report.startTime), "EEE d MMM yyyy")} · {prep.raiders} raiders ·{" "}
            {kills}/{counted.length} bosses killed
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
          {/* The pull list doubles as the switch for which pulls count. */}
          <div className="mt-1">
            {/* Keyed per report: the filter holds the officer's pending
                selection in state, and a stale one would save this night's
                exclusions onto the next night opened. */}
            <FightFilter key={report.code} code={report.code} fights={fights} />
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <KpiCard
          label="Flask / elixirs"
          value={`${prep.flaskOrElixirPct}%`}
          sub={`${fullSets}% a full set, ${halfSets}% half`}
        />
        <KpiCard label="Food" value={`${prep.foodPct}%`} sub="Well Fed at pull" />
        <KpiCard label="Weapon buff" value={`${prep.weaponBuffPct}%`} sub="oil / stone / poison" />
        <KpiCard label="Pre-pots" value={`${prep.prepotPct}%`} sub={`${prep.prepots} pulls opened potted`} />
        <KpiCard label="Potions used" value={prep.potionsTotal} sub="combat potions, all raiders" />
        <KpiCard label="Sappers" value={prep.sappersTotal} sub="sapper charges thrown" />
      </div>

      {prep.unplacedElixirs.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Counted as covered but not placed in a battle or guardian slot:{" "}
          {prep.unplacedElixirs.map((e) => `${e.label} (${e.pulls})`).join(", ")}. Curate them in
          the consumable list and the half-filled sets beneath them can name which slot is empty.
        </p>
      )}

      <RaidLogTabs
        overview={<OverviewPanel raid={raid} />}
        rankings={<RankingsPanel raid={raid} overrides={priceOverrides} />}
        board={
          <GroupsPanel
            code={report.code}
            board={board}
            pool={pool}
            recovered={recovered}
          />
        }
        gold={<GoldPanel raid={raid} overrides={priceOverrides} adjustments={adjustments} />}
      />
    </>
  );
}

/**
 * Which groups the night was run in.
 *
 * Recorded rather than derived, and the panel says so: Warcraft Logs stores no
 * group assignments, so nothing here can be filled in automatically from the
 * import. What the log *does* give away is the odd party — Battle Shout and the
 * jewelcrafting necks are party-scoped and are emitted with a source and a
 * target — and that is what "Suggest from log" offers, as a draft to correct.
 */
function GroupsPanel({
  code,
  board,
  pool,
  recovered,
}: {
  code: string;
  board: Board;
  pool: PoolMember[];
  recovered: RecoveredParty[];
}) {
  if (pool.length === 0) {
    return (
      <EmptyState
        title="No players on this report"
        description="This raid has no per-player rows to arrange. Re-fetch it once Warcraft Logs has finished parsing."
      />
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Warcraft Logs doesn&apos;t record which group anyone stood in, so this is the
        officer&apos;s record — saved against this raid alone, never shared with another night or
        with a roster. The buffs it does log give some of it away, and a spec the log confirmed
        turns a &ldquo;?&rdquo; into a &ldquo;✓&rdquo; on its own.{" "}
        <Link
          href={`/raid-planner?board=${encodeURIComponent(code)}`}
          className="underline underline-offset-2"
        >
          Open it in the raid planner
        </Link>
        .
      </p>
      <RaidBoard
        // Remount per night. The board seeds its state (and its undo stack)
        // once on mount, so without this, switching reports leaves the previous
        // night's arrangement on screen under the new night's code — and the
        // autosave then writes it there, overwriting a real record with another
        // raid's. Same reason the raid planner keys it.
        key={`raid:${code}`}
        target={{ kind: "raid", code }}
        pool={pool}
        initial={board}
        recovered={recovered}
        note={`${pool.length} raiders logged on this night.`}
      />
    </div>
  );
}

function OverviewPanel({ raid }: { raid: RaidReportView }) {
  const { prep, upkeep, playerBuffs, totems, cooldowns, improvements, fights, deathProfiles } = raid;
  // Class per raider, so a name in the death list links like every other one.
  const classByActor = new Map(
    raid.usage.map((u) => [u.name, u.className as WowClass | undefined]),
  );
  // Excluded pulls feed nothing derived, so they get no timeline tab either.
  const counted = fights.filter((f) => !f.excluded);

  return (
    <>
      {/* Section 1: uptime — boss-by-boss and player-by-player, the full table folded below */}
      <UptimeByBoss fights={counted} upkeep={upkeep} reportStartTime={raid.report.startTime} />
      <UptimeByPlayer fights={counted} playerBuffs={playerBuffs} reportStartTime={raid.report.startTime} />
      <TotemTimeline fights={counted} totems={totems} />
      {upkeep.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Buff &amp; debuff uptime</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="py-1 text-sm text-muted-foreground">
              No tracked debuffs/buffs in this report. Re-import reports from before uptime
              tracking to backfill.
            </p>
          </CardContent>
        </Card>
      ) : (
        <CollapsibleCard
          title={<>Buff &amp; debuff uptime — night averages</>}
          description="Maintained raid debuffs (on the boss) and self/assigned buffs, averaged across the night per provider. Boss debuffs first."
        >
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
        </CollapsibleCard>
      )}

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
            <p className="text-xs text-muted-foreground">
              Everything consumed mid-fight, by type — sappers included. Click a row to see which
              raiders used it and how many they threw.
            </p>
          </CardHeader>
          <CardContent>
            <ConsumableUsageTable potions={prep.potionTypes} items={prep.inFightTypes} />
          </CardContent>
        </Card>
      </div>

      {/* Section 3: why we struggle on a boss — when people die, not how many */}
      <Card>
        <CardHeader>
          <CardTitle>Where the pulls break down</CardTitle>
          <p className="text-xs text-muted-foreground">
            Bosses that cost the most, hardest first. A count says the raid loses people; when they
            go says whether it&apos;s an opener nobody survives or attrition late on. What killed
            them isn&apos;t in the data — that part is yours.
          </p>
        </CardHeader>
        <CardContent>
          <DeathProfiles
            profiles={deathProfiles}
            wowClassOf={(name) => classByActor.get(name)}
          />
        </CardContent>
      </Card>

      {/* Section 4: player improvements */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TriangleAlert className="h-4 w-4 text-warn-ink" />
            Player improvements
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Preparation gaps this night, worst first — missing enchants, flask/food, and skipped
            potions. The pre-raid nudge list.
          </p>
        </CardHeader>
        <CardContent>
          {improvements.length === 0 ? (
            <p className="flex items-center gap-1.5 py-2 text-sm text-success-ink">
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

function RankingsPanel({
  raid,
  overrides,
}: {
  raid: RaidReportView;
  overrides: Record<string, ConsumablePrice>;
}) {
  const { usage, upkeep } = raid;
  const cooldownLeaders = [...usage]
    .filter((u) => u.cooldowns > 0)
    .sort((a, b) => b.cooldowns - a.cooldowns || a.name.localeCompare(b.name));

  // In-fight items thrown this raid drive the (precise) gold toggle here.
  const itemNames = new Set(usage.flatMap((u) => u.itemBreakdown.map((b) => b.name)));
  const costPerUse = costPerUseMap(itemNames, overrides);
  const usingDefault = Object.keys(overrides).length === 0;

  return (
    <>
      <ParseBoards boards={raid.parseBoards} />
      {raid.parseBoards.length > 0 && !raid.parseBoards.some((b) => b.bossMetric) && (
        <p className="text-xs text-muted-foreground">
          No boss-damage parses in this report, so the boards show all damage only — boss damage
          was added to the importer after this report was fetched. Re-import it on the{" "}
          <Link
            href="/admin/import?tab=wcl"
            className="font-medium text-foreground underline-offset-2 hover:underline"
          >
            Warcraft Logs tab
          </Link>{" "}
          to fill the board in.
        </p>
      )}

      <ConsumableLeaderboard rows={usage} costPerUse={costPerUse} usingDefault={usingDefault} />

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-info-ink" />
              Cooldown usage
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Most major class cooldowns pressed across the night, with the breakdown.
            </p>
          </CardHeader>
          <CardContent>
            {cooldownLeaders.length === 0 ? (
              <p className="py-1 text-sm text-muted-foreground">No tracked cooldowns cast.</p>
            ) : (
              <Table>
                <TableBody>
                  {cooldownLeaders.map((u, i) => (
                    <TableRow key={u.name}>
                      <TableCell className="w-8">
                        <RankBadge rank={i + 1} />
                      </TableCell>
                      <TableCell>
                        <Raider name={u.name} slug={u.slug} className={u.className} />
                      </TableCell>
                      <TableCell className="w-14 text-right text-sm font-semibold tabular-nums">
                        ×{u.cooldowns}
                      </TableCell>
                      <TableCell>
                        <BreakdownBadges items={u.cooldownBreakdown} />
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
            <CardTitle>Uptime leaders</CardTitle>
            <p className="text-xs text-muted-foreground">
              Best-maintained raid debuffs and buffs — the top keeper for each track this night.
            </p>
          </CardHeader>
          <CardContent>
            {upkeep.length === 0 ? (
              <p className="py-1 text-sm text-muted-foreground">No tracked debuffs/buffs in this report.</p>
            ) : (
              <Table>
                <TableBody>
                  {upkeep.map((u) => {
                    const top = u.providers[0];
                    return (
                      <TableRow key={u.name}>
                        <TableCell className="text-sm font-medium">
                          {u.name}
                          {u.kind === "debuff" && (
                            <span className="ml-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                              on boss
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {top ? (
                            <Raider name={top.name} slug={top.slug} className={u.className} />
                          ) : (
                            <span className="text-muted-foreground/50">—</span>
                          )}
                        </TableCell>
                        <TableCell
                          className={cn("w-16 text-right text-sm font-medium tabular-nums", uptimeClass(u.bestPct))}
                        >
                          {u.bestPct}%
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function GoldPanel({
  raid,
  overrides,
  adjustments,
}: {
  raid: RaidReportView;
  overrides: Record<string, ConsumablePrice>;
  adjustments: ConsumableAdjustment[];
}) {
  const { usage } = raid;
  // Union of every consumable this raid touched — in-fight casts + prep buffs.
  const names = new Set<string>();
  for (const u of usage) {
    for (const b of u.itemBreakdown) names.add(b.name);
    for (const b of u.prepBreakdown) names.add(b.name);
  }
  // A hand-added consumable needs a price too, even if nobody was logged using it.
  for (const a of adjustments) names.add(a.name);
  const costPerUse = costPerUseMap(names, overrides);
  const usingDefault = Object.keys(overrides).length === 0;
  const priceRows = [...names].sort().map((name) => ({ name, price: effectivePrice(name, overrides) }));

  const goldOfName = (n: string, count: number) => (costPerUse[n] ?? 0) * count;
  const ranked = usage
    .map((u) => {
      const inFight = goldOfBreakdown(u.itemBreakdown, costPerUse);
      const prep = goldOfBreakdown(u.prepBreakdown, costPerUse);
      // Merge both breakdowns for the "includes" column, then let the officer's
      // corrections move the counts. The logged in-fight/prep columns stay as
      // the log reported them, so the adjustment column shows exactly what a
      // person changed rather than hiding it inside a bigger number.
      const logged = [...u.itemBreakdown, ...u.prepBreakdown];
      const mine = adjustmentsFor(adjustments, u.name);
      const adjusted = applyAdjustments(logged, mine);
      const delta = adjustmentGold(logged, adjusted, costPerUse);
      const lines = adjusted
        .filter((it) => goldOfName(it.name, it.count) > 0 || it.delta !== undefined)
        .sort((a, b) => goldOfName(b.name, b.count) - goldOfName(a.name, a.count));
      return { u, inFight, prep, delta, total: inFight + prep + delta, lines, adjusted: mine.length };
    })
    .filter((x) => x.total > 0 || x.adjusted > 0)
    .sort((a, b) => b.total - a.total || a.u.name.localeCompare(b.u.name));

  const raidTotal = ranked.reduce((s, x) => s + x.total, 0);
  const adjustmentTotal = ranked.reduce((s, x) => s + x.delta, 0);
  const anyAdjusted = ranked.some((x) => x.adjusted > 0);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <Coins className="h-4 w-4 text-warn" />
            Total gold spent
            <span className="text-sm font-normal text-muted-foreground">
              ≈ {Math.round(raidTotal).toLocaleString("en-US")}g across the raid
            </span>
            {anyAdjusted && adjustmentTotal !== 0 && (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-medium",
                  adjustmentTotal > 0 ? "bg-warn-fill text-warn-ink" : "bg-success-fill text-success-ink",
                )}
                title="Net change from this raid's manual adjustments — listed in full below"
              >
                {adjustmentTotal > 0 ? "+" : "−"}
                {Math.abs(Math.round(adjustmentTotal)).toLocaleString("en-US")}g adjusted
              </span>
            )}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Estimated gold per raider across everything — in-fight potions/sappers plus prep buffs
            (flask, elixirs, food, weapon stone, scrolls, Flame Cap). Prep buffs scale with raid
            length and deaths: a buff held from an early to a late pull on a night longer than it
            lasts is re-bought (a flask ≈ ×2 past 2 hours), and consumed buffs add one per death.
            {usingDefault && (
              <span className="ml-1 inline-flex items-center gap-1 text-warn-ink">
                <TriangleAlert className="h-3 w-3" /> using default prices — set this raid&apos;s
                below.
              </span>
            )}
          </p>
        </CardHeader>
        <CardContent>
          {ranked.length === 0 ? (
            <p className="py-1 text-sm text-muted-foreground">No priced consumables this raid.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Raider</TableHead>
                  <TableHead className="w-20 text-right">In-fight</TableHead>
                  <TableHead className="w-16 text-right">Prep</TableHead>
                  {anyAdjusted && (
                    <TableHead className="w-20 text-right" title="Net gold from manual adjustments">
                      Adjusted
                    </TableHead>
                  )}
                  <TableHead className="w-20 text-right">Total</TableHead>
                  <TableHead>Includes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ranked.map(({ u, inFight, prep, delta, total, lines }, i) => (
                  <TableRow key={u.name} className={cn(i === 0 && "bg-warn-soft/70 hover:bg-warn-soft/70")}>
                    <TableCell>
                      <RankBadge rank={i + 1} />
                    </TableCell>
                    <TableCell>
                      <Raider name={u.name} slug={u.slug} className={u.className} />
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                      {Math.round(inFight).toLocaleString("en-US")}g
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                      {Math.round(prep).toLocaleString("en-US")}g
                    </TableCell>
                    {anyAdjusted && (
                      <TableCell
                        className={cn(
                          "text-right text-sm tabular-nums",
                          delta === 0
                            ? "text-muted-foreground/40"
                            : delta > 0
                              ? "text-warn-ink"
                              : "text-success-ink",
                        )}
                      >
                        {delta === 0
                          ? "—"
                          : `${delta > 0 ? "+" : "−"}${Math.abs(Math.round(delta)).toLocaleString("en-US")}g`}
                      </TableCell>
                    )}
                    <TableCell className="text-right text-sm font-semibold tabular-nums">
                      {Math.round(total).toLocaleString("en-US")}g
                    </TableCell>
                    <TableCell>
                      <BreakdownBadges items={lines} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ConsumableAdjustmentsPanel
        key={`adj-${raid.report.code}`}
        code={raid.report.code}
        adjustments={adjustments}
        raiders={usage.map((u) => u.name).sort((a, b) => a.localeCompare(b))}
        consumables={[...names].sort((a, b) => a.localeCompare(b))}
        goldDelta={adjustmentTotal}
      />

      <ConsumablePricePanel
        key={raid.report.code}
        code={raid.report.code}
        rows={priceRows}
        usingDefault={usingDefault}
      />
    </>
  );
}
