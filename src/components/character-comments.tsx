"use client";

import * as React from "react";
import { format, parseISO } from "date-fns";
import { Loader2, MessageSquarePlus, Trash2 } from "lucide-react";
import { addComment, deleteComment } from "@/app/characters/[name]/comment-actions";
import {
  COMMENT_CATEGORIES,
  COMMENT_CATEGORY_LABELS,
  COMMENT_CATEGORY_VARIANT,
  type CommentCategory,
} from "@/lib/comments";
import type { CharacterComment } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Officer comment log on a character — the detailed, timestamped record the
 * single inline `note` can't hold. Add categorized notes (performance,
 * attendance, conduct, loot) and remove them; everything re-renders through the
 * server action's revalidate. The same comments surface in the comparison view.
 */
export function CharacterComments({
  characterId,
  characterName,
  comments,
}: {
  characterId: string;
  characterName: string;
  comments: CharacterComment[];
}) {
  const [body, setBody] = React.useState("");
  const [author, setAuthor] = React.useState("");
  const [category, setCategory] = React.useState<CommentCategory>("note");
  const [error, setError] = React.useState<string | null>(null);
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [isPending, startTransition] = React.useTransition();

  const submit = () => {
    if (body.trim().length === 0) {
      setError("Write something first.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await addComment({ characterId, category, body, author });
      if (!res.ok) {
        setError(res.message ?? "Could not add the comment.");
        return;
      }
      setBody("");
      setCategory("note");
      // Keep the author — an officer usually logs several in a row.
    });
  };

  const remove = (id: string) => {
    setError(null);
    setPendingId(id);
    startTransition(async () => {
      const res = await deleteComment({ commentId: id });
      if (!res.ok) setError(res.message ?? "Could not remove the comment.");
      setPendingId(null);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-baseline gap-2">
          Comments
          <span className="text-xs font-normal text-muted-foreground">
            {comments.length} note{comments.length === 1 ? "" : "s"} on {characterName}
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          The officer log — performance, attendance, conduct and loot notes the council can refer
          back to. Visible on the profile and in the character comparison.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={`Add a note about ${characterName}…`}
            rows={2}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Comment category"
              value={category}
              onChange={(e) => setCategory(e.target.value as CommentCategory)}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {COMMENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {COMMENT_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
            <input
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="Your name (optional)"
              className="h-8 w-44 rounded-md border border-input bg-background px-2.5 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <Button size="sm" onClick={submit} disabled={isPending && pendingId === null}>
              {isPending && pendingId === null ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <MessageSquarePlus className="h-3.5 w-3.5" />
              )}
              Add comment
            </Button>
            <span className="text-[11px] text-muted-foreground">⌘/Ctrl+Enter to post</span>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        {comments.length === 0 ? (
          <p className="py-1 text-sm text-muted-foreground">
            No comments yet — the first note about {characterName} goes here.
          </p>
        ) : (
          <ul className="divide-y">
            {comments.map((c) => {
              const busy = pendingId === c.id;
              return (
                <li key={c.id} className={cn("flex items-start justify-between gap-3 py-2.5", busy && "opacity-50")}>
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={COMMENT_CATEGORY_VARIANT[c.category]} className="font-normal">
                        {COMMENT_CATEGORY_LABELS[c.category]}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground">
                        {format(parseISO(c.createdAt), "d MMM yyyy, HH:mm")}
                        {c.author && ` · ${c.author}`}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm">{c.body}</p>
                  </div>
                  <button
                    type="button"
                    aria-label="Delete comment"
                    disabled={busy}
                    onClick={() => remove(c.id)}
                    className="mt-0.5 shrink-0 rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-accent hover:text-destructive disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
