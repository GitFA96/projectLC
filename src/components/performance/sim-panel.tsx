"use client";

import * as React from "react";
import { ChevronRight, CircleAlert, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { bossOrder, raidOfBoss, raidOrder } from "@/lib/constants/wow";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  resolveSimAbilities,
  runSimComparison,
  saveSimSettings,
  type AbilityLink,
  type SimComparisonResult,
} from "@/app/characters/[name]/performance/sim-actions";
import type { SetupRow } from "@/lib/sim/setup";
import type { TimedEvent } from "@/lib/sim/result";
import type { ContextRow } from "@/lib/sim/context";
import { RotationTimeline } from "@/components/performance/rotation-timeline";

/**
 * One raider's pulls against their own wowsims setup.
 *
 * The order on screen is deliberate: the context audit comes FIRST, above the
 * DPS numbers. A gap only means something once you know what the sim assumed
 * that the raid didn't have, and putting the number first invites reading it as
 * a verdict on the player.
 */

export interface SimPull {
  reportCode: string;
  fightId: number;
  actorName: string;
  encounterName: string;
  durationMs: number;
  parsePercent?: number;
  /** ISO date of the raid night — the other axis you can browse by. */
  raidDate: string;
}

/** Stable identity of a pull, independent of how you navigated to it. */
export const pullId = (p: SimPull) => `${p.reportCode}:${p.fightId}`;

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso.slice(0, 10)
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

/** "134s · 96%" — enough to tell two kills of the same boss apart. */
function pullStats(p: SimPull): string {
  const secs = `${Math.round(p.durationMs / 1000)}s`;
  return p.parsePercent === undefined ? secs : `${secs} · ${Math.round(p.parsePercent)}%`;
}

export type BrowseMode = "boss" | "night";

interface PullGroup {
  key: string;
  label: string;
  /** Raid instance heading this group sits under; unset on the night axis. */
  section?: string;
  pulls: SimPull[];
}

/**
 * Group the kills on whichever axis is primary.
 *
 * Bosses go in raid progression order (Karazhan → Sunwell), not alphabetically:
 * a raider scanning for Void Reaver looks under Tempest Keep, and an
 * alphabetical list scatters each instance across the dropdown. Nights go
 * newest-first. Within a boss the best parse leads, because comparing your own
 * good and bad kills of one fight is what that axis is for; within a night,
 * pulls stay in the order they happened.
 */
export function groupPulls(pulls: SimPull[], mode: BrowseMode): PullGroup[] {
  const byKey = new Map<string, PullGroup>();
  for (const p of pulls) {
    const key = mode === "boss" ? p.encounterName : p.raidDate;
    const label = mode === "boss" ? p.encounterName : shortDate(p.raidDate);
    const hit = byKey.get(key);
    if (hit) hit.pulls.push(p);
    else {
      byKey.set(key, {
        key,
        label,
        // Only the boss axis is nested; a night is already one heading.
        section: mode === "boss" ? (raidOfBoss(p.encounterName)?.name ?? "Other") : undefined,
        pulls: [p],
      });
    }
  }
  const groups = [...byKey.values()];
  for (const g of groups) {
    g.pulls.sort(
      mode === "boss"
        ? (a, b) => (b.parsePercent ?? -1) - (a.parsePercent ?? -1) || b.raidDate.localeCompare(a.raidDate)
        : (a, b) => a.fightId - b.fightId,
    );
  }
  return groups.sort(
    mode === "boss"
      ? (a, b) =>
          raidOrder(a.key) - raidOrder(b.key) ||
          bossOrder(a.key) - bossOrder(b.key) ||
          a.key.localeCompare(b.key)
      : (a, b) => b.key.localeCompare(a.key),
  );
}

/** Consecutive groups sharing a section, for rendering one heading each. */
export function sectionsOf(groups: PullGroup[]): { section?: string; groups: PullGroup[] }[] {
  const out: { section?: string; groups: PullGroup[] }[] = [];
  for (const g of groups) {
    const last = out[out.length - 1];
    if (last && last.section === g.section) last.groups.push(g);
    else out.push({ section: g.section, groups: [g] });
  }
  return out;
}

/**
 * A verdict scale that says what it means.
 *
 * The first cut used four greys and ambers that all read as "something",
 * without saying which way. These name the consequence instead: green when the
 * sim's assumption held, amber when the sim was handed something the raid
 * didn't have (so the gap overstates the player), blue when the pull had an
 * edge the sim didn't model (the gap understates them), and a plain outline for
 * what we genuinely can't check.
 */
const VERDICT: Record<
  string,
  { badge: "success" | "warning" | "secondary" | "outline"; label: string; hint: string }
> = {
  match: { badge: "success", label: "matched", hint: "The sim's assumption held on this pull." },
  "sim-only": {
    badge: "warning",
    label: "sim only",
    hint: "The sim was given this and the pull wasn't — part of the gap isn't the player.",
  },
  differs: {
    badge: "warning",
    label: "partial",
    hint: "Present, but not for the whole fight — the sim models it as always on.",
  },
  "log-only": {
    badge: "secondary",
    label: "pull only",
    hint: "The pull had this and the sim didn't assume it — the gap understates the player.",
  },
  unknown: {
    badge: "outline",
    label: "can't tell",
    hint: "Either this aura isn't tracked, or this report was imported before it was — refetch the report and run again.",
  },
};

/** Ability rows: colour by which side is ahead, not by raw sign. */
function deltaBadge(perMinDelta: number): "success" | "warning" | "muted" {
  if (Math.abs(perMinDelta) < 0.5) return "muted";
  return perMinDelta > 0 ? "warning" : "success";
}

/**
 * The run's parameters as facts, not as a diff.
 *
 * The first cut was two three-column tables, and most cells were a dash: the
 * sim has iterations and the pull has deaths, and neither has an opposite
 * number. All that whitespace read as missing data. Each parameter now states
 * its own value, with a left border carrying the only comparison that matters —
 * whether the two sides disagree.
 */
const SETUP_TONE: Record<SetupRow["state"], string> = {
  agree: "border-l-emerald-400",
  differ: "border-l-amber-400",
  single: "border-l-border",
};

function SetupGrid({ rows }: { rows: SetupRow[] }) {
  return (
    <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {rows.map((r) => (
        <div key={r.label} className={`border-l-2 pl-2 ${SETUP_TONE[r.state]}`} title={r.note}>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {r.label}
            {r.note && <span className="ml-1">*</span>}
          </p>
          <p className={`text-sm ${r.state === "differ" ? "font-medium text-amber-700" : ""}`}>
            {r.value}
          </p>
          {r.detail && <p className="text-[11px] text-muted-foreground">{r.detail}</p>}
        </div>
      ))}
    </div>
  );
}

/**
 * Look every ability in the comparison up on Wowhead.
 *
 * Two reasons this covers all of them rather than only the bare ids. The ids
 * are the interesting rows — a sim pressing something the guild never casts —
 * so leaving a number there hides the finding. But a named row benefits from
 * the same tooltip: "Heroic Strike, 40/min vs 12/min" is easier to argue about
 * when you can see what it costs. Cached forever, so it's one press per new
 * ability, ever.
 */
function AbilityLookup({
  abilities,
  unnamed,
}: {
  abilities: Record<string, AbilityLink>;
  unnamed: string[];
}) {
  const [msg, setMsg] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();

  const missing = Object.values(abilities).filter((a) => !a.cached);
  if (missing.length === 0 && unnamed.length === 0) return null;

  const keys = missing.map((a) => a.key);
  const tone =
    unnamed.length > 0
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : "border-border bg-muted/40 text-muted-foreground";

  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-md border p-2 text-xs ${tone}`}>
      {unnamed.length > 0 && <CircleAlert className="h-3.5 w-3.5 shrink-0" />}
      <span>
        {unnamed.length > 0 ? (
          <>
            No log has ever named <strong>{unnamed.join(", ")}</strong> — the sim pressed{" "}
            {unnamed.length === 1 ? "it" : "them"} and nobody here does.
          </>
        ) : (
          <>{missing.length} abilities here haven&apos;t been looked up yet.</>
        )}
      </span>
      {keys.length > 0 && (
        <Button
          size="sm"
          variant="outline"
          className="h-7"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await resolveSimAbilities({ keys });
              setMsg(res.message);
            })
          }
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          Look up on Wowhead
        </Button>
      )}
      {msg && <span>{msg} Re-run the comparison to see them.</span>}
    </div>
  );
}

/**
 * A card that folds away.
 *
 * The panel had grown to three tall cards, and an officer comparing two pulls
 * scrolls past whichever one they aren't reading. The summary line stays
 * visible when collapsed, so folding a section never hides its conclusion —
 * only the working.
 */
function Section({
  title,
  summary,
  aside,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary?: string;
  aside?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <Card>
      <CardHeader className="pb-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-baseline gap-2 text-left"
          aria-expanded={open}
        >
          <ChevronRight
            className={`mt-0.5 h-4 w-4 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
          />
          <CardTitle className="text-base">{title}</CardTitle>
          {aside && (
            <span className="ml-auto text-xs font-normal text-muted-foreground">{aside}</span>
          )}
        </button>
        {summary && <p className="pl-6 text-xs text-muted-foreground">{summary}</p>}
      </CardHeader>
      {open && <CardContent>{children}</CardContent>}
    </Card>
  );
}

/**
 * The assumptions, one line each.
 *
 * Was a four-column table, which gave a 28-row list the height of a page for
 * what is mostly "yes, and yes". A line per assumption with a coloured edge
 * fits the same information in a third of the space and still scans by verdict.
 */
const AUDIT_TONE: Record<string, string> = {
  match: "border-l-emerald-400",
  "sim-only": "border-l-amber-400",
  differs: "border-l-amber-400",
  "log-only": "border-l-sky-400",
  unknown: "border-l-border",
};

function AuditGrid({ rows }: { rows: ContextRow[] }) {
  return (
    <div className="grid gap-x-6 gap-y-1 lg:grid-cols-2">
      {rows.map((r) => (
        <div
          key={`${r.category}:${r.name}`}
          className={`flex items-baseline gap-2 border-l-2 py-0.5 pl-2 text-xs ${
            AUDIT_TONE[r.verdict] ?? "border-l-border"
          }`}
          title={`Sim: ${r.sim}\n${VERDICT[r.verdict]?.hint ?? ""}`}
        >
          <span className="shrink-0 font-medium">{r.name}</span>
          <span className="truncate text-muted-foreground">{r.logged}</span>
          {/*
            Reasoned, not measured — kept on the row rather than folded into the
            verdict, so a reader scanning verdicts can't mistake a deduction for
            an observation.
          */}
          {r.inferred && (
            <span
              className="shrink-0 rounded border border-dashed border-current px-1 text-[10px] uppercase text-muted-foreground"
              title="Not in the combat log — worked out from other evidence."
            >
              inferred
            </span>
          )}
          <span className="ml-auto shrink-0">
            <Badge variant={VERDICT[r.verdict]?.badge ?? "outline"} title={VERDICT[r.verdict]?.hint}>
              {VERDICT[r.verdict]?.label ?? r.verdict}
            </Badge>
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * The fight written out, line by line, both sides.
 *
 * Two independent columns rather than one interleaved list. The pull and the
 * sim don't share a clock in any meaningful way past the opener — the sim never
 * stops for a mechanic — so lining them up row-for-row would imply a
 * correspondence that isn't there. Side by side, you scroll each to the moment
 * you care about and read what each was doing.
 */
function EventLog({ logged, sim }: { logged: TimedEvent[]; sim: TimedEvent[] }) {
  const [castsOnly, setCastsOnly] = React.useState(false);
  const show = (rows: TimedEvent[]) => (castsOnly ? rows.filter((r) => r.kind === "cast") : rows);

  const column = (title: string, rows: TimedEvent[], tone: string) => (
    <div className="min-w-0 flex-1">
      <p className={`mb-1 text-xs font-medium ${tone}`}>
        {title} <span className="font-normal text-muted-foreground">· {rows.length} lines</span>
      </p>
      <div className="max-h-96 overflow-auto rounded-md border border-border font-mono text-[11px]">
        {rows.length === 0 ? (
          <p className="p-2 text-muted-foreground">Nothing recorded.</p>
        ) : (
          rows.map((r, i) => (
            <div
              key={i}
              className={`flex gap-2 px-2 py-px ${i % 2 ? "bg-muted/40" : ""} ${
                r.kind === "cast" ? "font-medium" : "text-muted-foreground"
              }`}
            >
              <span className="w-12 shrink-0 text-right tabular-nums">
                {(r.tMs / 1000).toFixed(1)}s
              </span>
              <span className="w-10 shrink-0 uppercase">{r.kind === "cast" ? "cast" : "hit"}</span>
              <span className="min-w-0 flex-1 truncate">{r.name}</span>
              {r.amount !== undefined && r.amount > 0 && (
                <span className="shrink-0 tabular-nums">{Math.round(r.amount).toLocaleString("en-US")}</span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={castsOnly}
          onChange={(e) => setCastsOnly(e.target.checked)}
          className="h-3.5 w-3.5"
        />
        Casts only — hide the damage lines
      </label>
      <div className="flex flex-col gap-3 lg:flex-row">
        {column("Logged", show(logged), "text-sky-700")}
        {column("Sim", show(sim), "text-amber-700")}
      </div>
      <p className="text-[11px] text-muted-foreground">
        The sim column is the single representative iteration — the seed whose DPS landed closest to
        the 3,000-run average, so it is a real pull rather than a lucky one.
      </p>
    </div>
  );
}

/** Compact damage: 81,914 → "81.9k". Totals here run to millions. */
function short(n: number | undefined): string {
  if (n === undefined || n === 0) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

/**
 * Casts, damage and order — the three questions about a rotation.
 *
 * Counts alone rank by button presses, which flatters whatever is spammed:
 * 27 Heroic Strikes over 8 Bloodthirsts reads as Heroic Strike being the
 * bigger deal until you see it did less damage per press. And neither number
 * shows the ORDER, which is where a real pull diverges from a sim — hence the
 * timeline beside them rather than under them.
 */
function RotationSection({ result }: { result: Extract<SimComparisonResult, { status: "ok" }> }) {
  const [tab, setTab] = React.useState<"table" | "timeline" | "log">("table");
  const abilities = React.useMemo(
    () => [...result.comparison.abilities].sort((x, y) => x.name.localeCompare(y.name)),
    [result.comparison.abilities],
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {(["table", "timeline", "log"] as const).map((t) => (
          <Button
            key={t}
            size="sm"
            variant={tab === t ? "default" : "outline"}
            className="h-7"
            onClick={() => setTab(t)}
          >
            {t === "table" ? "Casts & damage" : t === "timeline" ? "Timeline" : "Event log"}
          </Button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          {tab === "table"
            ? "Per minute, so a shorter pull isn't compared with raw counts. A to Z."
            : tab === "timeline"
              ? "When each ability was pressed — the opener is where the two are comparable."
              : "Every action in order, both sides, the way Warcraft Logs reads a fight."}
        </span>
      </div>

      <AbilityLookup abilities={result.abilities} unnamed={result.unnamed} />

      {tab === "log" ? (
        <EventLog logged={result.events.logged} sim={result.events.sim} />
      ) : tab === "timeline" ? (
        <RotationTimeline
          durationMs={result.durationMs}
          tracks={[
            { label: "Logged", tone: "log", casts: result.comparison.a.timeline ?? [] },
            { label: "Sim", tone: "sim", casts: result.comparison.b.timeline ?? [] },
          ]}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ability</TableHead>
              <TableHead className="text-right">Logged / min</TableHead>
              <TableHead className="text-right">Sim / min</TableHead>
              <TableHead className="text-right">Difference</TableHead>
              <TableHead className="text-right">Logged dmg</TableHead>
              <TableHead className="text-right">Sim dmg</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {/*
              Every ability, alphabetical. The old view took the 14 biggest
              gaps, which meant an ability you went looking for might simply
              not be on screen, with nothing saying so.
            */}
            {abilities.map((a) => (
              <TableRow key={a.name}>
                <TableCell className="text-sm">
                  {result.abilities[a.name] ? (
                    <a
                      href={result.abilities[a.name].url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline decoration-dotted underline-offset-2"
                      title={result.abilities[a.name].description ?? "Look up on Wowhead"}
                    >
                      {a.name}
                    </a>
                  ) : (
                    a.name
                  )}
                </TableCell>
                <TableCell
                  className="text-right text-sm tabular-nums"
                  title={
                    a.aEstimated
                      ? "Warcraft Logs records no cast events for this ability on this pull — this is how often it LANDED."
                      : undefined
                  }
                >
                  {a.aEstimated && <span className="text-muted-foreground">≈</span>}
                  {a.aPerMin.toFixed(1)}
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums">
                  {a.bPerMin.toFixed(1)}
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums">
                  <Badge
                    variant={deltaBadge(a.perMinDelta)}
                    title={
                      Math.abs(a.perMinDelta) < 0.5
                        ? "Effectively the same rate."
                        : a.perMinDelta > 0
                          ? "The sim pressed this more often than you did."
                          : "You pressed this more often than the sim."
                    }
                  >
                    {a.perMinDelta > 0 ? "+" : ""}
                    {a.perMinDelta.toFixed(1)}
                  </Badge>
                </TableCell>
                <TableCell
                  className="text-right text-sm tabular-nums"
                  title={a.aDamage ? `${a.aDamageShare}% of your damage` : undefined}
                >
                  {short(a.aDamage)}
                  {a.aDamage !== undefined && a.aDamage > 0 && (
                    <span className="ml-1 text-[10px] text-muted-foreground">{a.aDamageShare}%</span>
                  )}
                </TableCell>
                <TableCell
                  className="text-right text-sm tabular-nums"
                  title={a.bDamage ? `${a.bDamageShare}% of the sim's damage` : undefined}
                >
                  {short(a.bDamage)}
                  {a.bDamage !== undefined && a.bDamage > 0 && (
                    <span className="ml-1 text-[10px] text-muted-foreground">{a.bDamageShare}%</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function SimSetup({
  slug,
  configured,
  hasSim,
}: {
  slug: string;
  configured: boolean;
  hasSim: boolean;
}) {
  const [link, setLink] = React.useState("");
  const [msg, setMsg] = React.useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = React.useTransition();

  const save = (value: string) =>
    start(async () => {
      const res = await saveSimSettings({ slug, link: value });
      setMsg(res);
      if (res.ok) setLink("");
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {hasSim ? "Replace this raider's sim setup" : "Add a sim setup"}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          In wowsims, build the character and use <strong>Export → Link</strong>, then paste the
          whole URL here. Gear, talents and fight length are taken from each logged pull instead, so
          the setup only supplies the rotation, buffs and consumables you consider standard.{" "}
          <a
            href="https://github.com/wowsims/tbc-new"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            wowsims
          </a>{" "}
          is a separate open-source project.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {!configured ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            No simulator configured. Download <code className="font-mono">wowsimcli</code> from the
            wowsims releases page and point <code className="font-mono">WOWSIMCLI_PATH</code> at it
            in <code className="font-mono">.env.local</code>, then restart the dev server.
          </p>
        ) : (
          <>
            <div className="space-y-1">
              <Label className="text-xs">wowsims export link</Label>
              <Input
                value={link}
                onChange={(e) => {
                  setLink(e.target.value);
                  setMsg(null);
                }}
                placeholder="https://www.wowsims.com/tbc/warrior/dps/#eJyr4ONiE2..."
                className="h-8 font-mono text-xs"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={pending || !link.trim()} onClick={() => save(link.trim())}>
                {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                Save setup
              </Button>
              {hasSim && (
                <Button size="sm" variant="outline" disabled={pending} onClick={() => save("")}>
                  Remove
                </Button>
              )}
            </div>
          </>
        )}
        {msg && (
          <p className={msg.ok ? "text-xs text-emerald-700" : "text-xs text-red-700"}>{msg.message}</p>
        )}
      </CardContent>
    </Card>
  );
}

export function SimPanel({
  slug,
  pulls,
  configured,
  hasSim,
}: {
  slug: string;
  pulls: SimPull[];
  configured: boolean;
  hasSim: boolean;
}) {
  const [mode, setMode] = React.useState<BrowseMode>("boss");
  const [pick, setPick] = React.useState(pulls[0] ? pullId(pulls[0]) : "");
  const [result, setResult] = React.useState<SimComparisonResult | null>(null);
  const [pending, start] = React.useTransition();

  /*
   * The selection is the pull itself, never the path taken to it — so flipping
   * between "by boss" and "by raid night" re-groups the dropdowns around
   * whatever is already chosen instead of resetting it. That's the whole point
   * of having both axes: they're two routes to the same thing.
   */
  const groups = React.useMemo(() => groupPulls(pulls, mode), [pulls, mode]);
  const chosen = pulls.find((p) => pullId(p) === pick);
  const activeGroup =
    (chosen && groups.find((g) => g.pulls.some((p) => pullId(p) === pick))) ?? groups[0];

  /** Moving to another boss/night lands on its best kill rather than nothing. */
  const pickGroup = (key: string) => {
    const group = groups.find((g) => g.key === key);
    if (group?.pulls[0]) setPick(pullId(group.pulls[0]));
  };

  const run = () => {
    if (!chosen) return;
    setResult(null);
    start(async () => {
      setResult(
        await runSimComparison({
          slug,
          reportCode: chosen.reportCode,
          fightId: chosen.fightId,
          actorName: chosen.actorName,
        }),
      );
    });
  };

  return (
    <div className="space-y-4">
      {(!hasSim || !configured) && <SimSetup slug={slug} configured={configured} hasSim={hasSim} />}

      {hasSim && configured && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Compare a pull against the sim</CardTitle>
            <p className="text-xs text-muted-foreground">
              The sim runs with the gear, talents and length of the pull you pick — so it answers
              “what would perfect play have produced, that night, in that kit”.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Browse by</span>
              {(["boss", "night"] as const).map((m) => (
                <Button
                  key={m}
                  size="sm"
                  variant={mode === m ? "default" : "outline"}
                  className="h-7"
                  onClick={() => setMode(m)}
                >
                  {m === "boss" ? "Boss" : "Raid night"}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-56 flex-1 space-y-1">
                <Label className="text-xs">{mode === "boss" ? "Boss" : "Raid night"}</Label>
                <Select value={activeGroup?.key ?? ""} onValueChange={pickGroup}>
                  <SelectTrigger>
                    <SelectValue placeholder={mode === "boss" ? "Pick a boss" : "Pick a night"} />
                  </SelectTrigger>
                  <SelectContent>
                    {sectionsOf(groups).map((sec, i) => (
                      <SelectGroup key={sec.section ?? `s${i}`}>
                        {sec.section && <SelectLabel>{sec.section}</SelectLabel>}
                        {sec.groups.map((g) => (
                          <SelectItem key={g.key} value={g.key}>
                            {g.label}
                            <span className="ml-2 text-xs text-muted-foreground">
                              {g.pulls.length} {mode === "boss" ? "kills" : "bosses"}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-56 flex-1 space-y-1">
                <Label className="text-xs">{mode === "boss" ? "Kill" : "Boss"}</Label>
                <Select value={pick} onValueChange={setPick}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pick a pull" />
                  </SelectTrigger>
                  <SelectContent>
                    {(activeGroup?.pulls ?? []).map((p) => (
                      <SelectItem key={pullId(p)} value={pullId(p)}>
                        {mode === "boss" ? shortDate(p.raidDate) : p.encounterName}
                        <span className="ml-2 text-xs text-muted-foreground">{pullStats(p)}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button disabled={pending || !chosen} onClick={run}>
                {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                Run comparison
              </Button>
            </div>
            {pulls.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No boss kills imported for this character yet.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {result?.status === "not-configured" && (
        <SimSetup slug={slug} configured={false} hasSim={hasSim} />
      )}
      {result?.status === "no-sim" && <SimSetup slug={slug} configured={configured} hasSim={false} />}
      {result?.status === "error" && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {result.message}
        </p>
      )}

      {result?.status === "ok" && (
        <>
          {/* What produced both numbers, before either number is shown. */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex flex-wrap items-baseline justify-between gap-2 text-base">
                <span>How this comparison was run</span>
                <span className="text-xs font-normal text-muted-foreground">
                  <span className="text-amber-600">▍</span> sim and pull differ{" "}
                  <span className="text-emerald-600">▍</span> they agree · hover * for why
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <SetupGrid rows={result.setup} />
            </CardContent>
          </Card>

          {/* Context next, deliberately — see the note at the top of this file. */}
          <Section
            title="What the sim assumed"
            summary={result.auditHeadline}
            aside={`${result.encounterName} · ${Math.round(result.durationMs / 1000)}s`}
            defaultOpen
          >
            <AuditGrid rows={result.audit.rows} />
            {result.notes.length > 0 && (
              <ul className="mt-2 space-y-1 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                {result.notes.map((n, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
                    {n}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/*
            The read-out. Deliberately AFTER the assumptions and before the
            rotation table: a gap explained by a missing raid buff isn't a
            rotation problem, and this is the only part of the panel that says
            which is which.
          */}
          <Section title="What the logs say" summary={result.findingsHeadline} defaultOpen>
            {result.findings.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing stands out — the pull matched the model closely enough that no single
                difference is worth calling out.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {result.findings.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span
                      className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                        f.good
                          ? "bg-emerald-500"
                          : f.kind === "context"
                            ? "bg-sky-500"
                            : f.kind === "uptime"
                              ? "bg-violet-500"
                              : "bg-amber-500"
                      }`}
                      title={
                        f.kind === "context"
                          ? "Outside the raider's control"
                          : f.kind === "uptime"
                            ? "Time not spent attacking"
                            : "The rotation itself"
                      }
                    />
                    <span>{f.text}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[11px] text-muted-foreground">
              <span className="text-sky-600">●</span> context ·{" "}
              <span className="text-violet-600">●</span> uptime ·{" "}
              <span className="text-amber-600">●</span> rotation ·{" "}
              <span className="text-emerald-600">●</span> ahead of the sim. Measurements, not
              verdicts — what to do about them is the officer&apos;s call.
            </p>
          </Section>

          <Section
            title="Rotation"
            summary="What was pressed, how often, and what it was worth."
            aside={
              result.loggedDps !== undefined && result.simDps !== undefined
                ? `logged ${result.loggedDps} dps · sim ${result.simDps} dps`
                : undefined
            }
            defaultOpen
          >
            <RotationSection result={result} />
          </Section>
        </>
      )}
    </div>
  );
}
