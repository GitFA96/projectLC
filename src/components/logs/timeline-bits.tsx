import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/**
 * The shared vocabulary of the within-pull timelines: a time axis, gridlines
 * and a lane of colored up-intervals over the length of one boss pull. Both
 * uptime views draw with these — by boss (who kept a debuff on the target) and
 * by player (who had a raid buff) — so the two read as one chart.
 */

/** Lane grid: label column, the band track, then the percentage. */
export const LANE_GRID = "grid grid-cols-[11rem_1fr_2.75rem] items-center gap-2";

export function uptimeClass(pct: number): string {
  return pct >= 90 ? "text-success-ink" : pct < 60 ? "text-warn-ink" : "";
}

/** "4:12" from ms. */
export function mmss(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Wall-clock "21:14:32" for an offset into the report night. */
export function clockTime(reportStartMs: number, offsetMs: number): string {
  const d = new Date(reportStartMs + offsetMs);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

/**
 * Tick positions (ms) for a fight's time axis — the step adapts to the pull
 * length (15s gates on a short pull, minutes on a long one) so there are
 * always a readable ~4–8 gates.
 */
export function timeTicks(durationMs: number): { ticks: number[]; stepMs: number } {
  const steps = [15_000, 30_000, 60_000, 120_000, 300_000, 600_000];
  const stepMs = steps.find((s) => durationMs / s <= 8) ?? 600_000;
  const ticks: number[] = [];
  for (let t = stepMs; t < durationMs; t += stepMs) ticks.push(t);
  return { ticks, stepMs };
}

/** Axis header: tick labels over the lane column, aligned with the gridlines. */
export function TimeAxis({ durationMs, ticks }: { durationMs: number; ticks: number[] }) {
  const dur = Math.max(1, durationMs);
  return (
    <div className="grid grid-cols-[11rem_1fr_2.75rem] items-end gap-2">
      <span />
      <div className="relative h-4 text-[10px] tabular-nums text-muted-foreground">
        <span className="absolute bottom-0 left-0">0:00</span>
        {ticks.map((t) => {
          const leftPct = (t / dur) * 100;
          // Skip labels that would collide with the endpoints.
          if (leftPct < 7 || leftPct > 91) return null;
          return (
            <span key={t} className="absolute bottom-0 -translate-x-1/2" style={{ left: `${leftPct}%` }}>
              {mmss(t)}
            </span>
          );
        })}
        <span className="absolute bottom-0 right-0">{mmss(durationMs)}</span>
      </div>
      <span />
    </div>
  );
}

/** Vertical gridlines behind a lane's bands, one per axis tick. */
function TickGrid({ durationMs, ticks }: { durationMs: number; ticks: number[] }) {
  const dur = Math.max(1, durationMs);
  return (
    <>
      {ticks.map((t) => (
        <div
          key={t}
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-px bg-foreground/15"
          style={{ left: `${(t / dur) * 100}%` }}
        />
      ))}
    </>
  );
}

/** One band group: up-intervals of a single color, positioned over the pull. */
export interface Band {
  segments: [number, number][];
  color: string;
  /** Tooltip prefix, e.g. the provider's name on a shared lane. */
  label?: string;
}

/**
 * One stretch of a lane drawn at a fraction of its height — how deep a stacking
 * debuff sat through that stretch. Height is the magnitude (stacks), color is
 * the identity (who was holding it), so one lane answers both without a second
 * row.
 */
export interface StepBand {
  from: number;
  to: number;
  /** 0–1 of the lane's height. */
  level: number;
  color: string;
  /** Tooltip prefix, e.g. "Scomb · 5 stacks". */
  label?: string;
}

/** A single moment in the pull — a button press, drawn as a pip on the lane. */
export interface Marker {
  atMs: number;
  color?: string;
  /** Tooltip text; the timestamp is appended. */
  label?: string;
}

/** Pips for the moments a cast happened, over whatever the lane already shows. */
function MarkerPips({ markers, durationMs }: { markers: Marker[]; durationMs: number }) {
  const dur = Math.max(1, durationMs);
  return (
    <>
      {markers.map((m, i) => (
        <span
          key={`${m.atMs}-${i}`}
          className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[1px] border border-background"
          title={`${m.label ? `${m.label} · ` : ""}cast ${mmss(m.atMs)}`}
          style={{ left: `${Math.min(100, Math.max(0, (m.atMs / dur) * 100))}%`, backgroundColor: m.color ?? "var(--foreground)" }}
        />
      ))}
    </>
  );
}

/**
 * A lane of up-intervals over one pull: the label on the left, colored bands
 * over the pull's length in the middle, the coverage on the right. Several
 * band groups can share one lane (a buff kept up by two different providers).
 */
export function TimelineLane({
  label,
  bands,
  steps,
  markers = [],
  pct,
  durationMs,
  ticks,
  trailing,
}: {
  label: React.ReactNode;
  bands: Band[];
  /**
   * Stack depth over the pull, bottom-anchored. A lane that has these is drawn
   * taller — a one-stack step on a 10px lane is two pixels and reads as nothing.
   */
  steps?: StepBand[];
  /** Cast moments drawn on top of the bands (when the button was pressed). */
  markers?: Marker[];
  pct: number;
  durationMs: number;
  ticks: number[];
  /** Rendered instead of the percentage (e.g. nothing on a heading lane). */
  trailing?: React.ReactNode;
}) {
  const dur = Math.max(1, durationMs);
  return (
    <div className={LANE_GRID}>
      <span className="truncate text-sm">{label}</span>
      <div className={cn("relative rounded-sm bg-muted", steps ? "h-5" : "h-2.5")}>
        <TickGrid durationMs={dur} ticks={ticks} />
        {steps?.map((step, i) => (
          <div
            key={`step-${i}`}
            className="absolute bottom-0 rounded-[1px]"
            title={`${step.label ? `${step.label} · ` : ""}${mmss(step.from)}–${mmss(step.to)}`}
            style={
              {
                left: `${Math.max(0, (step.from / dur) * 100)}%`,
                // A 2px surface gap keeps two neighbouring depths from reading as
                // one block; max() so a one-second span does not go negative.
                width: `max(1px, calc(${Math.max(0.4, ((step.to - step.from) / dur) * 100)}% - 2px))`,
                height: `${Math.max(10, Math.min(1, step.level) * 100)}%`,
                backgroundColor: step.color,
              } satisfies CSSProperties
            }
          />
        ))}
        {bands.map((band, b) =>
          band.segments.map(([from, to], i) => (
            <div
              key={`${b}-${i}`}
              className="absolute inset-y-0 rounded-[1px]"
              title={`${band.label ? `${band.label} · ` : ""}${mmss(from)}–${mmss(to)}`}
              style={
                {
                  left: `${Math.max(0, (from / dur) * 100)}%`,
                  width: `${Math.max(0.4, ((to - from) / dur) * 100)}%`,
                  backgroundColor: band.color,
                } satisfies CSSProperties
              }
            />
          )),
        )}
        <MarkerPips markers={markers} durationMs={dur} />
      </div>
      {trailing ?? (
        <span className={cn("text-right text-xs font-medium tabular-nums", uptimeClass(pct))}>{pct}%</span>
      )}
    </div>
  );
}

/** Plain coverage bar with no timeline — night averages and pre-timeline imports. */
export function PctLane({
  label,
  pct,
  color,
  trailing,
}: {
  label: React.ReactNode;
  pct: number;
  color?: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className={LANE_GRID}>
      <span className="truncate text-sm">{label}</span>
      <div className="h-2.5 overflow-hidden rounded-sm bg-muted">
        <div
          className="h-full"
          style={{ width: `${Math.min(100, Math.max(0, pct))}%`, backgroundColor: color ?? "var(--primary)" }}
        />
      </div>
      {trailing ?? (
        <span className={cn("text-right text-xs font-medium tabular-nums", uptimeClass(pct))}>{pct}%</span>
      )}
    </div>
  );
}
