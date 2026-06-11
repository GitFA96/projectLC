import { PHASES } from "@/lib/constants/wow";
import type { Phase } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface PhasePillData {
  phase: Phase;
  /** Wishlist completion 0–100; undefined = no wishlist imported. */
  pct?: number;
}

/**
 * Compact P1–P5 pills. Filled tone scales with completion; the guild's active
 * phase gets a ring. Phases without a wishlist render muted.
 */
export function PhasePills({
  items,
  activePhase,
  showEmpty = false,
  className,
}: {
  items: PhasePillData[];
  activePhase?: Phase;
  showEmpty?: boolean;
  className?: string;
}) {
  const byPhase = new Map(items.map((i) => [i.phase, i]));
  const phases = PHASES.filter((p) => showEmpty || byPhase.has(p.phase));
  if (phases.length === 0) {
    return <span className="text-xs text-muted-foreground">No wishlists</span>;
  }
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {phases.map(({ phase, short }) => {
        const data = byPhase.get(phase);
        const pct = data?.pct;
        return (
          <span
            key={phase}
            title={pct !== undefined ? `${short}: ${pct}% of wishlist satisfied` : `${short}: no wishlist imported`}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[11px] font-medium tabular-nums",
              pct === undefined && "border-dashed text-muted-foreground/60",
              pct !== undefined && pct >= 80 && "border-emerald-200 bg-emerald-50 text-emerald-700",
              pct !== undefined && pct >= 40 && pct < 80 && "border-sky-200 bg-sky-50 text-sky-700",
              pct !== undefined && pct < 40 && "bg-muted text-muted-foreground",
              activePhase === phase && "ring-1 ring-foreground/30",
            )}
          >
            {short}
            {pct !== undefined && <span>{pct}%</span>}
          </span>
        );
      })}
    </span>
  );
}
