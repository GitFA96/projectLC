import { cn } from "@/lib/utils";

/**
 * Warcraft Logs parse-percentile colors, as theme variables (same approach as
 * QUALITY_TEXT_COLORS): darkened for the light theme, canonical for the dark
 * one. Values live in src/app/globals.css.
 */
export function parseColor(pct: number): string {
  if (pct >= 100) return "var(--parse-100)"; // artifact gold
  if (pct >= 99) return "var(--parse-99)"; // pink
  if (pct >= 95) return "var(--parse-95)"; // legendary orange
  if (pct >= 75) return "var(--parse-75)"; // epic purple
  if (pct >= 50) return "var(--parse-50)"; // rare blue
  if (pct >= 25) return "var(--parse-25)"; // uncommon green
  return "var(--parse-0)"; // poor grey
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
