"use client";

import * as React from "react";
import { Minus, PencilLine, Plus } from "lucide-react";
import type { ConsumableGroup } from "@/lib/wcl/consumables";
import { cn } from "@/lib/utils";

export interface AdjustLine {
  name: string;
  /** Count after corrections — what the gold is charged on. */
  count: number;
  /** Net uses added (+) or removed (-) by hand. Absent when untouched. */
  delta?: number;
  /** True when nothing was logged and the whole line is an officer's. */
  added?: boolean;
  /** The reason written against the correction, when there is one. */
  note?: string;
  /** Gold per use at this raid's prices. */
  cost: number;
}

/** One family of a raider's consumables, already in display order. */
export interface ConsumableGroupedLines {
  group: ConsumableGroup;
  label: string;
  lines: AdjustLine[];
}

/**
 * One raider's consumables, correctable — the panel behind a row in the gold
 * table.
 *
 * This used to be a ± beside every badge in the row itself. That put ~200 pairs
 * of buttons on a table that is read far more often than it is corrected, and
 * it moved while you used it: a press appends "(−1)" to a badge, the badge
 * grows, and every control to its right slides out from under the cursor.
 *
 * A grid of fixed columns cannot do that. Nothing here is sized by its
 * contents, so a count going 12 → 11 → 10 moves nothing on screen, and the
 * numbers a correction is meant to be judged against — what the log saw, what
 * it now counts, what it costs — are columns instead of a tooltip.
 *
 * **Green and red are the direction of the *count*, not of the gold.** A line
 * goes green when uses were added and red when they were taken away, matching
 * the buttons that do it. The table's Adjusted column keeps money's meaning,
 * where spending more is the amber one; they answer different questions about
 * the same press.
 *
 * Lines arrive already split into families and ordered — see `groupLines` in
 * the gold table. Grouping is applied after the gold sort, so a heading never
 * costs the frozen order that keeps a press from moving the row it is aimed at.
 *
 * The footer records a consumable the log never saw at all — the one correction
 * that cannot start from a ± on an existing line, because there is no line.
 * That used to live in a separate card below the table; with the breakdown and
 * the corrections both here, a second card was just somewhere else to look.
 */
export function BreakdownAdjuster({
  actorName,
  groups,
  disabled,
  known,
  onBump,
  onNote,
  onAdd,
}: {
  /** The raider these lines belong to — the "who" of every press from here. */
  actorName: string;
  groups: ConsumableGroupedLines[];
  /** True while the batch is being written, so the buffer can't move under it. */
  disabled?: boolean;
  /** Every consumable priced this raid — the suggestion list for an addition. */
  known: string[];
  onBump: (actorName: string, name: string, direction: 1 | -1) => void;
  onNote: (actorName: string, name: string, note: string) => void;
  onAdd: (actorName: string, name: string, count: number, note: string) => void;
}) {
  const cols = "grid-cols-[minmax(7rem,1fr)_3.5rem_7rem_4rem_5rem]";

  return (
    <div className="rounded-lg border bg-muted/30">
      <div
        className={cn(
          "grid items-center gap-2 border-b px-3 py-1.5 text-[11px] font-medium text-muted-foreground",
          cols,
        )}
      >
        <span>Consumable</span>
        <span className="text-right" title="Uses Warcraft Logs saw">
          Logged
        </span>
        <span className="text-center">Correction</span>
        <span className="text-right" title="What the gold below is charged on">
          Counted
        </span>
        <span className="text-right">Gold</span>
      </div>

      {groups.map((group) => (
        <React.Fragment key={group.group}>
          {/* One heading per family, and only for families this raider used —
              the point is seeing at a glance what they ran, not reading an
              inventory of everything they could have. */}
          <div className="flex items-baseline justify-between border-b bg-muted/60 px-3 py-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {group.label}
            </span>
            <span className="text-[10px] tabular-nums text-muted-foreground/70">
              {gold(group.lines)}g
            </span>
          </div>
          {group.lines.map((line) => {
            const delta = line.delta ?? 0;
            const logged = line.count - delta;
            return (
              <div
                key={line.name}
                className={cn(
                  "grid items-center gap-2 border-b px-3 py-1 text-xs last:border-b-0",
                  delta > 0 && "bg-success-soft/50",
                  delta < 0 && "bg-danger-soft/50",
                  cols,
                )}
              >
                <span className="truncate font-medium" title={line.name}>
                  {line.name}
                  {line.added && (
                    <span className="ml-1 font-normal text-muted-foreground">(not logged)</span>
                  )}
                </span>

                <span className="text-right tabular-nums text-muted-foreground">
                  {line.added ? "—" : logged}
                </span>

                <span className="flex justify-center">
                  <span className="inline-flex items-center overflow-hidden rounded-md border bg-card">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onBump(actorName, line.name, -1)}
                      className="px-1.5 py-1 text-danger-ink/60 transition-colors hover:bg-danger-soft hover:text-danger-ink disabled:opacity-40"
                      aria-label={`One fewer ${line.name} for ${actorName}`}
                      title={`One fewer ${line.name} than the log saw`}
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                    {/* Fixed width: this is the number that changes, so it is the
                    one thing that must never resize the row around it. */}
                    <span
                      className={cn(
                        "w-9 border-x px-1 py-0.5 text-center tabular-nums",
                        delta === 0 && "text-muted-foreground/50",
                        delta > 0 && "font-medium text-success-ink",
                        delta < 0 && "font-medium text-danger-ink",
                      )}
                    >
                      {delta === 0 ? "—" : `${delta > 0 ? "+" : "−"}${Math.abs(delta)}`}
                    </span>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onBump(actorName, line.name, 1)}
                      className="px-1.5 py-1 text-success-ink/60 transition-colors hover:bg-success-soft hover:text-success-ink disabled:opacity-40"
                      aria-label={`One more ${line.name} for ${actorName}`}
                      title={`One more ${line.name} than the log saw`}
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </span>
                </span>

                <span
                  className={cn(
                    "text-right font-semibold tabular-nums",
                    delta > 0 && "text-success-ink",
                    delta < 0 && "text-danger-ink",
                  )}
                >
                  {line.count}
                </span>

                <span
                  className="text-right tabular-nums text-muted-foreground"
                  title={`${line.cost.toFixed(2)}g per use`}
                >
                  {Math.round(line.count * line.cost).toLocaleString("en-US")}g
                </span>

                {/* Only a line that was actually corrected gets somewhere to
                    explain itself — a reason with no change behind it would
                    read in the audit list as a sentence about nothing. */}
                {delta !== 0 && (
                  <label className="col-span-full flex items-center gap-2 pt-1 text-[11px] text-muted-foreground">
                    <PencilLine className="h-3 w-3 shrink-0" />
                    <span className="sr-only">Why {line.name} was corrected</span>
                    <input
                      type="text"
                      defaultValue={line.note ?? ""}
                      disabled={disabled}
                      maxLength={200}
                      onBlur={(e) => onNote(actorName, line.name, e.target.value)}
                      placeholder="Why? (optional — shown in the corrections log)"
                      className="w-full rounded-sm border-b border-dashed border-transparent bg-transparent py-0.5 outline-none placeholder:text-muted-foreground/50 hover:border-border focus:border-ring disabled:opacity-40"
                    />
                  </label>
                )}
              </div>
            );
          })}
        </React.Fragment>
      ))}

      {groups.length === 0 && (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          Nothing priced this raid for {actorName}.
        </p>
      )}

      <AddConsumable actorName={actorName} known={known} disabled={disabled} onAdd={onAdd} />
    </div>
  );
}

/**
 * Record something Warcraft Logs never saw — a flask drunk before the pull
 * timer, a night somebody's client dropped.
 *
 * Deliberately not a row in the grid above: everything there starts from a
 * logged number and moves it, and this starts from nothing. It stays folded
 * away until asked for, because it is the rarer of the two corrections and the
 * grid is what people come here to read.
 */
function AddConsumable({
  actorName,
  known,
  disabled,
  onAdd,
}: {
  actorName: string;
  known: string[];
  disabled?: boolean;
  onAdd: (actorName: string, name: string, count: number, note: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [count, setCount] = React.useState("1");
  const [note, setNote] = React.useState("");
  const listId = React.useId();

  const submit = () => {
    const n = Number(count);
    if (name.trim() === "" || !Number.isFinite(n) || Math.round(n) === 0) return;
    onAdd(actorName, name, Math.round(n), note);
    setName("");
    setCount("1");
    setNote("");
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-1.5 border-t px-3 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
      >
        <Plus className="h-3 w-3" />
        Add a consumable the log didn&apos;t see
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-2 border-t bg-card/60 px-3 py-2 text-xs">
      <label className="flex min-w-[10rem] flex-1 flex-col gap-0.5">
        <span className="text-[10px] font-medium text-muted-foreground">Consumable</span>
        <input
          autoFocus
          list={listId}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          placeholder="Flask of Relentless Assault"
          className="rounded-md border bg-background px-2 py-1 outline-none focus:border-ring"
        />
        {/* The raid's own priced names, so a hand-typed spelling doesn't open a
            second line for a consumable that already has one. */}
        <datalist id={listId}>
          {known.map((k) => (
            <option key={k} value={k} />
          ))}
        </datalist>
      </label>
      <label className="flex w-16 flex-col gap-0.5">
        <span className="text-[10px] font-medium text-muted-foreground">Uses</span>
        <input
          type="number"
          min={1}
          value={count}
          onChange={(e) => setCount(e.target.value)}
          className="rounded-md border bg-background px-2 py-1 text-right tabular-nums outline-none focus:border-ring"
        />
      </label>
      <label className="flex min-w-[10rem] flex-[2] flex-col gap-0.5">
        <span className="text-[10px] font-medium text-muted-foreground">Why (optional)</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={200}
          placeholder="Drunk before the pull timer"
          className="rounded-md border bg-background px-2 py-1 outline-none focus:border-ring"
        />
      </label>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={submit}
          disabled={disabled || name.trim() === ""}
          className="rounded-md bg-primary px-2 py-1 font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          Add
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-accent"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Gold a family accounts for, so a heading carries its own weight. */
function gold(lines: AdjustLine[]): string {
  return Math.round(lines.reduce((sum, l) => sum + l.count * l.cost, 0)).toLocaleString("en-US");
}
