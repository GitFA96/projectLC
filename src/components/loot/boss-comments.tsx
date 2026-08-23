"use client";

import * as React from "react";
import { format, parseISO } from "date-fns";
import { Loader2, MessageSquarePlus, Trash2 } from "lucide-react";
import {
  addBossCommentAction,
  deleteBossCommentAction,
} from "@/app/loot/plan/boss-comment-actions";
import type { BossComment } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * What the council wants said about this boss, under his drops.
 *
 * The loot plan is read out loud before a pull, and a lot of what an officer
 * needs to say is about the boss rather than any one item: "we're holding
 * tokens for the warriors this reset", "his trinket goes to a healer if it
 * drops again". Said once in Discord, that is gone by the next reset; here it
 * sits under the drops it applies to, dated, with a name on it.
 *
 * Collapsed to a one-line control when empty, because most bosses have nothing
 * to say and a plan is a page you scan. A boss that HAS notes shows them
 * without a click — an unread note under a fold is the same as no note.
 */
export function BossComments({
  zone,
  boss,
  comments,
  canWrite,
}: {
  zone: string;
  boss: string;
  comments: BossComment[];
  canWrite: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [body, setBody] = React.useState("");
  const [author, setAuthor] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | undefined>();

  // Nothing written and nothing to write with: render nothing at all rather
  // than an empty affordance on every card of a nine-boss raid.
  if (comments.length === 0 && !canWrite) return null;

  const submit = () => {
    const text = body.trim();
    if (!text) return;
    setError(undefined);
    startTransition(async () => {
      const result = await addBossCommentAction({
        zone,
        boss,
        body: text,
        author: author.trim() || undefined,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setBody("");
      setOpen(false);
    });
  };

  const remove = (id: string) => {
    startTransition(async () => {
      const result = await deleteBossCommentAction(id);
      if (!result.ok) setError(result.message);
    });
  };

  return (
    <div className="mt-2 border-t pt-2">
      {comments.length > 0 && (
        <ul className="mb-1.5 space-y-1.5">
          {comments.map((c) => (
            <li key={c.id} className="flex items-start gap-2 text-sm">
              <span className="min-w-0 flex-1 whitespace-pre-wrap">{c.body}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {c.author ? `${c.author} · ` : ""}
                {safeDate(c.createdAt)}
              </span>
              {canWrite && (
                <button
                  type="button"
                  onClick={() => remove(c.id)}
                  disabled={pending}
                  aria-label="Remove this note"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canWrite &&
        (open ? (
          <div className="space-y-1.5">
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={2}
              autoFocus
              placeholder={`What should the council know about ${boss}?`}
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <input
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="Your name (optional)"
                className="h-8 rounded-md border bg-background px-2 text-sm"
              />
              <Button size="sm" onClick={submit} disabled={pending || !body.trim()}>
                {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Save note
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setOpen(false);
                  setError(undefined);
                }}
                disabled={pending}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={cn(
              "inline-flex items-center gap-1.5 text-xs text-muted-foreground",
              "hover:text-foreground",
            )}
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
            {comments.length === 0 ? "Add a council note" : "Add another note"}
          </button>
        ))}

      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

/**
 * A stored timestamp that won't parse must not take the plan down with it —
 * the note itself is the thing worth reading, and the date is decoration.
 */
function safeDate(iso: string): string {
  try {
    return format(parseISO(iso), "d MMM");
  } catch {
    return "";
  }
}
