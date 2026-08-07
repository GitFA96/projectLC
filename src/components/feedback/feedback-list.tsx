"use client";

import * as React from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { Bug, Check, ClipboardCopy, Lightbulb, Loader2, Trash2, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { deleteFeedback, setFeedbackStatus } from "@/app/admin/feedback/actions";
import { contextLines, formatReportForAgent, formatReportsForAgent } from "@/lib/feedback";
import type { FeedbackReport } from "@/lib/types";
import { cn } from "@/lib/utils";

const KIND_META = {
  bug: { icon: Bug, label: "Bug" },
  feedback: { icon: Lightbulb, label: "Feedback" },
} as const;

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

  const open = reports.filter((r) => r.status === "open");

  return (
    <div>
      {/* Bulk export sits above the list: handing over "everything still open"
          is the common case, and per-report copying is the exception. */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
        <p className="mr-auto text-xs text-muted-foreground">
          Copy as markdown to hand to a developer or a coding agent — includes the route, the
          element and the likely source file.
        </p>
        {open.length > 0 && (
          <CopyButton
            label={`Copy ${open.length} open`}
            text={() => formatReportsForAgent(open)}
          />
        )}
        <CopyButton label="Copy all" text={() => formatReportsForAgent(reports)} />
      </div>

      <ul className="space-y-3">
        {reports.map((report) => (
          <FeedbackCard key={report.id} report={report} />
        ))}
      </ul>
    </div>
  );
}

function FeedbackCard({ report }: { report: FeedbackReport }) {
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | undefined>();
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);
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
