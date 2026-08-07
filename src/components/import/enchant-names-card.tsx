"use client";

import * as React from "react";
import { RefreshCw, Sparkles } from "lucide-react";
import {
  backfillEnchantNames,
  type BackfillEnchantsResult,
} from "@/app/admin/import/enchant-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The enchant dictionary's repair button, sibling to the item cache card.
 * Warcraft Logs reports enchants as bare ids and Wowhead has no page for one;
 * the guild's imported lists name the ones somebody wishlisted, and this names
 * the rest from the enchantment table.
 */
export function EnchantNamesCard({ unnamed }: { unnamed: number }) {
  const [pending, startTransition] = React.useTransition();
  const [result, setResult] = React.useState<BackfillEnchantsResult | null>(null);

  const run = () =>
    startTransition(async () => {
      setResult(await backfillEnchantNames());
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
      </CardContent>
    </Card>
  );
}
