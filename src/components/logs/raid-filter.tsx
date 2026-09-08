"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { filterReportsByRaids } from "@/lib/analysis/raid-scope";
import { nightHref, toggleRaid, withRaidPicks } from "@/components/logs/raid-filter-url";

/**
 * One night, reduced to what the picker draws.
 *
 * Deliberately not `WclReportView`: this crosses to the browser, and a report
 * carries its unclassified-aura dump and every enemy cast with it. Twenty-four
 * of those is a payload nobody looks at, for a row of dates.
 */
export interface PickerNight {
  code: string;
  /** Preformatted on the server — "6 Sep". Formatting it twice can disagree. */
  label: string;
  /** The hover: full title, raid label, bosses and headcount. */
  title: string;
  /** Which raids this night ran, from its bosses. */
  raids: string[];
}

export interface RaidChip {
  raid: string;
  /** "BT", "MH" — the label. `Other` has none and uses its own name. */
  short?: string;
  count: number;
}

/**
 * Which raids to show nights for — the filter above the list of runs.
 *
 * **Filtering happens here, not on the server.** The nights are already on the
 * page; narrowing them is a display question, and a round trip per press would
 * re-render the whole season dashboard to shorten a row of dates.
 *
 * The URL is still kept in step, through `history.replaceState` — the shallow
 * update Next documents for exactly this. That is what makes a picked filter
 * survive clicking a night: the link carries the selection, the server hands it
 * back as `initial`, and the officer lands on the same shortened list rather
 * than on all twenty-four again.
 *
 * Multi-select, because the raids a night ran are not exclusive and neither is
 * the question — "Black Temple and Hyjal" is one evening here most weeks.
 */
export function RaidFilter({
  nights,
  chips,
  initial,
  activeCode,
  allHref,
  allLabel,
}: {
  nights: PickerNight[];
  chips: RaidChip[];
  /** The picks the URL arrived with, already pruned to what this scope offers. */
  initial: string[];
  activeCode?: string;
  /** The season rollup for this scope — never narrowed by these chips. */
  allHref: string;
  allLabel: string;
}) {
  const searchParams = useSearchParams();
  /*
   * Seeded from the URL once, then owned here.
   *
   * There is no effect syncing the two back, and there must not be: pressing a
   * chip rewrites the URL without a navigation, so the prop cannot have moved
   * on its own. When the URL genuinely does change — a pasted link, a switch of
   * heading — the picker is remounted on a key built from these picks, which
   * resets this the way React asks rather than by adjusting state in an effect.
   */
  const [picked, setPicked] = React.useState<string[]>(initial);

  /**
   * Take the selection, and rewrite `?raid=` without a navigation — the
   * shallow update Next documents for exactly this.
   */
  const apply = (next: string[]) => {
    setPicked(next);
    const query = withRaidPicks(searchParams.toString(), next);
    window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
  };

  const shown = filterReportsByRaids(nights, (n) => n.raids, picked);

  return (
    <div className="space-y-2 rounded-lg border bg-card/40 p-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-0.5 text-xs font-medium text-muted-foreground">Raids</span>
        {chips.map((chip) => {
          const on = picked.includes(chip.raid);
          return (
            <button
              key={chip.raid}
              type="button"
              onClick={() => apply(toggleRaid(picked, chip.raid))}
              aria-pressed={on}
              title={`${on ? "Stop showing" : "Show"} ${chip.raid} nights`}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-accent",
                on && "border-foreground/30 bg-primary text-primary-foreground hover:bg-primary",
              )}
            >
              {chip.short ?? chip.raid}
              <span className={cn("tabular-nums", !on && "text-muted-foreground")}>{chip.count}</span>
            </button>
          );
        })}
        {picked.length > 0 && (
          <button
            type="button"
            onClick={() => apply([])}
            className="inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-3 w-3" /> Clear
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {/* The season rollup spans the whole heading whatever is picked above:
            a rollup of one instance would be a different number wearing the
            same name. It sits here because it is the other thing you can open. */}
        <Link href={allHref} className={cn(PILL, activeCode === "all" && ACTIVE_PILL)}>
          {allLabel}
        </Link>
        <span className="text-xs text-muted-foreground">
          {picked.length > 0
            ? `${shown.length} of ${nights.length} nights`
            : `${nights.length} night${nights.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {shown.length === 0 ? (
        <p className="text-xs text-muted-foreground">No night here ran those raids.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {shown.map((night) => (
            <Link
              key={night.code}
              href={nightHref(night.code, picked)}
              title={night.title}
              className={cn(PILL, night.code === activeCode && ACTIVE_PILL)}
            >
              {night.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

const PILL = "rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-accent";
const ACTIVE_PILL = "border-foreground/30 bg-primary text-primary-foreground hover:bg-primary";
