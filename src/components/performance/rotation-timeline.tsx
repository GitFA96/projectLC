"use client";

import * as React from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import type { RotationCast } from "@/lib/analysis/rotation";

/**
 * One lane per ability, markers where it was pressed — the shape wowsims' own
 * timeline uses, so an officer can put the two side by side.
 *
 * The point is the ORDER, not the totals: a cast table says a raider pressed
 * Bloodthirst nine times, and only a timeline shows that three of them came
 * late because he was chasing a target swap. Lanes are shared between the two
 * sources so the same ability sits on the same row in both.
 *
 * The whole fight is always drawn. An earlier cut windowed it and let you pan,
 * which meant the answer to "did he Execute at the end" depended on where you
 * happened to be scrolled — you could never see that the pull HAD an end. The
 * segment length sets the scale instead: at 1s a fight is very wide and every
 * global cooldown is separable, at 30s it fits on a screen. Scrolling is the
 * browser's, the same as any other table on this page.
 */

export interface TimelineTrack {
  label: string;
  casts: RotationCast[];
  /** Rendered under the first; both use the same lanes and the same scale. */
  tone: "log" | "sim";
}

const TONE = {
  log: { dot: "bg-sky-500", text: "text-sky-700" },
  sim: { dot: "bg-amber-500", text: "text-amber-700" },
} as const;

/** Seconds per gridline segment. */
export const SEGMENTS = [1, 5, 10, 20, 30] as const;
/** Pixels per segment — fixed, so the segment choice IS the zoom. */
const SEGMENT_PX = 72;

/** Lane order: busiest first, so the rotation's spine is at the top. */
export function lanesOf(tracks: TimelineTrack[]): string[] {
  const counts = new Map<string, number>();
  for (const t of tracks) {
    for (const c of t.casts) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);
}

/** Every gridline for a fight, in ms, including the pre-pull side. */
export function ticksOf(minMs: number, maxMs: number, segmentMs: number): number[] {
  const first = Math.floor(minMs / segmentMs) * segmentMs;
  const out: number[] = [];
  for (let t = first; t <= maxMs + segmentMs; t += segmentMs) out.push(t);
  return out;
}

export function RotationTimeline({
  tracks,
  durationMs,
}: {
  tracks: TimelineTrack[];
  durationMs: number;
}) {
  const [segment, setSegment] = React.useState<number>(10);
  const [expanded, setExpanded] = React.useState(false);
  const lanes = React.useMemo(() => lanesOf(tracks), [tracks]);

  // Pre-pull actions carry negative timestamps in a sim log, and the opener is
  // exactly where they matter — so the axis can start before zero.
  const allTimes = tracks.flatMap((t) => t.casts.map((c) => c.tMs));
  const minMs = Math.min(0, ...allTimes);
  const maxMs = Math.max(durationMs, ...allTimes);

  const segmentMs = segment * 1000;
  const ticks = ticksOf(minMs, maxMs, segmentMs);
  const originMs = ticks[0] ?? 0;
  const totalMs = Math.max(1, (ticks[ticks.length - 1] ?? maxMs) - originMs);
  const width = (totalMs / segmentMs) * SEGMENT_PX;
  const x = (tMs: number) => ((tMs - originMs) / segmentMs) * SEGMENT_PX;

  if (lanes.length === 0) {
    return <p className="text-sm text-muted-foreground">No casts recorded for this pull.</p>;
  }

  const body = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Segment</span>
        {SEGMENTS.map((sec) => (
          <button
            key={sec}
            type="button"
            onClick={() => setSegment(sec)}
            className={`rounded border px-1.5 py-0.5 tabular-nums ${
              segment === sec ? "border-foreground bg-muted font-medium" : "border-border"
            }`}
          >
            {sec}s
          </button>
        ))}
        <span className="text-muted-foreground">· {Math.round(maxMs / 1000)}s fight, scroll sideways</span>

        <span className="ml-auto flex items-center gap-3">
          {tracks.map((t) => (
            <span key={t.label} className="flex items-center gap-1">
              <span className={`inline-block h-2 w-2 rounded-full ${TONE[t.tone].dot}`} />
              {t.label}
            </span>
          ))}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5"
          >
            {expanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
            {expanded ? "Close" : "Expand"}
          </button>
        </span>
      </div>

      {/*
        One scroll container for both axes, so the header row and the lanes can
        never drift apart. The ability column is sticky rather than a separate
        element for the same reason.
      */}
      <div
        className={`overflow-auto rounded-md border border-border ${
          expanded ? "max-h-[calc(100vh-11rem)]" : "max-h-112"
        }`}
      >
        <div style={{ width: width + 160, minWidth: "100%" }}>
          <div className="sticky top-0 z-20 flex border-b border-border bg-background">
            <div className="sticky left-0 z-30 w-40 shrink-0 border-r border-border bg-background py-1 pr-2 text-right text-[10px] uppercase text-muted-foreground">
              ability
            </div>
            <div className="relative h-6" style={{ width }}>
              {ticks.map((t) => (
                <span
                  key={t}
                  className="absolute inset-y-0 border-l border-border/70"
                  style={{ left: x(t) }}
                >
                  <span className="absolute top-1 ml-1 whitespace-nowrap text-[10px] text-muted-foreground tabular-nums">
                    {(t / 1000).toFixed(0)}s
                  </span>
                </span>
              ))}
            </div>
          </div>

          {lanes.map((lane, laneIndex) => (
            <div key={lane} className={`flex ${laneIndex % 2 ? "bg-muted/30" : ""}`}>
              <div
                className={`sticky left-0 z-10 w-40 shrink-0 truncate border-r border-border py-1 pr-2 text-right text-xs ${
                  laneIndex % 2 ? "bg-muted" : "bg-background"
                }`}
                title={lane}
              >
                {lane}
              </div>
              <div className="relative" style={{ width }}>
                {ticks.map((t) => (
                  <span
                    key={t}
                    className="absolute inset-y-0 border-l border-border/40"
                    style={{ left: x(t) }}
                  />
                ))}
                {tracks.map((track) => (
                  <div key={track.label} className="relative h-3.5">
                    {track.casts
                      .filter((c) => c.name === lane)
                      .map((c, i) => (
                        <span
                          key={i}
                          className={`absolute top-1/2 h-2.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-sm ${TONE[track.tone].dot}`}
                          style={{ left: x(c.tMs) }}
                          title={`${lane} — ${track.label} at ${(c.tMs / 1000).toFixed(1)}s`}
                        />
                      ))}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Each mark is one cast — or, for abilities Warcraft Logs records no casts for (Execute,
        bleeds, white swings), one landed hit. The sim side is a single iteration, chosen from
        several seeds as the one whose DPS landed closest to the 3,000-run average, so it&apos;s a
        real pull rather than a lucky one. An on-next-swing ability like Heroic Strike marks both
        when it was queued and when it landed, which is why its lane looks busier than its cast
        count.
      </p>
    </div>
  );

  if (!expanded) return body;
  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-background/95 p-4 backdrop-blur-sm">
      {body}
    </div>
  );
}
