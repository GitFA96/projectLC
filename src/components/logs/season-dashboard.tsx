"use client";

import * as React from "react";
import { format, parseISO } from "date-fns";
import { Coins, HandCoins, Trophy, TriangleAlert } from "lucide-react";
import type {
  SeasonPaybackView,
  SeasonRaiderStat,
  SeasonReportInput,
  SeasonRosterEntry,
} from "@/lib/types";
import { isGuildCharacter, summarizeSeason } from "@/lib/analysis/season";
import { DEFAULT_POLICY, type GuildPolicy } from "@/lib/analysis/policy";
import { STATUS_LABELS, type CharacterStatus } from "@/lib/constants/wow";
import { RankBadge, Raider } from "@/components/logs/rank-bits";
import { SeasonConsumableBoard } from "@/components/logs/season-consumable-board";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { compareText } from "@/lib/sort";

function uptimeClass(pct: number): string {
  return pct >= 90 ? "text-success-ink" : pct < 60 ? "text-warn-ink" : "";
}

/** One identity for the empty case, so the rollup memo isn't busted every render. */
const NO_ROSTER: Record<string, SeasonRosterEntry> = {};

/**
 * Cross-raid rankings: pick which imported raids to include, then see who
 * spends the most gold on consumables, who keeps the key debuffs up, and the
 * season's notable leaders and laggards — all on per-raid medians so one wild
 * night doesn't distort the picture.
 */
export function SeasonDashboard({
  reports,
  roster = NO_ROSTER,
  policy = DEFAULT_POLICY,
}: {
  reports: SeasonReportInput[];
  /** Slug → what the roster says, for the guild/pug split. Empty is legal. */
  roster?: Record<string, SeasonRosterEntry>;
  /** The council's payback split — only the ledger reads it. */
  policy?: GuildPolicy;
}) {
  const sorted = React.useMemo(
    () => [...reports].sort((a, b) => compareText(b.startTime, a.startTime)),
    [reports],
  );
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set(sorted.map((r) => r.code)));

  const chosen = sorted.filter((r) => selected.has(r.code));
  const view = React.useMemo(
    () => summarizeSeason(chosen, roster, policy),
    [chosen, roster, policy],
  );

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
                    n.tone === "positive" ? "border-success-line bg-success-soft/60" : "border-warn-line bg-warn-soft/60",
                  )}
                >
                  <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {n.tone === "positive" ? (
                      <Trophy className="h-3.5 w-3.5 text-success-ink" />
                    ) : (
                      <TriangleAlert className="h-3.5 w-3.5 text-warn-ink" />
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

          <SpendCard raiders={view.raiders} raidCount={chosen.length} />

          <PaybackLedger view={view.payback} />

          <SeasonConsumableBoard consumables={view.consumables} raidCount={chosen.length} />

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

/** Guild statuses, in the order the filter offers them. */
const GUILD_STATUS_ORDER: readonly CharacterStatus[] = ["main", "trial", "alt", "inactive"];

/**
 * Chip labels. Written out rather than pluralising `STATUS_LABELS`, which turns
 * a perfectly good adjective into "Inactives".
 */
const STATUS_CHIP_LABELS: Record<CharacterStatus, string> = {
  main: "Mains",
  trial: "Trials",
  alt: "Alts",
  inactive: "Inactive",
  pug: "Pugs",
};

/**
 * What the roster calls this raider, where it's worth saying.
 *
 * Mains carry no tag — they're the default and a badge on every row would be
 * noise. An alt names whose it is, which is the whole reason an officer reads
 * the alt filter rather than guessing from names.
 */
function StatusTag({ status, mainName }: { status?: CharacterStatus; mainName?: string }) {
  if (status === undefined || status === "main") return null;
  return (
    <span className="ml-1.5 whitespace-nowrap text-[11px] text-muted-foreground">
      {STATUS_LABELS[status].toLowerCase()}
      {status === "alt" && mainName && <> of {mainName}</>}
    </span>
  );
}

/**
 * The season's spend, guild first.
 *
 * Split because the two questions are different and the same table can't answer
 * both: "what do our raiders put in" is about the roster, and a pug's night —
 * real spend, somebody else's raider — inflates it. The totals strip follows
 * whatever is on screen, so the number under the tab is always the sum of the
 * rows beneath it rather than a season-wide figure that happens to sit there.
 */
function SpendCard({ raiders, raidCount }: { raiders: SeasonRaiderStat[]; raidCount: number }) {
  const [scope, setScope] = React.useState<"guild" | "all">("guild");
  const [status, setStatus] = React.useState<CharacterStatus | "all">("all");

  const guild = React.useMemo(() => raiders.filter((r) => isGuildCharacter(r.status)), [raiders]);
  const present = GUILD_STATUS_ORDER.filter((s) => guild.some((r) => r.status === s));
  // Deselecting raids can empty the status somebody was filtered to; fall back
  // rather than showing an empty table with a chip that no longer applies.
  const active = status !== "all" && present.includes(status) ? status : "all";
  const guildRows = active === "all" ? guild : guild.filter((r) => r.status === active);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Coins className="h-4 w-4 text-warn" />
          Consumable spend across {raidCount} raid{raidCount === 1 ? "" : "s"}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Total and typical (median) gold and items used per raid, ranked by total spend.
        </p>
      </CardHeader>
      <CardContent>
        <Tabs value={scope} onValueChange={(v) => setScope(v as "guild" | "all")}>
          <TabsList>
            <TabsTrigger value="guild">Guild characters</TabsTrigger>
            <TabsTrigger value="all">All players</TabsTrigger>
          </TabsList>
          <TabsContent value="guild" className="space-y-3">
            {present.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                <StatusChip
                  label="All"
                  count={guild.length}
                  on={active === "all"}
                  onClick={() => setStatus("all")}
                />
                {present.map((s) => (
                  <StatusChip
                    key={s}
                    label={STATUS_CHIP_LABELS[s]}
                    count={guild.filter((r) => r.status === s).length}
                    on={active === s}
                    onClick={() => setStatus(s)}
                  />
                ))}
              </div>
            )}
            <SpendTotals rows={guildRows} raidCount={raidCount} noun="character" />
            <SpendTable rows={guildRows} />
          </TabsContent>
          <TabsContent value="all" className="space-y-3">
            <SpendTotals rows={raiders} raidCount={raidCount} noun="player" />
            <SpendTable rows={raiders} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function StatusChip({
  label,
  count,
  on,
  onClick,
}: {
  label: string;
  count: number;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs transition-colors",
        on
          ? "border-foreground/30 bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-accent",
      )}
    >
      {label} <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}

/** The sum of exactly what's in the table below it. */
function SpendTotals({
  rows,
  raidCount,
  noun,
}: {
  rows: SeasonRaiderStat[];
  raidCount: number;
  noun: string;
}) {
  const total = Math.round(rows.reduce((s, r) => s + r.goldTotal, 0));
  const perRaid = raidCount > 0 ? Math.round(total / raidCount) : 0;
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-lg border bg-muted/40 px-3 py-2">
      <span className="text-lg font-semibold tabular-nums">
        {total.toLocaleString("en-US")}g
      </span>
      <span className="text-xs text-muted-foreground">
        across {rows.length} {noun}
        {rows.length === 1 ? "" : "s"} and {raidCount} raid{raidCount === 1 ? "" : "s"}
      </span>
      <span className="text-xs text-muted-foreground">
        ≈<span className="tabular-nums">{perRaid.toLocaleString("en-US")}g</span> per raid
      </span>
    </div>
  );
}

function SpendTable({ rows }: { rows: SeasonRaiderStat[] }) {
  if (rows.length === 0) {
    return <p className="py-1 text-sm text-muted-foreground">Nobody here in the selected raids.</p>;
  }
  return (
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
        {rows.map((r, i) => (
          <TableRow key={r.name} className={cn(i === 0 && "bg-warn-soft/70 hover:bg-warn-soft/70")}>
            <TableCell>
              <RankBadge rank={i + 1} />
            </TableCell>
            <TableCell>
              <Raider name={r.name} slug={r.slug} className={r.className} />
              <StatusTag status={r.status} mainName={r.mainName} />
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
              {Math.round(r.goldTotal).toLocaleString("en-US")}g
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

const gold = (n: number) => `${Math.round(n).toLocaleString("en-US")}g`;

/**
 * The running payback account across every raid that banked marks.
 *
 * The point of it is the **balance** column, which is why the table is sorted
 * on that and not on spend: over a season the split hands the biggest payouts
 * to the same handful of raiders every week, and this is the only view that
 * says who has quietly never been covered. Reading it is how the council evens
 * things out.
 *
 * It does not even them out by itself. Feeding a running balance back into the
 * next night's split would change who gets marks, which is a judgement about
 * fairness rather than a fact in a log — see AGENTS.md invariant 5. The ledger
 * reports; the officers decide.
 */
function PaybackLedger({ view }: { view: SeasonPaybackView }) {
  if (view.raids.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HandCoins className="h-4 w-4 text-success-ink" />
            Payback ledger
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            None of the selected raids has a pot recorded. Enter the Marks of Illidari a night
            banked on that raid&apos;s gold tab and it joins the ledger from then on.
          </p>
        </CardHeader>
      </Card>
    );
  }

  const outstanding = view.recommendedTotal - view.paidTotal;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <HandCoins className="h-4 w-4 text-success-ink" />
          Payback ledger
          <span className="text-sm font-normal text-muted-foreground">
            {view.marksTotal} marks over {view.raids.length} raid
            {view.raids.length === 1 ? "" : "s"} · {gold(view.paidTotal)} of{" "}
            {gold(view.recommendedTotal)} handed back
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Who has had their consumables covered and who has not, added up across every selected
          raid that banked marks. <strong>Sorted by who is furthest behind</strong> — that is the
          column to read when deciding who the next payday should favour. Nothing here feeds a
          split automatically: evening out is the council&apos;s call, not the app&apos;s.
          {view.raidsWithoutPot > 0 && (
            <span className="ml-1 text-warn-ink">
              {view.raidsWithoutPot} selected raid{view.raidsWithoutPot === 1 ? "" : "s"} recorded
              no pot and {view.raidsWithoutPot === 1 ? "is" : "are"} not counted here.
            </span>
          )}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Raider</TableHead>
              <TableHead className="w-16 text-right">Raids</TableHead>
              <TableHead className="w-24 text-right">Spent</TableHead>
              <TableHead className="w-24 text-right">Owed</TableHead>
              <TableHead className="w-24 text-right">Paid</TableHead>
              <TableHead className="w-16 text-right">Marks</TableHead>
              <TableHead className="w-24 text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {view.raiders.map((r, i) => (
              <TableRow key={r.name}>
                <TableCell>{r.balance > 0 && <RankBadge rank={i + 1} />}</TableCell>
                <TableCell>
                  <Raider name={r.name} slug={r.slug} className={r.className} />
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                  {r.raids}
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                  {gold(r.spend)}
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums">
                  {gold(r.recommended)}
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                  {r.paid > 0 ? gold(r.paid) : "—"}
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                  {r.marks}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right text-sm font-semibold tabular-nums",
                    r.balance > 0.5 ? "text-warn-ink" : r.balance < -0.5 ? "text-success-ink" : "",
                  )}
                >
                  {gold(r.balance)}
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="border-t-2 hover:bg-transparent">
              <TableCell />
              <TableCell className="text-xs font-medium text-muted-foreground">Ledger</TableCell>
              <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                {view.raids.length}
              </TableCell>
              <TableCell />
              <TableCell className="text-right text-sm font-semibold tabular-nums">
                {gold(view.recommendedTotal)}
              </TableCell>
              <TableCell className="text-right text-sm font-semibold tabular-nums">
                {gold(view.paidTotal)}
              </TableCell>
              <TableCell className="text-right text-sm font-semibold tabular-nums">
                {view.marksTotal}
              </TableCell>
              <TableCell
                className={cn(
                  "text-right text-sm font-semibold tabular-nums",
                  outstanding > 0.5 ? "text-warn-ink" : "text-success-ink",
                )}
              >
                {gold(outstanding)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <div>
          <h4 className="mb-1 text-xs font-medium text-muted-foreground">Nights in the ledger</h4>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {view.raids.map((r) => (
              <span key={r.code} className="whitespace-nowrap">
                {format(parseISO(r.startTime), "d MMM")} · {r.marks} marks ×{" "}
                {gold(r.markGold)} · {gold(r.paid)}/{gold(r.recommended)} back
                {r.marksLeft > 0 && (
                  <span className="text-info-ink"> · {r.marksLeft} left in bank</span>
                )}
              </span>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
