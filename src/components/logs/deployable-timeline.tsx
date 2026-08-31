"use client";

import * as React from "react";
import type { RaidFight } from "@/lib/types";
import type { RaidDeployableView } from "@/lib/analysis/deployables";
import { DEPLOYABLES } from "@/lib/wcl/deployables";
import { Raider } from "@/components/logs/rank-bits";
import { CollapsibleCard } from "@/components/logs/collapsible-card";
import { LANE_GRID, mmss, TimeAxis, TimelineLane, timeTicks } from "@/components/logs/timeline-bits";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * What the raid put on the ground, pull by pull.
 *
 * On a fight that wants the kit — Mother Shahraz is the one this was built for
 * — the count is the least interesting half. "Six land mines" says nothing
 * about whether they were down before the first cast or trickled in over two
 * minutes, and that is the difference the officers are actually asking about.
 * So it is a timeline first, with the per-pull tally underneath it.
 */

/**
 * A colour per device, from the validated graph slots — the four items in list
 * order, and the one ability in the cooldown slot, which is what it is
 * (change-chains §9: these values are validated for both themes, not chosen,
 * and a hex in a `style` attribute would break dark mode silently).
 */
const ITEM_SLOTS = [
  "var(--graph-series-1)",
  "var(--graph-series-2)",
  "var(--graph-series-3)",
  "var(--graph-series-4)",
];

const COLOR_BY_LABEL = (() => {
  const map = new Map<string, string>();
  let item = 0;
  for (const d of DEPLOYABLES) {
    map.set(
      d.label,
      d.kind === "ability" ? "var(--graph-cooldown)" : ITEM_SLOTS[item++ % ITEM_SLOTS.length],
    );
  }
  return map;
})();

function deployableColor(name: string): string {
  return COLOR_BY_LABEL.get(name) ?? "var(--muted-foreground)";
}

function Tally({ totals }: { totals: { name: string; count: number }[] }) {
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {totals.map((t) => (
        <span key={t.name} className="inline-flex items-center gap-1 whitespace-nowrap">
          <span
            aria-hidden
            className="h-2 w-2 rotate-45 rounded-[1px]"
            style={{ backgroundColor: deployableColor(t.name) }}
          />
          {t.name}
          <span className="tabular-nums text-muted-foreground">×{t.count}</span>
        </span>
      ))}
    </span>
  );
}

export function DeployableTimeline({
  fights,
  deployables,
}: {
  fights: RaidFight[];
  deployables: RaidDeployableView;
}) {
  const withDrops = fights.filter((f) => deployables.fights.some((d) => d.fightId === f.fightId));

  if (deployables.total === 0) {
    return (
      <CollapsibleCard
        title="Deployables"
        description="Land mines, snake traps, thornlings, dog whistles and flame turrets — what the raid put on the ground, and when."
      >
        <p className="py-1 text-sm text-muted-foreground">
          None recorded for this night. That is <em>not</em> the same as nobody laying one: reports
          imported before these five were tracked contain no events for them at all. Re-import this
          report to fill it in.
        </p>
      </CollapsibleCard>
    );
  }

  return (
    <CollapsibleCard
      title="Deployables"
      description="Land mines, snake traps, thornlings, dog whistles and flame turrets — laid on the pull, in the order they went down. The count is the smaller half of this: what matters on a fight that wants the kit is whether it was down early and how many people laid one."
    >
      <div className="space-y-3">
        <Tally totals={deployables.totals} />

        <Tabs defaultValue={String(withDrops[0].fightId)}>
          <TabsList className="h-auto flex-wrap justify-start">
            {withDrops.map((f) => (
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

          {withDrops.map((fight) => {
            const pull = deployables.fights.find((d) => d.fightId === fight.fightId);
            const { ticks } = timeTicks(fight.durationMs);
            return (
              <TabsContent key={fight.fightId} value={String(fight.fightId)} className="space-y-1">
                <TimeAxis durationMs={fight.durationMs} ticks={ticks} />
                {(pull?.lanes ?? []).map((lane) => (
                  <React.Fragment key={lane.name}>
                    <TimelineLane
                      label={<Raider name={lane.name} slug={lane.slug} className={lane.className} />}
                      bands={[]}
                      markers={lane.drops.map((d) => ({
                        atMs: d.atMs,
                        color: deployableColor(d.name),
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
                            <span style={{ color: deployableColor(d.name) }}>{d.name}</span>
                          </span>
                        ))}
                      </span>
                      <span />
                    </div>
                  </React.Fragment>
                ))}
                <div className="flex flex-wrap items-baseline gap-x-3 pt-1">
                  <span className="text-xs text-muted-foreground">
                    {pull?.total ?? 0} laid by {pull?.raiders ?? 0}{" "}
                    {pull?.raiders === 1 ? "raider" : "raiders"}
                  </span>
                  <Tally totals={pull?.totals ?? []} />
                </div>
                <p className="pt-1 text-xs text-muted-foreground/70">
                  <Badge variant="muted" className="mr-1.5 font-normal">
                    note
                  </Badge>
                  Boss pulls only. One thrown on trash has no pull to sit on and is counted as a
                  consumable in the gold tab instead — and anything laid <em>before</em> the pull
                  started is in no log at all.
                </p>
              </TabsContent>
            );
          })}
        </Tabs>
      </div>
    </CollapsibleCard>
  );
}
