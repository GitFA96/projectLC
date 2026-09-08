import Link from "next/link";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import {
  RAID_SCOPES,
  groupReportsByRaid,
  keepOfferedRaids,
  type RaidScope,
} from "@/lib/analysis/raid-scope";
import { RaidFilter, type PickerNight, type RaidChip } from "@/components/logs/raid-filter";
import type { WclReportView } from "@/lib/types";

/**
 * Which nights there are, and whose they were.
 *
 * Two levels, and they answer different questions. **Scope** is the heading —
 * the guild's own raids, a community one-off, a pug — and it decides what the
 * rest of the app counts, so it is the coarse switch and it comes first, as
 * links: changing it changes what the page is about.
 *
 * **Raid** is a filter over the nights inside a heading, and nothing more. It
 * is multi-select and it presses instantly, because the nights are already on
 * the page — see `RaidFilter`. Picking a raid does not narrow "All raids",
 * which always spans the whole heading: a season rollup of a single instance
 * would be a different number wearing the same name.
 *
 * A night that ran two instances answers to both chips. It is listed once,
 * which is the point of the chips replacing a section per raid — most nights
 * here run SSC and TK together, so sections listed most dates twice and cost
 * five rows to say what one row says.
 */
export function ReportPicker({
  reports,
  scope,
  raids,
  activeCode,
}: {
  reports: WclReportView[];
  /** The scope being shown — the heading whose nights are listed. */
  scope: RaidScope;
  /** Raids the URL asked to show, before pruning to what this scope has. */
  raids: string[];
  /** The report open right now, or `"all"` for the season rollup. */
  activeCode?: string;
}) {
  const counts = new Map<RaidScope, number>();
  for (const r of reports) counts.set(r.scope, (counts.get(r.scope) ?? 0) + 1);
  const mine = reports.filter((r) => r.scope === scope);
  const current = RAID_SCOPES.find((s) => s.scope === scope) ?? RAID_SCOPES[0];

  // One chip per raid this heading actually holds, in TBC order, with how many
  // nights ran it — a chip for a raid nobody here raided would be a dead press.
  const chips: RaidChip[] = groupReportsByRaid(mine, (r) => r.raids).map((group) => ({
    raid: group.raid,
    short: group.short,
    count: group.reports.length,
  }));

  /*
   * Pruned here, on the server, so a raid left in the URL by another heading
   * cannot select a chip that isn't drawn — and so the remount key below is
   * built from what the filter will actually hold.
   */
  const offered = keepOfferedRaids(
    raids,
    chips.map((c) => c.raid),
  );

  const nights: PickerNight[] = mine.map((r) => ({
    code: r.report.code,
    // Formatted here rather than in the browser: this renders on the server and
    // hydrates on the client, and a date computed twice can disagree.
    label: format(parseISO(r.report.startTime), "d MMM"),
    title: `${r.report.title}${r.report.zone ? ` · ${r.report.zone}` : ""} — ${r.killCount}/${r.encounterCount} bosses, ${r.playerCount} raiders`,
    raids: r.raids,
  }));

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
          <Link
            href="/guild/import?tab=wcl"
            className="underline underline-offset-2 hover:text-foreground"
          >
            import page
          </Link>
          .
        </p>
      ) : (
        <RaidFilter
          /*
           * Remount when the URL's picks genuinely change — a pasted link, or a
           * switch of heading. The filter owns its selection once mounted (a
           * chip press rewrites the URL without a navigation), so this is what
           * resets it, rather than an effect adjusting state on a prop.
           */
          key={offered.join("|")}
          nights={nights}
          chips={chips}
          initial={offered}
          activeCode={activeCode}
          allHref={allHref(scope)}
          allLabel={`All ${current.label.toLowerCase()} raids`}
        />
      )}
    </div>
  );
}

/**
 * A scope's landing link — its season rollup.
 *
 * The guild's keeps the bare `?report=all` it has always had, so every link
 * anybody bookmarked or wrote into a doc still lands where it did. Raid picks
 * are deliberately dropped: this is the switch that changes what the page is
 * about, and carrying a guild raid's chip into the pug heading would land on a
 * filter with nothing to match.
 */
function allHref(scope: RaidScope): string {
  return scope === "guild" ? "/logs?report=all" : `/logs?report=all&scope=${scope}`;
}
