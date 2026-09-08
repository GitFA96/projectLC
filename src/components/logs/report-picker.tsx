import Link from "next/link";
import { format, parseISO } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  RAID_SCOPES,
  groupReportsByRaid,
  type RaidScope,
} from "@/lib/analysis/raid-scope";
import type { WclReportView } from "@/lib/types";

/**
 * Which nights there are, and whose they were.
 *
 * Two levels, and they answer different questions. **Scope** is the heading —
 * the guild's own raids, a community one-off, a pug — and it decides what the
 * rest of the app counts, so it is the coarse switch and it comes first.
 * **Raid** is a way to find a night inside a scope, and nothing more: an
 * officer looking for last month's Hyjal should not have to read six weeks of
 * dates. Picking a raid does not narrow "All raids", which always spans the
 * whole scope — a season rollup of a single instance would be a different
 * number wearing the same name.
 *
 * A night that ran two instances is listed under both, because that is where
 * somebody will look for it. It is the same night and the same link.
 */
export function ReportPicker({
  reports,
  scope,
  activeCode,
}: {
  reports: WclReportView[];
  /** The scope being shown — the heading whose nights are listed. */
  scope: RaidScope;
  /** The report open right now, or `"all"` for the season rollup. */
  activeCode?: string;
}) {
  const counts = new Map<RaidScope, number>();
  for (const r of reports) counts.set(r.scope, (counts.get(r.scope) ?? 0) + 1);
  const mine = reports.filter((r) => r.scope === scope);
  const current = RAID_SCOPES.find((s) => s.scope === scope) ?? RAID_SCOPES[0];
  const groups = groupReportsByRaid(mine, (r) => r.raids);

  return (
    <div className="space-y-2.5">
      {/*
       * Every scope is offered, including the empty ones — "there are no pug
       * raids" is an answer, and a heading that appears the day somebody tags
       * one is a heading nobody knew to look for.
       */}
      <div className="flex flex-wrap items-center gap-1.5">
        {RAID_SCOPES.map((s) => {
          const n = counts.get(s.scope) ?? 0;
          const active = s.scope === scope;
          return (
            <Link
              key={s.scope}
              href={allHref(s.scope)}
              title={s.blurb}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent",
                active && "border-foreground/30 bg-primary text-primary-foreground hover:bg-primary",
                n === 0 && !active && "text-muted-foreground",
              )}
            >
              {s.label}
              <span className={cn("text-xs tabular-nums", !active && "text-muted-foreground")}>
                {n}
              </span>
            </Link>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">{current.blurb}</p>

      {mine.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No {current.label.toLowerCase()} raids yet. Any imported report can be filed as one on the{" "}
          <Link href="/guild/import?tab=wcl" className="underline underline-offset-2 hover:text-foreground">
            import page
          </Link>
          .
        </p>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Link href={allHref(scope)} className={cn(PILL, activeCode === "all" && ACTIVE_PILL)}>
              All {current.label.toLowerCase()} raids
            </Link>
            <span className="text-xs text-muted-foreground">
              {mine.length} night{mine.length === 1 ? "" : "s"}
            </span>
          </div>
          {groups.map((group) => (
            <div key={group.raid} className="flex flex-wrap items-baseline gap-1.5">
              <Badge
                variant="muted"
                className="min-w-24 justify-center font-normal"
                title={group.raid}
              >
                {group.short ?? group.raid}
              </Badge>
              {group.reports.map((r) => (
                <Link
                  key={r.report.code}
                  href={`/logs?report=${encodeURIComponent(r.report.code)}`}
                  title={`${r.report.title}${r.report.zone ? ` · ${r.report.zone}` : ""} — ${r.killCount}/${r.encounterCount} bosses, ${r.playerCount} raiders`}
                  className={cn(PILL, r.report.code === activeCode && ACTIVE_PILL)}
                >
                  {format(parseISO(r.report.startTime), "d MMM")}
                </Link>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const PILL = "rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-accent";
const ACTIVE_PILL =
  "border-foreground/30 bg-primary text-primary-foreground hover:bg-primary";

/**
 * A scope's landing link — its season rollup.
 *
 * The guild's keeps the bare `?report=all` it has always had, so every link
 * anybody bookmarked or wrote into a doc still lands where it did.
 */
function allHref(scope: RaidScope): string {
  return scope === "guild" ? "/logs?report=all" : `/logs?report=all&scope=${scope}`;
}
