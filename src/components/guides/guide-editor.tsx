"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil } from "lucide-react";
import { saveClassGuideAction } from "@/app/guides/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { sourceHref, type ClassGuide } from "@/lib/guides";

/**
 * One class-or-spec guide: read it, or write it.
 *
 * Body and sources are edited together on purpose. A summary with no source is
 * the thing this feature exists to avoid — it becomes folklore the moment the
 * officer who wrote it leaves — so the source box sits in the same form rather
 * than behind a second step somebody skips.
 */
export function GuideEditor({
  wowClass,
  spec,
  label,
  guide,
}: {
  wowClass: string;
  spec: string;
  label: string;
  guide?: ClassGuide;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [body, setBody] = React.useState(guide?.body ?? "");
  const [sources, setSources] = React.useState((guide?.sources ?? []).join("\n"));
  const [author, setAuthor] = React.useState(guide?.author ?? "");
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = React.useTransition();

  const save = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await saveClassGuideAction({ wowClass, spec, body, sources, author });
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
            {/* Deliberately not rendered as HTML: this is officer-entered text,
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
            Nothing written yet. Until there is, the audits have no standard to measure {label}{" "}
            against.
          </p>
        )}
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Pencil className="mr-1.5 h-3.5 w-3.5" />
          {guide ? "Edit" : "Write it"}
        </Button>
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
      <div>
        <Label htmlFor={`body-${spec}`}>Summary</Label>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Consumables, enchants, gems, cooldown use — what this guild expects. A few lines beats a
          transcription.
        </p>
        <Textarea
          id={`body-${spec}`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={8}
          className="mt-1.5 text-sm"
          placeholder={"Flask of Relentless Assault.\nHaste potion on cooldown with Bloodlust.\n…"}
        />
      </div>

      <div>
        <Label htmlFor={`sources-${spec}`}>Sources, one per line</Label>
        <Textarea
          id={`sources-${spec}`}
          value={sources}
          onChange={(e) => setSources(e.target.value)}
          rows={3}
          className="mt-1.5 font-mono text-xs"
          placeholder="https://www.wowhead.com/tbc/guide/…"
        />
      </div>

      <div className="sm:max-w-xs">
        <Label htmlFor={`author-${spec}`}>Written by</Label>
        <Input
          id={`author-${spec}`}
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
