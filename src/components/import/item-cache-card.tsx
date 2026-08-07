"use client";

import * as React from "react";
import { ImageOff, RefreshCw } from "lucide-react";
import { backfillItemData, type BackfillItemsResult } from "@/app/admin/import/item-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The item cache's repair button. Items reach the tracker as bare ids from
 * Gargul pastes and gear snapshots; this fills in their names and icons —
 * first from records already imported (free), then one Wowhead lookup per id
 * nothing local knew. Both are one-time per item: nothing re-fetches.
 */
export function ItemCacheCard({ unresolved }: { unresolved: number }) {
  const [pending, startTransition] = React.useTransition();
  const [result, setResult] = React.useState<BackfillItemsResult | null>(null);

  const run = () =>
    startTransition(async () => {
      setResult(await backfillItemData());
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <ImageOff className="h-4 w-4 text-muted-foreground" />
          Item names &amp; icons
          {unresolved > 0 && (
            <span className="rounded-full bg-warn-fill px-2 py-0.5 text-[11px] font-medium text-warn-ink">
              {unresolved} missing a name or icon
            </span>
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Loot pastes and log gear snapshots often carry only an item id. This fills the gaps —
          first from data already imported, then one Wowhead lookup per unknown id, cached
          forever. Loot and wishlist items are resolved first, a batch per press (Wowhead turns
          away anyone asking for hundreds at once), so a big backlog takes a few presses. Safe to
          press any time: it never overwrites what&apos;s already known and never re-fetches.
        </p>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={run} disabled={pending}>
          <RefreshCw className={pending ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
          {pending ? "Filling in…" : "Backfill item data"}
        </Button>
        {result && (
          <span className={result.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
            {result.message}
          </span>
        )}
      </CardContent>
    </Card>
  );
}
