"use client";

import * as React from "react";
import { RefreshCw, RotateCcw, Sparkles } from "lucide-react";
import {
  backfillEnchantNames,
  retryRefusedEnchantIds,
  type BackfillEnchantsResult,
} from "@/app/guild/import/enchant-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The enchant dictionary's repair button, sibling to the item cache card.
 * Warcraft Logs reports enchants as bare ids and Wowhead has no page for one;
 * the guild's imported lists name the ones somebody wishlisted, and this names
 * the rest from the enchantment table.
 */

/**
 * Ids the dictionary was asked about and had no name for — a standing list,
 * not a line after a press.
 *
 * The same record the item names keep, and it earns its place the same way: the
 * badge above counts what has **never been asked**, so a number that stays put
 * is now honest about which of the two it means. It also makes an outage
 * visible. When this source moved house every lookup began failing at once,
 * including for ids already named in this deployment's own table, and nothing
 * anywhere said so — the card went on reporting them as missing from a table it
 * could no longer reach.
 */
function RefusedEnchants({
  ids,
  onRetry,
  busy,
}: {
  ids: number[];
  onRetry: () => void;
  busy: boolean;
}) {
  return (
    <div className="w-full rounded-md border border-warn-line bg-warn-soft p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-warn-ink">
          {ids.length} id{ids.length === 1 ? "" : "s"} the dictionary had no name for
        </span>
        <Button size="sm" variant="outline" onClick={onRetry} disabled={busy}>
          <RotateCcw className="h-3.5 w-3.5" />
          Ask about these again
        </Button>
      </div>
      <p className="mt-1 text-[11px] text-warn-ink/80">
        Already tried, so the button above no longer counts them. An id has no spelling to fix,
        so the only thing that changes the answer is the source — if these all failed at once, the
        dictionary was probably down. Press <em>Ask about these again</em> to find out.
      </p>
      <p className="mt-1.5 font-mono text-[11px] text-warn-ink/90">{ids.join(", ")}</p>
    </div>
  );
}

export function EnchantNamesCard({
  unnamed,
  /** Ids already asked about and still unnamed — see `RefusedEnchants`. */
  refused = [],
}: {
  unnamed: number;
  refused?: number[];
}) {
  const [pending, startTransition] = React.useTransition();
  const [result, setResult] = React.useState<BackfillEnchantsResult | null>(null);
  const [retry, setRetry] = React.useState<string | null>(null);

  const run = () =>
    startTransition(async () => {
      setRetry(null);
      setResult(await backfillEnchantNames());
    });

  const runRetry = () =>
    startTransition(async () => {
      setResult(null);
      setRetry((await retryRefusedEnchantIds()).message);
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          Enchant names
          {unnamed > 0 && (
            <span className="rounded-full bg-warn-fill px-2 py-0.5 text-[11px] font-medium text-warn-ink">
              {unnamed} showing as an id
            </span>
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Logs record a permanent enchant as a bare enchantment id, and Wowhead has no page for
          one. The guild&apos;s imported lists name the enchants somebody wishlisted; this names
          everything else raiders have actually been wearing — scopes, resistance enchants, the
          gloves enchant nobody lists — one lookup per id, cached forever. It never overwrites a
          name an imported list already gave.
        </p>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={run} disabled={pending}>
          <RefreshCw className={pending ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
          {pending ? "Looking up…" : "Name worn enchants"}
        </Button>
        {result && (
          <span className={result.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
            {result.message}
          </span>
        )}
        {retry && <span className="text-xs text-muted-foreground">{retry}</span>}
        {refused.length > 0 && (
          <RefusedEnchants ids={refused} onRetry={runRetry} busy={pending} />
        )}
      </CardContent>
    </Card>
  );
}
