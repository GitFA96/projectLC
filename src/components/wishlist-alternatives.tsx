"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Loader2, Plus, X } from "lucide-react";
import { saveWishlistAlternativesAction } from "@/app/characters/[name]/alternatives-actions";
import { rankLabel } from "@/lib/analysis/wishlist-alternatives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ItemLink, type ItemRef } from "@/components/item-link";
import { Badge } from "@/components/ui/badge";

/**
 * "If my BiS doesn't drop, I'll take this."
 *
 * Order is the point, so the control is arrows rather than a rank box — an
 * officer moving a row shouldn't have to renumber the ones below it, and a
 * typed rank invites two items claiming second place. The list is saved whole,
 * in order, and the ranks are derived from position on the way in.
 */
export interface AlternativeView {
  itemId: number;
  item: ItemRef;
  rank: number;
  note?: string;
}

export function WishlistAlternatives({
  characterId,
  phase,
  slot,
  alternatives,
}: {
  characterId: string;
  phase: number;
  slot: string;
  alternatives: AlternativeView[];
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [list, setList] = React.useState(alternatives);
  const [newId, setNewId] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const commit = (next: AlternativeView[]) => {
    setList(next);
    setError(null);
    startTransition(async () => {
      const result = await saveWishlistAlternativesAction({
        characterId,
        phase,
        slot,
        items: next.map((a) => ({ itemId: a.itemId, itemName: a.item.name, note: a.note })),
      });
      if (!result.ok) {
        setError(result.message);
        setList(list);
        return;
      }
      router.refresh();
    });
  };

  const move = (index: number, by: -1 | 1) => {
    const next = [...list];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    commit(next);
  };

  const add = () => {
    const itemId = Number(newId.trim());
    if (!Number.isInteger(itemId) || itemId <= 0) {
      setError("Enter the item's numeric id.");
      return;
    }
    if (list.some((a) => a.itemId === itemId)) {
      setError("That item is already on the list.");
      return;
    }
    setNewId("");
    commit([...list, { itemId, item: { itemId }, rank: list.length + 1 }]);
  };

  if (!editing && list.length === 0) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        + alternatives
      </button>
    );
  }

  return (
    <div className="space-y-1">
      {list.map((a, i) => (
        <div key={a.itemId} className="flex items-center gap-1.5 text-xs">
          <Badge variant="outline" className="shrink-0">
            {rankLabel(a.rank)}
          </Badge>
          <ItemLink item={a.item} size="sm" className="min-w-0" />
          {editing && (
            <span className="ml-auto flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0 || pending}
                aria-label="Move up"
                className="rounded p-0.5 hover:bg-accent disabled:opacity-30"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === list.length - 1 || pending}
                aria-label="Move down"
                className="rounded p-0.5 hover:bg-accent disabled:opacity-30"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => commit(list.filter((x) => x.itemId !== a.itemId))}
                disabled={pending}
                aria-label="Remove"
                className="rounded p-0.5 text-destructive hover:bg-accent disabled:opacity-30"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          )}
        </div>
      ))}

      {editing && (
        <div className="flex items-center gap-1.5 pt-0.5">
          <Input
            value={newId}
            onChange={(e) => setNewId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder="Item id"
            className="h-7 w-24 text-xs"
            inputMode="numeric"
          />
          <Button size="sm" variant="outline" onClick={add} disabled={pending} className="h-7">
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          </Button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            done
          </button>
        </div>
      )}

      {!editing && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          edit
        </button>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
