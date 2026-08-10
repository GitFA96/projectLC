"use client";

import * as React from "react";
import { ImageOff, RefreshCw, Search } from "lucide-react";
import {
  backfillItemData,
  resolveSheetItemNames,
  type BackfillItemsResult,
  type SheetNameResult,
} from "@/app/admin/import/item-actions";
import type { UnmatchedName } from "@/lib/items/wowhead";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The item cache's repair button. Items reach the tracker as bare ids from
 * Gargul pastes and gear snapshots; this fills in their names and icons —
 * first from records already imported (free), then one Wowhead lookup per id
 * Wowhead has never answered for.
 *
 * The count is deliberately not "missing a name or icon". A hand-written entry
 * renders perfectly and can still be the wrong picture, which is how eight
 * separate reports of a wrong icon sat behind a cache reporting itself
 * complete. Unconfirmed is the thing worth counting.
 *
 * The second button answers the opposite question. The priority sheet is
 * written in item *names*, and most of what a sheet lists has never been
 * wishlisted or won — so those rows have no id at all and render as bare text
 * on the page officers read while deciding a drop. That lookup goes by name
 * and only accepts an exact match.
 */
/**
 * The names that stayed plain text, and what to do about each.
 *
 * Named rather than counted: these are the rows an officer reads while deciding
 * a drop, so "4 had no single exact match" is a to-do list with the contents
 * missing. Each reason points at a different fix, and the link is the fastest
 * way to settle one — the sheet is editable, so correcting the spelling there
 * resolves it on the next press.
 */
const MISS_HELP: Record<UnmatchedName["reason"], string> = {
  unknown: "Wowhead has nothing by this name — likely a typo in the sheet.",
  "no-exact": "Close, but not the same name. Fix the spelling in the sheet.",
  ambiguous: "Several items share this name exactly, so only a person can pick.",
  error: "The lookup itself failed — press again.",
};

function UnmatchedNames({ rows }: { rows: UnmatchedName[] }) {
  return (
    <div className="w-full space-y-1 rounded-md border border-warn-line bg-warn-soft p-2.5">
      <p className="text-xs font-medium text-warn-ink">
        {rows.length} name{rows.length === 1 ? "" : "s"} stayed plain text — no icon or hover on
        the priority sheet until this is settled by hand.
      </p>
      <ul className="space-y-1">
        {rows.map((row) => (
          <li key={row.name} className="text-xs text-warn-ink">
            <a
              href={`https://www.wowhead.com/tbc/search?q=${encodeURIComponent(row.name)}`}
              target="_blank"
              rel="noreferrer"
              className="font-medium underline underline-offset-2"
            >
              {row.name}
            </a>{" "}
            — {MISS_HELP[row.reason]}
            {row.near.length > 0 && (
              <span className="block text-[11px] opacity-80">
                Wowhead offered: {row.near.join(", ")}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ItemCacheCard({
  unresolved,
  /** Priority-sheet names with no item id — see `resolveSheetItemNames`. */
  unmatchedSheetNames = 0,
}: {
  unresolved: number;
  unmatchedSheetNames?: number;
}) {
  const [pending, startTransition] = React.useTransition();
  const [result, setResult] = React.useState<BackfillItemsResult | SheetNameResult | null>(null);

  const run = () =>
    startTransition(async () => {
      setResult(await backfillItemData());
    });

  const runNames = () =>
    startTransition(async () => {
      setResult(await resolveSheetItemNames());
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <ImageOff className="h-4 w-4 text-muted-foreground" />
          Item names &amp; icons
          {unresolved > 0 && (
            <span className="rounded-full bg-warn-fill px-2 py-0.5 text-[11px] font-medium text-warn-ink">
              {unresolved} unconfirmed
            </span>
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Loot pastes and log gear snapshots often carry only an item id. This fills the gaps —
          from data already imported, from the shipped drop table (zone, boss and phase), and
          then one Wowhead lookup per id Wowhead hasn&apos;t answered for yet. Rows with a hole
          in them go first, then anything still unconfirmed, a batch per press (Wowhead turns
          away anyone asking for hundreds at once), so a backlog takes a few presses. Safe to
          press any time: only Wowhead&apos;s own answer overwrites anything, it never asks
          twice about an item it has confirmed, and your own zone, boss and phase always win
          over the shipped ones.
        </p>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={run} disabled={pending}>
          <RefreshCw className={pending ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
          {pending ? "Filling in…" : "Backfill item data"}
        </Button>
        {/* A separate press because it is a different question — "what id is
            this name" rather than "what is this id" — and because it is the
            only lookup here that can come back with nothing for a row. */}
        {unmatchedSheetNames > 0 && (
          <Button size="sm" variant="outline" onClick={runNames} disabled={pending}>
            <Search className="h-3.5 w-3.5" />
            Identify {unmatchedSheetNames} sheet item
            {unmatchedSheetNames === 1 ? "" : "s"}
          </Button>
        )}
        {result && (
          <span className={result.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
            {result.message}
          </span>
        )}
        {result && "unmatched" in result && result.unmatched.length > 0 && (
          <UnmatchedNames rows={result.unmatched} />
        )}
      </CardContent>
    </Card>
  );
}
