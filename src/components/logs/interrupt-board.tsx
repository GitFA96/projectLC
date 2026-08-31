"use client";

import * as React from "react";
import type { RaidFight } from "@/lib/types";
import type {
  EnemyCastRow,
  InterruptCount,
  InterruptTally,
  RaidInterruptView,
} from "@/lib/analysis/interrupts";
import { Raider } from "@/components/logs/rank-bits";
import { BoardSection, plural } from "@/components/logs/board-section";
import { LANE_GRID, mmss, TimeAxis, TimelineLane, timeTicks } from "@/components/logs/timeline-bits";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Who stopped which cast.
 *
 * Three shapes for three questions. Across the night it is a table of who was
 * actually on kick duty. On a boss it is a phase split plus a timeline, because
 * "nineteen interrupts on Reliquary of Souls" and "every Spirit Shock and
 * Deaden in Essence of Desire stopped" are the same nineteen events and only
 * one of them is an answer. On trash it is a count per instance, because a
 * night is a hundred-odd segments and a night that runs Hyjal and Black Temple
 * is two different jobs.
 *
 * Nothing here is ranked or scored. A heal is *labelled* so an officer can find
 * it; whether it should have been kicked is an assignment the council makes,
 * not a fact in a log.
 */

/**
 * Themed roles, never hex: a `style` attribute is out of reach of a `dark:`
 * variant, so a literal here would break one theme in silence (§9).
 */
const HEAL_COLOR = "var(--graph-series-2)";
const CAST_COLOR = "var(--graph-series-1)";

const momentColor = (healing: boolean) => (healing ? HEAL_COLOR : CAST_COLOR);

/** The interrupts one raider pressed, as chips — "Earth Shock ×35". */
function SpellChips({ spells }: { spells: InterruptTally["spells"] }) {
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-0.5">
      {spells.map((s) => (
        <span key={s.name} className="whitespace-nowrap text-xs">
          {s.name}
          <span className="tabular-nums text-muted-foreground"> ×{s.count}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * "Shadow Bolt ×93, Circle of Healing ×7" — what actually died mid-cast.
 *
 * A heal is marked rather than sorted to the front: the list is ordered by how
 * often a cast was stopped, and re-ordering it by importance would be this
 * component deciding what matters.
 */
function StoppedChips({ stopped, cap = 12 }: { stopped: InterruptCount[]; cap?: number }) {
  const shown = stopped.slice(0, cap);
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
      {shown.map((s) => (
        <span key={s.name} className="whitespace-nowrap">
          {s.healing && (
            <span
              aria-hidden
              className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
              style={{ backgroundColor: HEAL_COLOR }}
            />
          )}
          <span style={s.healing ? { color: HEAL_COLOR } : undefined}>{s.name}</span>{" "}
          <span className="tabular-nums">×{s.count}</span>
        </span>
      ))}
      {stopped.length > cap && <span>+{stopped.length - cap} more</span>}
    </span>
  );
}

/**
 * What the enemy tried on a pull, and what got through.
 *
 * The point of the table is the **landed** column, so it leads the sort. The
 * "interruptible" mark is what keeps that column honest: an ability this report
 * never shows being interrupted might simply not be interruptible, and marking
 * every one of Archimonde's casts as a miss would bury the two that matter.
 */
function EnemyCastTable({ casts }: { casts: EnemyCastRow[] }) {
  const anyUnresolved = casts.some((c) => c.unresolved > 0);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Caster</TableHead>
          <TableHead>Ability</TableHead>
          <TableHead className="text-right">Started</TableHead>
          <TableHead className="text-right">Got through</TableHead>
          <TableHead className="text-right">We stopped</TableHead>
          {anyUnresolved && <TableHead className="text-right">Unresolved</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {casts.map((c) => (
          <TableRow key={`${c.caster}|${c.ability}`}>
            <TableCell className="text-muted-foreground">{c.caster}</TableCell>
            <TableCell>
              {c.healing && (
                <span
                  aria-hidden
                  className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
                  style={{ backgroundColor: HEAL_COLOR }}
                />
              )}
              <span style={c.healing ? { color: HEAL_COLOR } : undefined}>{c.ability}</span>
              {!c.interruptible && (
                <Badge variant="muted" className="ml-2 font-normal">
                  never interrupted
                </Badge>
              )}
            </TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {c.started}
            </TableCell>
            {/*
              Emphasised only when we know it could have been stopped. On an
              ability nobody has ever interrupted this is just what the boss
              does, and colouring it would read as an accusation.
            */}
            <TableCell
              className={
                c.interruptible && c.landed > 0
                  ? "text-right font-medium tabular-nums text-warn-ink"
                  : "text-right tabular-nums"
              }
            >
              {c.landed}
            </TableCell>
            <TableCell className="text-right tabular-nums">{c.stopped || "—"}</TableCell>
            {anyUnresolved && (
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {c.unresolved || "—"}
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** A tally with the night's split, which the per-zone tables don't carry. */
type NightTally = InterruptTally & { onPulls: number; onTrash: number };

function InterrupterTable({
  rows,
  showSplit,
}: {
  rows: InterruptTally[] | NightTally[];
  showSplit?: boolean;
}) {
  /*
   * The heal column only exists where there are heals.
   *
   * Essence of Desire casts nothing that heals, so on that phase the column was
   * a stripe of em-dashes implying the raid had missed something it was never
   * offered. A column of zeroes is not neutral — it reads as a score.
   */
  const anyHeals = rows.some((r) => r.onHeals > 0);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Raider</TableHead>
          {showSplit && <TableHead className="text-right">Pulls</TableHead>}
          {showSplit && <TableHead className="text-right">Trash</TableHead>}
          {anyHeals && <TableHead className="text-right">On heals</TableHead>}
          <TableHead className="text-right">Total</TableHead>
          <TableHead>Interrupts</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.name}>
            <TableCell>
              <Raider name={r.name} slug={r.slug} className={r.className} />
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
            {anyHeals && (
              <TableCell
                className="text-right tabular-nums"
                style={r.onHeals > 0 ? { color: HEAL_COLOR } : undefined}
              >
                {r.onHeals || "—"}
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

/**
 * The interrupt half of the counterplay card — sections, not cards.
 *
 * Wrapped by `DispelInterruptBoard`, which supplies the one card and the tab
 * this lives in. It keeps its own empty state rather than letting the wrapper
 * decide: a report imported after dispels but before interrupts has real
 * dispels and no interrupts at all, and one shared "nothing recorded" message
 * would be wrong about both halves at once.
 */
export function InterruptSections({
  fights,
  interrupts,
}: {
  fights: RaidFight[];
  interrupts: RaidInterruptView;
}) {
  // Only pulls that actually had an interrupt get a tab. A boss nobody kicked
  // on is usually a boss with nothing to kick, so a tab reading zero would
  // invent a miss the log never claimed.
  const withInterrupts = fights.filter((f) =>
    interrupts.fights.some((i) => i.fightId === f.fightId),
  );

  if (interrupts.total === 0) {
    return (
      <p className="py-1 text-sm text-muted-foreground">
        No interrupts recorded for this night. That is <em>not</em> the same as nobody
        interrupting: reports imported before interrupt tracking existed carry none at all.
        Re-import this report to fill it in.
      </p>
    );
  }

  const trashTotal = interrupts.zones.reduce((sum, z) => sum + z.total, 0);

  return (
    <div className="space-y-3">
      <BoardSection
        title="Across the night"
        meta={`${plural(interrupts.night.length, "raider", "raiders")} · ${plural(interrupts.total, "interrupt", "interrupts")}`}
        defaultOpen
        description="Who stopped which cast, boss pulls and trash together. “On heals” counts the interrupts that landed on a healing cast."
      >
        <div className="space-y-3">
          <InterrupterTable rows={interrupts.night} showSplit />
          {interrupts.uncurated.length > 0 && (
            <p className="text-xs text-muted-foreground/70">
              <Badge variant="muted" className="mr-1.5 font-normal">
                uncurated
              </Badge>
              Counted but unnamed, so no class is shown against them:{" "}
              {interrupts.uncurated.map((u) => `${u.name} ×${u.count}`).join(", ")}. Curating them
              in <code>src/lib/wcl/interrupts.ts</code> fixes this night too — interrupts are
              classified when the page is drawn, not when the report was imported.
            </p>
          )}
          <p className="text-xs text-muted-foreground/70">
            <Badge variant="muted" className="mr-1.5 font-normal">
              note
            </Badge>
            These are presses that <em>landed</em>. What the enemy <em>tried</em> is on each
            boss tab below, from its own cast stream — fetched whole for the pull rather than
            narrowed to the casts we happened to interrupt, which would have scored a clean sheet
            for exactly the caster nobody ever kicked. Trash has no such denominator and stays a
            plain count. Whether a cast <em>should</em> have been interrupted is an assignment the
            council makes; this board only reports what happened.
          </p>
        </div>
      </BoardSection>

      {withInterrupts.length > 0 && (
        <BoardSection
          title="On bosses"
          meta={plural(withInterrupts.length, "pull", "pulls")}
          description="Only the pulls that had one. Phased encounters are broken down by phase first — Warcraft Logs' own phase names, which count intermissions, so “P2: Essence of Desire” is the phase the raid calls phase two."
        >
          <Tabs defaultValue={String(withInterrupts[0].fightId)}>
            <TabsList className="h-auto flex-wrap justify-start">
              {withInterrupts.map((f) => {
                const pull = interrupts.fights.find((i) => i.fightId === f.fightId);
                return (
                  <TabsTrigger key={f.fightId} value={String(f.fightId)}>
                    {f.encounterName}
                    <span className="ml-1 text-[10px] tabular-nums text-muted-foreground">
                      ×{pull?.total ?? 0}
                    </span>
                    {!f.kill && (
                      <span className="text-[10px] text-warn-ink">
                        {f.fightPercentage !== undefined
                          ? `${Math.round(f.fightPercentage)}%`
                          : "wipe"}
                      </span>
                    )}
                  </TabsTrigger>
                );
              })}
            </TabsList>

            {withInterrupts.map((fight) => {
              const pull = interrupts.fights.find((i) => i.fightId === fight.fightId);
              const { ticks } = timeTicks(fight.durationMs);
              return (
                <TabsContent key={fight.fightId} value={String(fight.fightId)} className="space-y-4">
                  {/*
                    The pull's own table first. A phased encounter repeats it
                    per phase below; an unphased one — the Illidari Council, four
                    casters and no WCL phases — would otherwise have no table at
                    all and only a timeline.
                  */}
                  <InterrupterTable rows={pull?.interrupters ?? []} />

                  {(pull?.casts.length ?? 0) > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-baseline gap-2">
                        <h4 className="font-medium">What the enemy got through</h4>
                        <span className="text-xs text-muted-foreground">
                          cast bars only — an instant had nothing to interrupt
                        </span>
                      </div>
                      <EnemyCastTable casts={pull?.casts ?? []} />
                      <p className="text-xs text-muted-foreground/70">
                        <Badge variant="muted" className="mr-1.5 font-normal">
                          reading this
                        </Badge>
                        Started = got through + we stopped + unresolved, and the third is real:
                        a cast the mob died in the middle of, or one it cancelled. An ability
                        marked <em>never interrupted</em> was not interrupted anywhere in this
                        report, which may mean it cannot be — most of what a boss casts cannot —
                        so its “got through” is not counted against anybody.
                      </p>
                    </div>
                  )}

                  {(pull?.phases.length ?? 0) > 0 && (
                    <div className="space-y-3">
                      {pull?.phases.map((phase) => (
                        <div key={phase.name} className="space-y-1.5">
                          <div className="flex items-baseline gap-2">
                            <h4 className="font-medium">{phase.name}</h4>
                            <span className="text-xs tabular-nums text-muted-foreground">
                              {phase.total} interrupts
                            </span>
                          </div>
                          <InterrupterTable rows={phase.interrupters} />
                          <div className="pt-0.5">
                            <span className="mr-2 text-[11px] font-medium text-muted-foreground">
                              Stopped:
                            </span>
                            <StoppedChips stopped={phase.stopped} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="space-y-1">
                    <TimeAxis durationMs={fight.durationMs} ticks={ticks} />
                    {(pull?.lanes ?? []).map((lane) => (
                      <React.Fragment key={lane.name}>
                        <TimelineLane
                          label={
                            <Raider name={lane.name} slug={lane.slug} className={lane.className} />
                          }
                          bands={[]}
                          markers={lane.moments.map((m) => ({
                            atMs: m.atMs,
                            color: momentColor(m.healing),
                            label: `${m.spell} → ${m.target}: ${m.stopped}${m.phase ? ` (${m.phase})` : ""}`,
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
                                <span style={{ color: momentColor(m.healing) }}>{m.stopped}</span>{" "}
                                <span className="text-muted-foreground/70">{m.target}</span>
                              </span>
                            ))}
                          </span>
                          <span />
                        </div>
                      </React.Fragment>
                    ))}
                  </div>

                  <div className="pt-1">
                    <span className="mr-2 text-[11px] font-medium text-muted-foreground">
                      Stopped on this pull:
                    </span>
                    <StoppedChips stopped={pull?.stopped ?? []} />
                  </div>
                </TabsContent>
              );
            })}
          </Tabs>
        </BoardSection>
      )}

      {interrupts.zones.length > 0 && (
        <BoardSection
          title="On trash"
          meta={`${plural(interrupts.zones.length, "instance", "instances")} · ${plural(trashTotal, "interrupt", "interrupts")}`}
          description="Trash is where most of this raid's kicking happens, and it belongs to no pull — so it is counted per instance instead of timed. Excluding a boss pull does not remove it: the hour of clearing before a farm wipe still happened."
        >
          <div className="space-y-5">
            {interrupts.zones.map((zone) => (
              <div key={zone.zone} className="space-y-2">
                <div className="flex items-baseline gap-2">
                  <h4 className="font-medium">{zone.zone}</h4>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {zone.total} interrupts
                  </span>
                </div>
                <InterrupterTable rows={zone.interrupters} />
                <div className="pt-0.5">
                  <span className="mr-2 text-[11px] font-medium text-muted-foreground">
                    Stopped:
                  </span>
                  <StoppedChips stopped={zone.stopped} />
                </div>
              </div>
            ))}
          </div>
        </BoardSection>
      )}
    </div>
  );
}
