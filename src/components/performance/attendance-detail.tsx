"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { attendanceFacts, attendanceTitle } from "@/lib/analysis/performance";
import type { AttendanceSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

const PANEL_WIDTH = 224;
const GAP = 6;

/**
 * The attendance figure, with its arithmetic one click away.
 *
 * The breakdown used to live only in a `title`, which is the least reachable
 * place to put something people argue with: it needs a mouse, it can't be read
 * on a phone, and it arrives as one run-on line. The hover is kept — nobody
 * who learned it loses it — and a toggle opens the same facts as rows.
 *
 * Portalled to the body and positioned fixed, rather than rendered in place.
 * Three of the four callers sit inside a table whose wrapper is
 * `overflow-x-auto`, and because a clipped overflow on one axis forces the
 * other to clip too, an in-flow panel there either widens the column or gets
 * cut off. A dropdown has to float over the table, not push it around.
 */
export function AttendanceDetail({
  attendance,
  children,
  align = "left",
  className,
}: {
  attendance: AttendanceSummary;
  /** The compact figure — dots, "7/10 raids · 70%", whatever the caller shows. */
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  const [at, setAt] = React.useState<{ top: number; left: number } | null>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const panelId = React.useId();
  const open = at !== null;

  const place = React.useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Right-align when opening near the right edge, so the panel never runs
    // off screen on the last columns of a wide table.
    const wantsLeft = rect.left + PANEL_WIDTH + GAP > window.innerWidth;
    const left = wantsLeft ? rect.right - PANEL_WIDTH : rect.left;
    setAt({ top: rect.bottom + GAP, left: Math.max(GAP, left) });
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const close = () => setAt(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    // Scrolling would leave a fixed panel behind where the row used to be, so
    // it closes rather than chasing the trigger down the page.
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className={cn("inline-flex items-center gap-1", align === "right" && "flex-row-reverse", className)}>
      <span title={attendanceTitle(attendance)}>{children}</span>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? setAt(null) : place())}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? "Hide how this attendance was counted" : "How was this attendance counted?"}
        className={cn(
          "inline-flex shrink-0 cursor-pointer rounded-sm p-0.5 text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground",
          open && "bg-accent text-foreground",
        )}
      >
        <Info className="h-3 w-3" />
      </button>

      {open &&
        createPortal(
          <>
            {/* Catches the click that dismisses it, without stealing focus. */}
            <div className="fixed inset-0 z-40" onClick={() => setAt(null)} aria-hidden />
            <dl
              id={panelId}
              style={{ top: at.top, left: at.left, width: PANEL_WIDTH }}
              className="fixed z-50 space-y-1.5 rounded-md border bg-card p-2 text-left text-xs shadow-md"
            >
              {attendanceFacts(attendance).map((fact) => (
                <div key={fact.label} className="leading-tight">
                  <dt className="inline text-muted-foreground">{fact.label}: </dt>
                  <dd className="inline font-medium text-foreground">{fact.value}</dd>
                  {fact.note && (
                    <span className="mt-px block text-[10px] leading-tight text-muted-foreground/80">
                      {fact.note}
                    </span>
                  )}
                </div>
              ))}
            </dl>
          </>,
          document.body,
        )}
    </span>
  );
}
