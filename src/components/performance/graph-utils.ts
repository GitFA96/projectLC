/**
 * Shared helpers for the fight-graph charts (single view and the compare
 * page's overlay). Colors are the validated dataviz categorical slots.
 *
 * They are CSS variables rather than hex because these end up in inline
 * `style`/`stroke` attributes, which no `dark:` class can reach. Each theme
 * picks its own step of the same hue in src/app/globals.css — the dark values
 * are selected and separately validated, not a flip of the light ones.
 */

export const GRAPH_COLOR = {
  dps: "var(--graph-dps)",
  cooldown: "var(--graph-cooldown)",
  consumable: "var(--graph-consumable)",
  buff: "var(--graph-buff)",
  boss: "var(--graph-boss)",
} as const;

/** Per-player-instance accents for compare views — validated 4-slot set. */
export const INSTANCE_COLORS = [
  "var(--graph-series-1)",
  "var(--graph-series-2)",
  "var(--graph-series-3)",
  "var(--graph-series-4)",
] as const;

/** "4:12" from ms. */
export function mmss(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Axis gate step that keeps ~4–8 ticks whatever the pull length. */
export function tickStep(durationMs: number): number {
  return [15_000, 30_000, 60_000, 120_000, 300_000, 600_000].find((s) => durationMs / s <= 8) ?? 600_000;
}

/** Round a max up to a clean axis ceiling (1/2/2.5/5 × 10^k). */
export function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * pow >= v) return m * pow;
  }
  return 10 * pow;
}

export function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** 5691000 → "5.69M", 84500 → "84.5k" — for absolute boss HP readouts. */
export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}
