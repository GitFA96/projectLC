"use client";

import * as React from "react";
import { Coins, FlaskConical, TriangleAlert } from "lucide-react";
import type { RaiderUsage } from "@/lib/types";
import { goldOfBreakdown } from "@/lib/wcl/consumable-prices";
import { BreakdownBadges, RankBadge, Raider, Tally } from "@/components/logs/rank-bits";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { compareText } from "@/lib/sort";

/**
 * Consumable-usage leaderboard with a Count ↔ Gold toggle: "Count" ranks by raw
 * items thrown, "Gold spent" multiplies each raider's breakdown by this raid's
 * logged cost-per-use (or code defaults) and re-ranks by the total.
 */
export function ConsumableLeaderboard({
  rows,
  costPerUse,
  usingDefault,
}: {
  rows: RaiderUsage[];
  /** Gold per single use, keyed by consumable name. */
  costPerUse: Record<string, number>;
  /** True when the raid hasn't logged prices — the gold total is a rough default. */
  usingDefault: boolean;
}) {
  const [metric, setMetric] = React.useState<"count" | "gold">("count");
  const gold = metric === "gold";

  const leaders = rows
    .filter((u) => u.consumablesTotal > 0)
    .map((u) => ({ u, gold: goldOfBreakdown(u.itemBreakdown, costPerUse) }));
  const ordered = gold
    ? [...leaders].sort((a, b) => b.gold - a.gold || compareText(a.u.name, b.u.name))
    : leaders; // rows arrive pre-sorted by total consumables

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-success-ink" />
            Consumable usage
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Who used the most — potions, sappers and other items across the whole night, with what
            they actually used.
            {gold &&
              (usingDefault ? (
                <span className="ml-1 inline-flex items-center gap-1 text-warn-ink">
                  <TriangleAlert className="h-3 w-3" /> default prices — set this raid&apos;s in the
                  Gold tab.
                </span>
              ) : (
                " Gold uses this raid's logged prices."
              ))}
          </p>
        </div>
        <div className="flex shrink-0 rounded-md border p-0.5">
          <Button
            type="button"
            variant={gold ? "ghost" : "default"}
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => setMetric("count")}
          >
            Count
          </Button>
          <Button
            type="button"
            variant={gold ? "default" : "ghost"}
            size="sm"
            className="h-7 gap-1 px-2.5 text-xs"
            onClick={() => setMetric("gold")}
          >
            <Coins className="h-3.5 w-3.5" /> Gold spent
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {leaders.length === 0 ? (
          <p className="py-1 text-sm text-muted-foreground">No consumables used this night.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Raider</TableHead>
                <TableHead className="w-14 text-right">Pots</TableHead>
                <TableHead className="w-16 text-right">Sappers</TableHead>
                <TableHead className="w-14 text-right">Other</TableHead>
                <TableHead className="w-16 text-right">{gold ? "Gold" : "Total"}</TableHead>
                <TableHead>Used</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordered.map(({ u, gold: g }, i) => (
                <TableRow key={u.name} className={cn(i === 0 && "bg-warn-soft/70 hover:bg-warn-soft/70")}>
                  <TableCell>
                    <RankBadge rank={i + 1} />
                  </TableCell>
                  <TableCell>
                    <Raider name={u.name} slug={u.slug} className={u.className} />
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    <Tally n={u.potions} />
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    <Tally n={u.sappers} />
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    <Tally n={u.otherItems} />
                  </TableCell>
                  <TableCell className="text-right text-sm font-semibold tabular-nums">
                    {gold ? `${Math.round(g).toLocaleString("en-US")}g` : u.consumablesTotal}
                  </TableCell>
                  <TableCell>
                    <BreakdownBadges items={u.itemBreakdown} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
