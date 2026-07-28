"use client";

import * as React from "react";
import type { RaidFight, RaidTotemFight } from "@/lib/types";
import { Raider } from "@/components/logs/rank-bits";
import { CollapsibleCard } from "@/components/logs/collapsible-card";
import { LANE_GRID, mmss, TimeAxis, TimelineLane, timeTicks } from "@/components/logs/timeline-bits";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * A stable color per totem so one lane's drops stay readable — earth, air,
 * fire, water, roughly in that order.
 */
const TOTEM_COLORS = [
  "#c2703d",
  "#7aa2c8",
  "#d4634a",
  "#4fa3a3",
  "#9b7bc4",
  "#7fa74f",
  "#c9a227",
  "#b0577f",
];

function totemColor(index: number): string {
  return TOTEM_COLORS[index % TOTEM_COLORS.length] ?? "var(--primary)";
}

/**
 * When each shaman dropped which totem, pull by pull.
 *
 * TBC's combat log records the drop but never the buff a totem hands out —
 * Strength of Earth, Grace of Air, Wrath of Air and the rest reach nobody's
 * aura list, so there is no honest "who had it" uptime to show. (The one
 * "Windfury Totem" buff the log does carry is the attacker's own proc window,
 * not who was standing in it.) The drops themselves are the record: totem
 * coverage, re-drops after a move, and who forgot one.
 */
export function TotemTimeline({ fights, totems }: { fights: RaidFight[]; totems: RaidTotemFight[] }) {
  const seenFights = fights.filter((f) => totems.some((t) => t.fightId === f.fightId));
  if (seenFights.length === 0) return null;

  // One color per totem across the whole section, most-dropped first.
  const dropCounts = new Map<string, number>();
  for (const fight of totems) {
    for (const lane of fight.lanes) {
      for (const d of lane.drops) dropCounts.set(d.name, (dropCounts.get(d.name) ?? 0) + 1);
    }
  }
  const order = [...dropCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n]) => n);
  const colorOf = (name: string) => totemColor(order.indexOf(name));

  return (
    <CollapsibleCard
      title="Totem drops"
      description="When each shaman put down which totem, pull by pull. TBC never logs the buff a totem gives out — not even to the players standing in it — so the drop is the record: what was down, when it was re-dropped, and what nobody brought."
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {order.map((name) => (
            <span key={name} className="inline-flex items-center gap-1 whitespace-nowrap">
              <span
                aria-hidden
                className="h-2 w-2 rotate-45 rounded-[1px]"
                style={{ backgroundColor: colorOf(name) }}
              />
              {name}
              <span className="tabular-nums text-muted-foreground">×{dropCounts.get(name)}</span>
            </span>
          ))}
        </div>

        <Tabs defaultValue={String(seenFights[0].fightId)}>
          <TabsList className="h-auto flex-wrap justify-start">
            {seenFights.map((f) => (
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

          {seenFights.map((fight) => {
            const lanes = totems.find((t) => t.fightId === fight.fightId)?.lanes ?? [];
            const { ticks } = timeTicks(fight.durationMs);
            return (
              <TabsContent key={fight.fightId} value={String(fight.fightId)} className="space-y-1">
                <TimeAxis durationMs={fight.durationMs} ticks={ticks} />
                {lanes.map((lane) => (
                  <React.Fragment key={lane.name}>
                    <TimelineLane
                      label={<Raider name={lane.name} slug={lane.slug} className={lane.className} />}
                      bands={[]}
                      markers={lane.drops.map((d) => ({
                        atMs: d.atMs,
                        color: colorOf(d.name),
                        label: d.name,
                      }))}
                      pct={0}
                      durationMs={fight.durationMs}
                      ticks={ticks}
                      trailing={
                        <span className="text-right text-xs tabular-nums text-muted-foreground">
                          ×{lane.drops.length}
                        </span>
                      }
                    />
                    <div className={LANE_GRID}>
                      <span />
                      <span className="flex flex-wrap gap-x-2 gap-y-0.5 pb-1 text-[11px] text-muted-foreground">
                        {lane.drops.map((d, i) => (
                          <span key={i} className="whitespace-nowrap">
                            <span className="tabular-nums">{mmss(d.atMs)}</span>{" "}
                            <span style={{ color: colorOf(d.name) }}>{d.name}</span>
                          </span>
                        ))}
                      </span>
                      <span />
                    </div>
                  </React.Fragment>
                ))}
                {lanes.length === 0 && (
                  <p className="text-sm text-muted-foreground/70">No totems dropped this pull.</p>
                )}
                <p className="pt-1 text-xs text-muted-foreground/70">
                  <Badge variant="muted" className="mr-1.5 font-normal">
                    note
                  </Badge>
                  Only drops inside the pull are logged — a totem put down before the pull started
                  is invisible here even though the raid had it.
                </p>
              </TabsContent>
            );
          })}
        </Tabs>
      </div>
    </CollapsibleCard>
  );
}
