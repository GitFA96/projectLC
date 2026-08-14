"use client";

import * as React from "react";
import { Loader2, Minus, Plus } from "lucide-react";
import type { ConsumableAdjustment } from "@/lib/types";
import { saveReportConsumableAdjustments } from "@/app/logs/actions";
import { bumpAdjustment } from "@/lib/analysis/consumable-adjustments";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * The gold breakdown, correctable in place.
 *
 * The panel below this table has always been able to do the same thing, and it
 * asks for a raider, a consumable name and a count before it will — three fields
 * to say "he had one more flask than the log saw", about a line already on screen
 * with the raider and the consumable in it. This puts the ± on the line.
 *
 * It writes the same `ConsumableAdjustment` rows the panel does, so the panel
 * stays the audit trail: every correction is still listed there with who, what,
 * how many, and why, and removing it still restores exactly what the log said.
 * The panel is also still the only way to add a consumable the log never saw —
 * there is no badge here to press for a line that doesn't exist.
 */
export function BreakdownAdjuster({
  code,
  actorName,
  items,
  adjustments,
}: {
  code: string;
  /** The raider this row belongs to — the "who" of every write from here. */
  actorName: string;
  items: { name: string; count: number; delta?: number; added?: boolean }[];
  /** Every adjustment on this raid, since a save replaces the whole list. */
  adjustments: ConsumableAdjustment[];
}) {
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [, startTransition] = React.useTransition();

  const bump = (name: string, direction: 1 | -1) => {
    setError(null);
    setPending(name);

    // Which row a press lands on is a rule with an edge (noted entries are left
    // alone), so it lives in the analysis module and is tested there.
    const next = bumpAdjustment({
      adjustments,
      actorName,
      name,
      direction,
      at: new Date().toISOString(),
    });

    startTransition(async () => {
      const result = await saveReportConsumableAdjustments({ code, adjustments: next });
      if (!result.ok) setError(result.message);
      setPending(null);
    });
  };

  if (items.length === 0) return <span className="text-xs text-muted-foreground/50">—</span>;

  return (
    <span className="flex flex-wrap items-center gap-1">
      {items.map((it) => (
        <span
          key={it.name}
          className={cn(
            "inline-flex items-center overflow-hidden rounded-md border",
            it.delta === undefined ? "border-transparent" : "border-warn-line",
          )}
        >
          <Badge
            variant={it.delta === undefined ? "secondary" : "warning"}
            className="rounded-none border-0 font-normal"
            title={
              it.delta === undefined
                ? undefined
                : `${it.added ? "Added by hand" : "Adjusted by hand"}: ${it.delta > 0 ? "+" : "−"}${Math.abs(it.delta)} use${Math.abs(it.delta) === 1 ? "" : "s"}`
            }
          >
            {it.name}
            {it.count > 1 && <span className="ml-1 opacity-70">×{it.count}</span>}
            {it.delta !== undefined && (
              <span className="ml-1 font-medium">
                ({it.delta > 0 ? "+" : "−"}
                {Math.abs(it.delta)})
              </span>
            )}
          </Badge>
          <span className="flex items-stretch border-l">
            <button
              type="button"
              disabled={pending === it.name}
              onClick={() => bump(it.name, -1)}
              className="px-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
              aria-label={`One fewer ${it.name} for ${actorName}`}
              title={`One fewer ${it.name} than the log saw`}
            >
              {pending === it.name ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Minus className="h-3 w-3" />
              )}
            </button>
            <button
              type="button"
              disabled={pending === it.name}
              onClick={() => bump(it.name, 1)}
              className="border-l px-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
              aria-label={`One more ${it.name} for ${actorName}`}
              title={`One more ${it.name} than the log saw`}
            >
              <Plus className="h-3 w-3" />
            </button>
          </span>
        </span>
      ))}
      {error && <span className="text-[11px] text-danger-ink">{error}</span>}
    </span>
  );
}
