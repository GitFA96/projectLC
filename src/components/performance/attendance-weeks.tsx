"use client";

import * as React from "react";
import { format, parseISO } from "date-fns";
import { Check, Loader2, X } from "lucide-react";
import { setWeekExcused } from "@/app/characters/[name]/attendance-actions";
import type { AttendanceSummary } from "@/lib/types";
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

  // Newest week first reads best for a check-in.
  const weeks = [...attendance.weeks].reverse();

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
            raided {attendance.weeksAttended}/{attendance.weeksTracked} counted week
            {attendance.weeksTracked === 1 ? "" : "s"}
            {attendance.weeks.length > 0 &&
              ` of the last ${attendance.weeks.length} the guild logged`}
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
      </CardHeader>
      <CardContent>
        {weeks.length === 0 ? (
          <p className="py-1 text-sm text-muted-foreground">No logged reset weeks yet.</p>
        ) : (
          <ul className="divide-y">
            {weeks.map((w) => {
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
        )}
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
