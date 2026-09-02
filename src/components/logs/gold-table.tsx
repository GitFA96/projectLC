"use client";

import * as React from "react";
import { ChevronRight, Coins, Loader2, TriangleAlert } from "lucide-react";
import type { ConsumableAdjustment, ReportPayback } from "@/lib/types";
import { buildPayback, type PaybackRow } from "@/lib/analysis/payback";
import type { GuildPolicy } from "@/lib/analysis/policy";
import {
  adjustmentGold,
  adjustmentsFor,
  applyAdjustments,
  addAdjustment,
  bumpAdjustment,
  setAdjustmentNote,
  type ConsumableLine,
} from "@/lib/analysis/consumable-adjustments";
import {
  CONSUMABLE_GROUP_LABELS,
  CONSUMABLE_GROUP_ORDER,
  consumableGroupOf,
  type ConsumableGroup,
} from "@/lib/wcl/consumables";
import { saveReportConsumableAdjustments } from "@/app/logs/actions";
import { RankBadge, Raider } from "@/components/logs/rank-bits";
import {
  BreakdownAdjuster,
  type AdjustLine,
  type ConsumableGroupedLines,
} from "@/components/logs/breakdown-adjuster";
import { useUnsavedGuard } from "@/components/use-unsaved-guard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/** One raider's row, as the server ranked it against the *saved* adjustments. */
export interface GoldRow {
  name: string;
  slug?: string;
  className?: string;
  /** Logged gold, never moved by a correction — shown as the log reported it. */
  inFight: number;
  prep: number;
  /** In-fight + prep lines merged, before any correction. */
  logged: ConsumableLine[];
}

const gold = (n: number) => `${Math.round(n).toLocaleString("en-US")}g`;
const signedGold = (n: number) => `${n > 0 ? "+" : "−"}${gold(Math.abs(n))}`;
const marksLabel = (n: number) => `${n} mark${n === 1 ? "" : "s"}`;

/**
 * One raider's share of the night's marks.
 *
 * Gold on top because it is the figure that compares to the spend beside it,
 * marks underneath because marks are what actually change hands — you cannot
 * give somebody 2.7 of one, so the whole-mark number is the actionable half.
 */
function PaybackCell({ entry }: { entry?: PaybackRow }) {
  if (!entry) return <span className="text-muted-foreground/40">—</span>;
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className="font-medium">{gold(entry.recommended)}</span>
      {/* nowrap on each line, not the container: the three lines are meant to
          stack, but "2" breaking away from "marks" is not a line break anyone
          chose — and a badge that wraps under its own count reads as a second
          fact rather than a qualifier on the first. */}
      <span className="whitespace-nowrap text-[10px] text-muted-foreground">
        {marksLabel(entry.marks)}
        {/* Capped beats boosted, because it is the more surprising fact: a
            capped row has stopped tracking the weighting entirely, and an
            officer reading the column deserves to know why before they are
            told the raider was boosted into it. */}
        {entry.capped ? (
          <span
            className="ml-1 rounded-full bg-info-fill px-1 py-px font-medium text-info-ink"
            title="Held at what this raider spent — nobody is paid back more than their outlay, and the difference went back into the pot for everyone else"
          >
            at cap
          </span>
        ) : (
          entry.top && (
            <span
              className="ml-1 rounded-full bg-warn-fill px-1 py-px font-medium text-warn-ink"
              title="In the boosted tier — this raider's spend counts more when the pot is split"
            >
              boosted
            </span>
          )
        )}
      </span>
      {entry.paid > 0 && (
        <span className="whitespace-nowrap text-[10px] text-success-ink">
          {gold(entry.paid)} paid
        </span>
      )}
    </span>
  );
}

/**
 * The gold-spent ranking, with its ± corrections buffered into one save.
 *
 * Every press used to be its own write, and every write bust the whole route
 * cache — so correcting a night meant a dozen round trips, and the ranking
 * re-sorted between them. An officer working down the table would aim at a row
 * that had already moved.
 *
 * The presses now collect here and go out as one list on **Save**. Deliberately
 * no timer: a flush re-renders the page and re-ranks the rows, and there is no
 * interval short enough to be worth having that won't also fire mid-thought and
 * reshuffle a table someone is still clicking through.
 *
 * Two orderings are therefore frozen while a batch is open, both against the
 * *saved* adjustments rather than the pending ones:
 *
 * - **Row order and membership** — the server ranks them, and doesn't re-run
 *   until a save lands.
 * - **Consumable order within a raider** — sorted by saved gold, so a −1 never
 *   moves a line past its neighbour while it is being pressed.
 *
 * Every *number* still moves on the press. Only the sort waits.
 *
 * The ± themselves live one level down, in the panel a row expands into: the
 * chips in the row are evidence for the number beside them and are read far
 * more often than they are corrected, so they carry no controls. See
 * `BreakdownAdjuster` for why the editor is a grid.
 */
export function GoldTable({
  code,
  rows,
  costPerUse,
  adjustments,
  usingDefault,
  payback,
  policy,
}: {
  code: string;
  rows: GoldRow[];
  costPerUse: Record<string, number>;
  /** The saved list. Seeds the buffer, and re-seeds it once a save lands. */
  adjustments: ConsumableAdjustment[];
  usingDefault: boolean;
  /**
   * This night's marks and what has been handed back. Edited in its own panel
   * below the table — the same arrangement the prices use, and for the same
   * reason: this card's ± presses are a buffered batch, and a second kind of
   * pending edit inside it would have to share that buffer's save, its dirty
   * flag and its unsaved-work guard.
   */
  payback: ReportPayback;
  /** The council's split, from guild policy. */
  policy: GuildPolicy;
}) {
  const [pending, setPending] = React.useState(adjustments);
  const [saved, setSaved] = React.useState(adjustments);
  const [dirty, setDirty] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [leavingTo, setLeavingTo] = React.useState<string | null>(null);
  /** Which raider's correction panel is open — one at a time, so the card stays short. */
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [saving, startTransition] = React.useTransition();

  // A save refreshes the route, which streams the written list back down as a
  // new prop. Take it — but never over unsaved presses, or a slow round trip
  // would swallow whatever got clicked while it was in flight. The panel below
  // writes the same key, so this is also how its edits arrive here.
  if (saved !== adjustments) {
    setSaved(adjustments);
    if (!dirty) setPending(adjustments);
  }

  // Leaving with a batch open would throw it away silently, and the links that
  // do it are all over the page. The guard catches the click and hands the
  // destination back; the dialog below offers to save on the way out.
  const { leave } = useUnsavedGuard({ when: dirty, onIntercept: setLeavingTo });

  const bump = (actorName: string, name: string, direction: 1 | -1) => {
    setError(null);
    setDirty(true);
    setPending((prev) =>
      bumpAdjustment({
        adjustments: prev,
        actorName,
        name,
        direction,
        at: new Date().toISOString(),
      }),
    );
  };

  const note = (actorName: string, name: string, text: string) => {
    setPending((prev) => {
      const next = setAdjustmentNote({ adjustments: prev, actorName, name, note: text });
      // A blur fires whether or not anything was typed. Only mark the batch
      // dirty when the reason actually moved, or tabbing through the panel
      // would arm the unsaved-work guard over nothing.
      if (JSON.stringify(next) !== JSON.stringify(prev)) setDirty(true);
      return next;
    });
  };

  const add = (actorName: string, name: string, count: number, text: string) => {
    setError(null);
    setDirty(true);
    setPending((prev) =>
      addAdjustment({
        adjustments: prev,
        actorName,
        name,
        count,
        note: text,
        at: new Date().toISOString(),
      }),
    );
  };

  // `then` is how "save and leave" stays honest: the navigation happens only if
  // the write actually landed, so a failed save leaves the batch on screen with
  // its error rather than dropping it on the way out.
  const save = (then?: () => void) => {
    setError(null);
    const sent = pending;
    startTransition(async () => {
      const result = await saveReportConsumableAdjustments({
        code,
        adjustments: sent,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setDirty(false);
      then?.();
    });
  };

  const discard = () => {
    setError(null);
    setPending(saved);
    setDirty(false);
  };

  // Values follow the presses; both sorts follow `saved`. See the note above.
  const view = rows.map((row) => {
    const order = new Map(
      applyAdjustments(row.logged, adjustmentsFor(saved, row.name))
        .map((l) => [l.name, (costPerUse[l.name] ?? 0) * l.count] as const)
        .sort((a, b) => b[1] - a[1])
        .map(([name], i) => [name, i] as const),
    );
    const lines = applyAdjustments(row.logged, adjustmentsFor(pending, row.name))
      .filter((l) => (costPerUse[l.name] ?? 0) * l.count > 0 || l.delta !== undefined)
      .sort((a, b) => (order.get(a.name) ?? order.size) - (order.get(b.name) ?? order.size));
    const delta = adjustmentGold(row.logged, lines, costPerUse);
    // The reason lives on the adjustment, not the folded line — carry it back
    // so the panel can show and edit what was written against each correction.
    const notes = new Map(
      adjustmentsFor(pending, row.name).map((a) => [a.name.trim().toLowerCase(), a.note]),
    );
    const groups = groupLines(
      lines.map((l) => ({
        ...l,
        cost: costPerUse[l.name] ?? 0,
        note: notes.get(l.name.trim().toLowerCase()),
      })),
    );
    // Surfaced on the collapsed row so a corrected raider is visible without
    // opening anything — the chips used to carry that and no longer do.
    const corrections = lines.filter((l) => l.delta !== undefined).length;
    return { row, groups, corrections, delta, total: row.inFight + row.prep + delta };
  });

  // Everything this raid has a price for — the suggestion list when an officer
  // records a consumable the log never saw, so a typo can't open a second line
  // for something that already has one.
  const known = React.useMemo(() => Object.keys(costPerUse).sort(), [costPerUse]);

  /*
   * Recomputed from the LIVE totals, not the server's.
   *
   * The ranking is frozen against the saved adjustments while a batch is open
   * (see the note above), and the payback split rides on that same frozen
   * order — but its numbers move with every press, which is the rule this card
   * already follows everywhere else: values follow the presses, sorts wait.
   * A payback column that sat still while the gold beside it moved would be
   * the one number on screen contradicting its own row.
   */
  const split = buildPayback({
    spenders: view.map((v) => ({
      name: v.row.name,
      slug: v.row.slug,
      className: v.row.className,
      gold: v.total,
    })),
    pot: { marks: payback.marks, markGold: payback.markGold },
    paid: payback.paid,
    policy,
  });
  const paybackByName = new Map(split.rows.map((r) => [r.name, r]));

  const raidTotal = view.reduce((sum, v) => sum + v.total, 0);
  const adjustmentTotal = view.reduce((sum, v) => sum + v.delta, 0);
  const unsaved = dirty ? countChanges(saved, pending) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Coins className="h-4 w-4 text-warn" />
          Total gold spent
          <span className="text-sm font-normal text-muted-foreground">
            ≈ {gold(raidTotal)} across the raid
          </span>
          {adjustmentTotal !== 0 && (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium",
                adjustmentTotal > 0
                  ? "bg-warn-fill text-warn-ink"
                  : "bg-success-fill text-success-ink",
              )}
              title="Net change from this raid's manual adjustments — listed in full below"
            >
              {signedGold(adjustmentTotal)} adjusted
            </span>
          )}
          {/* Always here, empty or not. These controls are taller than the title
              text, so appearing on the first press would push the whole table
              down — out from under the cursor that is still pressing ±. */}
          <span className="ml-auto flex h-8 items-center gap-2">
            {dirty && (
              <>
                <span
                  className="rounded-full bg-warn-fill px-2 py-0.5 text-[11px] font-medium text-warn-ink"
                  title="The ranking re-sorts when you save, not while you're still correcting it."
                >
                  {unsaved} unsaved correction{unsaved === 1 ? "" : "s"}
                </span>
                <Button size="sm" variant="ghost" onClick={discard} disabled={saving}>
                  Discard
                </Button>
                <Button size="sm" onClick={() => save()} disabled={saving}>
                  {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                  Save
                </Button>
              </>
            )}
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Estimated gold per raider across everything — in-fight potions/sappers plus prep buffs
          (flask, elixirs, food, weapon stone, scrolls, Flame Cap). Prep buffs scale with raid
          length and deaths: a buff held from an early to a late pull on a night longer than it
          lasts is re-bought (a flask ≈ ×2 past 2 hours), and consumed buffs add one per death.
          {usingDefault && (
            <span className="ml-1 inline-flex items-center gap-1 text-warn-ink">
              <TriangleAlert className="h-3 w-3" /> using default prices — set this raid&apos;s
              below.
            </span>
          )}
          {/* The "re-sorts on save" note lives on the unsaved badge instead of
              here: a sentence appended to this paragraph wraps it onto another
              line, which moves the table for the same reason. */}
        </p>
        {error && <p className="text-xs text-danger-ink">{error}</p>}
      </CardHeader>
      <CardContent>
        {view.length === 0 ? (
          <p className="py-1 text-sm text-muted-foreground">No priced consumables this raid.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Raider</TableHead>
                <TableHead className="w-20 text-right">In-fight</TableHead>
                <TableHead className="w-16 text-right">Prep</TableHead>
                {/* Held open even on a raid nobody has corrected: appearing on
                    the first press would shift every column after it sideways,
                    ± buttons included. An untouched raid reads as a column of
                    dashes, which is the true answer. */}
                <TableHead className="w-20 text-right" title="Net gold from manual adjustments">
                  Adjusted
                </TableHead>
                <TableHead className="w-20 text-right">Total</TableHead>
                {split.potRecorded && (
                  <TableHead
                    /* Wide enough for "2 marks" and its pill on ONE line: at
                       w-24 the count wrapped off its own noun, so a two-mark
                       row read as four stacked lines. The space comes out of
                       Consumables, which is a single button and has it spare. */
                    className="w-36 text-right"
                    title="Recommended share of this night's Marks of Illidari, and what has been handed back"
                  >
                    Payback
                  </TableHead>
                )}
                <TableHead>Consumables</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.map(({ row, groups, corrections, delta, total }, i) => (
                <React.Fragment key={row.name}>
                  <TableRow className={cn(i === 0 && "bg-warn-soft/70 hover:bg-warn-soft/70")}>
                    <TableCell>
                      <RankBadge rank={i + 1} />
                    </TableCell>
                    <TableCell>
                      <Raider name={row.name} slug={row.slug} className={row.className} />
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                      {gold(row.inFight)}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                      {gold(row.prep)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right text-sm tabular-nums",
                        delta === 0
                          ? "text-muted-foreground/40"
                          : delta > 0
                            ? "text-warn-ink"
                            : "text-success-ink",
                      )}
                    >
                      {delta === 0 ? "—" : signedGold(delta)}
                    </TableCell>
                    <TableCell className="text-right text-sm font-semibold tabular-nums">
                      {gold(total)}
                    </TableCell>
                    {split.potRecorded && (
                      <TableCell className="text-right text-sm tabular-nums">
                        <PaybackCell entry={paybackByName.get(row.name)} />
                      </TableCell>
                    )}
                    <TableCell>
                      {/* The breakdown lives in the panel this opens, not in the
                          row. Spelling out ~8 consumables per raider turned the
                          ranking into three lines of chips per row and buried
                          the gold, which is what the card is for. */}
                      <button
                        type="button"
                        onClick={() => setExpanded((e) => (e === row.name ? null : row.name))}
                        aria-expanded={expanded === row.name}
                        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        <ChevronRight
                          className={cn(
                            "h-3.5 w-3.5 transition-transform",
                            expanded === row.name && "rotate-90",
                          )}
                        />
                        {expanded === row.name ? "Hide consumables" : "Show consumables used"}
                        {corrections > 0 && (
                          <span className="ml-1 rounded-full bg-warn-fill px-1.5 py-0.5 text-[10px] font-medium text-warn-ink">
                            {corrections} corrected
                          </span>
                        )}
                      </button>
                    </TableCell>
                  </TableRow>
                  {expanded === row.name && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={split.potRecorded ? 8 : 7} className="p-2">
                        <BreakdownAdjuster
                          actorName={row.name}
                          groups={groups}
                          disabled={saving}
                          known={known}
                          onBump={bump}
                          onNote={note}
                          onAdd={add}
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              ))}
              {split.potRecorded && (
                <TableRow className="border-t-2 hover:bg-transparent">
                  <TableCell />
                  <TableCell className="text-xs font-medium text-muted-foreground">
                    Night total
                  </TableCell>
                  <TableCell colSpan={3} />
                  <TableCell className="text-right text-sm font-semibold tabular-nums">
                    {gold(raidTotal)}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    <span className="inline-flex flex-col items-end leading-tight">
                      <span className="font-semibold">{gold(split.recommendedTotal)}</span>
                      <span className="whitespace-nowrap text-[10px] text-muted-foreground">
                        {marksLabel(split.marksAllocated)}
                      </span>
                      {split.paidTotal > 0 && (
                        <span className="whitespace-nowrap text-[10px] text-success-ink">
                          {gold(split.paidTotal)} paid
                        </span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {/* The sum IS the pot — that is what makes it a split rather
                        than a rebate — so saying so here is the check an officer
                        would otherwise do with a calculator. Unless the spend
                        ceiling bit, in which case saying which is the point. */}
                    {split.marksUndistributed > 0 ? (
                      <span className="text-info-ink">
                        {marksLabel(split.marksUndistributed)} left in the bank — nobody can take
                        more without being paid back over what they spent
                      </span>
                    ) : (
                      split.recommendedTotal > 0 &&
                      `${Math.round((split.recommendedTotal / raidTotal) * 100)}% of the night's spend, back`
                    )}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Modal
        open={leavingTo !== null}
        onClose={() => setLeavingTo(null)}
        title={`${unsaved} unsaved correction${unsaved === 1 ? "" : "s"}`}
        description="Leaving this page now throws them away — nothing has been written yet."
      >
        {error && <p className="mb-3 text-xs text-danger-ink">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setLeavingTo(null)} disabled={saving}>
            Stay here
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const to = leavingTo;
              discard();
              setLeavingTo(null);
              if (to) leave(to);
            }}
            disabled={saving}
          >
            Discard and leave
          </Button>
          <Button
            size="sm"
            onClick={() => {
              const to = leavingTo;
              save(() => {
                setLeavingTo(null);
                if (to) leave(to);
              });
            }}
            disabled={saving}
          >
            {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            Save and leave
          </Button>
        </div>
      </Modal>
    </Card>
  );
}

/**
 * Split a raider's lines into families, in the curated display order.
 *
 * Grouping is applied *after* the gold sort, so the order inside a family is
 * still the frozen one and a press can't move a line past its neighbour. Empty
 * families are dropped — a raider who drank no potions gets no Potions heading.
 */
function groupLines(lines: AdjustLine[]): ConsumableGroupedLines[] {
  const byGroup = new Map<ConsumableGroup, AdjustLine[]>();
  for (const line of lines) {
    const group = consumableGroupOf(line.name);
    const bucket = byGroup.get(group);
    if (bucket) bucket.push(line);
    else byGroup.set(group, [line]);
  }
  return CONSUMABLE_GROUP_ORDER.filter((g) => byGroup.has(g)).map((group) => ({
    group,
    label: CONSUMABLE_GROUP_LABELS[group],
    lines: byGroup.get(group) ?? [],
  }));
}

/**
 * How many corrections the open batch actually represents — entries added,
 * dropped, or moved off their saved delta. Counting presses would be wrong:
 * pressing + then − again leaves nothing to save.
 */
function countChanges(saved: ConsumableAdjustment[], pending: ConsumableAdjustment[]): number {
  /*
   * The separator between the three parts is a raw NUL, and it has to be
   * something no one can type: a raider's name, a consumable's name and an
   * officer's free-text note are all arbitrary strings, so any printable
   * separator is one an officer can put in a note and fold two different
   * corrections onto one key — which would silently undercount the batch.
   *
   * The cost is paid outside this file, and is worth knowing before it
   * surprises somebody: two NUL bytes make **git classify this file as
   * binary**. It will not diff or auto-merge it the way it does every other
   * source file here, `grep` skips it as binary, and a line-ending change
   * that git would normally absorb shows up as a whole-file rewrite.
   *
   * Writing these as the escape `\u0000` — or switching to `\u001f` —
   * keeps the guarantee exactly and hands the file back to git. Worth doing
   * next time this function is open for another reason.
   */
  const key = (a: ConsumableAdjustment) =>
    `${a.actorName.trim().toLowerCase()} ${a.name.trim().toLowerCase()} ${a.note ?? ""}`;
  const before = new Map(saved.map((a) => [key(a), a.delta]));
  const seen = new Set<string>();
  let n = 0;
  for (const a of pending) {
    const k = key(a);
    seen.add(k);
    if (before.get(k) !== a.delta) n++;
  }
  for (const k of before.keys()) if (!seen.has(k)) n++;
  return n;
}
