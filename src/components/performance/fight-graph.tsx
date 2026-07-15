"use client";

import * as React from "react";
import type { FightGraphActionResult } from "@/app/characters/[name]/performance/graph-actions";
import { fetchFightGraphAction } from "@/app/characters/[name]/performance/graph-actions";
import type { FightGraphView } from "@/lib/wcl/fight-graph";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * "Fight graph" tab: one pull's DPS-over-time line with the moments that
 * explain it — class-cooldown casts, consumable casts, boss health, and the
 * buff windows the player gained (trinket/weapon/item procs, CDs, externals).
 * Everything shares ONE time axis in a single SVG, so a proc band sits
 * pixel-aligned under the damage it produced. Data is fetched live from WCL
 * per fight (cached server- and client-side), so it needs no re-import.
 *
 * Colors are the validated categorical slots (dataviz palette, light mode):
 * DPS slot 1, cooldowns slot 2, consumables slot 3, buff windows slot 4,
 * boss health slot 5.
 */
import { GRAPH_COLOR as COLOR, compact, mmss, niceCeil, tickStep, truncate } from "@/components/performance/graph-utils";
import {
  HiddenBuffsMenu,
  anyHighlight,
  hideBuff,
  isDimmed,
  toggleHighlight,
  type BuffFilterState,
} from "@/components/performance/buff-filter";

/* Chart geometry (viewBox units; the SVG scales to its container). */
const W = 840;
const GUTTER = 150; // left label gutter shared by the plot and the lanes
const M_RIGHT = 46;
const M_TOP = 10;
const PLOT_W = W - GUTTER - M_RIGHT;
const PLOT_H = 170;
const BOSS_H = 36;
const LANE_H = 16;
const SECTION_GAP = 12;
const AXIS_H = 20;

interface FightOption {
  fightId: number;
  encounterName: string;
  kill: boolean;
  fightPercentage?: number;
}

// Fights are historical, so results cache for the whole browser session
// (module scope, shared across mounts) — flipping between fights or players
// already viewed costs no server roundtrip and no WCL calls.
const clientCache = new Map<string, FightGraphActionResult>();

export function FightGraphPanel({
  code,
  actorName,
  fights,
}: {
  code: string;
  actorName: string;
  fights: FightOption[];
}) {
  const [fightId, setFightId] = React.useState(fights[0]?.fightId);
  // Buff show/highlight/hide persists across fight switches — that's how you
  // follow one proc through the night.
  const [buffFilter, setBuffFilter] = React.useState<BuffFilterState>({});
  const key = `${code}|${fightId}|${actorName}`;
  const fromCache = clientCache.get(key);
  // While a new fight loads, the previously shown result holds at reduced opacity.
  const [loaded, setLoaded] = React.useState<{ key: string; result: FightGraphActionResult } | null>(null);
  const result = fromCache ?? loaded?.result;
  const loading = !fromCache;

  React.useEffect(() => {
    if (fightId === undefined || clientCache.has(key)) return;
    let cancelled = false;
    const requestKey = key;
    fetchFightGraphAction({ code, fightId, actorName }).then((r) => {
      if (cancelled) return;
      clientCache.set(requestKey, r);
      setLoaded({ key: requestKey, result: r });
    });
    return () => {
      cancelled = true;
    };
  }, [code, fightId, actorName, key]);

  if (fights.length === 0) {
    return <p className="py-1 text-sm text-muted-foreground">No pulls in this report.</p>;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Fight graph</CardTitle>
          <Select value={String(fightId)} onValueChange={(v) => setFightId(Number(v))}>
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {fights.map((f) => (
                <SelectItem key={f.fightId} value={String(f.fightId)}>
                  {f.encounterName}
                  {f.kill
                    ? " · kill"
                    : ` · wipe${f.fightPercentage !== undefined ? ` ${Math.round(f.fightPercentage)}%` : ""}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">
          {actorName}&apos;s damage output across the pull, with what drove it: cooldown presses,
          consumables, boss health, and every buff window gained — trinket, weapon and item procs
          included. Fetched live from Warcraft Logs.
        </p>
      </CardHeader>
      <CardContent>
        {result?.status === "not-configured" ? (
          <p className="py-1 text-sm text-muted-foreground">
            Warcraft Logs credentials are not configured — set WCL_CLIENT_ID / WCL_CLIENT_SECRET.
          </p>
        ) : result?.status === "error" ? (
          <p className="py-1 text-sm text-destructive">{result.message}</p>
        ) : result?.status === "ok" ? (
          <div className={cn("space-y-3 transition-opacity", loading && "opacity-50")}>
            <HiddenBuffsMenu filter={buffFilter} onChange={setBuffFilter} />
            <DpsChart
              data={result.data}
              buffFilter={buffFilter}
              onBuffClick={(name) => setBuffFilter((f) => toggleHighlight(f, name))}
              onBuffHide={(name) => setBuffFilter((f) => hideBuff(f, name))}
            />
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading fight data…</p>
        )}
      </CardContent>
    </Card>
  );
}

export function DpsChart({
  data,
  accent,
  buffFilter,
  onBuffClick,
  onBuffHide,
}: {
  data: FightGraphView;
  accent?: string;
  /** Optional per-buff show/highlight/hide state (click toggles highlight, double-click hides). */
  buffFilter?: BuffFilterState;
  onBuffClick?: (name: string) => void;
  onBuffHide?: (name: string) => void;
}) {
  const { durationMs, bucketMs, dps, casts, bossHealth, bossName, bossMaxHp } = data;
  const buffs = React.useMemo(
    () => data.buffs.filter((b) => buffFilter?.[b.name] !== "hidden"),
    [data.buffs, buffFilter],
  );
  const lineColor = accent ?? COLOR.dps;
  const svgRef = React.useRef<SVGSVGElement>(null);
  const [hover, setHover] = React.useState<{ t: number; x: number } | null>(null);

  /* Consumable uses, one lane per item (haste pots, mana pots, sappers…). */
  const consumeLanes = React.useMemo(() => {
    const byName = new Map<string, number[]>();
    for (const c of casts) {
      if (c.kind !== "consumable") continue;
      const times = byName.get(c.name) ?? [];
      times.push(c.t);
      byName.set(c.name, times);
    }
    return [...byName]
      .map(([name, times]) => ({ name, times }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [casts]);

  /* Vertical layout: DPS plot, boss-health strip, buff lanes, consume lanes. */
  const bossTop = M_TOP + PLOT_H + (bossHealth ? SECTION_GAP : 0);
  const lanesTop = (bossHealth ? bossTop + BOSS_H : M_TOP + PLOT_H) + (buffs.length > 0 ? SECTION_GAP : 0);
  const buffLanesBottom = lanesTop + buffs.length * LANE_H;
  const consumeTop = buffLanesBottom + (consumeLanes.length > 0 ? SECTION_GAP : 0);
  const lanesBottom = consumeTop + consumeLanes.length * LANE_H;
  const H = lanesBottom + AXIS_H;

  const yMax = niceCeil(Math.max(1, ...dps));
  const x = (t: number) => GUTTER + (t / durationMs) * PLOT_W;
  const y = (v: number) => M_TOP + PLOT_H - (Math.min(v, yMax) / yMax) * PLOT_H;
  const tAt = (i: number) => Math.min(durationMs, i * bucketMs + bucketMs / 2);

  const linePath = dps.map((v, i) => `${i === 0 ? "M" : "L"}${x(tAt(i)).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${x(tAt(dps.length - 1)).toFixed(1)},${y(0)} L${x(tAt(0)).toFixed(1)},${y(0)} Z`;

  const step = tickStep(durationMs);
  const xTicks: number[] = [];
  for (let t = step; t < durationMs; t += step) xTicks.push(t);
  const yTicks = [0.25, 0.5, 0.75, 1].map((f) => f * yMax);

  const bossY = (pct: number) => bossTop + BOSS_H - (pct / 100) * BOSS_H;
  const bossPath = (bossHealth ?? [])
    .map(([t, pct], i) => `${i === 0 ? "M" : "L"}${x(t).toFixed(1)},${bossY(pct).toFixed(1)}`)
    .join(" ");

  const dpsAt = (t: number) => dps[Math.min(dps.length - 1, Math.max(0, Math.floor(t / bucketMs)))] ?? 0;
  const bossAt = (t: number) => {
    if (!bossHealth) return undefined;
    let last: number | undefined;
    for (const [pt, pct] of bossHealth) {
      if (pt > t) break;
      last = pct;
    }
    return last ?? bossHealth[0]?.[1];
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
    // Snap the crosshair to the nearest bucket center.
    const i = Math.min(dps.length - 1, Math.max(0, Math.round((frac * durationMs - bucketMs / 2) / bucketMs)));
    setHover({ t: tAt(i), x: (x(tAt(i)) / W) * rect.width });
  };

  const hoverCasts = hover ? casts.filter((c) => Math.abs(c.t - hover.t) <= Math.max(bucketMs, 1500)) : [];
  const hoverBuffs = hover ? buffs.filter((b) => b.segments.some(([a, bEnd]) => hover.t >= a && hover.t <= bEnd)) : [];

  return (
    <div className="space-y-3">
      {/* Legend — identity is never color-alone; text wears text tokens. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded" style={{ backgroundColor: lineColor }} /> DPS
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: COLOR.cooldown }} /> cooldown cast
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: COLOR.consumable }} /> consumable
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm" style={{ backgroundColor: COLOR.buff }} /> buff window
        </span>
        {bossHealth && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded" style={{ backgroundColor: COLOR.boss }} /> boss health
          </span>
        )}
      </div>

      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label="Damage per second over the fight, with boss health and buff windows"
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHover(null)}
        >
          {/* Recessive hairline grid — vertical gates span plot, strip and lanes. */}
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

          {/* DPS: area wash + 2px line */}
          {dps.length > 0 && (
            <>
              <path d={areaPath} fill={lineColor} opacity={0.1} />
              <path d={linePath} fill="none" stroke={lineColor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            </>
          )}

          {/* Cast markers on the line, 2px surface ring. Consumable markers
              recede with the consume lanes while a buff is highlighted. */}
          {casts.map((c, i) => (
            <circle
              key={i}
              cx={x(c.t)}
              cy={y(dpsAt(c.t))}
              r={4.5}
              fill={c.kind === "cooldown" ? COLOR.cooldown : COLOR.consumable}
              stroke="var(--card)"
              strokeWidth={2}
              opacity={c.kind === "consumable" && anyHighlight(buffFilter) ? 0.25 : 1}
            >
              <title>{`${mmss(c.t)} · ${c.name}`}</title>
            </circle>
          ))}

          {/* Boss health strip — its own 100→0% scale, same time axis. */}
          {bossHealth && (
            <g>
              <text x={GUTTER - 6} y={bossTop + BOSS_H / 2 + 3} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">
                {truncate(bossName ?? "Boss", 20)} hp
              </text>
              <line x1={GUTTER} x2={W - M_RIGHT} y1={bossTop + BOSS_H} y2={bossTop + BOSS_H} stroke="var(--border)" strokeWidth={1} />
              <path d={bossPath} fill="none" stroke={COLOR.boss} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              <text x={W - M_RIGHT + 4} y={bossTop + 8} textAnchor="start" fontSize={9} fill="var(--muted-foreground)">100%</text>
              <text x={W - M_RIGHT + 4} y={bossTop + BOSS_H} textAnchor="start" fontSize={9} fill="var(--muted-foreground)">0%</text>
            </g>
          )}

          {/* Buff-window lanes — pixel-aligned with the plot above. */}
          {buffs.map((b, row) => {
            const top = lanesTop + row * LANE_H;
            return (
              <g
                key={b.name}
                opacity={isDimmed(b.name, buffFilter) ? 0.25 : 1}
                onClick={onBuffClick ? () => onBuffClick(b.name) : undefined}
                onDoubleClick={onBuffHide ? () => onBuffHide(b.name) : undefined}
                style={onBuffClick ? { cursor: "pointer" } : undefined}
              >
                {onBuffClick && (
                  <title>{`${b.name} — click: highlight on/off · double-click: hide`}</title>
                )}
                <text x={GUTTER - 6} y={top + LANE_H / 2 + 3} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">
                  {truncate(b.name, 22)}
                  {b.uses > 1 ? ` ×${b.uses}` : ""}
                </text>
                <rect x={GUTTER} y={top + 3} width={PLOT_W} height={LANE_H - 6} fill="var(--muted)" rx={2} />
                {b.segments.map(([from, to], i) => (
                  <rect
                    key={i}
                    x={x(from)}
                    y={top + 3}
                    width={Math.max(2, ((to - from) / durationMs) * PLOT_W)}
                    height={LANE_H - 6}
                    fill={COLOR.buff}
                    rx={1}
                  >
                    <title>{`${b.name} ${mmss(from)}–${mmss(to)}`}</title>
                  </rect>
                ))}
                <text
                  x={W - M_RIGHT + 4}
                  y={top + LANE_H / 2 + 3}
                  textAnchor="start"
                  fontSize={10}
                  fill="var(--muted-foreground)"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {b.pct}%
                </text>
              </g>
            );
          })}

          {/* Consumable-use lanes — one per item, a dot per use, same time axis. */}
          {consumeLanes.map((lane, row) => {
            const top = consumeTop + row * LANE_H;
            return (
              <g key={lane.name} opacity={anyHighlight(buffFilter) ? 0.25 : 1}>
                <text x={GUTTER - 6} y={top + LANE_H / 2 + 3} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">
                  {truncate(lane.name, 22)}
                  {lane.times.length > 1 ? ` ×${lane.times.length}` : ""}
                </text>
                <rect x={GUTTER} y={top + 3} width={PLOT_W} height={LANE_H - 6} fill="var(--muted)" rx={2} />
                {lane.times.map((t, i) => (
                  <circle key={i} cx={x(t)} cy={top + LANE_H / 2} r={4} fill={COLOR.consumable} stroke="var(--card)" strokeWidth={2}>
                    <title>{`${mmss(t)} · ${lane.name}`}</title>
                  </circle>
                ))}
              </g>
            );
          })}

          {/* Crosshair spans the plot, the strip and every lane. */}
          {hover && (
            <line x1={x(hover.t)} x2={x(hover.t)} y1={M_TOP} y2={lanesBottom} stroke="var(--muted-foreground)" strokeWidth={1} />
          )}
        </svg>

        {hover && (
          <div
            className="pointer-events-none absolute top-1 z-10 w-max max-w-56 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
            style={{ left: `min(calc(100% - 15rem), ${Math.round(hover.x + 10)}px)` }}
          >
            <p>
              <span className="text-sm font-semibold tabular-nums">{Math.round(dpsAt(hover.t)).toLocaleString("en-US")}</span>{" "}
              <span className="text-muted-foreground">dps · {mmss(hover.t)}</span>
            </p>
            {bossHealth && (
              <p className="mt-0.5 text-muted-foreground">
                {bossName ?? "boss"}:{" "}
                <span className="tabular-nums text-foreground">{bossAt(hover.t)}%</span>
                {bossMaxHp !== undefined && (
                  <span className="tabular-nums">
                    {" "}· {compact(((bossAt(hover.t) ?? 0) / 100) * bossMaxHp)} / {compact(bossMaxHp)} HP
                  </span>
                )}
              </p>
            )}
            {hoverCasts.map((c, i) => (
              <p key={i} className="mt-0.5 flex items-center gap-1.5">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: c.kind === "cooldown" ? COLOR.cooldown : COLOR.consumable }}
                />
                {c.name}
              </p>
            ))}
            {hoverBuffs.length > 0 && (
              <p className="mt-0.5 text-muted-foreground">
                active: {hoverBuffs.map((b) => b.name).join(", ")}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Cast list — the no-hover home for every marker (relief for the light hues). */}
      {casts.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {casts.map((c, i) => (
            <Badge key={i} variant="secondary" className="gap-1 font-normal tabular-nums">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: c.kind === "cooldown" ? COLOR.cooldown : COLOR.consumable }}
              />
              {mmss(c.t)} {c.name}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
