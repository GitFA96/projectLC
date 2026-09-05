"use client";

import { CircleCheck } from "lucide-react";
import { type WclImportActionResult } from "@/app/guild/import/wcl-actions";
/** One report in a bulk import, as the queue works through it. */
export interface QueueItem {
  code: string;
  state: "waiting" | "running" | "done";
  result?: WclImportActionResult;
}

/**
 * Live progress for a sequence of report fetches — one line per report, in
 * order. Shared by the bulk import and the refetch button so both read the
 * same way; `verb` is the only thing that differs.
 */
export function ImportQueue({ items, verb = "Imported" }: { items: QueueItem[]; verb?: string }) {
  const done = items.filter((i) => i.state === "done");
  const failed = done.filter((i) => i.result?.status !== "committed");
  const running = items.some((i) => i.state !== "done");
  const gerund = verb === "Imported" ? "Importing" : "Refetching";

  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="text-sm font-medium">
        {running
          ? `${gerund} ${done.length + 1} of ${items.length}…`
          : `${verb} ${done.length - failed.length} of ${items.length}`}
        {failed.length > 0 && !running && ` — ${failed.length} failed`}
      </p>
      <ul className="space-y-1 text-xs">
        {items.map((item) => {
          const ok = item.result?.status === "committed";
          return (
            <li key={item.code} className="flex items-baseline gap-2">
              <span
                className={
                  item.state === "waiting"
                    ? "text-muted-foreground"
                    : item.state === "running"
                      ? "text-foreground"
                      : ok
                        ? "text-success-ink"
                        : "text-danger-ink"
                }
              >
                {item.state === "waiting" ? "·" : item.state === "running" ? "…" : ok ? "✓" : "✕"}
              </span>
              <span className="font-mono text-muted-foreground">{item.code}</span>
              <span className="min-w-0 flex-1">
                {item.state === "done" && item.result?.status === "committed" && (
                  <>
                    {item.result.replaced ? "updated" : "imported"} — {item.result.title}
                    {` (${item.result.fightCount} pull${item.result.fightCount === 1 ? "" : "s"})`}
                  </>
                )}
                {item.state === "done" && item.result?.status === "error" && (
                  <span className="text-danger-ink">{item.result.message}</span>
                )}
                {item.state === "done" && item.result?.status === "not-configured" && (
                  <span className="text-danger-ink">Warcraft Logs credentials are not configured.</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {!running && (
        <p className="text-xs text-muted-foreground">
          Reports keep the titles Warcraft Logs gave them — rename any of them in the list below.
        </p>
      )}
    </div>
  );
}

/** Failed entries in a finished run, with why. */
function failedItems(items: QueueItem[]) {
  return items.filter((i) => i.state === "done" && i.result?.status !== "committed");
}

/**
 * One-line refetch progress, sitting beside the button that started it.
 *
 * A refetch is a bulk operation on rows that are already on screen, so the
 * per-report list the import flow shows would just duplicate the table below
 * it. What's actually useful mid-run is "is it still going, and where is it" —
 * one line, naming only the report currently in flight.
 */
export function RefetchStatus({ items }: { items: QueueItem[] }) {
  const done = items.filter((i) => i.state === "done").length;
  const current = items.find((i) => i.state === "running") ?? items.find((i) => i.state === "waiting");
  const failed = failedItems(items).length;

  if (current) {
    return (
      <span className="min-w-0 text-xs font-normal text-muted-foreground">
        Refetching {Math.min(done + 1, items.length)} of {items.length}
        <span className="ml-1.5 font-mono">{current.code}</span>
      </span>
    );
  }
  if (failed > 0) {
    return (
      <span className="text-xs font-normal text-danger-ink">
        Refetched {items.length - failed} of {items.length} — {failed} failed
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs font-normal text-success-ink">
      <CircleCheck className="h-3.5 w-3.5" />
      Refetched {items.length} report{items.length === 1 ? "" : "s"}
    </span>
  );
}

/**
 * The detail for anything that failed, at the foot of the card.
 *
 * Only rendered when there's something wrong: a successful run says so in one
 * line up top and needs no further reading. A failure needs the code and the
 * reason, because the fix is usually per-report.
 */
export function RefetchFailures({ items }: { items: QueueItem[] }) {
  const failed = failedItems(items);
  if (failed.length === 0 || items.some((i) => i.state !== "done")) return null;
  return (
    <div className="space-y-1 rounded-md border border-danger-line bg-danger-soft p-3 text-xs text-danger-ink">
      <p className="font-medium">
        {failed.length} report{failed.length === 1 ? "" : "s"} could not be refetched — everything
        else was updated.
      </p>
      <ul className="space-y-0.5">
        {failed.map((item) => (
          <li key={item.code} className="flex flex-wrap items-baseline gap-1.5">
            <span className="font-mono">{item.code}</span>
            <span>
              {item.result?.status === "error"
                ? item.result.message
                : item.result?.status === "not-configured"
                  ? "Warcraft Logs credentials are not configured."
                  : "Unknown error."}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
