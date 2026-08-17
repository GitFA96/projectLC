"use client";

import * as React from "react";
import { format, parseISO } from "date-fns";
import { Check, Loader2, X } from "lucide-react";
import { setWeekExcused } from "@/app/characters/[name]/attendance-actions";
import type { AttendanceSummary, AttendanceWeek } from "@/lib/types";
import { PHASES } from "@/lib/constants/wow";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Per-reset attendance with an excuse toggle. Each reset week the guild logged
 * (since the character's first appearance) is a row: raided / missed / excused.
 * Clicking "Excuse" drops that week from the attendance markup; it stays shown
 * as a distinct state so the gap is never hidden.
 */
export function AttendanceWeeks({
  characterId,
  attendance,
}: {
  characterId: string;
  attendance: AttendanceSummary;
}) {
  const [pendingWeek, setPendingWeek] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, startTransition] = React.useTransition();

  const toggle = (weekStart: string, excused: boolean) => {
    setError(null);
    setPendingWeek(weekStart);
    startTransition(async () => {
      const res = await setWeekExcused({ characterId, weekStart, excused });
      if (!res.ok) setError(res.message ?? "Update failed.");
      setPendingWeek(null);
    });
  };

  /*
   * The whole record, newest first — a check-in reads backwards from now.
   *
   * The headline counts every week (`allWeeks`), because that is the figure the
   * guild judges on: a raider's record is their record, and a window that
   * quietly forgives an old stretch of absences is a different claim than the
   * one the number appears to make. The last-ten line under it is the secondary
   * read — "and lately?" — which is a different question, not a smaller version
   * of the same one.
   */
  const weeks = [...attendance.allWeeks].reverse();
  const recent = attendance.weeks;
  const recentAttended = attendance.weeksAttended;

  const [shown, setShown] = React.useState(PAGE);
  const visible = weeks.slice(0, shown);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-baseline gap-2">
          Attendance by reset
          {/* The window belongs next to the fraction. This figure covers the
              last N resets, while the per-raid figure above covers every raid
              since the character's first — two different denominators answering
              what looks like one question. */}
          <span className="text-xs font-normal text-muted-foreground">
            raided {attendance.allWeeksAttended}/{attendance.allWeeksTracked} counted week
            {attendance.allWeeksTracked === 1 ? "" : "s"}, all time
            {attendance.weeksExcused > 0 && ` · ${attendance.weeksExcused} excused`}
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          One row per reset week (EU, Wednesday) the guild logged.{" "}
          <strong className="font-medium">A week counts as raided if they made any raid in it</strong>{" "}
          — one night scores the same as three, so this figure sits above the per-raid one rather
          than matching it. Excuse a week an officer cleared in advance — it stops counting against
          the markup but stays visible.
        </p>
        {recent.length > 0 && (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              Lately: {recentAttended}/{attendance.weeksTracked} of the last {recent.length}
            </span>{" "}
            — the same weeks, read over a shorter run. A raider back to full attendance after a
            gap reads well here and still carries the gap in the all-time figure above.
          </p>
        )}
      </CardHeader>
      <CardContent>
        {weeks.length === 0 ? (
          <p className="py-1 text-sm text-muted-foreground">No logged reset weeks yet.</p>
        ) : (
          groupByPhase(visible).map((group) => (
          <div key={group.key} className="mb-3 last:mb-0">
            <p className="flex items-baseline gap-2 border-b pb-1 text-xs font-medium">
              {group.label}
              <span className="font-normal text-muted-foreground">
                raided {group.attended}/{group.tracked} counted week
                {group.tracked === 1 ? "" : "s"} shown
              </span>
            </p>
          <ul className="divide-y">
            {group.weeks.map((w) => {
              const busy = isPending && pendingWeek === w.start;
              return (
                <li key={w.start} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="flex items-center gap-2 text-sm">
                    <span
                      className={cn(
                        "inline-block h-2.5 w-2.5 rounded-full",
                        w.excused
                          ? "border border-dashed border-muted-foreground/50 bg-muted"
                          : w.attended
                            ? "bg-success"
                            : "border border-warn bg-warn/30",
                      )}
                    />
                    <span className="tabular-nums">{format(parseISO(w.start), "d MMM yyyy")}</span>
                    <span
                      className={cn(
                        "text-xs",
                        w.excused
                          ? "text-muted-foreground"
                          : w.attended
                            ? "text-success-ink"
                            : "text-warn-ink",
                      )}
                    >
                      {w.excused ? "excused" : w.attended ? "raided" : "missed"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      · {w.reports} log{w.reports === 1 ? "" : "s"}
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => toggle(w.start, !w.excused)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs transition-colors hover:bg-accent disabled:opacity-50",
                      w.excused && "border-border",
                    )}
                  >
                    {busy ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : w.excused ? (
                      <>
                        <X className="h-3 w-3" /> Count again
                      </>
                    ) : (
                      <>
                        <Check className="h-3 w-3" /> Excuse
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          </div>
          ))
        )}
        {shown < weeks.length && (
          <button
            type="button"
            onClick={() => setShown((n) => n + PAGE)}
            className="mt-2 w-full rounded-md border py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Show {Math.min(PAGE, weeks.length - shown)} earlier week
            {Math.min(PAGE, weeks.length - shown) === 1 ? "" : "s"} · {weeks.length - shown} left
          </button>
        )}
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

/** Weeks revealed per click. Long histories open at a readable size. */
const PAGE = 10;

/**
 * Split the weeks on screen into the tiers they were raided in.
 *
 * The tier is what makes an old week legible: "missed, 14 Jan" means nothing
 * two tiers later, while "missed, during SSC/TK" is a fact about a raider that
 * an officer can weigh. Consecutive weeks of one phase form one group, so a
 * guild that went back to an old zone for a night gets two groups rather than
 * one mislabelled run — the list stays in date order either way.
 *
 * Counts are per group and say "shown", because paging in earlier weeks changes
 * them; the figure that does not move is the all-time one in the header.
 */
function groupByPhase(weeks: AttendanceWeek[]) {
  const groups: { key: string; label: string; weeks: AttendanceWeek[]; attended: number; tracked: number }[] = [];
  for (const w of weeks) {
    const label = w.phase === undefined ? "Tier not recorded" : (PHASES.find((p) => p.phase === w.phase)?.name ?? `Phase ${w.phase}`);
    const zones = w.phase === undefined ? undefined : PHASES.find((p) => p.phase === w.phase)?.zones.join(" + ");
    const heading = zones ? `${label} — ${zones}` : label;
    const last = groups.at(-1);
    if (last && last.label === heading) {
      last.weeks.push(w);
    } else {
      groups.push({ key: `${heading}-${w.start}`, label: heading, weeks: [w], attended: 0, tracked: 0 });
    }
  }
  for (const g of groups) {
    const counted = g.weeks.filter((w) => !w.excused);
    g.tracked = counted.length;
    g.attended = counted.filter((w) => w.attended).length;
  }
  return groups;
}
