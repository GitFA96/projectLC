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
import { Checkbox } from "@/components/ui/checkbox";
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

/**
 * A press that stopped nothing is drawn muted and hollow, never in the warning
 * role. It is not a mistake the board has established — the log cannot say
 * whether the window was there to hit — and colouring it as one would be this
 * component deciding what invariant 5 keeps out of the analysis.
 */
const UNLANDED_COLOR = "var(--muted-foreground)";

/**
 * The interrupts one raider pressed, as chips — "Earth Shock ×35".
 *
 * With `showUnlanded` the presses that stopped nothing ride along as a second
 * figure — "Pummel ×4 +5" — rather than as a second chip, because they are the
 * same button and splitting them would read as two spells. A chip with no
 * landings at all still shows its ×0: that is the row an officer is looking
 * for, and hiding the zero would leave the press count floating.
 */
function SpellChips({
  spells,
  showUnlanded,
}: {
  spells: InterruptTally["spells"];
  showUnlanded?: boolean;
}) {
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-0.5">
      {spells.map((s) => (
        <span key={s.name} className="whitespace-nowrap text-xs">
          {s.name}
          <span className="tabular-nums text-muted-foreground"> ×{s.count}</span>
          {showUnlanded && (s.unlanded ?? 0) > 0 && (
            <span className="tabular-nums" style={{ color: UNLANDED_COLOR }} title="presses that stopped nothing">
              {" "}
              +{s.unlanded}
            </span>
          )}
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
  showUnlanded,
}: {
  rows: InterruptTally[] | NightTally[];
  showSplit?: boolean;
  /**
   * Draw the presses that stopped nothing. Only ever true for a boss pull or
   * one of its phases — the night and per-instance tables include trash, where
   * presses are not fetched at all, so a column there would be blank in a way
   * that reads as "nobody missed".
   */
  showUnlanded?: boolean;
}) {
  /*
   * The heal column only exists where there are heals.
   *
   * Essence of Desire casts nothing that heals, so on that phase the column was
   * a stripe of em-dashes implying the raid had missed something it was never
   * offered. A column of zeroes is not neutral — it reads as a score.
   */
  const anyHeals = rows.some((r) => r.onHeals > 0);
  /*
   * The press columns appear on a pull whether or not anybody missed there,
   * unlike the heal column above — a pull where every press landed is a real
   * answer and "0" is how it reads, while a blank would look like nothing was
   * measured.
   *
   * What separates that from a report imported before presses were fetched is
   * NOT visible from these rows: both are a table of zeroes. The caller decides
   * it, on the night's total, and passes `showUnlanded` false for the second —
   * so the toggle's own paragraph gets to say which zero it is.
   */
  const anyPresses = showUnlanded && rows.some((r) => r.unlanded !== undefined);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Raider</TableHead>
          {showSplit && <TableHead className="text-right">Pulls</TableHead>}
          {showSplit && <TableHead className="text-right">Trash</TableHead>}
          {anyHeals && <TableHead className="text-right">On heals</TableHead>}
          <TableHead className="text-right">Stopped</TableHead>
          {anyPresses && <TableHead className="text-right">No stop</TableHead>}
          {anyPresses && <TableHead className="text-right">Pressed</TableHead>}
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
            {anyPresses && (
              <TableCell className="text-right tabular-nums" style={{ color: UNLANDED_COLOR }}>
                {r.unlanded ?? "—"}
              </TableCell>
            )}
            {anyPresses && (
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {r.unlanded === undefined ? "—" : r.count + r.unlanded}
              </TableCell>
            )}
            <TableCell>
              <SpellChips spells={r.spells} showUnlanded={anyPresses} />
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
  const [showUnlanded, setShowUnlanded] = React.useState(false);

  /*
   * Which pulls get a tab, and why it moves with the toggle.
   *
   * A boss nobody kicked on is usually a boss with nothing to kick, so a tab
   * reading zero would invent a miss the log never claimed — that rule is why
   * pulls with no interrupt are left out, and it still holds. But counting
   * every curated button means a pull can be here on presses alone, and on this
   * guild's logs most of those are a shaman's Earth Shock rotation: eight pulls
   * of the probed night have no interrupt on them and nothing else but nukes.
   *
   * So they arrive with the toggle that explains them and leave with it. Off,
   * the section is what it always was; on, the presses bring their own pulls.
   */
  const pullOf = (fightId: number) => interrupts.fights.find((i) => i.fightId === fightId);
  const withAnything = fights.filter((f) => pullOf(f.fightId) !== undefined);
  const withInterrupts = showUnlanded
    ? withAnything
    : withAnything.filter((f) => (pullOf(f.fightId)?.total ?? 0) > 0);

  /*
   * Controlled, because the list above changes under the toggle: an
   * uncontrolled `defaultValue` would keep pointing at a pull that has just
   * left the list, and the panel would go blank with every tab still drawn.
   */
  /*
   * Whether this report has presses at all, which is the question the tables
   * cannot answer for themselves: a night where every press landed and a report
   * fetched before presses existed are both a column of zeroes. Only a
   * report-wide total separates them, and only a re-import fixes the second.
   */
  const pressesRecorded = showUnlanded && interrupts.unlanded > 0;

  const [openTab, setOpenTab] = React.useState<string>();
  const tabIds = withInterrupts.map((f) => String(f.fightId));
  const activeTab = openTab !== undefined && tabIds.includes(openTab) ? openTab : tabIds[0];

  if (interrupts.total === 0 && interrupts.unlanded === 0) {
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
            plain count, and so do these totals: presses that stopped nothing are only fetched on
            boss pulls, so they are on the pull tabs and nowhere else. Whether a cast{" "}
            <em>should</em> have been interrupted is an assignment the council makes; this board
            only reports what happened.
          </p>
        </div>
      </BoardSection>

      {withAnything.length > 0 && (
        <BoardSection
          title="On bosses"
          meta={`${plural(withInterrupts.length, "pull", "pulls")}${interrupts.unlanded > 0 ? ` · ${interrupts.unlanded} pressed without a stop` : ""}`}
          description="Only the pulls somebody pressed on. Phased encounters are broken down by phase first — Warcraft Logs' own phase names, which count intermissions, so “P2: Essence of Desire” is the phase the raid calls phase two."
        >
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={showUnlanded}
                  onChange={(e) => setShowUnlanded(e.target.checked)}
                />
                Show presses that stopped nothing
              </label>
              <p className="text-xs text-muted-foreground/70">
                {interrupts.unlanded > 0 ? (
                  <>
                    A press with no cast beside it — the button went out and nothing was cut. The
                    log does not say <em>why</em>, and this board does not guess: a press can miss,
                    or land in a window that had already closed, and Warcraft Logs records the two
                    identically. Kick, Pummel and Counterspell do nothing else, so their presses
                    are all attempts; Earth Shock and Feral Charge are also a nuke and a charge, so
                    most of theirs are not. That is why every count stays split per spell.
                  </>
                ) : (
                  <>
                    Nothing to show on this report. That is <em>not</em> the same as a night where
                    every press landed: a press that stops nothing leaves no interrupt event, so it
                    is read off the cast stream — and reports imported before that was fetched hold
                    none at all. Re-import this report to tell the two apart.
                  </>
                )}
              </p>
            </div>
            {withInterrupts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No pull on this night had an interrupt land. Turn the switch above on for the
                pulls where somebody pressed and nothing stopped.
              </p>
            ) : (
              <Tabs value={activeTab} onValueChange={setOpenTab}>
                <TabsList className="h-auto flex-wrap justify-start">
                  {withInterrupts.map((f) => {
                    const pull = interrupts.fights.find((i) => i.fightId === f.fightId);
                    return (
                      <TabsTrigger key={f.fightId} value={String(f.fightId)}>
                        {f.encounterName}
                        <span className="ml-1 text-[10px] tabular-nums text-muted-foreground">
                          ×{pull?.total ?? 0}
                          {showUnlanded && (pull?.unlanded ?? 0) > 0 && (
                            <span style={{ color: UNLANDED_COLOR }}> +{pull?.unlanded}</span>
                          )}
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
                      <InterrupterTable rows={pull?.interrupters ?? []} showUnlanded={pressesRecorded} />

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
                                  {showUnlanded && (phase.unlanded ?? 0) > 0 && (
                                    <span style={{ color: UNLANDED_COLOR }}>
                                      {" "}
                                      · {phase.unlanded} pressed without a stop
                                    </span>
                                  )}
                                </span>
                              </div>
                              <InterrupterTable rows={phase.interrupters} showUnlanded={pressesRecorded} />
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
                              markers={[
                                ...lane.moments.map((m) => ({
                                  atMs: m.atMs,
                                  color: momentColor(m.healing),
                                  label: `${m.spell} → ${m.target}: ${m.stopped}${m.phase ? ` (${m.phase})` : ""}`,
                                })),
                                /*
                                  Hollow, and only when asked for. Same lane rather
                                  than one of its own: the question is whether a
                                  press sat in the gap between two landings, and two
                                  rows put that a row apart.
                                */
                                ...(showUnlanded
                                  ? lane.unlanded.map((u) => ({
                                      atMs: u.atMs,
                                      color: UNLANDED_COLOR,
                                      hollow: true,
                                      label: `${u.spell}${u.target ? ` → ${u.target}` : ""}: stopped nothing${u.phase ? ` (${u.phase})` : ""}`,
                                    }))
                                  : []),
                              ]}
                              pct={0}
                              durationMs={fight.durationMs}
                              ticks={ticks}
                              trailing={
                                <span className="text-right text-xs tabular-nums text-muted-foreground">
                                  ×{lane.moments.length}
                                  {showUnlanded && lane.unlanded.length > 0 && (
                                    <span style={{ color: UNLANDED_COLOR }}> +{lane.unlanded.length}</span>
                                  )}
                                </span>
                              }
                            />
                            <div className={LANE_GRID}>
                              <span />
                              <span className="flex flex-wrap gap-x-2 gap-y-0.5 pb-1 text-[11px] text-muted-foreground">
                                {/*
                                  Merged into one time-ordered list rather than
                                  appended, because the reading is chronological:
                                  "pressed at 2:41, pressed again at 2:43, stopped
                                  one at 2:45" is the story, and a second list after
                                  the first hides it.
                                */}
                                {[
                                  ...lane.moments.map((m) => ({
                                    atMs: m.atMs,
                                    what: m.stopped,
                                    who: m.target,
                                    color: momentColor(m.healing),
                                  })),
                                  ...(showUnlanded
                                    ? lane.unlanded.map((u) => ({
                                        atMs: u.atMs,
                                        what: `${u.spell} — no stop`,
                                        who: u.target ?? "",
                                        color: UNLANDED_COLOR,
                                      }))
                                    : []),
                                ]
                                  .sort((a, b) => a.atMs - b.atMs)
                                  .map((m, i) => (
                                    <span key={i} className="whitespace-nowrap">
                                      <span className="tabular-nums">{mmss(m.atMs)}</span>{" "}
                                      <span style={{ color: m.color }}>{m.what}</span>{" "}
                                      <span className="text-muted-foreground/70">{m.who}</span>
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

                      {showUnlanded && (pull?.unlanded ?? 0) > 0 && (
                        <p className="text-xs text-muted-foreground/70">
                          <Badge variant="muted" className="mr-1.5 font-normal">
                            reading this
                          </Badge>
                          The hollow pips are presses this pull recorded with no cast cut. They are
                          not counted anywhere above — “stopped” and “on heals” still mean a cast
                          that actually died — and they are not a verdict: a press that stopped
                          nothing may have missed or may have been aimed at a window already closed,
                          and the log records those identically.
                        </p>
                      )}
                    </TabsContent>
                  );
                  })}
              </Tabs>
            )}
          </div>
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
