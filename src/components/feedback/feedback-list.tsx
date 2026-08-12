"use client";

import * as React from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import {
  Bug,
  Check,
  ClipboardCopy,
  Lightbulb,
  Loader2,
  MessageSquare,
  Trash2,
  Undo2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { deleteFeedback, setFeedbackStatus, setFeedbackTriage } from "@/app/service/feedback/actions";
import { contextLines, formatReportForAgent, formatReportsForAgent } from "@/lib/feedback";
import type { FeedbackPriority, FeedbackReport } from "@/lib/types";
import { cn } from "@/lib/utils";

const KIND_META = {
  bug: { icon: Bug, label: "Bug" },
  feedback: { icon: Lightbulb, label: "Feedback" },
} as const;

/**
 * How much a report matters, in the triager's judgement.
 *
 * "Untriaged" is a state, not a severity — a report nobody has weighed yet is
 * exactly what an officer wants to find, and defaulting it to "minor" would
 * hide it among the ones they decided about.
 */
const PRIORITY_META: Record<
  FeedbackPriority,
  { label: string; badge: "muted" | "warning" | "destructive" }
> = {
  unset: { label: "Untriaged", badge: "muted" },
  minor: { label: "Minor", badge: "warning" },
  major: { label: "Major", badge: "destructive" },
};

const PRIORITY_ORDER: FeedbackPriority[] = ["unset", "minor", "major"];

/**
 * Who is triaging, and when they last read the page — both per browser.
 *
 * There are no accounts in this app, so "a note from a different officer"
 * cannot be known for certain; what *can* be known is that a note appeared
 * since this browser last opened the page, and who signed it. That is the
 * honest version of a notification here, and the card says the name rather
 * than claiming it wasn't yours.
 */
const AUTHOR_KEY = "projectlc:feedback-author";
const SEEN_KEY = "projectlc:feedback-seen-at";

/** Nothing external changes while the page is open, so there is nothing to subscribe to. */
const subscribeNever = () => () => {};

/** Cached on first read: the stamp is rewritten on mount, and a snapshot that
 *  changed underneath the render would clear the markers it just drew. */
let seenAtSnapshot: string | null | undefined;
function readSeenAt(): string | null {
  if (seenAtSnapshot === undefined) seenAtSnapshot = localStorage.getItem(SEEN_KEY);
  return seenAtSnapshot;
}

/**
 * Copy to clipboard, reporting whether it landed.
 *
 * `navigator.clipboard` needs a secure context, and this app is often served
 * over plain http on a LAN address, where it is simply absent. The textarea
 * fallback is not legacy cruft — it is the path that actually runs for anyone
 * not on localhost.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through — a denied permission is still a failure worth recovering.
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/** A copy button that says what happened, because a silent copy is untrustworthy. */
function CopyButton({
  text,
  label,
  className,
}: {
  text: () => string;
  label: string;
  className?: string;
}) {
  const [state, setState] = React.useState<"idle" | "copied" | "failed">("idle");

  React.useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(timer);
  }, [state]);

  return (
    <Button
      size="sm"
      variant="outline"
      className={cn("h-7 gap-1.5 text-xs", className)}
      onClick={async () => setState((await copyText(text())) ? "copied" : "failed")}
    >
      {state === "copied" ? (
        <Check className="h-3 w-3 text-success" aria-hidden />
      ) : (
        <ClipboardCopy className="h-3 w-3" aria-hidden />
      )}
      {state === "copied" ? "Copied" : state === "failed" ? "Press Ctrl+C" : label}
    </Button>
  );
}

/**
 * Triage: read it, go look at the page it came from, close it.
 *
 * Resolving is reversible and deleting is not, so only the first is one click.
 * Reports are never edited — what the reporter wrote stays as they wrote it,
 * which is the only reason a report is worth anything a month later.
 */
export function FeedbackList({ reports }: { reports: FeedbackReport[] }) {
  if (reports.length === 0) {
    return (
      <EmptyState
        title="No reports yet"
        description="The “Report a bug” and “Feedback” buttons sit in the bottom-right corner of every page. Anything filed there lands here."
      />
    );
  }

  return <FilterableList reports={reports} />;
}

type Filter = { kind: string; priority: string; status: string };

const MATCHES = (r: FeedbackReport, f: Filter) =>
  (f.kind === "all" || r.kind === f.kind) &&
  (f.priority === "all" || r.priority === f.priority) &&
  (f.status === "all" || r.status === f.status);

/**
 * Triage with the list narrowed to what you came for.
 *
 * Defaults to open only, because that is the working set — a page that opens
 * on 27 resolved reports buries the six that need something. The counts on
 * each control are of the *whole* set, so narrowing never hides how much there
 * is; that was the thing the count-only summary got wrong.
 */
function FilterableList({ reports }: { reports: FeedbackReport[] }) {
  const [filter, setFilter] = React.useState<Filter>({
    kind: "all",
    priority: "all",
    status: "open",
  });
  /*
   * The moment this browser last opened the page.
   *
   * Read through `useSyncExternalStore` rather than an effect, because the
   * server has no localStorage: it renders the "no stamp yet" case, and React
   * swaps in the real one after hydration instead of the two disagreeing. The
   * snapshot is cached on first read so re-stamping below can't change it
   * mid-render — otherwise marking a note read would un-mark it.
   */
  const seenBefore = React.useSyncExternalStore(subscribeNever, readSeenAt, () => null);
  React.useEffect(() => {
    // Stamped for *next* visit, immediately. Writing to an external system is
    // what an effect is for; nothing in React state depends on it.
    localStorage.setItem(SEEN_KEY, new Date().toISOString());
  }, []);
  const shown = reports.filter((r) => MATCHES(r, filter));
  const open = shown.filter((r) => r.status === "open");

  const group = (
    key: keyof Filter,
    label: string,
    options: { value: string; label: string }[],
  ) => (
    <span className="flex flex-wrap items-center gap-1">
      <span className="mr-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {options.map((o) => {
        const active = filter[key] === o.value;
        const count =
          o.value === "all"
            ? reports.length
            : reports.filter((r) => String(r[key as keyof FeedbackReport]) === o.value).length;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => setFilter((f) => ({ ...f, [key]: o.value }))}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[11px] transition-colors hover:bg-accent",
              active && "border-foreground/30 bg-primary text-primary-foreground hover:bg-primary",
            )}
          >
            {o.label} <span className="tabular-nums opacity-70">{count}</span>
          </button>
        );
      })}
    </span>
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {group("status", "Status", [
          { value: "open", label: "Open" },
          { value: "resolved", label: "Resolved" },
          { value: "all", label: "All" },
        ])}
        {group("kind", "Kind", [
          { value: "all", label: "All" },
          { value: "bug", label: "Bugs" },
          { value: "feedback", label: "Feedback" },
        ])}
        {group("priority", "Priority", [
          { value: "all", label: "All" },
          { value: "major", label: "Major" },
          { value: "unset", label: "Untriaged" },
          { value: "minor", label: "Minor" },
        ])}
      </div>
      {/* Bulk export sits above the list: handing over "everything still open"
          is the common case, and per-report copying is the exception. */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
        <p className="mr-auto text-xs text-muted-foreground">
          Copy as markdown to hand to a developer or a coding agent — includes the route, the
          element and the likely source file.
        </p>
        {/* What you are looking at, not what exists — an officer who filtered to
            "open bugs" wants to hand over open bugs. */}
        {open.length > 0 && open.length !== shown.length && (
          <CopyButton
            label={`Copy ${open.length} open`}
            text={() => formatReportsForAgent(open)}
          />
        )}
        <CopyButton
          label={shown.length === reports.length ? "Copy all" : `Copy these ${shown.length}`}
          text={() => formatReportsForAgent(shown)}
        />
      </div>

      {shown.length === 0 ? (
        <p className="rounded-lg border bg-card p-3 text-sm text-muted-foreground">
          Nothing matches these filters.
        </p>
      ) : (
        <ul className="space-y-3">
          {shown.map((report) => (
            <FeedbackCard key={report.id} report={report} seenBefore={seenBefore} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FeedbackCard({
  report,
  seenBefore,
}: {
  report: FeedbackReport;
  /** When this browser last opened the page; null on a first visit. */
  seenBefore: string | null;
}) {
  // A first visit marks nothing new — everything would be, which says nothing.
  const isNew =
    seenBefore !== null && report.adminNoteAt !== undefined && report.adminNoteAt > seenBefore;
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | undefined>();
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);
  // The note editor opens on demand: most triage is a priority and a close, and
  // a textarea on every card turns a scannable list into a wall of forms.
  const [editingNote, setEditingNote] = React.useState(false);
  const [note, setNote] = React.useState(report.adminNote ?? "");
  // Remembered per browser, because there are no accounts here — the same
  // compromise as the reporter's name on the widget.
  const [author, setAuthor] = React.useState("");
  const resolved = report.status === "resolved";
  const lines = report.context ? contextLines(report.context) : [];
  const KindIcon = KIND_META[report.kind].icon;

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    startTransition(async () => {
      setError(undefined);
      const result = await fn();
      if (!result.ok) setError(result.message ?? "That didn't work.");
    });

  return (
    <li
      className={cn(
        "rounded-lg border bg-card p-3.5 transition-opacity",
        resolved && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={resolved ? "success" : "warning"}>
              {resolved ? "Resolved" : "Open"}
            </Badge>
            <Badge variant="muted" className="gap-1">
              <KindIcon className="h-3 w-3" aria-hidden />
              {KIND_META[report.kind].label}
            </Badge>
            {report.priority !== "unset" && (
              <Badge variant={PRIORITY_META[report.priority].badge}>
                {PRIORITY_META[report.priority].label}
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              {format(parseISO(report.createdAt), "d MMM yyyy, HH:mm")}
            </span>
            {report.reporter && (
              <span className="text-xs text-muted-foreground">· {report.reporter}</span>
            )}
          </div>
          {/* The reporter's own words, wrapped as written. */}
          <p className="mt-2 text-sm whitespace-pre-wrap">{report.body}</p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <CopyButton label="Copy" text={() => formatReportForAgent(report)} />
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs"
            disabled={pending}
            onClick={() =>
              run(() =>
                setFeedbackStatus({ id: report.id, status: resolved ? "open" : "resolved" }),
              )
            }
          >
            {pending ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : resolved ? (
              <Undo2 className="h-3 w-3" aria-hidden />
            ) : null}
            {resolved ? "Reopen" : "Resolve"}
          </Button>
          <Button
            size="sm"
            variant={confirmingDelete ? "destructive" : "ghost"}
            className="h-7 gap-1.5 text-xs"
            disabled={pending}
            onClick={() => {
              if (!confirmingDelete) {
                setConfirmingDelete(true);
                return;
              }
              run(() => deleteFeedback({ id: report.id }));
            }}
            onBlur={() => setConfirmingDelete(false)}
          >
            <Trash2 className="h-3 w-3" aria-hidden />
            {confirmingDelete ? "Really delete?" : ""}
          </Button>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t pt-2">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Priority</span>
        <span className="flex items-center gap-1">
          {PRIORITY_ORDER.map((value) => (
            <button
              key={value}
              type="button"
              disabled={pending}
              onClick={() => run(() => setFeedbackTriage({ id: report.id, priority: value }))}
              className={cn(
                "rounded-full border px-2 py-0.5 text-[11px] transition-colors hover:bg-accent disabled:opacity-50",
                report.priority === value && "border-foreground/30 bg-primary text-primary-foreground hover:bg-primary",
              )}
            >
              {PRIORITY_META[value].label}
            </button>
          ))}
        </span>
        {!editingNote && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-7 gap-1.5 text-xs"
            onClick={() => {
              // Read here rather than on mount: it only matters once the
              // editor is open, and by then hydration is long done.
              setAuthor(localStorage.getItem(AUTHOR_KEY) ?? "");
              setEditingNote(true);
            }}
          >
            <MessageSquare className="h-3 w-3" aria-hidden />
            {report.adminNote ? "Edit note" : "Add note"}
          </Button>
        )}
      </div>

      {/* The officer's note, beside the reporter's words and never over them. */}
      {report.adminNote && !editingNote && (
        <p className="mt-2 rounded-md border border-info-line bg-info-soft px-2.5 py-1.5 text-xs whitespace-pre-wrap text-info-ink">
          <span className="font-medium">{report.adminNoteAuthor || "Officer"}</span>
          {report.adminNoteAt && (
            <span className="opacity-75"> · {format(parseISO(report.adminNoteAt), "d MMM HH:mm")}</span>
          )}
          {isNew && (
            <span className="ml-1.5 rounded-full bg-info-ink px-1.5 py-0.5 text-[10px] font-medium text-info-soft">
              new
            </span>
          )}{" "}
          · {report.adminNote}
        </p>
      )}

      {editingNote && (
        <div className="mt-2 space-y-1.5">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={2000}
            autoFocus
            placeholder="What was decided, what it's waiting on, why it was closed."
            className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="Your name"
              maxLength={60}
              className="h-7 w-32 rounded-md border bg-background px-2 text-xs"
              aria-label="Your name"
            />
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const result = await setFeedbackTriage({
                    id: report.id,
                    adminNote: note,
                    adminNoteAuthor: author,
                  });
                  if (result.ok) {
                    localStorage.setItem(AUTHOR_KEY, author.trim());
                    setEditingNote(false);
                  }
                  return result;
                })
              }
            >
              {pending && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
              Save note
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => {
                setNote(report.adminNote ?? "");
                setEditingNote(false);
              }}
            >
              Cancel
            </Button>
            {note.trim().length === 0 && report.adminNote && (
              <span className="text-[11px] text-muted-foreground">Saving empty clears it.</span>
            )}
          </div>
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2 text-[11px]">
        <Link
          href={report.url}
          className="font-mono text-info-ink underline underline-offset-2"
          title={report.url}
        >
          {report.route}
        </Link>
        {lines.length === 0 ? (
          <span className="text-muted-foreground">
            No page details — the reporter didn&apos;t share them.
          </span>
        ) : (
          lines.map((line) => (
            <span key={line.label} className="text-muted-foreground">
              <span className="uppercase tracking-wide">{line.label}</span>{" "}
              <span className="font-mono text-foreground/75">{line.value}</span>
            </span>
          ))
        )}
      </div>

      {error && <p className="mt-2 text-xs text-danger-ink">{error}</p>}
    </li>
  );
}
