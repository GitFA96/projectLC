"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil } from "lucide-react";
import { saveGuideAction } from "@/app/guides/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { sourceHref, type Guide, type GuideKind } from "@/lib/guides";

/**
 * One guide: read it, or write it.
 *
 * Body and sources are edited together on purpose. A summary with no source is
 * the thing this feature exists to avoid — it becomes folklore the moment the
 * person who wrote it leaves — so the source box sits in the same form rather
 * than behind a second step somebody skips.
 *
 * The same component serves both owners. What differs is only the label and who
 * is allowed to press the button; the *shape* of a shared baseline and a guild's
 * own notes is identical, and two editors would drift.
 */
export function GuideEditor({
  kind,
  subject,
  section,
  label,
  guide,
  asOperator = false,
  canEdit,
  placeholder,
  hint,
}: {
  kind: GuideKind;
  subject: string;
  section: string;
  /** What this guide is about, for the empty state. */
  label: string;
  guide?: Guide;
  /** Writes the shared baseline rather than this guild's own. */
  asOperator?: boolean;
  canEdit: boolean;
  placeholder?: string;
  /** What belongs in this particular guide — differs by kind. */
  hint?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [body, setBody] = React.useState(guide?.body ?? "");
  const [sources, setSources] = React.useState((guide?.sources ?? []).join("\n"));
  const [author, setAuthor] = React.useState(guide?.author ?? "");
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = React.useTransition();

  // Stable per editor instance, so two on one page can't collide their labels.
  const fieldId = `${kind}-${subject}-${section || "all"}-${asOperator ? "op" : "own"}`;

  const save = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await saveGuideAction({
        kind,
        subject,
        section,
        body,
        sources,
        author,
        asOperator,
      });
      setMessage({ ok: result.ok, text: result.message });
      if (result.ok) {
        setOpen(false);
        router.refresh();
      }
    });
  };

  if (!open) {
    return (
      <div className="space-y-2">
        {guide ? (
          <>
            {/* Deliberately not rendered as HTML: this is hand-entered text,
                and the guide is prose rather than a document that needs markup. */}
            <p className="whitespace-pre-wrap text-sm">{guide.body}</p>
            {guide.sources.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="text-muted-foreground">Sources:</span>
                {guide.sources.map((source) => {
                  const href = sourceHref(source);
                  return href ? (
                    <a
                      key={source}
                      href={href}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="font-medium underline underline-offset-2"
                    >
                      {new URL(href).hostname.replace(/^www\./, "")}
                    </a>
                  ) : (
                    <span key={source} className="text-muted-foreground">
                      {source}
                    </span>
                  );
                })}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {guide.author ? `${guide.author} · ` : ""}
              updated {new Date(guide.updatedAt).toLocaleDateString()}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {asOperator
              ? `No shared write-up for ${label} yet.`
              : `Nothing written yet for ${label}.`}
          </p>
        )}
        {canEdit && (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            {guide ? "Edit" : "Write it"}
          </Button>
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
    <div className="space-y-3">
      {asOperator && (
        <Badge variant="warning" className="font-normal">
          Shared — every guild on this deployment reads this
        </Badge>
      )}
      <div>
        <Label htmlFor={`body-${fieldId}`}>Summary</Label>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {hint ?? "A few lines beats a transcription."}
        </p>
        <Textarea
          id={`body-${fieldId}`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={8}
          className="mt-1.5 text-sm"
          placeholder={placeholder}
        />
      </div>

      <div>
        <Label htmlFor={`sources-${fieldId}`}>Sources, one per line</Label>
        <Textarea
          id={`sources-${fieldId}`}
          value={sources}
          onChange={(e) => setSources(e.target.value)}
          rows={3}
          className="mt-1.5 font-mono text-xs"
          placeholder="https://www.wowhead.com/tbc/guide/…"
        />
      </div>

      <div className="sm:max-w-xs">
        <Label htmlFor={`author-${fieldId}`}>Written by</Label>
        <Input
          id={`author-${fieldId}`}
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          maxLength={60}
          placeholder="Your name"
          className="mt-1"
        />
      </div>

      {message && (
        <p className={message.ok ? "text-sm text-success" : "text-sm text-destructive"}>
          {message.text}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={pending}>
          {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Save
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
        {guide && (
          <span className="text-xs text-muted-foreground">
            Saving an empty summary clears this guide.
          </span>
        )}
      </div>
    </div>
  );
}
