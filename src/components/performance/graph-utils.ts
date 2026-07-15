/**
 * Shared helpers for the fight-graph charts (single view and the compare
 * page's overlay). Colors are the validated dataviz categorical slots.
 */

export const GRAPH_COLOR = {
  dps: "#2a78d6",
  cooldown: "#1baf7a",
  consumable: "#eda100",
  buff: "#008300",
  boss: "#4a3aa7",
} as const;

/** Per-player-instance accents for compare views — validated 4-slot set (worst adjacent CVD ΔE 51.8). */
export const INSTANCE_COLORS = ["#2a78d6", "#eb6834", "#4a3aa7", "#e87ba4"] as const;

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
