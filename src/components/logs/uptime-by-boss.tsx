"use client";

import * as React from "react";
import { parseISO } from "date-fns";
import { X } from "lucide-react";
import type { RaidFight, RaidUpkeepRow, UpkeepFightProvider, WclUpkeepTarget } from "@/lib/types";
import { classColor, Raider } from "@/components/logs/rank-bits";
import { CollapsibleCard } from "@/components/logs/collapsible-card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { clockTime, PctLane, TimeAxis, TimelineLane, timeTicks } from "@/components/logs/timeline-bits";
import type { StepBand } from "@/components/logs/timeline-bits";

import { msAtStack, stackSpans, unionIntervals } from "@/lib/analysis/debuff-merge";

import { compareText } from "@/lib/sort";

/** One provider's up-intervals on one target, as bands over the pull. */
function SegmentLane({
  provider,
  trackName,
  showTrack,
  pct,
  segments,
  applications,
  stackUps,
  refreshes,
  durationMs,
  ticks,
}: {
  provider: UpkeepFightProvider;
  trackName: string;
  showTrack: boolean;
  pct: number;
  segments: [number, number][];
  applications?: number;
  /** The two halves of those casts, when the report recorded the stack. */
  stackUps?: number;
  refreshes?: number;
  durationMs: number;
  ticks: number[];
}) {
  return (
    <TimelineLane
      label={
        <>
          <Raider name={provider.name} slug={provider.slug} className={provider.className} />
          {applications !== undefined && applications > 0 && (
            <span
              className="ml-1 text-xs tabular-nums text-muted-foreground"
              title={
                stackUps === undefined
                  ? "≈ casts landed (applies + refreshes)"
                  : `${applications} landed cast${applications === 1 ? "" : "s"}: ${stackUps} raised the stack, ${refreshes ?? 0} renewed it`
              }
            >
              ×{applications}
              {stackUps !== undefined && stackUps > 0 && <span className="ml-0.5">{stackUps}↑</span>}
            </span>
          )}
          {showTrack && (
            <span className="ml-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">{trackName}</span>
          )}
        </>
      }
      bands={[{ segments, color: classColor(provider.className) ?? "var(--primary)" }]}
      pct={pct}
      durationMs={durationMs}
      ticks={ticks}
    />
  );
}

interface Lane {
  provider: UpkeepFightProvider;
  target: WclUpkeepTarget;
  trackName: string;
  /** Position of the track in the selection — comparison lanes cluster per track. */
  trackIdx: number;
}

/**
 * The stack a raid this size can reach. Every Sunder point in this guild's logs
 * tops out at five, so five is the full-height bar; a track that ever goes
 * higher raises the ceiling rather than being clipped by it.
 */
const STACK_CEILING = 5;

/**
 * What the raid had up on this target, from anybody — one lane per track, drawn
 * above the per-provider lanes it merges.
 *
 * The lanes below are per provider, which is the right way to read "did this
 * raider do their job" and cannot answer "was Sunder up on the boss". Two
 * warriors covering different halves of a pull show as 40% and 40% and the
 * council wants the 80%. **Union, never sum**: overlapping cover is the same
 * seconds twice, so the intervals are merged before dividing.
 *
 * On a stacking debuff the lane carries both facts at once — **bar height is the
 * stack, bar colour is whoever was holding it at that moment**. That is what the
 * numbers beside it could not convey: a raid that walked Sunder to five and held
 * it reads as a full block, a raid that reached five and let it fall off reads as
 * a stub, and a handover between two warriors reads as a colour change mid-lane.
 * The percentages were the same shape for all three.
 *
 * Reports imported before the stack was kept say nothing rather than "0".
 */
function RaidLane({
  trackName,
  showTrack,
  lanes,
  durationMs,
  ticks,
}: {
  trackName: string;
  showTrack: boolean;
  lanes: Lane[];
  durationMs: number;
  ticks: number[];
}) {
  const intervals = unionIntervals(lanes.flatMap((l) => l.target.segments as [number, number][]));
  const ms = intervals.reduce((sum, [from, to]) => sum + (to - from), 0);
  const pctOf = (part: number) => (durationMs > 0 ? Math.round(Math.min(100, (part / durationMs) * 100)) : 0);
  const pct = pctOf(ms);

  const points = lanes.flatMap((l) => l.target.stackPoints ?? []) as [number, number][];
  const stacks = msAtStack(points, intervals);
  const stackUps = lanes.reduce((sum, l) => sum + (l.target.stackUps ?? 0), 0);
  const refreshes = lanes.reduce((sum, l) => sum + (l.target.refreshes ?? 0), 0);
  const casts = lanes.reduce((sum, l) => sum + (l.target.applications ?? 0), 0);

  const ceiling = Math.max(STACK_CEILING, stacks?.maxStack ?? 0);
  /*
   * Every step is one stack level held by one player: the stack spans cut
   * against each provider's own windows.
   *
   * Cutting on the stack alone is not enough. A raid that walks Sunder to five
   * in the first ten seconds and holds it for another eighty has ONE span there,
   * and colouring it by whoever happens to sit at its midpoint hides every
   * hand-over inside it — on a real Lurker pull that erased three warriors.
   * Providers never overlap on one target (Warcraft Logs hands the debuff from
   * one source to the next, and the import now hands it to the real caster), so
   * the intersection is exact and covers the union once.
   */
  const steps: StepBand[] | undefined =
    points.length > 0
      ? stackSpans(points, intervals)
          .flatMap((span) =>
            lanes.flatMap((lane) =>
              (lane.target.segments as [number, number][]).flatMap(([held, until]) => {
                const from = Math.max(span.from, held);
                const to = Math.min(span.to, until);
                if (to <= from) return [];
                return [
                  {
                    from,
                    to,
                    level: span.stack / ceiling,
                    color: classColor(lane.provider.className) ?? "var(--primary)",
                    label: `${lane.provider.name} · ${span.stack} stack${span.stack === 1 ? "" : "s"}`,
                  },
                ];
              }),
            ),
          )
          .sort((a, b) => a.from - b.from)
      : undefined;

  const sources = new Set(lanes.map((l) => l.provider.name));
  const title =
    `${trackName} was on this target ${pct}% of the pull counting every source at once` +
    (sources.size > 1 ? ` (${sources.size} of them, handed over in turn)` : "") +
    (stacks
      ? `. Peaked at ${stacks.maxStack} stacks and held there ${pctOf(stacks.msAtMax)}% of the pull — bar height is the stack, colour is who was holding it.`
      : ". Stacks not recorded on this report — re-import to fill them in.") +
    (casts > 0 ? ` ${casts} landed casts: ${stackUps} raised the stack, ${refreshes} renewed it.` : "") +
    (sources.size > 1
      ? ` — ${lanes
          .filter((l) => (l.target.applications ?? 0) > 0)
          .sort((a, b) => (b.target.applications ?? 0) - (a.target.applications ?? 0))
          .map(
            (l) =>
              `${l.provider.name} ${l.target.applications}` +
              (l.target.stackUps !== undefined ? ` (${l.target.stackUps}↑ ${l.target.refreshes ?? 0}↻)` : ""),
          )
          .join(", ")}`
      : "");

  return (
    <TimelineLane
      label={
        <span title={title}>
          <span className="text-muted-foreground">raid</span>
          {showTrack && <span className="ml-1">{trackName}</span>}
          {stacks && (
            <span className="ml-1 text-xs tabular-nums text-muted-foreground">
              peak {stacks.maxStack}× · {pctOf(stacks.msAtMax)}%
            </span>
          )}
          {sources.size > 1 && (
            <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              {sources.size} sources
            </span>
          )}
        </span>
      }
      bands={
        steps
          ? []
          : lanes.map((l) => ({
              segments: l.target.segments as [number, number][],
              color: classColor(l.provider.className) ?? "var(--primary)",
              label: l.provider.name,
            }))
      }
      steps={steps}
      pct={pct}
      durationMs={durationMs}
      ticks={ticks}
    />
  );
}

/** The raid lanes for one target, one per track that has something to merge. */
function RaidLanes({
  lanes,
  showTrack,
  durationMs,
  ticks,
}: {
  lanes: Lane[];
  showTrack: boolean;
  durationMs: number;
  ticks: number[];
}) {
  const perTrack = new Map<string, Lane[]>();
  for (const lane of lanes) {
    perTrack.set(lane.trackName, [...(perTrack.get(lane.trackName) ?? []), lane]);
  }
  return (
    <>
      {[...perTrack].map(([trackName, trackLanes]) => {
        // A single provider on a non-stacking track needs no merging — its own
        // lane already says this, and a duplicate reads as a second raider.
        if (trackLanes.length < 2 && trackLanes[0]?.target.stackPoints === undefined) return null;
        return (
          <RaidLane
            key={trackName}
            trackName={trackName}
            showTrack={showTrack}
            lanes={trackLanes}
            durationMs={durationMs}
            ticks={ticks}
          />
        );
      })}
    </>
  );
}

/** All selected tracks' lanes on one victim (the boss, one add instance, or a buffed friendly). */
interface TargetGroup {
  key: string;
  label: string;
  boss: boolean;
  bestPct: number;
  lanes: Lane[];
}

function groupByTarget(tracks: { name: string; providers: UpkeepFightProvider[] }[]): TargetGroup[] {
  const groups = new Map<string, TargetGroup>();
  tracks.forEach(({ name: trackName, providers }, trackIdx) => {
    for (const provider of providers) {
      for (const target of provider.targets ?? []) {
        const key = `${target.target}|${target.instance ?? 0}`;
        const label = target.instance !== undefined ? `${target.target} #${target.instance}` : target.target;
        const group = groups.get(key) ?? { key, label, boss: target.boss, bestPct: 0, lanes: [] };
        group.bestPct = Math.max(group.bestPct, target.pct);
        // Distinct NPCs can share one name AND instance (several "Phoenix Egg"
        // actor ids) — fold a provider's repeat appearances into one lane so
        // its bands show everything they did to that named target.
        const lane = group.lanes.find((l) => l.provider.name === provider.name && l.trackName === trackName);
        if (lane) {
          lane.target = {
            ...lane.target,
            pct: Math.max(lane.target.pct, target.pct),
            segments: [...lane.target.segments, ...target.segments].sort((a, b) => a[0] - b[0]),
            applications:
              lane.target.applications !== undefined || target.applications !== undefined
                ? (lane.target.applications ?? 0) + (target.applications ?? 0)
                : undefined,
            // The stack fields fold the same way, or the second actor id's
            // stacks vanish from a mob whose events WCL split across two.
            stackUps:
              lane.target.stackUps !== undefined || target.stackUps !== undefined
                ? (lane.target.stackUps ?? 0) + (target.stackUps ?? 0)
                : undefined,
            refreshes:
              lane.target.refreshes !== undefined || target.refreshes !== undefined
                ? (lane.target.refreshes ?? 0) + (target.refreshes ?? 0)
                : undefined,
            stackPoints:
              lane.target.stackPoints !== undefined || target.stackPoints !== undefined
                ? [...(lane.target.stackPoints ?? []), ...(target.stackPoints ?? [])]
                : undefined,
          };
        } else {
          group.lanes.push({ provider, target, trackName, trackIdx });
        }
        groups.set(key, group);
      }
    }
  });
  const list = [...groups.values()];
  // Comparison reads best clustered per track, best keeper first within each.
  for (const g of list) {
    g.lanes.sort(
      (a, b) => a.trackIdx - b.trackIdx || b.target.pct - a.target.pct || compareText(a.provider.name, b.provider.name),
    );
  }
  return list.sort((a, b) => Number(b.boss) - Number(a.boss) || b.bestPct - a.bestPct || compareText(a.label, b.label));
}

/**
 * Within-fight uptime timelines for one or more maintained debuffs/buffs, one
 * boss pull per tab: when each aura was up on the boss (and on every add or
 * buffed friendly it touched), per provider, over the length of the pull —
 * plus the wall-clock pull/kill times. Pick several tracks to compare them on
 * the same targets (e.g. warriors' Sunder Armor vs rogues' Expose Armor).
 * Falls back to plain per-pull percentages for reports imported before
 * timeline tracking; re-importing backfills them.
 */
export function UptimeByBoss({
  fights,
  upkeep: allUpkeep,
  reportStartTime,
}: {
  fights: RaidFight[];
  upkeep: RaidUpkeepRow[];
  reportStartTime: string;
}) {
  // Buffs a player puts on other raiders (shouts, totems, Innervate) are read
  // from the receiving end instead — that's the "Uptime by player" section.
  const upkeep = allUpkeep.filter((u) => u.kind !== "buff");
  const [selected, setSelected] = React.useState<string[]>(() => {
    // The armor/physical debuff suite the officers watch first; anything of it
    // present in the report starts selected. Explicitly not "(Feral)".
    const preferred = ["Curse of Recklessness", "Sunder Armor", "Expose Armor", "Hunter's Mark", "Faerie Fire"];
    const defaults = preferred.filter((name) => upkeep.some((u) => u.name === name));
    if (defaults.length > 0) return defaults;
    return upkeep.length > 0 ? [upkeep[0].name] : [];
  });

  if (upkeep.length === 0 || fights.length === 0) return null;

  const tracks = selected
    .map((name) => upkeep.find((u) => u.name === name))
    .filter((u): u is RaidUpkeepRow => u !== undefined);
  const reportStartMs = parseISO(reportStartTime).getTime();
  const unselected = upkeep.filter((u) => !selected.includes(u.name));
  const debuffs = unselected.filter((u) => u.kind === "debuff");
  const buffs = unselected.filter((u) => u.kind !== "debuff");

  return (
    <CollapsibleCard
      title="Uptime by boss"
      description="When each picked debuff/buff was up across the pull — colored bands are time it was active, gaps are time it was down (rebuff lag, target died, or nobody reapplied). ×N is roughly how many casts landed. The taller “raid” lane is the target's own view: bar height is the stack it carried (full height is 5 Sunders), bar colour is whoever held it there. Add a second track to compare, e.g. Sunder Armor vs Expose Armor."
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {tracks.map((u) => (
              <Badge key={u.name} variant="secondary" className="gap-1 font-normal">
                {u.name}
                <button
                  type="button"
                  aria-label={`Remove ${u.name}`}
                  className="cursor-pointer rounded-full text-muted-foreground hover:text-foreground"
                  onClick={() => setSelected((s) => s.filter((n) => n !== u.name))}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            {unselected.length > 0 && (
              <Select value="" onValueChange={(name) => setSelected((s) => [...s, name])}>
                <SelectTrigger className="h-7 w-44 text-xs">
                  <SelectValue placeholder={tracks.length > 0 ? "Compare with…" : "Pick a debuff or buff"} />
                </SelectTrigger>
                <SelectContent>
                  {debuffs.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Debuffs (on enemies)</SelectLabel>
                      {debuffs.map((u) => (
                        <SelectItem key={u.name} value={u.name}>
                          {u.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  {buffs.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Self-buffs</SelectLabel>
                      {buffs.map((u) => (
                        <SelectItem key={u.name} value={u.name}>
                          {u.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
            )}
        </div>
        {tracks.length === 0 ? (
          <p className="py-1 text-sm text-muted-foreground">Pick a debuff or buff above to see its timelines.</p>
        ) : (
          <Tabs defaultValue={String(fights[0].fightId)}>
            <TabsList className="h-auto flex-wrap justify-start">
              {fights.map((f) => (
                <TabsTrigger key={f.fightId} value={String(f.fightId)}>
                  {f.encounterName}
                  {!f.kill && (
                    <span className="text-[10px] text-warn-ink">
                      {f.fightPercentage !== undefined ? `${Math.round(f.fightPercentage)}%` : "wipe"}
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
            {fights.map((fight) => {
              const perTrack = tracks.map((u) => ({
                name: u.name,
                providers: (u.perFight ?? []).find((f) => f.fightId === fight.fightId)?.providers ?? [],
              }));
              const targetGroups = groupByTarget(perTrack);
              const hasTimelines = targetGroups.length > 0;
              const anyProviders = perTrack.some((t) => t.providers.length > 0);
              const showTrack = tracks.length > 1;
              const { ticks } = timeTicks(fight.durationMs);
              return (
                <TabsContent key={fight.fightId} value={String(fight.fightId)} className="space-y-4">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <Badge variant={fight.kill ? "success" : "warning"} className="font-normal">
                      {fight.kill
                        ? "kill"
                        : `wipe${fight.fightPercentage !== undefined ? ` at ${Math.round(fight.fightPercentage)}%` : ""}`}
                    </Badge>
                    {fight.startMs !== undefined && (
                      <span className="tabular-nums">
                        pulled {clockTime(reportStartMs, fight.startMs)} ·{" "}
                        {fight.kill ? "killed" : "wiped"} {clockTime(reportStartMs, fight.startMs + fight.durationMs)}
                      </span>
                    )}
                  </p>

                  {hasTimelines && <TimeAxis durationMs={fight.durationMs} ticks={ticks} />}
                  {hasTimelines &&
                    targetGroups.map((group) => (
                      <div key={group.key} className="space-y-1">
                        <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                          {group.label}
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            {group.boss ? "boss" : "add"}
                          </span>
                        </p>
                        <div className="space-y-1">
                          <RaidLanes
                            lanes={group.lanes}
                            showTrack={showTrack}
                            durationMs={fight.durationMs}
                            ticks={ticks}
                          />
                          {group.lanes.map(({ provider, target, trackName }) => (
                            <SegmentLane
                              key={`${trackName}|${provider.name}|${group.key}`}
                              provider={provider}
                              trackName={trackName}
                              showTrack={showTrack}
                              pct={target.pct}
                              segments={target.segments}
                              applications={target.applications}
                              stackUps={target.stackUps}
                              refreshes={target.refreshes}
                              durationMs={fight.durationMs}
                              ticks={ticks}
                            />
                          ))}
                        </div>
                      </div>
                    ))}

                  {/* Pre-timeline imports: percentages exist but no segments. */}
                  {!hasTimelines && anyProviders && (
                    <div className="space-y-3">
                      {perTrack
                        .filter((t) => t.providers.length > 0)
                        .map((t) => (
                          <div key={t.name} className="space-y-1">
                            {showTrack && <p className="text-sm font-medium">{t.name}</p>}
                            {t.providers.map((p) => (
                              <PctLane
                                key={p.name}
                                label={<Raider name={p.name} slug={p.slug} className={p.className} />}
                                pct={p.pct}
                                color={classColor(p.className)}
                              />
                            ))}
                          </div>
                        ))}
                      <p className="pt-1 text-xs text-muted-foreground/70">
                        Imported before timeline tracking — re-import this report to see when each debuff/buff
                        was up or dropped within the pull, boss and adds separately.
                      </p>
                    </div>
                  )}

                  {/* Selected tracks nobody kept up this pull — the comparison gap. */}
                  {perTrack
                    .filter((t) => t.providers.length === 0)
                    .map((t) => (
                      <p key={t.name} className="text-sm text-muted-foreground/70">
                        Nobody kept {t.name} up this pull.
                      </p>
                    ))}
                </TabsContent>
              );
            })}
          </Tabs>
        )}
      </div>
    </CollapsibleCard>
  );
}
