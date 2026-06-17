"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { Check, ChevronDown } from "lucide-react";
import type { ComparedReportRef } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Per-character log selector for the comparison: choose which raid night(s)
 * feed this column's output / parses / consumables / uptime. The selection
 * lives in the URL as r_<slug>=code,code (alongside ?chars), so it's shareable;
 * all-or-none means "all logs" and the param is dropped.
 */
export function CompareLogPicker({
  slug,
  chars,
  explicitFilter,
  reports,
  selected,
}: {
  slug: string;
  /** All compared slugs in order — to rebuild ?chars. */
  chars: string[];
  /** The r_<slug> filters currently in the URL — to preserve other columns. */
  explicitFilter: Record<string, string[]>;
  /** Reports this character appears in, newest first. */
  reports: ComparedReportRef[];
  /** Report codes currently feeding this column. */
  selected: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  if (reports.length === 0) return null;
  if (reports.length === 1) {
    return <span className="text-[10px] text-muted-foreground/70">1 log</span>;
  }

  const hrefFor = (nextCodes: string[]): string => {
    const params = new URLSearchParams();
    params.set("chars", chars.join(","));
    for (const [s, codes] of Object.entries(explicitFilter)) {
      if (s === slug) continue;
      if (codes.length > 0) params.set(`r_${s}`, codes.join(","));
    }
    // Only write a param for a real subset; all-or-none defaults to "all logs".
    if (nextCodes.length > 0 && nextCodes.length < reports.length) {
      params.set(`r_${slug}`, nextCodes.join(","));
    }
    return `/compare?${params.toString()}`;
  };

  const toggle = (code: string) => {
    const next = selected.includes(code)
      ? selected.filter((c) => c !== code)
      : [...selected, code];
    router.push(hrefFor(next));
  };

  const allSelected = selected.length === reports.length;

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        title="Choose which logs feed this column"
      >
        {allSelected ? `all ${reports.length} logs` : `${selected.length}/${reports.length} logs`}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-md border bg-popover text-left shadow-md">
          <div className="flex items-center justify-between border-b px-2 py-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Logs to compare
            </span>
            {!allSelected && (
              <button
                type="button"
                onClick={() => router.push(hrefFor(reports.map((r) => r.code)))}
                className="text-[10px] text-foreground underline-offset-2 hover:underline"
              >
                All
              </button>
            )}
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {reports.map((r) => {
              const on = selected.includes(r.code);
              return (
                <li key={r.code}>
                  <button
                    type="button"
                    onClick={() => toggle(r.code)}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-accent"
                  >
                    <span
                      className={cn(
                        "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border",
                        on ? "border-primary bg-primary text-primary-foreground" : "border-input",
                      )}
                    >
                      {on && <Check className="h-2.5 w-2.5" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-medium tabular-nums">
                        {format(parseISO(r.startTime), "d MMM yyyy")}
                      </span>
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {r.zone ?? r.title}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
