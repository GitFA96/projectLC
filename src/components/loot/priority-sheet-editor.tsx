"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, RotateCcw } from "lucide-react";
import {
  previewPrioritySheetAction,
  resetPrioritySheetAction,
  savePrioritySheetAction,
} from "@/app/loot-policy-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Pasting a phase's sheet.
 *
 * The sheet is stored as the markdown an officer pasted, never pre-parsed, so
 * replacing next phase's is a paste and the source of every rule stays one
 * glance away. That's the same reason the seeded sheet is a markdown string
 * rather than a table of rows.
 *
 * Overwriting is the update flow, and the preview is what makes that safe: it
 * states what the text parses to BEFORE anything is stored, so "I pasted the
 * wrong half of the document" is caught by reading rather than by a raid night
 * ranking on an empty sheet.
 */
export function PrioritySheetEditor({
  phase,
  origin,
  markdown,
  author,
  updatedAt,
}: {
  phase: number;
  origin: "seed" | "pasted" | "none";
  /** The sheet in force, so the editor opens on what it is replacing. */
  markdown: string;
  author?: string;
  updatedAt?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(markdown);
  const [who, setWho] = React.useState(author ?? "");
  const [note, setNote] = React.useState("");
  const [preview, setPreview] = React.useState<{ ruleCount: number; sections: string[] } | null>(null);
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = React.useTransition();

  // Preview follows the draft rather than a button: an officer who has to press
  // "check" before "save" will press "save".
  React.useEffect(() => {
    const text = draft.trim();
    if (!open || !text) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void previewPrioritySheetAction(text).then((result) => {
        if (!cancelled) setPreview(result);
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [draft, open]);

  // Emptying the box hides the preview without an effect writing state for it.
  const shownPreview = draft.trim() ? preview : null;

  const save = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await savePrioritySheetAction({ phase, markdown: draft, author: who, note });
      setMessage({ ok: result.ok, text: result.message });
      if (result.ok) {
        setOpen(false);
        router.refresh();
      }
    });
  };

  const reset = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await resetPrioritySheetAction(phase);
      setMessage({ ok: result.ok, text: result.message });
      if (result.ok) {
        setOpen(false);
        router.refresh();
      }
    });
  };

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Pencil className="mr-1.5 h-3.5 w-3.5" />
          {origin === "none" ? "Paste a sheet" : "Replace this sheet"}
        </Button>
        {origin === "pasted" && (
          <span className="text-xs text-muted-foreground">
            Pasted{author ? ` by ${author}` : ""}
            {updatedAt ? ` on ${new Date(updatedAt).toLocaleDateString()}` : ""}
          </span>
        )}
        {origin === "seed" && (
          <span className="text-xs text-muted-foreground">The sheet this app shipped with.</span>
        )}
        {message && (
          <span className={message.ok ? "text-xs text-success" : "text-xs text-destructive"}>
            {message.text}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div>
        <Label htmlFor="sheet-md">Phase {phase} sheet, as markdown</Label>
        <p className="mt-1 text-xs text-muted-foreground">
          Paste the whole document. Rows look like{" "}
          <code className="rounded bg-muted px-1">| Item | Priority | Slot | Notes |</code>, under a{" "}
          <code className="rounded bg-muted px-1">###</code> heading naming the boss. Saving replaces
          this phase&apos;s sheet outright; per-item edits an officer made stay on top.
        </p>
        <Textarea
          id="sheet-md"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={14}
          className="mt-2 font-mono text-xs"
          placeholder="### Gurtogg Bloodboil&#10;| Item | Priority | Slot | Notes |&#10;|---|---|---|---|&#10;| … | … | … | … |"
        />
      </div>

      {shownPreview && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/50 px-3 py-2">
          <Badge variant={shownPreview.ruleCount > 0 ? "secondary" : "warning"}>
            {shownPreview.ruleCount} {shownPreview.ruleCount === 1 ? "item" : "items"}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {shownPreview.ruleCount === 0
              ? "Nothing parses as a priority row — check the table's pipes."
              : `across ${shownPreview.sections.length} ${shownPreview.sections.length === 1 ? "section" : "sections"}: ${shownPreview.sections.slice(0, 4).join(", ")}${shownPreview.sections.length > 4 ? "…" : ""}`}
          </span>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="sheet-author">Pasted by</Label>
          <Input
            id="sheet-author"
            value={who}
            onChange={(e) => setWho(e.target.value)}
            placeholder="Your name"
            maxLength={60}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="sheet-note">Note</Label>
          <Input
            id="sheet-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What changed, and why"
            maxLength={200}
            className="mt-1"
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        There are no accounts yet, so &ldquo;pasted by&rdquo; is whatever you type — a note in the
        log, not a signature.
      </p>

      {message && (
        <p className={message.ok ? "text-sm text-success" : "text-sm text-destructive"}>
          {message.text}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={pending || !draft.trim()}>
          {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Save phase {phase} sheet
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
        {origin === "pasted" && (
          <Button variant="ghost" onClick={reset} disabled={pending} className="ml-auto">
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            Revert to the shipped sheet
          </Button>
        )}
      </div>
    </div>
  );
}
