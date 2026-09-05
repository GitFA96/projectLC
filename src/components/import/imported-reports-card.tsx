"use client";

import * as React from "react";
import { ExternalLink, Loader2, Pencil } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Pager } from "@/components/ui/pager";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  deleteWclReportAction,
  deleteWclReportsAction,
  refetchWclReport,
  updateWclReportMetaAction,
} from "@/app/guild/import/wcl-actions";
import { ActionResultLine, DangerButton, useRosterAction } from "@/components/roster-actions";
import { type ImportedReport } from "@/components/import/import-shared";
import { RefetchFailures, RefetchStatus, type QueueItem } from "@/components/import/import-queue";
/** One report row: title/zone with an inline rename editor. */
function ImportedReportRow({
  r,
  pending,
  run,
  selected,
  onToggle,
  onRefetch,
  busy,
}: {
  r: ImportedReport;
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; message: string }>) => void;
  selected: boolean;
  onToggle: () => void;
  onRefetch: () => void;
  busy: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const [title, setTitle] = React.useState(r.title);
  const [zone, setZone] = React.useState(r.zone ?? "");

  const save = () => {
    run(() => updateWclReportMetaAction({ code: r.code, title: title.trim(), zone: zone.trim() }));
    setEditing(false);
  };

  return (
    <TableRow>
      <TableCell>
        <Checkbox checked={selected} onChange={onToggle} aria-label={`Select ${r.title}`} />
      </TableCell>
      <TableCell className="tabular-nums text-muted-foreground">{r.startTime.slice(0, 10)}</TableCell>
      <TableCell>
        {editing ? (
          <span className="flex flex-wrap items-center gap-1.5">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-7 w-44 text-xs"
              placeholder="Report name"
              aria-label="Report name"
            />
            <Input
              value={zone}
              onChange={(e) => setZone(e.target.value)}
              className="h-7 w-32 text-xs"
              placeholder="Raid label (e.g. SSC/TK)"
              aria-label="Raid label"
            />
            <Button size="sm" className="h-7" disabled={pending || !title.trim()} onClick={save}>
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={() => {
                setEditing(false);
                setTitle(r.title);
                setZone(r.zone ?? "");
              }}
            >
              Cancel
            </Button>
          </span>
        ) : (
          <>
            <span className="text-sm font-medium">{r.title}</span>
            {r.zone && <span className="ml-2 text-xs text-muted-foreground">{r.zone}</span>}
            {/* This night's own record of what the app couldn't place, asked
                against today's tables. Only appears when re-importing would
                move a real number — an aura since ruled a class buff is not a
                reason to spend an officer's evening. */}
            {r.stale && (
              <Badge
                variant="warning"
                className="ml-2 align-middle font-normal"
                title={`Now understood: ${r.stale.learned.join(", ")}. Refetch to count them.`}
              >
                {r.stale.pulls} pull{r.stale.pulls === 1 ? "" : "s"} to recount
              </Badge>
            )}
            {/* The code doubles as the way out to the source report — this is
                the page where an officer is already checking what got imported,
                so "go look at the log itself" is one click, not a copy-paste. */}
            <a
              href={`https://classic.warcraftlogs.com/reports/${encodeURIComponent(r.code)}`}
              target="_blank"
              rel="noreferrer"
              title={`Open ${r.code} on Warcraft Logs`}
              className="ml-2 inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground/60 underline-offset-2 hover:text-foreground hover:underline"
            >
              {r.code}
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
            <button
              type="button"
              aria-label={`Rename ${r.title}`}
              title="Rename report / relabel raid"
              className="ml-1.5 cursor-pointer align-middle text-muted-foreground hover:text-foreground"
              onClick={() => setEditing(true)}
            >
              <Pencil className="h-3 w-3" />
            </button>
          </>
        )}
      </TableCell>
      <TableCell className="text-right text-sm tabular-nums">
        {r.encounterCount} ({r.killCount})
      </TableCell>
      <TableCell className="text-right text-sm tabular-nums">{r.playerCount}</TableCell>
      <TableCell className="text-xs text-muted-foreground">{r.sessionLabel ?? "—"}</TableCell>
      <TableCell
        className="text-xs tabular-nums text-muted-foreground"
        // Absolute rather than "3 days ago": this renders on the server and
        // hydrates on the client, and a relative label computed twice can
        // disagree. The exact moment is one hover away.
        title={r.fetchedAt}
      >
        {r.fetchedAt.slice(0, 10)}
      </TableCell>
      <TableCell className="text-right">
        <DangerButton
          disabled={pending}
          confirmLabel="Confirm remove"
          onConfirm={() => run(() => deleteWclReportAction({ code: r.code }))}
        >
          Remove
        </DangerButton>
      </TableCell>
      <TableCell className="text-right">
        {/* Outlined, not ghost: a bare label in a table reads as text, and the
            one control that re-runs a network fetch should look clickable. */}
        <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={onRefetch}>
          Refetch
        </Button>
      </TableCell>
    </TableRow>
  );
}

/**
 * Raid nights per page. Ten is roughly a tier's worth of recent raids, and the
 * card sits under three others on a tab people open to import one report.
 */
const REPORTS_PAGE_SIZE = 10;

export function ImportedReportsCard({ reports }: { reports: ImportedReport[] }) {
  const { pending, result, run } = useRosterAction();
  const [picked, setPicked] = React.useState<string[]>([]);

  /*
   * Derive the live selection rather than pruning it in an effect: after a
   * delete the removed codes simply stop matching, so a stale code can never
   * be handed to a later "delete selected". Syncing this with setState in an
   * effect would be an extra render and a lint error for the same result.
   */
  const live = React.useMemo(() => new Set(reports.map((r) => r.code)), [reports]);
  const selected = React.useMemo(() => picked.filter((c) => live.has(c)), [picked, live]);
  const setSelected = setPicked;

  const toggle = (code: string) =>
    setSelected((s) => (s.includes(code) ? s.filter((c) => c !== code) : [...s, code]));

  const [pageIndex, setPageIndex] = React.useState(0);
  const pageCount = Math.max(1, Math.ceil(reports.length / REPORTS_PAGE_SIZE));
  // Deleting the last report on the last page takes that page with it.
  const page = Math.min(pageIndex, pageCount - 1);
  const visible = reports.slice(page * REPORTS_PAGE_SIZE, (page + 1) * REPORTS_PAGE_SIZE);
  const visibleCodes = visible.map((r) => r.code);
  /*
   * The header box selects **this page**, matching the puggers table. Behind a
   * pager, "select all" arming a delete with rows the officer cannot see is the
   * failure worth designing out — and here those rows are raid nights, whose
   * removal recounts everyone's attendance. Selections still survive paging.
   */
  const allOnPageSelected =
    visibleCodes.length > 0 && visibleCodes.every((code) => selected.includes(code));
  const togglePage = () =>
    setSelected((s) =>
      allOnPageSelected
        ? s.filter((code) => !visibleCodes.includes(code))
        : [...new Set([...s, ...visibleCodes])],
    );

  const [queue, setQueue] = React.useState<QueueItem[] | null>(null);
  const [refetching, startRefetch] = React.useTransition();

  /**
   * Re-fetch one or many, sequentially — same reasoning as the bulk import:
   * each report is several API calls, and a failure partway through must keep
   * everything already done. One row uses the same path as ten so there's only
   * one behaviour to reason about.
   */
  const refetch = (codes: string[]) => {
    if (codes.length === 0) return;
    setQueue(codes.map((code) => ({ code, state: "waiting" })));
    startRefetch(async () => {
      for (let i = 0; i < codes.length; i++) {
        setQueue((q) => q && q.map((it, n) => (n === i ? { ...it, state: "running" } : it)));
        const res = await refetchWclReport({ code: codes[i] });
        setQueue((q) => q && q.map((it, n) => (n === i ? { ...it, state: "done", result: res } : it)));
      }
    });
  };
  const busy = pending || refetching;

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          <span>Imported reports</span>
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            {queue && <RefetchStatus items={queue} />}
            <Button
              size="sm"
              variant="outline"
              disabled={busy || reports.length === 0}
              onClick={() => refetch(selected.length > 0 ? selected : reports.map((r) => r.code))}
            >
              {refetching && <Loader2 className="h-4 w-4 animate-spin" />}
              {selected.length > 0 ? `Refetch ${selected.length} selected` : "Refetch all"}
            </Button>
            {selected.length > 0 && (
              <DangerButton
                disabled={busy}
                confirmLabel={`Delete ${selected.length}`}
                onConfirm={() => {
                  const codes = selected;
                  setSelected([]);
                  return run(() => deleteWclReportsAction({ codes }));
                }}
              >
                Remove {selected.length} selected
              </DangerButton>
            )}
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          <strong>Refetch</strong> pulls a report again from Warcraft Logs, keeping its name, raid
          label and linked session — that&apos;s how an older import gains anything the app has
          learned to track since. Removing one deletes its pulls,
          parses and consumable data — attendance recounts immediately. The same report can always
          be imported again.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {reports.length === 0 ? (
          <p className="py-1 text-sm text-muted-foreground">No reports imported yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox
                    checked={allOnPageSelected}
                    onChange={togglePage}
                    aria-label={
                      pageCount > 1 ? "Select every report on this page" : "Select all reports"
                    }
                  />
                </TableHead>
                <TableHead className="w-28">Date</TableHead>
                <TableHead>Report</TableHead>
                <TableHead className="text-right">Bosses (kills)</TableHead>
                <TableHead className="text-right">Players</TableHead>
                <TableHead>Linked session</TableHead>
                <TableHead className="w-28" title="When this report was last fetched from Warcraft Logs">
                  Imported
                </TableHead>
                <TableHead className="w-36"></TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((r) => (
                <ImportedReportRow
                  key={r.code}
                  r={r}
                  pending={pending}
                  run={run}
                  selected={selected.includes(r.code)}
                  onToggle={() => toggle(r.code)}
                  onRefetch={() => refetch([r.code])}
                  busy={busy}
                />
              ))}
            </TableBody>
          </Table>
        )}
        <Pager
          pageIndex={page}
          pageCount={pageCount}
          total={reports.length}
          pageSize={REPORTS_PAGE_SIZE}
          onPrev={() => setPageIndex(page - 1)}
          onNext={() => setPageIndex(page + 1)}
        />
        {queue && <RefetchFailures items={queue} />}
        <ActionResultLine result={result} />
      </CardContent>
    </Card>
  );
}
