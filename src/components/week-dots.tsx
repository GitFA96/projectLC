import { format, parseISO } from "date-fns";
import type { AttendanceWeek } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * One dot per reset week (EU, Wednesday) the guild logged: filled = the
 * character raided that week, hollow = they didn't. Oldest left, newest right.
 */
export function WeekDots({ weeks, className }: { weeks: AttendanceWeek[]; className?: string }) {
  if (weeks.length === 0) return null;
  return (
    <span className={cn("inline-flex items-center gap-[3px]", className)} aria-label="Raid weeks">
      {weeks.map((w) => (
        <span
          key={w.start}
          title={`Reset week of ${format(parseISO(w.start), "d MMM")}: ${
            w.excused ? "excused — doesn't count" : w.attended ? "raided" : "did not raid"
          } (${w.reports} log${w.reports === 1 ? "" : "s"} that week)`}
          className={cn(
            "inline-block h-2 w-2 rounded-full",
            w.excused
              ? "border border-dashed border-muted-foreground/50 bg-muted"
              : w.attended
                ? "bg-success"
                : "border border-warn bg-warn/30",
          )}
        />
      ))}
    </span>
  );
}
