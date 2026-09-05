"use client";

import * as React from "react";
import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { importWclReport, type WclImportActionResult } from "@/app/guild/import/wcl-actions";
import { parseReportCodes } from "@/lib/wcl/report-codes";
import {
  CommitButton,
  ErrorPanel,
  Warnings,
  fmtOffset,
  type ImportedReport,
  type SessionOption,
} from "@/components/import/import-shared";
import { ImportQueue, type QueueItem } from "@/components/import/import-queue";
import { ImportedReportsCard } from "@/components/import/imported-reports-card";
export function WclTab({
  sessions,
  configured,
  reports,
}: {
  sessions: SessionOption[];
  configured: boolean;
  reports: ImportedReport[];
}) {
  const [report, setReport] = React.useState("");
  const [sessionId, setSessionId] = React.useState("none");
  const [titleOverride, setTitleOverride] = React.useState("");
  const [zoneOverride, setZoneOverride] = React.useState("");
  const [result, setResult] = React.useState<WclImportActionResult | null>(null);
  const [queue, setQueue] = React.useState<QueueItem[] | null>(null);
  const [pending, startTransition] = React.useTransition();

  const parsed = React.useMemo(() => parseReportCodes(report), [report]);
  const many = parsed.codes.length > 1;

  const commit = () => {
    setResult(null);
    setQueue(null);
    startTransition(async () => {
      if (!many) {
        setResult(
          await importWclReport({
            report,
            raidSessionId: sessionId === "none" ? undefined : sessionId,
            title: titleOverride.trim() || undefined,
            zone: zoneOverride.trim() || undefined,
          }),
        );
        return;
      }
      /*
       * One report at a time, on purpose.
       *
       * Each import is ~7 API calls and takes seconds, so a batch of ten would
       * risk a server-action timeout and would hammer the rate limit in
       * parallel. Sequential also means a failure on the sixth report keeps the
       * five before it — and the officer can watch it progress instead of
       * staring at a spinner with no idea how far along it is.
       *
       * Overrides and session linking are deliberately not applied here: one
       * title for ten different raid nights would be wrong, and each report
       * keeps whatever WCL calls it (rename inline below afterwards).
       */
      const items: QueueItem[] = parsed.codes.map((code) => ({ code, state: "waiting" }));
      setQueue(items);
      for (let i = 0; i < items.length; i++) {
        setQueue((q) => q && q.map((it, n) => (n === i ? { ...it, state: "running" } : it)));
        const res = await importWclReport({ report: items[i].code });
        setQueue((q) => q && q.map((it, n) => (n === i ? { ...it, state: "done", result: res } : it)));
      }
    });
  };

  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Warcraft Logs report</CardTitle>
          <p className="text-xs text-muted-foreground">
            Paste a report URL (or just its code). The app fetches parses (all-damage, healing and
            boss-damage), per-pull consumable usage, deaths and the worn-gear snapshot via the
            official API — players are matched to the roster by name. Fetching the same report
            again replaces it (the update flow), which is also how an older import gains anything
            added since.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {!configured ? (
            <div className="space-y-2 rounded-md border border-warn-line bg-warn-soft p-3 text-sm text-warn-ink">
              <p className="font-medium">Warcraft Logs API credentials aren&apos;t configured.</p>
              <ol className="list-decimal space-y-1 pl-4 text-xs text-warn-ink">
                <li>
                  Create a (free) API client at{" "}
                  <a
                    href="https://www.warcraftlogs.com/api/clients"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    warcraftlogs.com/api/clients
                  </a>{" "}
                  — any name, no redirect URL needed.
                </li>
                <li>
                  Put the pair in <code className="rounded bg-warn-fill px-1 font-mono">.env.local</code>:{" "}
                  <code className="rounded bg-warn-fill px-1 font-mono">WCL_CLIENT_ID</code> and{" "}
                  <code className="rounded bg-warn-fill px-1 font-mono">WCL_CLIENT_SECRET</code>
                </li>
                <li>Restart the dev server and reload this page.</li>
              </ol>
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Report URLs or codes</Label>
                <Textarea
                  value={report}
                  onChange={(e) => {
                    setReport(e.target.value);
                    setResult(null);
                    setQueue(null);
                  }}
                  rows={4}
                  placeholder={
                    "https://classic.warcraftlogs.com/reports/AbCdEf1234567890\n" +
                    "…paste as many as you like, one per line"
                  }
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">
                  {parsed.codes.length === 0
                    ? "One report or many — URLs and bare codes, in any order."
                    : `${parsed.codes.length} report${parsed.codes.length === 1 ? "" : "s"} found`}
                  {parsed.duplicates > 0 && `, ${parsed.duplicates} duplicate skipped`}
                  {parsed.invalid.length > 0 && (
                    <span className="text-warn-ink">
                      {" "}
                      · ignored: {parsed.invalid.slice(0, 3).join(", ")}
                      {parsed.invalid.length > 3 && ` +${parsed.invalid.length - 3} more`}
                    </span>
                  )}
                </p>
              </div>
              {many && (
                <p className="rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
                  Importing {parsed.codes.length} reports one after another — each keeps its own
                  Warcraft Logs title, and no raid session is linked. Import a single report on its
                  own if you want to set those.
                </p>
              )}
              <div className={many ? "hidden" : "grid gap-3 sm:grid-cols-2"}>
                <div className="space-y-1">
                  <Label className="text-xs">Report name (optional)</Label>
                  <Input
                    value={titleOverride}
                    onChange={(e) => setTitleOverride(e.target.value)}
                    placeholder="Keep WCL's title"
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Raid label (optional)</Label>
                  <Input
                    value={zoneOverride}
                    onChange={(e) => setZoneOverride(e.target.value)}
                    placeholder="e.g. SSC/TK — WCL often mislabels multi-zone nights"
                    className="h-8 text-xs"
                  />
                </div>
              </div>
              <div className={many ? "hidden" : "space-y-1"}>
                <Label className="text-xs">Link to raid session (optional)</Label>
                <Select value={sessionId} onValueChange={setSessionId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not linked</SelectItem>
                    {sessions.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <CommitButton pending={pending} onClick={commit} disabled={parsed.codes.length === 0}>
                {many ? `Fetch & import ${parsed.codes.length} reports` : "Fetch & import"}
              </CommitButton>
            </>
          )}

          {queue && <ImportQueue items={queue} />}

          {result?.status === "not-configured" && (
            <ErrorPanel message="Warcraft Logs credentials are not configured — reload the page for setup instructions." />
          )}
          {result?.status === "error" && <ErrorPanel message={result.message} />}
          {result?.status === "committed" && (
            <div className="space-y-2 rounded-md border border-success-line bg-success-soft p-3 text-sm text-success-ink">
              <p className="flex items-center gap-1.5 font-medium">
                <CircleCheck className="h-4 w-4" />
                {result.replaced ? "Updated" : "Imported"} “{result.title}”
                {result.zone && ` — ${result.zone}`} ({result.fightCount} boss pull
                {result.fightCount === 1 ? "" : "s"})
              </p>
              <p className="text-xs">
                {result.matched.length} raider(s) matched to tracked characters
                {result.unmatched.length > 0 && (
                  <>
                    {" "}
                    · untracked: {result.unmatched.join(", ")} — add them as puggers on the{" "}
                    <Link href="/roster" className="font-medium underline-offset-2 hover:underline">
                      roster page
                    </Link>
                  </>
                )}
              </p>
              <Warnings warnings={result.warnings} />
              {result.ignored.total > 0 && (
                <details className="rounded-md border border-success-line/60 bg-background/50 p-2 text-xs">
                  <summary className="cursor-pointer font-medium">
                    Inspect the {result.ignored.total} ignored combatant-info event(s) (
                    {result.ignored.players} player{result.ignored.players === 1 ? "" : "s"})
                  </summary>
                  <p className="mt-1.5 text-muted-foreground">
                    WCL fires one combatant-info per player for <em>every</em> combat segment —
                    trash included. Only boss pulls feed parses, consumables and attendance, so
                    these were skipped. Sample (first {result.ignored.sample.length}):
                  </p>
                  <ul className="mt-1.5 space-y-0.5">
                    {result.ignored.sample.map((e, i) => (
                      <li key={i} className="tabular-nums">
                        <span className="font-medium">{e.player}</span>
                        <span className="text-muted-foreground"> at {fmtOffset(e.atMs)}</span>
                        <span className="text-muted-foreground">
                          {" — "}
                          {e.auras.length > 0
                            ? `consumables up: ${e.auras.join(", ")}`
                            : "no consumables visible"}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-muted-foreground">
                    If a whole boss kill seems missing instead, check the report on Warcraft Logs —
                    a broken/split log segment looks exactly like this.
                  </p>
                </details>
              )}
              {result.auraDump.length > 0 && (
                <details className="rounded-md border border-success-line/60 bg-background/50 p-2 text-xs">
                  <summary className="cursor-pointer font-medium">
                    Consumable-tuning dump: {result.auraDump.length} unrecognized aura name(s) at pulls
                  </summary>
                  <p className="mt-1.5 text-muted-foreground">
                    Auras seen at boss pulls that the consumable tables don&apos;t classify. Known
                    class buffs (blessings, auras, shouts, stances…) are already filtered out, so
                    what&apos;s left is genuinely unknown. If a consumable is missing from
                    someone&apos;s tracking, it&apos;s in this list: copy the block and paste it
                    into development to tune the tables.
                  </p>
                  <p className="mt-1.5 text-muted-foreground">
                    This list is <strong className="font-medium">kept with the report</strong>, so it
                    survives closing this page — and anything appearing at several pulls files itself
                    under Feedback rather than waiting to be noticed.
                  </p>
                  <pre className="mt-1.5 max-h-56 select-all overflow-y-auto whitespace-pre-wrap rounded bg-muted/60 p-2 font-mono text-[11px] leading-4">
                    {result.auraDump
                      .map((a) => `${String(a.abilityId ?? "?").padStart(6)}  ${a.name}  ×${a.count}`)
                      .join("\n")}
                  </pre>
                </details>
              )}
              {result.matched.length > 0 && (
                <Button asChild size="sm" variant="outline">
                  <Link
                    href={`/characters/${encodeURIComponent(result.matched[0].toLowerCase())}/performance`}
                  >
                    View {result.matched[0]}&apos;s performance
                  </Link>
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What gets imported</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            For every boss pull and every raider: <span className="text-foreground">parse percentile</span>{" "}
            (DPS, or HPS for healers) with its item-level bracket percentile,{" "}
            <span className="text-foreground">deaths</span>, and the full{" "}
            <span className="text-foreground">preparation picture</span> — flask/elixirs, food,
            weapon buff at the pull, pre-pots, and potions/drums/runes used during the fight.
          </p>
          <p>
            Gear seen at each pull is captured in full — every worn item with its quality, enchant
            and gems feeds the <span className="text-foreground">gear panel</span> on the
            performance page, where enchants are named and graded against imported wishlists
            (weapon enchant + temp buff get special attention).
          </p>
          <p>
            Per pull it also tracks the <span className="text-foreground">class toolkit</span>:
            major cooldown casts (Death Wish, Combustion, Innervate, Bloodlust…) with the moment
            each was pressed, shaman totem drops, and the uptime of maintained debuffs/buffs —
            warlock curse assignments, Thunder Clap, Demoralizing Shout, shouts, judgements,
            Faerie Fire, Earth Shield and friends. Raid buffs are also read back{" "}
            <span className="text-foreground">per recipient</span> on the logs page.
          </p>
          <p>
            Everything lands on each character&apos;s <span className="text-foreground">Performance</span>{" "}
            page (linked from their profile), per report and as a career rollup. Linking a report to
            a Gargul session ties the night&apos;s performance to its loot decisions.
          </p>
          <p className="text-xs">
            Costs ~7 API calls per report — the free Warcraft Logs tier allows thousands per hour.
          </p>
        </CardContent>
      </Card>

      <ImportedReportsCard reports={reports} />
    </div>
  );
}
