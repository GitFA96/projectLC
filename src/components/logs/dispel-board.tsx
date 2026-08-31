"use client";

import * as React from "react";
import type { RaidFight } from "@/lib/types";
import type { DispelKind } from "@/lib/wcl/dispels";
import type { DispelTally, RaidDispelView } from "@/lib/analysis/dispels";
import { Raider } from "@/components/logs/rank-bits";
import { CollapsibleCard } from "@/components/logs/collapsible-card";
import { LANE_GRID, mmss, TimeAxis, TimelineLane, timeTicks } from "@/components/logs/timeline-bits";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Who took what off whom.
 *
 * Two shapes because there are two questions. On a boss pull the answer is a
 * timeline — ten decurses on Archimonde says nothing, while the same ten with
 * names and timestamps say which mage was covering and whether anybody sat
 * under Grip of the Legion for twenty seconds. On trash it is a count per
 * instance, because a night is a hundred-odd segments and a night that clears
 * Hyjal and Black Temple is two different jobs.
 *
 * Nothing here is ranked or scored. What a raid *should* dispel is an
 * assignment the council makes, not a fact in a log.
 */

/**
 * A school's colour. Themed roles, never hex: a `style` attribute is out of
 * reach of a `dark:` variant, so a literal here would break one theme silently
 * (change-chains §9).
 */
const KIND_COLOR: Record<DispelKind, string> = {
  magic: "var(--graph-series-1)",
  curse: "var(--graph-series-3)",
  poison: "var(--graph-series-4)",
  disease: "var(--graph-series-4)",
  offensive: "var(--graph-series-2)",
};

function momentColor(kind: DispelKind | undefined, offensive: boolean): string {
  if (offensive) return KIND_COLOR.offensive;
  return kind ? KIND_COLOR[kind] : "var(--muted-foreground)";
}

/** The spells one raider pressed, as chips — "Remove Curse ×35". */
function SpellChips({ spells }: { spells: DispelTally["spells"] }) {
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-0.5">
      {spells.map((s) => (
        // Keyed on `id`, never `name`: Mass Dispel appears twice under one
        // name when a priest both cleansed and stripped with it.
        <span key={s.id} className="whitespace-nowrap text-xs">
          <span
            aria-hidden
            className="mr-1 inline-block h-2 w-2 rotate-45 rounded-[1px] align-middle"
            style={{ backgroundColor: momentColor(s.kind, s.offensive === true) }}
          />
          {s.name}
          {s.offensive && <span className="text-muted-foreground"> (enemy)</span>}
          <span className="tabular-nums text-muted-foreground"> ×{s.count}</span>
        </span>
      ))}
    </span>
  );
}

/** "Banshee Curse ×79, Flame Buffet ×34" — what actually came off. */
function RemovedChips({ removed, cap = 12 }: { removed: { name: string; count: number }[]; cap?: number }) {
  const shown = removed.slice(0, cap);
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
      {shown.map((r) => (
        <span key={r.name} className="whitespace-nowrap">
          {r.name} <span className="tabular-nums">×{r.count}</span>
        </span>
      ))}
      {removed.length > cap && <span>+{removed.length - cap} more</span>}
    </span>
  );
}

/** A tally with the night's split, which the per-zone tables don't carry. */
type NightTally = DispelTally & { onPulls: number; onTrash: number };

function DispellerTable({
  rows,
  showSplit,
}: {
  rows: DispelTally[] | NightTally[];
  showSplit?: boolean;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Raider</TableHead>
          <TableHead className="text-right">Cleansed</TableHead>
          <TableHead className="text-right">Stripped</TableHead>
          {showSplit && <TableHead className="text-right">Pulls</TableHead>}
          {showSplit && <TableHead className="text-right">Trash</TableHead>}
          <TableHead className="text-right">Total</TableHead>
          <TableHead>Spells</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.name}>
            <TableCell>
              <Raider name={r.name} slug={r.slug} className={r.className} />
            </TableCell>
            <TableCell className="text-right tabular-nums">{r.cleanses || "—"}</TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {r.strips || "—"}
            </TableCell>
            {showSplit && (
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {(r as NightTally).onPulls || "—"}
              </TableCell>
            )}
            {showSplit && (
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {(r as NightTally).onTrash || "—"}
              </TableCell>
            )}
            <TableCell className="text-right font-medium tabular-nums">{r.count}</TableCell>
            <TableCell>
              <SpellChips spells={r.spells} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function DispelBoard({ fights, dispels }: { fights: RaidFight[]; dispels: RaidDispelView }) {
  const withDispels = fights.filter((f) => dispels.fights.some((d) => d.fightId === f.fightId));

  if (dispels.total === 0) {
    return (
      <CollapsibleCard
        title="Dispels & cleansing"
        description="Who took what off whom — decurses, cleanses, poison removal, and buffs stripped off the enemy."
      >
        <p className="py-1 text-sm text-muted-foreground">
          No dispels recorded for this night. That is <em>not</em> the same as nobody dispelling:
          reports imported before dispel tracking existed carry none at all. Re-import this report
          to fill it in.
        </p>
      </CollapsibleCard>
    );
  }

  return (
    <>
      <CollapsibleCard
        title="Dispels & cleansing"
        description="Who took what off whom, across the whole night — boss pulls and trash together. Cleansed is what came off our own raiders; stripped is a buff pulled off an enemy (Purge, Spellsteal, Tranquilizing Shot), which is a different job under the same event."
      >
        <div className="space-y-3">
          <DispellerTable rows={dispels.night} showSplit />
          {dispels.uncurated.length > 0 && (
            <p className="text-xs text-muted-foreground/70">
              <Badge variant="muted" className="mr-1.5 font-normal">
                uncurated
              </Badge>
              Counted but unnamed, so no class or school is shown against them:{" "}
              {dispels.uncurated.map((u) => `${u.name} ×${u.count}`).join(", ")}. Curating them in{" "}
              <code>src/lib/wcl/dispels.ts</code> fixes this night too — dispels are classified when
              the page is drawn, not when the report was imported.
            </p>
          )}
          <p className="text-xs text-muted-foreground/70">
            <Badge variant="muted" className="mr-1.5 font-normal">
              note
            </Badge>
            A spell that can remove more than one school shows none — the event names the aura
            that came off and never which school the press caught, so a paladin&apos;s Cleanse is
            not split into magic and poison here. And a shaman&apos;s Poison Cleansing Totem never
            appears at all. The log records the drop and
            The log records the drop and not one of the cleanses it hands out, so a shaman&apos;s
            poison work reads as the totem timeline above plus whatever they cured by hand.
          </p>
        </div>
      </CollapsibleCard>

      {dispels.zones.length > 0 && (
        <CollapsibleCard
          title="Dispels on trash"
          description="Trash is where most of a decurser's night goes, and it belongs to no pull — so it is counted per instance instead of timed. Excluding a boss pull does not remove it: the hour of clearing before a farm wipe still happened."
        >
          <div className="space-y-5">
            {dispels.zones.map((zone) => (
              <div key={zone.zone} className="space-y-2">
                <div className="flex items-baseline gap-2">
                  <h4 className="font-medium">{zone.zone}</h4>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {zone.total} dispels
                  </span>
                </div>
                <DispellerTable rows={zone.dispellers} />
                <div className="pt-0.5">
                  <span className="mr-2 text-[11px] font-medium text-muted-foreground">
                    Came off:
                  </span>
                  <RemovedChips removed={zone.removed} />
                </div>
              </div>
            ))}
          </div>
        </CollapsibleCard>
      )}

      {withDispels.length > 0 && (
        <CollapsibleCard
          title="Dispels, pull by pull"
          description="Every dispel inside a boss pull, on the caster's own lane — who they took it off and when. A gap is time somebody spent under whatever landed on them."
        >
          <Tabs defaultValue={String(withDispels[0].fightId)}>
            <TabsList className="h-auto flex-wrap justify-start">
              {withDispels.map((f) => (
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

            {withDispels.map((fight) => {
              const pull = dispels.fights.find((d) => d.fightId === fight.fightId);
              const { ticks } = timeTicks(fight.durationMs);
              return (
                <TabsContent key={fight.fightId} value={String(fight.fightId)} className="space-y-1">
                  <TimeAxis durationMs={fight.durationMs} ticks={ticks} />
                  {(pull?.lanes ?? []).map((lane) => (
                    <React.Fragment key={lane.name}>
                      <TimelineLane
                        label={<Raider name={lane.name} slug={lane.slug} className={lane.className} />}
                        bands={[]}
                        markers={lane.moments.map((m) => ({
                          atMs: m.atMs,
                          color: momentColor(m.kind, m.offensive),
                          label: `${m.spell} → ${m.target}: ${m.removed}`,
                        }))}
                        pct={0}
                        durationMs={fight.durationMs}
                        ticks={ticks}
                        trailing={
                          <span className="text-right text-xs tabular-nums text-muted-foreground">
                            ×{lane.moments.length}
                          </span>
                        }
                      />
                      <div className={LANE_GRID}>
                        <span />
                        <span className="flex flex-wrap gap-x-2 gap-y-0.5 pb-1 text-[11px] text-muted-foreground">
                          {lane.moments.map((m, i) => (
                            <span key={i} className="whitespace-nowrap">
                              <span className="tabular-nums">{mmss(m.atMs)}</span>{" "}
                              <span style={{ color: momentColor(m.kind, m.offensive) }}>
                                {m.target}
                              </span>{" "}
                              <span className="text-muted-foreground/70">{m.removed}</span>
                            </span>
                          ))}
                        </span>
                        <span />
                      </div>
                    </React.Fragment>
                  ))}
                  <div className="pt-1">
                    <span className="mr-2 text-[11px] font-medium text-muted-foreground">
                      Came off:
                    </span>
                    <RemovedChips removed={pull?.removed ?? []} />
                  </div>
                </TabsContent>
              );
            })}
          </Tabs>
        </CollapsibleCard>
      )}
    </>
  );
}
