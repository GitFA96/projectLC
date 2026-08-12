"use client";

import * as React from "react";
import { Columns2, Layers, Minus, Plus, Rows2, X } from "lucide-react";
import type { FightGraphResult, FightGraphView } from "@/lib/wcl/fight-graph";
import { fightGraphKey, loadFightGraph, peekFightGraph } from "@/components/performance/fight-graph-client";
import { DpsChart } from "@/components/performance/fight-graph";
import {
  HiddenBuffsMenu,
  anyHighlight,
  hideBuff,
  isDimmed,
  toggleHighlight,
  type BuffFilterState,
} from "@/components/performance/buff-filter";
import {
  INSTANCE_COLORS,
  mmss,
  niceCeil,
  tickStep,
  truncate,
} from "@/components/performance/graph-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { compareText } from "@/lib/sort";

/**
 * The fight-graph playground: up to four player instances — any (player,
 * report, fight) combination, including the same player across raids —
 * rendered as an overlay on one time axis, side by side, or stacked.
 * Color codes the INSTANCE (validated 4-slot set); in overlay mode marker
 * shape carries cast kind (● cooldown, ■ consumable) since color is taken by
 * identity. Clicking a DPS line, legend chip or chart label focuses that
 * player (everything else recedes); the −/+ stepper walks three chart sizes.
 */

export interface PickerFight {
  fightId: number;
  encounterName: string;
  kill: boolean;
  fightPercentage?: number;
}

export interface PickerReport {
  code: string;
  title: string;
  /** "12 Jul" — preformatted server-side to avoid locale drift. */
  dateLabel: string;
  zone?: string;
  fights: PickerFight[];
  players: string[];
}

interface Instance {
  reportCode?: string;
  fightId?: number;
  player?: string;
}

type ViewMode = "overlay" | "side" | "stack";

function instanceKey(inst: Instance): string | undefined {
  if (!inst.reportCode || inst.fightId === undefined || !inst.player) return undefined;
  return fightGraphKey(inst.reportCode, inst.fightId, inst.player);
}

/** Loads one complete instance's graph via the (cached) API route — plain GETs, so several instances load in parallel. */
function useInstanceData(inst: Instance): { result?: FightGraphResult; loading: boolean } {
  const key = instanceKey(inst);
  const fromCache = key ? peekFightGraph(key) : undefined;
  const [loaded, setLoaded] = React.useState<{ key: string; result: FightGraphResult } | null>(null);

  React.useEffect(() => {
    if (!key || peekFightGraph(key)) return;
    let cancelled = false;
    loadFightGraph(key).then((r) => {
      if (!cancelled) setLoaded({ key, result: r });
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  if (!key) return { loading: false };
  if (fromCache) return { result: fromCache, loading: false };
  return { result: loaded?.key === key ? loaded.result : undefined, loading: loaded?.key !== key };
}

/** Up to four instances side by side; hooks need a fixed count. */
const SLOTS = [0, 1, 2, 3] as const;
type SlotIndex = (typeof SLOTS)[number];

/**
 * Chart-area sizes the −/+ stepper walks: per-chart max width in overlay/
 * stack, minimum column width in side-by-side (auto-fit decides how many
 * columns that allows). L is the full-bleed default.
 */
const SIZES = [
  { label: "S", maxWidth: "56rem", sideMin: 400 },
  { label: "M", maxWidth: "76rem", sideMin: 560 },
  { label: "L", maxWidth: undefined, sideMin: 740 },
] as const;

export function FightGraphCompare({ reports }: { reports: PickerReport[] }) {
  const [instances, setInstances] = React.useState<Instance[]>([{}, {}, {}, {}]);
  const [view, setView] = React.useState<ViewMode>("overlay");
  const [buffFilter, setBuffFilter] = React.useState<BuffFilterState>({});
  const [size, setSize] = React.useState(2);
  // Clicked-on player instance: everything else recedes. Click again to release.
  const [focusKey, setFocusKey] = React.useState<string | null>(null);
  const toggleFocus = (key: string) => setFocusKey((k) => (k === key ? null : key));
  // Hovering a line or name previews the same emphasis without committing it.
  const [hoverKey, setHoverKey] = React.useState<string | null>(null);

  const results = [
    useInstanceData(instances[0]),
    useInstanceData(instances[1]),
    useInstanceData(instances[2]),
    useInstanceData(instances[3]),
  ];

  const setInstance = (i: SlotIndex, patch: Instance) =>
    setInstances((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], ...patch };
      return next;
    });

  const label = (inst: Instance): string => {
    const report = reports.find((r) => r.code === inst.reportCode);
    const fight = report?.fights.find((f) => f.fightId === inst.fightId);
    return [inst.player, fight?.encounterName, report?.dateLabel].filter(Boolean).join(" · ");
  };

  const active = SLOTS.map((i) => ({
    key: instanceKey(instances[i]),
    data: results[i].result?.status === "ok" ? (results[i].result as { data: FightGraphView }).data : undefined,
    loading: results[i].loading,
    color: INSTANCE_COLORS[i],
    label: label(instances[i]),
    error: results[i].result && results[i].result!.status !== "ok" ? results[i].result : undefined,
  })).filter((x) => x.key !== undefined);

  const loadedInstances = active.filter((x) => x.data !== undefined) as {
    key: string;
    data: FightGraphView;
    color: string;
    label: string;
    loading: boolean;
  }[];

  // A focus only holds while its instance is still on screen; a live hover
  // outranks the clicked focus as the emphasized instance.
  const focus = focusKey !== null && loadedInstances.some((i) => i.key === focusKey) ? focusKey : null;
  const emphasis = hoverKey !== null && loadedInstances.some((i) => i.key === hoverKey) ? hoverKey : focus;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-2">
        {SLOTS.map((i) => (
          <InstancePicker
            key={i}
            index={i}
            color={INSTANCE_COLORS[i]}
            reports={reports}
            instance={instances[i]}
            onChange={(patch) => setInstance(i, patch)}
            onClear={() =>
              setInstances((prev) => prev.map((inst, j) => (j === i ? {} : inst)))
            }
          />
        ))}
      </div>

      {active.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Pick a player, report and fight above — add up to four instances to compare (the same
            player across raids works too).
          </CardContent>
        </Card>
      ) : (
        // Full-bleed on wide screens: graphs are the point of this page, so the
        // card escapes the centered column and uses (nearly) the whole viewport.
        <div className="xl:relative xl:left-1/2 xl:-ml-[50vw] xl:w-screen xl:px-6">
          <div className="xl:mx-auto xl:max-w-[110rem]">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Fight graph</CardTitle>
              <div className="flex flex-wrap items-center gap-1">
                {active.length > 1 && (
                  <>
                    <ViewButton current={view} mode="overlay" onClick={setView} icon={<Layers className="h-3.5 w-3.5" />} label="Overlay" />
                    <ViewButton current={view} mode="side" onClick={setView} icon={<Columns2 className="h-3.5 w-3.5" />} label="Side by side" />
                    <ViewButton current={view} mode="stack" onClick={setView} icon={<Rows2 className="h-3.5 w-3.5" />} label="Stacked" />
                  </>
                )}
                <div className="ml-2 flex items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-label="Smaller charts"
                    disabled={size === 0}
                    onClick={() => setSize((s) => Math.max(0, s - 1))}
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                  <span className="w-4 text-center text-xs font-medium text-muted-foreground">{SIZES[size].label}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-label="Larger charts"
                    disabled={size === SIZES.length - 1}
                    onClick={() => setSize((s) => Math.min(SIZES.length - 1, s + 1))}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {active.some((x) => x.error) && (
              <p className="pb-2 text-sm text-destructive">
                {active
                  .filter((x) => x.error)
                  .map((x) => (x.error!.status === "error" ? x.error!.message : "Warcraft Logs credentials are not configured."))
                  .join(" · ")}
              </p>
            )}
            {loadedInstances.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Loading fight data…</p>
            ) : (
              <div className="space-y-3">
                <HiddenBuffsMenu filter={buffFilter} onChange={setBuffFilter} />
                {loadedInstances.length === 1 || view !== "overlay" ? (
                  (() => {
                    const sideGrid = view === "side" && loadedInstances.length > 1;
                    return (
                      <div
                        className={cn("gap-6", sideGrid ? "grid" : "flex flex-col items-center")}
                        style={
                          sideGrid
                            ? { gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${SIZES[size].sideMin}px), 1fr))` }
                            : undefined
                        }
                      >
                        {loadedInstances.map((inst) => (
                          <div
                            key={inst.key}
                            className={cn(
                              "w-full min-w-0 space-y-2 transition-opacity",
                              inst.loading && "opacity-50",
                              emphasis !== null && inst.key !== emphasis && "opacity-30",
                            )}
                            style={!sideGrid ? { maxWidth: SIZES[size].maxWidth } : undefined}
                          >
                            <button
                              type="button"
                              title="Click: highlight this player on/off"
                              aria-pressed={focus === inst.key}
                              className={cn(
                                "flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-0.5 text-sm font-medium transition-colors hover:bg-accent",
                                focus === inst.key && "bg-accent",
                              )}
                              onClick={() => toggleFocus(inst.key)}
                              onMouseEnter={() => setHoverKey(inst.key)}
                              onMouseLeave={() => setHoverKey(null)}
                            >
                              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: inst.color }} />
                              {inst.label}
                            </button>
                            <DpsChart
                              data={inst.data}
                              accent={inst.color}
                              buffFilter={buffFilter}
                              onBuffClick={(name) => setBuffFilter((f) => toggleHighlight(f, name))}
                              onBuffHide={(name) => setBuffFilter((f) => hideBuff(f, name))}
                            />
                          </div>
                        ))}
                      </div>
                    );
                  })()
                ) : (
                  <div className="mx-auto w-full" style={{ maxWidth: SIZES[size].maxWidth }}>
                    <OverlayChart
                      instances={loadedInstances}
                      buffFilter={buffFilter}
                      onBuffClick={(name) => setBuffFilter((f) => toggleHighlight(f, name))}
                      onBuffHide={(name) => setBuffFilter((f) => hideBuff(f, name))}
                      focusKey={emphasis}
                      pressedKey={focus}
                      onFocusToggle={toggleFocus}
                      onFocusHover={setHoverKey}
                    />
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function ViewButton({
  current,
  mode,
  onClick,
  icon,
  label,
}: {
  current: ViewMode;
  mode: ViewMode;
  onClick: (m: ViewMode) => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={current === mode ? "default" : "outline"}
      onClick={() => onClick(mode)}
    >
      {icon} {label}
    </Button>
  );
}

function InstancePicker({
  index,
  color,
  reports,
  instance,
  onChange,
  onClear,
}: {
  index: number;
  color: string;
  reports: PickerReport[];
  instance: Instance;
  onChange: (patch: Instance) => void;
  onClear: () => void;
}) {
  const report = reports.find((r) => r.code === instance.reportCode);
  const hasAny = instance.reportCode || instance.player;
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border p-2">
      <span className="inline-flex items-center gap-1.5 pr-1 text-xs font-medium text-muted-foreground">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
        Player {String.fromCharCode(65 + index)}
      </span>
      <Select
        value={instance.reportCode ?? ""}
        onValueChange={(code) => onChange({ reportCode: code, fightId: undefined, player: undefined })}
      >
        <SelectTrigger className="h-7 w-44 text-xs">
          <SelectValue placeholder="Raid…" />
        </SelectTrigger>
        <SelectContent>
          {reports.map((r) => (
            <SelectItem key={r.code} value={r.code}>
              {r.dateLabel} · {r.zone ?? r.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={instance.fightId !== undefined ? String(instance.fightId) : ""}
        onValueChange={(v) => onChange({ fightId: Number(v) })}
        disabled={!report}
      >
        <SelectTrigger className="h-7 w-44 text-xs">
          <SelectValue placeholder="Fight…" />
        </SelectTrigger>
        <SelectContent>
          {(report?.fights ?? []).map((f) => (
            <SelectItem key={f.fightId} value={String(f.fightId)}>
              {f.encounterName}
              {f.kill ? "" : ` (wipe${f.fightPercentage !== undefined ? ` ${Math.round(f.fightPercentage)}%` : ""})`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={instance.player ?? ""}
        onValueChange={(p) => onChange({ player: p })}
        disabled={!report}
      >
        <SelectTrigger className="h-7 w-40 text-xs">
          <SelectValue placeholder="Player…" />
        </SelectTrigger>
        <SelectContent>
          {(report?.players ?? []).map((p) => (
            <SelectItem key={p} value={p}>
              {p}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hasAny && (
        <button
          type="button"
          aria-label="Clear"
          className="cursor-pointer rounded-full p-1 text-muted-foreground hover:text-foreground"
          onClick={onClear}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/* ---- Overlay: both instances on one time axis ---- */

const W = 840;
const GUTTER = 170;
const M_RIGHT = 46;
const M_TOP = 10;
const PLOT_W = W - GUTTER - M_RIGHT;
const PLOT_H = 190;
const BOSS_H = 36;
const LANE_H = 16;
const SECTION_GAP = 12;
const AXIS_H = 20;
interface OverlayInstance {
  key: string;
  data: FightGraphView;
  color: string;
  label: string;
}

/** A lane in the overlay: a buff window (bands) or a consume (dots per use). */
type OverlayLane =
  | { kind: "buff"; inst: OverlayInstance; name: string; uses: number; pct: number; segments: [number, number][] }
  | { kind: "consume"; inst: OverlayInstance; name: string; times: number[] };

function overlayLanes(instances: OverlayInstance[], buffFilter?: BuffFilterState): OverlayLane[] {
  return instances.flatMap((inst) => {
    // Every buff the single view shows appears here too — no overlay-only cap.
    const buffLanes: OverlayLane[] = inst.data.buffs
      .filter((b) => buffFilter?.[b.name] !== "hidden")
      .map((b) => ({ kind: "buff", inst, name: b.name, uses: b.uses, pct: b.pct, segments: b.segments }));
    const consumesByName = new Map<string, number[]>();
    for (const c of inst.data.casts) {
      if (c.kind !== "consumable") continue;
      const times = consumesByName.get(c.name) ?? [];
      times.push(c.t);
      consumesByName.set(c.name, times);
    }
    const consumeLanes: OverlayLane[] = [...consumesByName]
      .map(([name, times]): OverlayLane => ({ kind: "consume", inst, name, times }))
      .sort((a, b) => compareText(a.name, b.name));
    // Uptime lanes first (alphabetical from the fetch), then consumes.
    return [...buffLanes, ...consumeLanes];
  });
}

export function OverlayChart({
  instances,
  buffFilter,
  onBuffClick,
  onBuffHide,
  focusKey,
  pressedKey,
  onFocusToggle,
  onFocusHover,
}: {
  instances: OverlayInstance[];
  buffFilter?: BuffFilterState;
  onBuffClick?: (name: string) => void;
  onBuffHide?: (name: string) => void;
  /** Emphasized instance (clicked focus or live hover): the rest recede. */
  focusKey?: string | null;
  /** The clicked (persistent) focus — drives the pressed chip styling. */
  pressedKey?: string | null;
  onFocusToggle?: (key: string) => void;
  onFocusHover?: (key: string | null) => void;
}) {
  const svgRef = React.useRef<SVGSVGElement>(null);
  const [hover, setHover] = React.useState<{ t: number; x: number } | null>(null);

  const instDimmed = (key: string) => focusKey != null && key !== focusKey;

  const durationMs = Math.max(...instances.map((i) => i.data.durationMs));
  const yMax = niceCeil(Math.max(1, ...instances.flatMap((i) => i.data.dps)));
  const x = (t: number) => GUTTER + (t / durationMs) * PLOT_W;
  const y = (v: number) => M_TOP + PLOT_H - (Math.min(v, yMax) / yMax) * PLOT_H;

  const anyBoss = instances.some((i) => i.data.bossHealth);
  const lanes = overlayLanes(instances, buffFilter);

  const bossTop = M_TOP + PLOT_H + (anyBoss ? SECTION_GAP : 0);
  const lanesTop = (anyBoss ? bossTop + BOSS_H : M_TOP + PLOT_H) + (lanes.length > 0 ? SECTION_GAP : 0);
  const lanesBottom = lanesTop + lanes.length * LANE_H;
  const H = lanesBottom + AXIS_H;

  const step = tickStep(durationMs);
  const xTicks: number[] = [];
  for (let t = step; t < durationMs; t += step) xTicks.push(t);
  const yTicks = [0.25, 0.5, 0.75, 1].map((f) => f * yMax);

  const dpsAt = (inst: OverlayInstance, t: number) => {
    if (t > inst.data.durationMs) return undefined;
    const i = Math.min(inst.data.dps.length - 1, Math.max(0, Math.floor(t / inst.data.bucketMs)));
    return inst.data.dps[i] ?? 0;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const vx = ((e.clientX - rect.left) / rect.width) * W;
    const frac = (vx - GUTTER) / PLOT_W;
    if (frac < 0 || frac > 1) {
      setHover(null);
      return;
    }
    const t = frac * durationMs;
    setHover({ t, x: (x(t) / W) * rect.width });
  };

  const bossY = (pct: number) => bossTop + BOSS_H - (pct / 100) * BOSS_H;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {instances.map((inst) => (
          <button
            key={inst.key}
            type="button"
            title="Click: highlight this player on/off"
            aria-pressed={pressedKey === inst.key}
            className={cn(
              "inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2 py-0.5 transition-all hover:bg-accent",
              instDimmed(inst.key) && "opacity-40",
              pressedKey === inst.key && "bg-accent font-medium",
            )}
            onClick={onFocusToggle ? () => onFocusToggle(inst.key) : undefined}
            onMouseEnter={onFocusHover ? () => onFocusHover(inst.key) : undefined}
            onMouseLeave={onFocusHover ? () => onFocusHover(null) : undefined}
          >
            <span className="h-0.5 w-4 rounded" style={{ backgroundColor: inst.color }} />
            <span className="text-foreground">{inst.label}</span>
          </button>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full border border-muted-foreground/60" /> cooldown
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 border border-muted-foreground/60" /> consumable
        </span>
      </div>

      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label="Damage per second over the fight for the compared players"
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHover(null)}
        >
          {xTicks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={M_TOP} y2={lanesBottom} stroke="var(--border)" strokeWidth={1} />
              <text x={x(t)} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--muted-foreground)" style={{ fontVariantNumeric: "tabular-nums" }}>
                {mmss(t)}
              </text>
            </g>
          ))}
          {yTicks.map((v) => (
            <g key={v}>
              <line x1={GUTTER} x2={W - M_RIGHT} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
              <text x={GUTTER - 6} y={y(v) + 3} textAnchor="end" fontSize={10} fill="var(--muted-foreground)" style={{ fontVariantNumeric: "tabular-nums" }}>
                {v >= 1000 ? `${(v / 1000).toLocaleString("en-US")}k` : v.toLocaleString("en-US")}
              </text>
            </g>
          ))}
          <text x={GUTTER} y={H - 6} textAnchor="start" fontSize={10} fill="var(--muted-foreground)">0:00</text>
          <text x={W - M_RIGHT} y={H - 6} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">{mmss(durationMs)}</text>

          {/* One line + wash per instance; identity is the instance color.
              Washes never take pointer events — they cover the whole plot and
              would otherwise swallow clicks meant for other players' lines. */}
          {instances.map((inst) => {
            const tAt = (i: number) => Math.min(inst.data.durationMs, i * inst.data.bucketMs + inst.data.bucketMs / 2);
            if (inst.data.dps.length === 0) return null;
            const line = inst.data.dps
              .map((v, i) => `${i === 0 ? "M" : "L"}${x(tAt(i)).toFixed(1)},${y(v).toFixed(1)}`)
              .join(" ");
            const area = `${line} L${x(tAt(inst.data.dps.length - 1)).toFixed(1)},${y(0)} L${x(tAt(0)).toFixed(1)},${y(0)} Z`;
            return (
              <g key={inst.key} opacity={instDimmed(inst.key) ? 0.25 : 1} className="transition-opacity">
                <path d={area} fill={inst.color} opacity={0.08} pointerEvents="none" />
                <path
                  d={line}
                  fill="none"
                  stroke={inst.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  pointerEvents="none"
                />
              </g>
            );
          })}

          {/* Click targets for line highlighting: invisible wide strokes, drawn
              AFTER every wash and line so no other player's fill can cover
              them. Cast markers come later still, keeping their tooltips. */}
          {onFocusToggle &&
            instances.map((inst) => {
              const tAt = (i: number) => Math.min(inst.data.durationMs, i * inst.data.bucketMs + inst.data.bucketMs / 2);
              if (inst.data.dps.length === 0) return null;
              const line = inst.data.dps
                .map((v, i) => `${i === 0 ? "M" : "L"}${x(tAt(i)).toFixed(1)},${y(v).toFixed(1)}`)
                .join(" ");
              return (
                <path
                  key={inst.key}
                  d={line}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={14}
                  style={{ cursor: "pointer" }}
                  pointerEvents="stroke"
                  onClick={() => onFocusToggle(inst.key)}
                  onMouseEnter={onFocusHover ? () => onFocusHover(inst.key) : undefined}
                  onMouseLeave={onFocusHover ? () => onFocusHover(null) : undefined}
                >
                  <title>{`${inst.label} — click: highlight on/off`}</title>
                </path>
              );
            })}

          {/* Cast markers, above the click targets so their tooltips work. */}
          {instances.map((inst) => (
            <g key={inst.key} opacity={instDimmed(inst.key) ? 0.25 : 1} className="transition-opacity">
              {inst.data.casts.map((c, i) =>
                c.kind === "cooldown" ? (
                  <circle key={i} cx={x(c.t)} cy={y(dpsAt(inst, c.t) ?? 0)} r={4.5} fill={inst.color} stroke="var(--card)" strokeWidth={2}>
                    <title>{`${inst.label} · ${mmss(c.t)} · ${c.name}`}</title>
                  </circle>
                ) : (
                  <rect
                    key={i}
                    x={x(c.t) - 4}
                    y={y(dpsAt(inst, c.t) ?? 0) - 4}
                    width={8}
                    height={8}
                    fill={inst.color}
                    stroke="var(--card)"
                    strokeWidth={2}
                    opacity={anyHighlight(buffFilter) ? 0.25 : 1}
                  >
                    <title>{`${inst.label} · ${mmss(c.t)} · ${c.name}`}</title>
                  </rect>
                ),
              )}
            </g>
          ))}

          {/* Boss health strip — one curve per instance, instance-colored. */}
          {anyBoss && (
            <g>
              <text x={GUTTER - 6} y={bossTop + BOSS_H / 2 + 3} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">
                boss hp
              </text>
              <line x1={GUTTER} x2={W - M_RIGHT} y1={bossTop + BOSS_H} y2={bossTop + BOSS_H} stroke="var(--border)" strokeWidth={1} />
              {instances.map((inst) =>
                inst.data.bossHealth ? (
                  <path
                    key={inst.key}
                    d={inst.data.bossHealth.map(([t, pct], i) => `${i === 0 ? "M" : "L"}${x(t).toFixed(1)},${bossY(pct).toFixed(1)}`).join(" ")}
                    fill="none"
                    stroke={inst.color}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    opacity={instDimmed(inst.key) ? 0.25 : 1}
                  />
                ) : null,
              )}
              <text x={W - M_RIGHT + 4} y={bossTop + 8} textAnchor="start" fontSize={9} fill="var(--muted-foreground)">100%</text>
              <text x={W - M_RIGHT + 4} y={bossTop + BOSS_H} textAnchor="start" fontSize={9} fill="var(--muted-foreground)">0%</text>
            </g>
          )}

          {/* Uptime + consume lanes, instance-colored, player-prefixed labels. */}
          {lanes.map((lane, row) => {
            const top = lanesTop + row * LANE_H;
            const player = lane.inst.label.split(" · ")[0];
            // A highlight recedes everything else — other buffs AND consumes —
            // and an instance focus recedes every other player's lanes.
            const dimmed =
              instDimmed(lane.inst.key) ||
              (lane.kind === "buff" ? isDimmed(lane.name, buffFilter) : anyHighlight(buffFilter));
            const clickable = lane.kind === "buff" && onBuffClick;
            return (
              <g
                key={`${lane.inst.key}|${lane.kind}|${lane.name}`}
                opacity={dimmed ? 0.25 : 1}
                onClick={clickable ? () => onBuffClick(lane.name) : undefined}
                onDoubleClick={lane.kind === "buff" && onBuffHide ? () => onBuffHide(lane.name) : undefined}
                style={clickable ? { cursor: "pointer" } : undefined}
              >
                {clickable && <title>{`${lane.name} — click: highlight on/off · double-click: hide`}</title>}
                <text x={GUTTER - 6} y={top + LANE_H / 2 + 3} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">
                  {truncate(`${player} · ${lane.name}`, 28)}
                  {lane.kind === "buff" && lane.uses > 1 ? ` ×${lane.uses}` : ""}
                  {lane.kind === "consume" && lane.times.length > 1 ? ` ×${lane.times.length}` : ""}
                </text>
                <rect x={GUTTER} y={top + 3} width={PLOT_W} height={LANE_H - 6} fill="var(--muted)" rx={2} />
                {lane.kind === "buff" ? (
                  lane.segments.map(([from, to], i) => (
                    <rect
                      key={i}
                      x={x(from)}
                      y={top + 3}
                      width={Math.max(2, ((to - from) / durationMs) * PLOT_W)}
                      height={LANE_H - 6}
                      fill={lane.inst.color}
                      rx={1}
                    >
                      <title>{`${lane.name} ${mmss(from)}–${mmss(to)}`}</title>
                    </rect>
                  ))
                ) : (
                  lane.times.map((t, i) => (
                    <rect
                      key={i}
                      x={x(t) - 3.5}
                      y={top + LANE_H / 2 - 3.5}
                      width={7}
                      height={7}
                      fill={lane.inst.color}
                      stroke="var(--card)"
                      strokeWidth={1.5}
                    >
                      <title>{`${mmss(t)} · ${lane.name}`}</title>
                    </rect>
                  ))
                )}
                {lane.kind === "buff" && (
                  <text
                    x={W - M_RIGHT + 4}
                    y={top + LANE_H / 2 + 3}
                    textAnchor="start"
                    fontSize={10}
                    fill="var(--muted-foreground)"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {lane.pct}%
                  </text>
                )}
              </g>
            );
          })}

          {/* The crosshair tracks the pointer exactly, so it MUST be inert —
              as the topmost element it would otherwise sit under the cursor
              and steal every hover and click inside the plot. */}
          {hover && (
            <line
              x1={x(hover.t)}
              x2={x(hover.t)}
              y1={M_TOP}
              y2={lanesBottom}
              stroke="var(--muted-foreground)"
              strokeWidth={1}
              pointerEvents="none"
            />
          )}
        </svg>

        {hover && (
          <div
            className="pointer-events-none absolute top-1 z-10 w-max max-w-64 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
            style={{ left: `min(calc(100% - 17rem), ${Math.round(hover.x + 10)}px)` }}
          >
            <p className="text-muted-foreground">{mmss(hover.t)}</p>
            {instances.map((inst) => {
              const v = dpsAt(inst, hover.t);
              return (
                <p key={inst.key} className={cn("mt-0.5 flex items-center gap-1.5", instDimmed(inst.key) && "opacity-40")}>
                  <span className="h-1.5 w-4 rounded" style={{ backgroundColor: inst.color }} />
                  <span className="font-semibold tabular-nums">
                    {v === undefined ? "ended" : Math.round(v).toLocaleString("en-US")}
                  </span>
                  <span className="truncate text-muted-foreground">{inst.label.split(" · ")[0]}</span>
                </p>
              );
            })}
          </div>
        )}
      </div>

      {/* Cast lists per instance — the no-hover home for every marker. */}
      {instances.map(
        (inst) =>
          inst.data.casts.length > 0 && (
            <div
              key={inst.key}
              className={cn("flex flex-wrap items-center gap-1.5 transition-opacity", instDimmed(inst.key) && "opacity-40")}
            >
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: inst.color }} />
                {inst.label.split(" · ")[0]}:
              </span>
              {inst.data.casts.map((c, i) => (
                <Badge key={i} variant="secondary" className="font-normal tabular-nums">
                  {mmss(c.t)} {c.name}
                </Badge>
              ))}
            </div>
          ),
      )}
    </div>
  );
}
