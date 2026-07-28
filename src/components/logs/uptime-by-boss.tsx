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

/** One provider's up-intervals on one target, as bands over the pull. */
function SegmentLane({
  provider,
  trackName,
  showTrack,
  pct,
  segments,
  applications,
  durationMs,
  ticks,
}: {
  provider: UpkeepFightProvider;
  trackName: string;
  showTrack: boolean;
  pct: number;
  segments: [number, number][];
  applications?: number;
  durationMs: number;
  ticks: number[];
}) {
  return (
    <TimelineLane
      label={
        <>
          <Raider name={provider.name} slug={provider.slug} className={provider.className} />
          {applications !== undefined && applications > 1 && (
            <span
              className="ml-1 text-xs tabular-nums text-muted-foreground"
              title="≈ casts landed (applies + refreshes)"
            >
              ×{applications}
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
      (a, b) => a.trackIdx - b.trackIdx || b.target.pct - a.target.pct || a.provider.name.localeCompare(b.provider.name),
    );
  }
  return list.sort((a, b) => Number(b.boss) - Number(a.boss) || b.bestPct - a.bestPct || a.label.localeCompare(b.label));
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
      description="When each picked debuff/buff was up across the pull — colored bands are time it was active, gaps are time it was down (rebuff lag, target died, or nobody reapplied). ×N is roughly how many casts landed. Add a second track to compare, e.g. Sunder Armor vs Expose Armor."
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
                    <span className="text-[10px] text-amber-600">
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
                        <p className="flex items-center gap-1.5 text-sm font-medium">
                          {group.label}
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            {group.boss ? "boss" : "add"}
                          </span>
                        </p>
                        <div className="space-y-1">
                          {group.lanes.map(({ provider, target, trackName }) => (
                            <SegmentLane
                              key={`${trackName}|${provider.name}|${group.key}`}
                              provider={provider}
                              trackName={trackName}
                              showTrack={showTrack}
                              pct={target.pct}
                              segments={target.segments}
                              applications={target.applications}
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
