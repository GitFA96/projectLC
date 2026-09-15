"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";
import type { RaidFight } from "@/lib/types";
import type { RaidPairingView } from "@/lib/analysis/pairings";
import type {
  DeployableAbstainer,
  DeployableCount,
  RaidDeployableView,
} from "@/lib/analysis/deployables";
import { DEPLOYABLES, deployableLabelsFor } from "@/lib/wcl/deployables";
import { PAIRING_DEBUFFS } from "@/lib/wcl/pairings";
import { PairingSections } from "@/components/logs/pairing-board";
import { Raider } from "@/components/logs/rank-bits";
import { CollapsibleCard } from "@/components/logs/collapsible-card";
import { LANE_GRID, mmss, TimeAxis, TimelineLane, timeTicks } from "@/components/logs/timeline-bits";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/**
 * The Mother Shahraz card: what the raid put on the ground, and who she linked
 * together. `DeployableTimeline` is the wrapper; each tab's body is below it.
 *
 * On a fight that wants the kit — Mother Shahraz is the one this was built for
 * — the count is the least interesting half. "Six land mines" says nothing
 * about whether they were down before the first cast or trickled in over two
 * minutes, and that is the difference the officers are actually asking about.
 * So it is a timeline first, with the per-pull tally underneath it.
 *
 * The pairing half lives in `pairing-board.tsx` and arrived from a question
 * about this kit — whether a turret or a land mine can be caught in Fatal
 * Attraction. It can: that tab's "kit killed" column is what the mechanic
 * destroyed, and it was invisible until the damage was fetched with a data type
 * that includes pets at all.
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

/**
 * The devices the engineering list is about, named from the curated list rather
 * than typed into the sentence — a sixth deployable added there renames the
 * prompt with it instead of leaving it quietly wrong.
 */
const ENGINEERING_DEVICES = [...deployableLabelsFor("Engineering")];

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

/**
 * The name of the pairing tab, read off the curated list rather than typed
 * here — a second mechanic added there renames the tab with it instead of
 * leaving this quietly wrong.
 */
const PAIRING_LABEL = PAIRING_DEBUFFS.length === 1 ? PAIRING_DEBUFFS[0].name : "Pairings";

/**
 * One card, two tabs: what the raid put on the ground, and who the boss linked
 * together.
 *
 * They share a card because they share a fight — and, as it turned out, because
 * they share a casualty list. This timeline was built for Mother Shahraz, and
 * the question that produced the second tab was asked about this kit: whether a
 * turret or a land mine can be picked by Fatal Attraction, or soak its damage.
 * It cannot be picked — no pet has ever taken the debuff — but it is very much
 * hit, and the mechanic kills thornlings, land mines and flame turrets by the
 * dozen. The pairing tab counts what died, one tab away from what was laid.
 *
 * There are two tab rows on screen when this is open, which `board-section.tsx`
 * warns about — its own boards use folds for exactly that reason. The pull tabs
 * inside each half are separated from these by a line of summary text, which is
 * what keeps them from reading as one control; a third row would not survive
 * that trick and should become a fold instead.
 */
export function DeployableTimeline({
  fights,
  deployables,
  pairings,
}: {
  fights: RaidFight[];
  deployables: RaidDeployableView;
  pairings: RaidPairingView;
}) {
  /*
   * The tab with something in it opens first, the same rule the dispel and
   * interrupt card follows: a report imported after deployables shipped but
   * before pairings did has one and not the other, and opening on the empty
   * half reads as "this night had none" until you click.
   */
  const defaultTab = deployables.total === 0 && pairings.total > 0 ? "pairings" : "deployables";

  return (
    <CollapsibleCard
      title={`Deployables & ${PAIRING_LABEL}`}
      description="What the raid put on the ground — land mines, snake traps, thornlings, dog whistles and flame turrets — and who the boss linked together. Neither is scored: what the kit is worth on a pull, and what a pairing should have cost, are the council's calls."
    >
      <Tabs defaultValue={defaultTab}>
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="deployables">
            Deployables
            {/*
              A zero is left off rather than shown, same as the dispel card: it
              would claim the raid laid nothing when it may only mean this
              report predates the tracking — a distinction each half spells out
              once its tab is open.
            */}
            {deployables.total > 0 && (
              <span className="ml-1 text-[10px] tabular-nums text-muted-foreground">
                {deployables.total}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="pairings">
            {PAIRING_LABEL}
            {pairings.total > 0 && (
              <span className="ml-1 text-[10px] tabular-nums text-muted-foreground">
                {pairings.total}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="deployables">
          <DeployableSections fights={fights} deployables={deployables} />
        </TabsContent>
        <TabsContent value="pairings">
          <PairingSections fights={fights} pairings={pairings} />
        </TabsContent>
      </Tabs>
    </CollapsibleCard>
  );
}

function DeployableSections({
  fights,
  deployables,
}: {
  fights: RaidFight[];
  deployables: RaidDeployableView;
}) {
  const withDrops = fights.filter((f) => deployables.fights.some((d) => d.fightId === f.fightId));

  if (deployables.total === 0 || withDrops.length === 0) {
    return (
      <p className="py-1 text-sm text-muted-foreground">
        None recorded for this night. That is <em>not</em> the same as nobody laying one: reports
        imported before these five were tracked contain no events for them at all. Re-import this
        report to fill it in.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Laid on the pull, in the order they went down. The count is the smaller half: what matters
        on a fight that wants the kit is whether it was down early and how many people laid one.
      </p>
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

      <SilenceTable silence={deployables.silence} />
    </div>
  );
}

/** What somebody laid, as the same swatch-and-count the tally above uses. */
function LaidCell({ laid }: { laid: DeployableCount[] }) {
  if (laid.length === 0) {
    return <span className="text-xs text-muted-foreground/50">nothing</span>;
  }
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
      {laid.map((c) => (
        <span key={c.name} className="inline-flex items-center gap-1 whitespace-nowrap">
          <span
            aria-hidden
            className="h-2 w-2 rotate-45 rounded-[1px]"
            style={{ backgroundColor: deployableColor(c.name) }}
          />
          {c.name}
          <span className="tabular-nums text-muted-foreground">×{c.count}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * One of the two lists under a boss, as rows rather than a run-on line.
 *
 * Names, pull counts and what each person laid line up in columns because the
 * question is a comparison between raiders — read as wrapped prose, twenty
 * names and their counts are a wall, and the officer has to re-find the column
 * boundary on every one.
 */
function AbstainerRows({
  title,
  empty,
  who,
  pulls,
  showLaid,
}: {
  title: React.ReactNode;
  /** What it means when nobody is on this list — the good outcome, said plainly. */
  empty: string;
  who: DeployableAbstainer[];
  /**
   * The boss's counted pulls, as the denominator beside each raider's own.
   * "2 of 3" and "3 of 3" are different accusations and the row has to say
   * which — somebody who was only there for one pull had one chance.
   */
  pulls: number;
  /** The engineer list needs "laid instead"; on the silent list it is always nothing. */
  showLaid?: boolean;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      {who.length === 0 ? (
        <p className="text-xs text-muted-foreground/60">{empty}</p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {who.map((a) => (
              <tr key={a.name} className="border-b border-border/40 last:border-0">
                <td className="w-48 py-1 pr-2">
                  <span className="inline-flex items-center gap-1.5">
                    <Raider name={a.name} slug={a.slug} className={a.className} />
                    {a.engineer && (
                      <Badge variant="muted" title="The roster records them as an engineer">
                        Engi
                      </Badge>
                    )}
                  </span>
                </td>
                <td className="w-28 py-1 pr-2 text-xs text-muted-foreground">
                  <span className="tabular-nums">
                    {a.pulls} of {pulls}
                  </span>{" "}
                  {pulls === 1 ? "pull" : "pulls"}
                </td>
                {showLaid && (
                  <td className="py-1">
                    <LaidCell laid={a.laid} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * Who laid nothing, boss by boss — one row per boss, opening onto the names.
 *
 * **The boss is the unit, not the pull.** Mines and whistles run a fifteen
 * minute cooldown, so on a boss the raid wiped on twice before killing it
 * nobody could have laid one every time, and a per-pull list would name most of
 * the raid twice over for nothing. Across the boss it means what it says:
 * three chances, none taken.
 *
 * Two questions, two lists, and they overlap on purpose. "Laid nothing at all"
 * is about the kit; "an engineer with no device down" is about a profession the
 * roster records, and the engineer who did neither is honestly in both. The
 * second list carries what they *did* lay so the difference is readable.
 */
function SilenceTable({ silence }: { silence: RaidDeployableView["silence"] }) {
  const [open, setOpen] = React.useState<Record<number, boolean>>({});
  if (silence.length === 0) return null;

  return (
    <div className="pt-1">
      <p className="pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Who laid nothing
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-6" />
            <TableHead>Boss</TableHead>
            <TableHead className="w-20 text-right">Pulls</TableHead>
            <TableHead className="w-32 text-right">Laid nothing</TableHead>
            <TableHead className="w-36 text-right">Engineers idle</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {silence.map((boss) => {
            const isOpen = open[boss.encounterId] === true;
            return (
              <React.Fragment key={boss.encounterId}>
                <TableRow
                  className="cursor-pointer"
                  onClick={() => setOpen((o) => ({ ...o, [boss.encounterId]: !isOpen }))}
                  title="Show who"
                  aria-expanded={isOpen}
                >
                  <TableCell className="w-6 pr-0">
                    <ChevronRight
                      className={cn(
                        "h-3.5 w-3.5 text-muted-foreground transition-transform",
                        isOpen && "rotate-90",
                      )}
                      aria-hidden
                    />
                  </TableCell>
                  <TableCell className="text-sm font-medium">{boss.encounterName}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                    {boss.pulls}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {boss.silent.length}
                    <span className="ml-1 text-xs text-muted-foreground">/ {boss.raiders}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    {boss.engineers.length > 0 ? (
                      <Badge variant="warning">{boss.engineers.length}</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground/60">—</span>
                    )}
                  </TableCell>
                </TableRow>
                {isOpen && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell />
                    <TableCell colSpan={4} className="space-y-3 pb-3">
                      <AbstainerRows
                        title={`Laid nothing on any of the ${boss.pulls} ${
                          boss.pulls === 1 ? "pull" : "pulls"
                        }`}
                        empty="Nobody — everyone on this boss laid something."
                        who={boss.silent}
                        pulls={boss.pulls}
                      />
                      <AbstainerRows
                        title={
                          <>
                            Recorded engineers with no{" "}
                            {ENGINEERING_DEVICES.map((name, i) => (
                              <React.Fragment key={name}>
                                {i > 0 && " or "}
                                <span style={{ color: deployableColor(name) }}>{name}</span>
                              </React.Fragment>
                            ))}{" "}
                            down, and what they laid instead
                          </>
                        }
                        empty="Nobody — every engineer the roster knows about put a device down."
                        who={boss.engineers}
                        pulls={boss.pulls}
                        showLaid
                      />
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            );
          })}
        </TableBody>
      </Table>
      <p className="pt-1.5 text-xs text-muted-foreground/70">
        <Badge variant="muted" className="mr-1.5 font-normal">
          note
        </Badge>
        Per boss, not per pull — mines and whistles are on fifteen-minute cooldowns, so nobody
        could lay one on every wipe. Counted over the same pulls the timeline above shows: a pull
        <em> nobody at all</em> laid on is a reset or a boss the kit wasn’t wanted on, and putting
        it in everyone’s denominator would be counting a chance nobody had. The engineering rows
        read the roster, so a raider whose professions nobody has filled in never appears on them
        — an absent tag is unknown, not innocent.
      </p>
    </div>
  );
}
