"use client";

import * as React from "react";
import { parseISO } from "date-fns";
import type { RaidFight, RaidPlayerBuffRow } from "@/lib/types";
import { classColor, Raider } from "@/components/logs/rank-bits";
import { CollapsibleCard } from "@/components/logs/collapsible-card";
import { clockTime, mmss, PctLane, TimeAxis, TimelineLane, timeTicks } from "@/components/logs/timeline-bits";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** The buffs officers check first when the section opens, in order. */
const PREFERRED = ["Battle Shout", "Commanding Shout", "Innervate"];

const NIGHT_TAB = "night";

/**
 * Raid buffs read from the receiving end: which raiders actually had Battle
 * Shout or an Innervate up, for how much of each pull, and who put it on them.
 * The mirror image of "Uptime by boss" — that one asks who kept a debuff on
 * the target, this one asks who was covered.
 *
 * Bands are colored by the provider, so a player covered by two casters shows
 * both, and overlap counts once toward the coverage percentage. Diamonds mark
 * the cast itself, which is what separates "Innervate ×3" from knowing it went
 * out at 0:16, 1:40 and 3:05.
 */
export function UptimeByPlayer({
  fights,
  playerBuffs,
  reportStartTime,
}: {
  fights: RaidFight[];
  playerBuffs: RaidPlayerBuffRow[];
  reportStartTime: string;
}) {
  const [selectedName, setSelectedName] = React.useState<string>(
    () => PREFERRED.find((n) => playerBuffs.some((b) => b.name === n)) ?? playerBuffs[0]?.name ?? "",
  );

  if (playerBuffs.length === 0 || fights.length === 0) return null;

  const buff = playerBuffs.find((b) => b.name === selectedName) ?? playerBuffs[0];
  const reportStartMs = parseISO(reportStartTime).getTime();
  // Pulls the buff was seen in, in pull order — plus the night summary tab.
  const seenFights = fights.filter((f) => buff.perFight.some((p) => p.fightId === f.fightId));

  return (
    <CollapsibleCard
      title="Uptime by player"
      description="Who actually had a raid buff up, pull by pull — shouts, Innervate, Earth Shield. Bands are colored by whoever provided it, diamonds mark the moment it was cast, and gaps are time the raider went without it."
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={buff.name} onValueChange={setSelectedName}>
            <SelectTrigger className="h-7 w-56 text-xs">
              <SelectValue placeholder="Pick a raid buff" />
            </SelectTrigger>
            <SelectContent>
              {playerBuffs.map((b) => (
                <SelectItem key={b.name} value={b.name}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            {buff.recipients.length} raider{buff.recipients.length === 1 ? "" : "s"} covered ·{" "}
            {buff.providers.length > 0 ? "from " : "no provider matched"}
            {buff.providers.map((p, i) => (
              <span key={p.name}>
                {i > 0 && ", "}
                <Raider name={p.name} slug={p.slug} className={p.className} />
                {p.applications > 0 && <span className="ml-0.5 tabular-nums">×{p.applications}</span>}
              </span>
            ))}
          </span>
        </div>

        <Tabs defaultValue={NIGHT_TAB} key={buff.name}>
          <TabsList className="h-auto flex-wrap justify-start">
            <TabsTrigger value={NIGHT_TAB}>Night average</TabsTrigger>
            {seenFights.map((f) => (
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

          <TabsContent value={NIGHT_TAB} className="space-y-1">
            <p className="pb-1 text-xs text-muted-foreground">
              Coverage averaged over the pulls each raider was in — a pull they raided without the
              buff counts as a zero.
            </p>
            {buff.recipients.map((r) => (
              <PctLane
                key={r.name}
                label={<Raider name={r.name} slug={r.slug} className={r.className} />}
                pct={r.pct}
                color={classColor(r.className)}
              />
            ))}
          </TabsContent>

          {seenFights.map((fight) => {
            const recipients = buff.perFight.find((p) => p.fightId === fight.fightId)?.recipients ?? [];
            const { ticks } = timeTicks(fight.durationMs);
            return (
              <TabsContent key={fight.fightId} value={String(fight.fightId)} className="space-y-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 pb-1 text-xs text-muted-foreground">
                  <Badge variant={fight.kill ? "success" : "warning"} className="font-normal">
                    {fight.kill
                      ? "kill"
                      : `wipe${fight.fightPercentage !== undefined ? ` at ${Math.round(fight.fightPercentage)}%` : ""}`}
                  </Badge>
                  {fight.startMs !== undefined && (
                    <span className="tabular-nums">
                      pulled {clockTime(reportStartMs, fight.startMs)} · {fight.kill ? "killed" : "wiped"}{" "}
                      {clockTime(reportStartMs, fight.startMs + fight.durationMs)}
                    </span>
                  )}
                  <span>
                    {recipients.length} raider{recipients.length === 1 ? "" : "s"} had it
                  </span>
                </p>
                <TimeAxis durationMs={fight.durationMs} ticks={ticks} />
                {recipients.map((r) => (
                  <TimelineLane
                    key={r.name}
                    label={
                      <>
                        <Raider name={r.name} slug={r.slug} className={r.className} />
                        {r.sources.length > 1 && (
                          <span
                            className="ml-1 text-[10px] text-muted-foreground"
                            title={r.sources.map((s) => `${s.name} ${s.pct}%`).join(", ")}
                          >
                            {r.sources.length} providers
                          </span>
                        )}
                      </>
                    }
                    bands={r.sources.map((s) => ({
                      segments: s.segments,
                      color: classColor(s.className) ?? "var(--primary)",
                      label: s.name,
                    }))}
                    // The press itself, next to the window it bought.
                    markers={r.sources.flatMap((s) =>
                      (s.casts ?? []).map((atMs) => ({ atMs, label: `${s.name} → ${r.name}` })),
                    )}
                    pct={r.pct}
                    durationMs={fight.durationMs}
                    ticks={ticks}
                  />
                ))}
                {recipients.length === 0 && (
                  <p className="text-sm text-muted-foreground/70">Nobody had {buff.name} up this pull.</p>
                )}
                {(() => {
                  // Every press in this pull, in order — the diamonds spelled out.
                  const casts = recipients
                    .flatMap((r) => r.sources.flatMap((s) => (s.casts ?? []).map((atMs) => ({ atMs, from: s, to: r }))))
                    .sort((a, b) => a.atMs - b.atMs);
                  if (casts.length === 0) return null;
                  return (
                    <p className="flex flex-wrap gap-x-3 gap-y-1 pt-1 text-xs text-muted-foreground">
                      <span className="font-medium">Cast at</span>
                      {casts.map((c, i) => (
                        <span key={i} className="whitespace-nowrap">
                          <span className="tabular-nums">{mmss(c.atMs)}</span>{" "}
                          <Raider name={c.from.name} slug={c.from.slug} className={c.from.className} /> →{" "}
                          <Raider name={c.to.name} slug={c.to.slug} className={c.to.className} />
                        </span>
                      ))}
                    </p>
                  );
                })()}
              </TabsContent>
            );
          })}
        </Tabs>
      </div>
    </CollapsibleCard>
  );
}
