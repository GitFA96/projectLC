import type { Metadata } from "next";
import type * as React from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { Activity, GitCompareArrows } from "lucide-react";
import { getRepo } from "@/lib/data/repo";
import { AttendanceDetail } from "@/components/performance/attendance-detail";
import { CLASS_TEXT_COLORS } from "@/lib/constants/wow";
import {
  COMMENT_CATEGORY_LABELS,
  COMMENT_CATEGORY_VARIANT,
} from "@/lib/comments";
import type { CharacterComparisonView, ComparedCharacter } from "@/lib/types";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { SpecBadge } from "@/components/spec-badge";
import { WeekDots } from "@/components/week-dots";
import { ParseBadge } from "@/components/parse-badge";
import { ComparePicker, type PickerCharacter } from "@/components/compare/compare-picker";
import { CompareLogPicker } from "@/components/compare/compare-log-picker";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { pageView } from "@/lib/auth/view";
import { NoAccess } from "@/components/no-access";
import { compareText } from "@/lib/sort";

export const metadata: Metadata = { title: "Compare characters" };

type Search = Promise<Record<string, string | string[] | undefined>>;

/** Indices of the leader(s) in a value set; empty when fewer than 2 have data. */
function bestIndices(values: (number | undefined)[], dir: "high" | "low"): Set<number> {
  const defined = values.filter((v): v is number => v !== undefined);
  if (defined.length < 2) return new Set();
  const target = dir === "high" ? Math.max(...defined) : Math.min(...defined);
  const out = new Set<number>();
  values.forEach((v, i) => {
    if (v === target) out.add(i);
  });
  return out;
}

export default async function ComparePage({ searchParams }: { searchParams: Search }) {
  const access = await pageView("roster.view", { returnTo: "/compare" });
  if (!access.allowed) return <NoAccess reason={access.reason} />;

  const sp = await searchParams;
  const raw = sp.chars;
  const slugs = (Array.isArray(raw) ? raw : raw ? [raw] : [])
    .flatMap((s) => s.split(","))
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  // Per-character log filters: r_<slug>=code,code (preserved verbatim through edits).
  const reportFilter: Record<string, string[]> = {};
  for (const [key, val] of Object.entries(sp)) {
    if (!key.startsWith("r_")) continue;
    const codes = (Array.isArray(val) ? val : val ? [val] : [])
      .flatMap((v) => v.split(","))
      .map((s) => s.trim())
      .filter(Boolean);
    if (codes.length > 0) reportFilter[key.slice(2).toLowerCase()] = codes;
  }

  const repo = await getRepo();
  const [view, characters] = await Promise.all([
    repo.getComparison(slugs, reportFilter),
    repo.listCharacters(),
  ]);
  const chars = view.characters.map((c) => c.character.name.toLowerCase());

  const all: PickerCharacter[] = characters
    .map((s) => ({
      slug: s.character.name.toLowerCase(),
      name: s.character.name,
      wowClass: s.character.class,
      spec: s.character.spec,
      status: s.character.status,
    }))
    .sort((a, b) => compareText(a.name, b.name));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Compare characters"
        description="Up to four characters side-by-side: damage, performance, attendance, consumables, buff & debuff uptime, and the officer comment log."
      />

      <ComparePicker all={all} selected={view.characters.map((c) => c.character.name.toLowerCase())} />

      {view.characters.length === 0 ? (
        <EmptyState
          title="Pick characters to compare"
          description="Add two to four characters above to line up their raid contribution — output, parses, attendance, consumables and the buffs/debuffs they keep up."
        />
      ) : (
        <>
          <ComparisonMatrix view={view} chars={chars} explicitFilter={reportFilter} />
          <CommentsSection view={view} />
        </>
      )}
    </div>
  );
}

/** The aligned metric matrix: one column per character, sections of metrics. */
function ComparisonMatrix({
  view,
  chars: charSlugs,
  explicitFilter,
}: {
  view: CharacterComparisonView;
  /** All compared slugs in order — for the log pickers' URL rebuild. */
  chars: string[];
  /** Current r_<slug> filters in the URL — preserved across picker edits. */
  explicitFilter: Record<string, string[]>;
}) {
  const chars = view.characters;
  const cols = `minmax(8.5rem, 1.3fr) repeat(${chars.length}, minmax(6.5rem, 1fr))`;

  return (
    <Card className="overflow-x-auto">
      <div className="min-w-[36rem]">
        {/* Identity header */}
        <div style={{ gridTemplateColumns: cols }} className="grid items-end gap-x-2 px-3 pb-3 pt-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Metric
          </div>
          {chars.map((c) => (
            <CharacterHead key={c.character.id} c={c} chars={charSlugs} explicitFilter={explicitFilter} />
          ))}
        </div>

        <SectionLabel cols={cols} label="Damage / output" />
        <MetricRow
          cols={cols}
          label="Median output"
          title="Median dps across logged pulls (hps for healers)"
          values={chars.map((c) => c.output)}
          dir="high"
          format={(v, i) => `${Math.round(v).toLocaleString("en-US")} ${chars[i].outputUnit}`}
        />

        <SectionLabel cols={cols} label="Performance" />
        <MetricRow
          cols={cols}
          label="Median parse"
          title="Median Warcraft Logs percentile"
          values={chars.map((c) => c.medianParse)}
          dir="high"
          format={(v) => <ParseBadge pct={v} />}
        />
        <MetricRow
          cols={cols}
          label="Best parse"
          values={chars.map((c) => c.bestParse)}
          dir="high"
          format={(v) => <ParseBadge pct={v} />}
        />
        <MetricRow
          cols={cols}
          label="Ilvl-bracket median"
          title="Percentile within the item-level bracket — gear-adjusted"
          values={chars.map((c) => c.medianBracket)}
          dir="high"
          format={(v) => Math.round(v)}
        />
        <MetricRow
          cols={cols}
          label="Deaths"
          title="Total deaths across logged pulls (lower is better)"
          values={chars.map((c) => (c.hasLogs ? c.deaths : undefined))}
          dir="low"
          format={(v) => v}
        />
        <MetricRow
          cols={cols}
          label="Logged pulls"
          values={chars.map((c) => (c.hasLogs ? c.fights : undefined))}
          dir="high"
          format={(v, i) => `${v} · ${chars[i].reports} report${chars[i].reports === 1 ? "" : "s"}`}
          muteBest
        />

        <SectionLabel cols={cols} label="Attendance" />
        <AttendanceRow cols={cols} chars={chars} />
        <MetricRow
          cols={cols}
          label={chars[0]?.attendance?.scoreBasis === "week" ? "Weeks %" : "Raids %"}
          title="Attendance as this guild counts it, since first appearance"
          values={chars.map((c) => c.attendance?.scorePct)}
          dir="high"
          format={(v) => `${v}%`}
        />
        <MetricRow
          cols={cols}
          label="Pull coverage"
          title="Share of boss pulls present for, on attended nights"
          values={chars.map((c) => c.attendance?.pullPct)}
          dir="high"
          format={(v) => `${v}%`}
        />

        <SectionLabel cols={cols} label="Consumables" />
        <MetricRow cols={cols} label="Prepared" title="Flask/elixirs AND food at pull"
          values={chars.map((c) => (c.hasLogs ? c.preparedPct : undefined))} dir="high" format={(v) => `${v}%`} />
        <MetricRow cols={cols} label="Flask" title="Pulls with a flask up — lasts the night and survives a death"
          values={chars.map((c) => (c.hasLogs ? c.flaskPct : undefined))} dir="high" format={(v) => `${v}%`} />
        <MetricRow cols={cols} label="Elixirs" title="Pulls with at least one elixir up — cheaper, and lost on death"
          values={chars.map((c) => (c.hasLogs ? c.elixirsPct : undefined))} dir="high" format={(v) => `${v}%`} />
        <MetricRow cols={cols} label="Food"
          values={chars.map((c) => (c.hasLogs ? c.foodPct : undefined))} dir="high" format={(v) => `${v}%`} />
        <MetricRow cols={cols} label="Weapon buff" title="Oil / stone / poison / imbue at pull"
          values={chars.map((c) => (c.hasLogs ? c.weaponBuffPct : undefined))} dir="high" format={(v) => `${v}%`} />
        <MetricRow cols={cols} label="Potions / pull"
          values={chars.map((c) => (c.hasLogs ? c.potionsPerFight : undefined))} dir="high" format={(v) => v} muteBest />
        <MetricRow cols={cols} label="Gold / raid"
          title="≈ consumable gold per raid at default prices — in-fight items plus prep buffs (re-bought on deaths and over long nights)"
          values={chars.map((c) => c.goldPerRaid)} dir="high" muteBest
          format={(v) => `≈${v.toLocaleString("en-US")}g`} />

        <SectionLabel cols={cols} label="Cooldowns" />
        <MetricRow cols={cols} label="CDs / pull"
          title="Major class cooldowns pressed per logged pull"
          values={chars.map((c) => (c.hasLogs ? c.cooldownsPerFight : undefined))} dir="high"
          format={(v, i) => `${v} · ×${chars[i].cooldownsTotal}`} />
        <BreakdownRow cols={cols} label="Most pressed" chars={chars} />

        <SectionLabel cols={cols} label="In-fight items" />
        <MetricRow cols={cols} label="Sappers"
          values={chars.map((c) => (c.hasLogs ? c.sappers : undefined))} dir="high" format={(v) => `×${v}`} />
        <MetricRow cols={cols} label="Healthstones"
          values={chars.map((c) => (c.hasLogs ? c.healthstones : undefined))} dir="high" format={(v) => `×${v}`} />
        <MetricRow cols={cols} label="Runes / mana gems"
          values={chars.map((c) => (c.hasLogs ? c.runes : undefined))} dir="high" format={(v) => `×${v}`} />
        <MetricRow cols={cols} label="Drums"
          values={chars.map((c) => (c.hasLogs ? c.drums : undefined))} dir="high" format={(v) => `×${v}`} />

        {view.upkeepTracks.length > 0 && (
          <>
            <SectionLabel cols={cols} label="Buff & debuff uptime" />
            {view.upkeepTracks.map((track) => (
              <MetricRow
                key={track.name}
                cols={cols}
                label={track.name}
                title={
                  track.kind === "debuff"
                    ? "Best-target uptime; the sub-line is boss-only uptime and ≈ landed casts per pull"
                    : "Maintained on a friendly target"
                }
                values={chars.map((c) => c.upkeep.find((u) => u.name === track.name)?.pct)}
                dir="high"
                format={(v, i) => {
                  const entry = chars[i].upkeep.find((u) => u.name === track.name);
                  const sub = [
                    entry?.bossPct !== undefined && track.kind === "debuff" ? `boss ${entry.bossPct}%` : undefined,
                    entry?.appliesPerFight !== undefined && entry.appliesPerFight > 0
                      ? `×${entry.appliesPerFight}/pull`
                      : undefined,
                  ].filter(Boolean);
                  return (
                    <span className="inline-flex flex-col items-end">
                      <span>{v}%</span>
                      {sub.length > 0 && (
                        <span className="text-[10px] font-normal text-muted-foreground">{sub.join(" · ")}</span>
                      )}
                    </span>
                  );
                }}
              />
            ))}
          </>
        )}
        <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">
          Output, parses, deaths, consumables and uptime reflect each column&apos;s selected logs
          (pick them under a name). Attendance and comments are always all-time.
        </p>
      </div>
    </Card>
  );
}

function CharacterHead({
  c,
  chars,
  explicitFilter,
}: {
  c: ComparedCharacter;
  chars: string[];
  explicitFilter: Record<string, string[]>;
}) {
  const slug = c.character.name.toLowerCase();
  const specMismatch =
    c.loggedSpec &&
    c.loggedSpec.replace(/\s/g, "").toLowerCase() !== c.character.spec.replace(/\s/g, "").toLowerCase();
  return (
    <div className="flex min-w-0 flex-col items-end space-y-1 text-right">
      <Link
        href={`/characters/${encodeURIComponent(slug)}`}
        className="block w-full truncate font-semibold leading-tight hover:underline"
        style={{ color: CLASS_TEXT_COLORS[c.character.class] }}
      >
        {c.character.name}
      </Link>
      <SpecBadge spec={c.loggedSpec ?? c.character.spec} wowClass={c.character.class} />
      <p className="w-full truncate text-[11px] text-muted-foreground">
        {c.character.role}
        {c.mainCharacterName && ` · alt of ${c.mainCharacterName}`}
        {specMismatch && " · logs differ"}
      </p>
      <div className="flex items-center gap-2">
        <Link
          href={`/characters/${encodeURIComponent(slug)}/performance`}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          <Activity className="h-3 w-3" /> profile
        </Link>
        <CompareLogPicker
          slug={slug}
          chars={chars}
          explicitFilter={explicitFilter}
          reports={c.availableReports}
          selected={c.selectedReportCodes}
        />
      </div>
    </div>
  );
}

function SectionLabel({ cols, label }: { cols: string; label: string }) {
  return (
    <div style={{ gridTemplateColumns: cols }} className="grid border-t bg-muted/40 px-3 py-1.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

/** A numeric metric row that highlights the leader (unless muteBest). */
function MetricRow({
  cols,
  label,
  title,
  values,
  dir,
  format,
  muteBest,
}: {
  cols: string;
  label: string;
  title?: string;
  values: (number | undefined)[];
  dir: "high" | "low";
  format: (value: number, index: number) => React.ReactNode;
  muteBest?: boolean;
}) {
  const best = muteBest ? new Set<number>() : bestIndices(values, dir);
  return (
    <div style={{ gridTemplateColumns: cols }} className="grid items-center gap-x-2 border-t px-3 py-1.5">
      <div className="truncate text-xs text-muted-foreground" title={title}>
        {label}
      </div>
      {values.map((v, i) => (
        <div
          key={i}
          className={cn(
            "text-right text-sm tabular-nums",
            best.has(i) && "font-semibold text-success-ink",
          )}
        >
          {v === undefined ? <span className="text-muted-foreground/40">—</span> : format(v, i)}
        </div>
      ))}
    </div>
  );
}

/** Top cooldowns per column — names, not a number, so no leader highlight. */
function BreakdownRow({ cols, label, chars }: { cols: string; label: string; chars: ComparedCharacter[] }) {
  return (
    <div style={{ gridTemplateColumns: cols }} className="grid items-start gap-x-2 border-t px-3 py-1.5">
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      {chars.map((c) => (
        <div key={c.character.id} className="text-right text-[11px] text-muted-foreground">
          {c.cooldownBreakdown.length === 0 ? (
            <span className="text-muted-foreground/40">—</span>
          ) : (
            c.cooldownBreakdown
              .slice(0, 3)
              .map((b) => `${b.name} ×${b.count}`)
              .join(", ") + (c.cooldownBreakdown.length > 3 ? ", …" : "")
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Attendance row: raids attended out of raids logged, with the week dots
 * beneath. Ranked on the same number it shows — it used to show a reset-week
 * ratio while the leader was picked on it and the roster sorted on the raid
 * percentage, so three views of "attendance" disagreed about which it meant.
 */
function AttendanceRow({ cols, chars }: { cols: string; chars: ComparedCharacter[] }) {
  const ratios = chars.map((c) =>
    c.attendance && c.attendance.raidsTracked > 0
      ? c.attendance.raidsAttended / c.attendance.raidsTracked
      : undefined,
  );
  const best = bestIndices(ratios, "high");
  return (
    <div style={{ gridTemplateColumns: cols }} className="grid items-center gap-x-2 border-t px-3 py-1.5">
      <div className="text-xs text-muted-foreground">Raids logged</div>
      {chars.map((c, i) => {
        const a = c.attendance;
        if (!a || a.raidsTracked === 0) {
          return (
            <div key={c.character.id} className="text-right text-muted-foreground/40">
              —
            </div>
          );
        }
        return (
          <AttendanceDetail key={c.character.id} attendance={a} align="right">
            <span className="flex flex-col items-end gap-0.5">
              <span className={cn("text-sm tabular-nums", best.has(i) && "font-semibold text-success-ink")}>
                {a.raidsAttended}/{a.raidsTracked}
              </span>
              <WeekDots weeks={a.weeks} />
            </span>
          </AttendanceDetail>
        );
      })}
    </div>
  );
}

/** Per-character comment stacks — the detailed officer log, side by side. */
function CommentsSection({ view }: { view: CharacterComparisonView }) {
  const chars = view.characters;
  const anyComments = chars.some((c) => c.comments.length > 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitCompareArrows className="h-4 w-4 text-muted-foreground" />
          Comments
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          The officer log for each character — add and manage notes from their profile.
        </p>
      </CardHeader>
      <CardContent>
        {!anyComments ? (
          <p className="py-1 text-sm text-muted-foreground">
            No comments on any of these characters yet. Add notes from a character&apos;s profile and
            they show up here.
          </p>
        ) : (
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: `repeat(${chars.length}, minmax(0, 1fr))` }}
          >
            {chars.map((c) => {
              const slug = c.character.name.toLowerCase();
              return (
                <div key={c.character.id} className="min-w-0 space-y-2">
                  <Link
                    href={`/characters/${encodeURIComponent(slug)}`}
                    className="block truncate text-sm font-semibold hover:underline"
                    style={{ color: CLASS_TEXT_COLORS[c.character.class] }}
                  >
                    {c.character.name}
                  </Link>
                  {c.comments.length === 0 ? (
                    <p className="text-xs text-muted-foreground/60">No comments.</p>
                  ) : (
                    <ul className="space-y-2">
                      {c.comments.map((cm) => (
                        <li key={cm.id} className="rounded-md border bg-muted/20 p-2">
                          <div className="mb-1 flex flex-wrap items-center gap-1.5">
                            <Badge variant={COMMENT_CATEGORY_VARIANT[cm.category]} className="font-normal">
                              {COMMENT_CATEGORY_LABELS[cm.category]}
                            </Badge>
                            <span className="text-[10px] text-muted-foreground">
                              {format(parseISO(cm.createdAt), "d MMM")}
                              {cm.author && ` · ${cm.author}`}
                            </span>
                          </div>
                          <p className="whitespace-pre-wrap text-xs">{cm.body}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
