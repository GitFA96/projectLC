"use client";

import { useState } from "react";
import type { StatDeltaRow } from "@/lib/types";
import { formatNumber } from "@/lib/utils";
import { cn } from "@/lib/utils";

/**
 * "Upcoming stats": current vs wishlist-target stat values with signed deltas.
 * Values come straight from the SixtyUpgrades-computed stat blocks of the two
 * sets — this panel never computes stats, only diffs them.
 */
export function StatDeltaPanel({
  deltas,
  hasCurrent,
}: {
  deltas: StatDeltaRow[];
  hasCurrent: boolean;
}) {
  const [showUnchanged, setShowUnchanged] = useState(false);
  const rows = deltas.filter((d) => showUnchanged || d.delta !== 0);
  const hiddenCount = deltas.length - deltas.filter((d) => d.delta !== 0).length;

  return (
    <div>
      {!hasCurrent && (
        <p className="mb-2 rounded-md bg-warn-soft px-2 py-1.5 text-xs text-warn-ink">
          No current gear imported — showing wishlist target values only.
        </p>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-1.5 pr-2 font-medium">Stat</th>
            <th className="w-20 py-1.5 pr-2 text-right font-medium">Now</th>
            <th className="w-20 py-1.5 pr-2 text-right font-medium">Planned</th>
            <th className="w-20 py-1.5 text-right font-medium">Δ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-border/60 last:border-0">
              <td className="py-1 pr-2">{row.label}</td>
              <td className="py-1 pr-2 text-right tabular-nums text-muted-foreground">
                {hasCurrent ? formatNumber(row.current) : "—"}
              </td>
              <td className="py-1 pr-2 text-right font-medium tabular-nums">
                {formatNumber(row.target)}
              </td>
              <td
                className={cn(
                  "py-1 text-right font-semibold tabular-nums",
                  row.delta > 0 && "text-success-ink",
                  row.delta < 0 && "text-danger",
                  row.delta === 0 && "text-muted-foreground/50",
                )}
              >
                {row.delta > 0 ? `+${formatNumber(row.delta)}` : row.delta < 0 ? formatNumber(row.delta) : "±0"}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="py-3 text-center text-xs text-muted-foreground">
                No stat changes between current gear and this wishlist.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {hasCurrent && hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowUnchanged((v) => !v)}
          className="mt-2 cursor-pointer text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          {showUnchanged ? "Hide unchanged stats" : `Show ${hiddenCount} unchanged stats`}
        </button>
      )}
    </div>
  );
}
