import { cn } from "@/lib/utils";

/**
 * Warcraft Logs parse-percentile colors, darkened to stay legible on the
 * light theme (same approach as QUALITY_TEXT_COLORS).
 */
export function parseColor(pct: number): string {
  if (pct >= 100) return "#A16207"; // artifact gold
  if (pct >= 99) return "#C026D3"; // pink
  if (pct >= 95) return "#C26000"; // legendary orange
  if (pct >= 75) return "#A335EE"; // epic purple
  if (pct >= 50) return "#0070DD"; // rare blue
  if (pct >= 25) return "#0F8A00"; // uncommon green
  return "#757575"; // poor grey
}

export function ParseBadge({
  pct,
  className,
}: {
  pct: number | undefined;
  className?: string;
}) {
  if (pct === undefined) {
    return <span className={cn("text-xs text-muted-foreground/50", className)}>—</span>;
  }
  return (
    <span
      className={cn("font-semibold tabular-nums", className)}
      style={{ color: parseColor(pct) }}
    >
      {Math.round(pct)}
    </span>
  );
}
