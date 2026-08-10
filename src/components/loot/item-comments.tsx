"use client";

import * as React from "react";
import { format, parseISO } from "date-fns";
import { Loader2, MessageSquarePlus, Trash2 } from "lucide-react";
import { addItemComment, deleteItemComment } from "@/app/items/[itemId]/comment-actions";
import {
  ITEM_COMMENT_VOICES,
  ITEM_COMMENT_VOICE_LABELS,
  ITEM_COMMENT_VOICE_VARIANT,
  type ItemCommentVoice,
} from "@/lib/comments";
import type { ItemComment } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * The argument about one item, written down.
 *
 * The council was asked whether a second-choice wisher should contend against a
 * BiS wisher and how far behind, and answered that it depends — on how many
 * options the raider has and on what those options block elsewhere. That is
 * judgement, and a multiplier would only make the board confidently wrong. So
 * the ranking stays as it is and this holds the part that doesn't fit in it.
 *
 * A note can name a raider ("2nd choice for Melige, he'd rather hold for the
 * T5 gloves") or stand alone ("contested every week — flag it high value").
 * Nothing here is scored, and it says so on the card.
 */
export interface ItemCommentTarget {
  id: string;
  name: string;
}

export function ItemComments({
  itemId,
  itemName,
  comments,
  contenders,
}: {
  itemId: number;
  itemName: string;
  comments: ItemComment[];
  /** Raiders a note can be attached to — the item's contenders and past winners. */
  contenders: ItemCommentTarget[];
}) {
  const [body, setBody] = React.useState("");
  const [author, setAuthor] = React.useState("");
  const [voice, setVoice] = React.useState<ItemCommentVoice>("officer");
  const [characterId, setCharacterId] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [isPending, startTransition] = React.useTransition();

  const nameOf = React.useMemo(
    () => new Map(contenders.map((c) => [c.id, c.name])),
    [contenders],
  );

  const submit = () => {
    if (body.trim().length === 0) {
      setError("Write something first.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await addItemComment({
        itemId,
        characterId: characterId || undefined,
        voice,
        body,
        author,
      });
      if (!res.ok) {
        setError(res.message ?? "Could not add the note.");
        return;
      }
      setBody("");
      // Keep voice, author and raider — a council usually logs several at once.
    });
  };

  const remove = (id: string) => {
    setError(null);
    setPendingId(id);
    startTransition(async () => {
      const res = await deleteItemComment({ commentId: id });
      if (!res.ok) setError(res.message ?? "Could not remove the note.");
      setPendingId(null);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-baseline gap-2">
          Notes
          <span className="text-xs font-normal text-muted-foreground">
            {comments.length} on {itemName}
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          What the ranking can&apos;t hold — whether a second choice is worth passing on, what a
          raider is holding out for, what the council already agreed. None of it is scored.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={`Add a note about ${itemName}…`}
            rows={2}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Who is speaking"
              value={voice}
              onChange={(e) => setVoice(e.target.value as ItemCommentVoice)}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {ITEM_COMMENT_VOICES.map((v) => (
                <option key={v} value={v}>
                  {ITEM_COMMENT_VOICE_LABELS[v]}
                </option>
              ))}
            </select>
            <select
              aria-label="Whose claim this is about"
              value={characterId}
              onChange={(e) => setCharacterId(e.target.value)}
              className="h-8 max-w-44 rounded-md border border-input bg-background px-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">About the item</option>
              {contenders.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
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
              Add note
            </Button>
            <span className="text-[11px] text-muted-foreground">⌘/Ctrl+Enter to post</span>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        {comments.length === 0 ? (
          <p className="py-1 text-sm text-muted-foreground">
            Nothing written down yet. The first time this one is argued over, it belongs here.
          </p>
        ) : (
          <ul className="divide-y">
            {comments.map((c) => {
              const busy = pendingId === c.id;
              // A raider named on a note may since have been deleted from the
              // roster — history is unlinked, never destroyed, so the note
              // stays and simply stops naming somebody.
              const about = c.characterId === undefined ? undefined : nameOf.get(c.characterId);
              return (
                <li key={c.id} className={cn("flex items-start justify-between gap-3 py-2.5", busy && "opacity-50")}>
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={ITEM_COMMENT_VOICE_VARIANT[c.voice]} className="font-normal">
                        {ITEM_COMMENT_VOICE_LABELS[c.voice]}
                      </Badge>
                      {about && <span className="text-xs font-medium">on {about}</span>}
                      <span className="text-[11px] text-muted-foreground">
                        {format(parseISO(c.createdAt), "d MMM yyyy, HH:mm")}
                        {c.author && ` · ${c.author}`}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm">{c.body}</p>
                  </div>
                  <button
                    type="button"
                    aria-label="Delete note"
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
