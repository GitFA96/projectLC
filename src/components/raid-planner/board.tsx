"use client";

import * as React from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Link2,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  GROUP_COUNT,
  GROUP_SIZE,
  addGroup,
  benchSections,
  clearGroup,
  boardFingerprint,
  boardView,
  dropIntent,
  dropOnSlot,
  emptyBoard,
  nudge,
  place,
  placeInFirstOpen,
  sanitizeBoard,
  groupLabel,
  removeGroup,
  removeSlot,
  seedBoard,
  archetypeSlot,
  encodePlan,
  paletteByClass,
  setGroupName,
  setSlotLabel,
  slotKey,
  setSlotSpec,
  slotOf,
  type Board,
  type Archetype,
  type PoolMember,
  type BoardSlot,
  type PlacedMember,
  type RecoveredParty,
} from "@/lib/analysis/raid-planner";
import { CLASS_TEXT_COLORS, classTint, iconUrl } from "@/lib/constants/wow";
import type { WowClass } from "@/lib/types";
import { saveBoard, type BoardTarget } from "@/app/raid-planner/actions";
import { SpecBadge, specIcon, specLabel } from "@/components/spec-badge";
import { GroupBuffPanel, PartyBuffMatrix, RaidBuffPanel } from "@/components/raid-planner/buff-coverage";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * The board: eight groups of five, a bench, and what each arrangement buys.
 *
 * Three ways to move a raider, because officers do this in a hurry:
 *
 *  - **Click someone on the bench** and they take the first free slot. This is
 *    the common case by a mile — filling a raid — and making it one click each
 *    beats making it twenty-five drags.
 *  - **Click someone already placed** to pick them up, then click the group, the
 *    bench, or another raider. The only path a keyboard or a trackpad can take
 *    comfortably.
 *  - **Drag**, for putting somebody in a particular position in one motion.
 *
 * Landing on another raider is `dropOnSlot`: a slide when the group has room, a
 * swap when it's full. The board previews which one before you let go, because
 * a swap moves two people and that is not a mistake you want to discover three
 * drags later.
 *
 * Coverage recomputes on every move rather than on save — the whole value of a
 * board tool is watching the Battle Shout in group 3 appear as you drop
 * the warrior in, which a save-then-look loop destroys.
 */

const classColor = (wowClass: string | undefined) =>
  wowClass && wowClass in CLASS_TEXT_COLORS ? CLASS_TEXT_COLORS[wowClass as WowClass] : undefined;


const ROLE_LABEL = { tank: "Tank", healer: "Healer", dps: "DPS" } as const;

/**
 * One slot's height, shared by a filled chip and an empty placeholder.
 *
 * The board must not move while it is being filled. Every part of a group card
 * is therefore a fixed height — five slots at this, a header, and a buff line
 * that is present whether or not there are buffs — so a card is exactly as tall
 * with five raiders in it as with none, and the bench underneath never budges.
 */
const SLOT_HEIGHT = "h-7";

/**
 * How many changes Undo can walk back.
 *
 * Generous on purpose — seating a raid is a hundred small moves and the mistake
 * an officer wants to take back is rarely the most recent one. Each entry is a
 * board, which is a few hundred bytes.
 */
const HISTORY_LIMIT = 100;

/** Unique enough for a board: a slot id only has to be distinct from its twins. */
const newSlotId = () =>
  `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/**
 * Re-fit a freshly seeded board to the groups the officer actually has.
 *
 * `seedBoard` always builds the full eight; a board someone has trimmed
 * to five shouldn't silently grow three back because they pressed "Fill in
 * order". Anyone who no longer fits ends up unplaced, which the bench shows.
 */
function withGroupCount(seeded: Board, like: Board): Board {
  const groups = seeded.groups.slice(0, like.groups.length);
  return { ...like, groups, bench: like.bench ? [] : like.bench };
}

/** The specs an officer may count this raider as, their current one included. */
function specChoices(member: PoolMember): string[] {
  const options = member.specOptions ?? [];
  if (options.length === 0) return member.spec ? [member.spec] : [];
  return options;
}

function memberTitle(member: PoolMember): string {
  return [
    member.wowClass && member.spec
      ? `${specLabel(member.spec)} ${member.wowClass}`
      : member.wowClass,
    member.role && ROLE_LABEL[member.role],
    member.pulls !== undefined && `${member.pulls} pull${member.pulls === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * A bench, because lucide has no bench — its nearest seats are `Armchair` and
 * `Sofa`, which read as furniture rather than as *the bench*. Drawn to lucide's
 * grid (24px box, 2px round stroke) so it sits level with the `Pencil` and `X`
 * beside it.
 *
 * Four strokes and no more: this renders at chip size, where a slatted seat or
 * a second back rail turns to mud. It is also drawn wide and short (20×13 of
 * the 24 box) rather than square like the icons it sits with, so it wants one
 * step up in size to look the same weight — see the call site.
 */
function BenchIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M3 6h18" />
      <path d="M2 13h20" />
      <path d="M6 6v13" />
      <path d="M18 6v13" />
    </svg>
  );
}

/** A raider, wherever they're standing. The same chip on the board and the bench. */
function MemberChip({
  member,
  held,
  onPick,
  onRemove,
  onBench,
  onDragEnd,
  onCycleSpec,
  onMove,
  onLandOn,
  onHover,
  hint,
  onRename,
  onStartRename,
  renaming = false,
}: {
  member: PlacedMember;
  held: boolean;
  onPick: () => void;
  /**
   * Take this slot off the board for good. Only where slots are *created* —
   * a raid night's raiders came from the log and can be set aside but never
   * deleted.
   */
  onRemove?: () => void;
  /** Set aside without losing it. */
  onBench?: () => void;
  /** Clears the hold when a drag ends without a drop, so nothing stays armed. */
  onDragEnd: () => void;
  /** Count them as their next spec — only offered when they have more than one. */
  onCycleSpec?: () => void;
  /** Reorder within the group: position 1 at the top, 5 at the bottom. */
  onMove?: (direction: -1 | 1) => void;
  /** Somebody was dropped (or placed) onto this raider — see `dropOnSlot`. */
  onLandOn?: () => void;
  /** Aiming at this raider, so the board can say what letting go would do. */
  onHover?: (over: boolean) => void;
  /** What that would be: slide the group along, or trade places. */
  hint?: "insert" | "swap" | "none";
  /** Give this slot the officer's own name. Planner boards only. */
  onRename?: (label: string) => void;
  onStartRename?: () => void;
  renaming?: boolean;
}) {
  const choices = specChoices(member);
  const next = choices.length > 1 ? choices[(choices.indexOf(member.spec ?? "") + 1) % choices.length] : undefined;
  const overridden = "specOverridden" in member && member.specOverridden;

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", slotKey(member.slot));
        e.dataTransfer.effectAllowed = "move";
        onPick();
      }}
      onDragEnd={onDragEnd}
      onDragOver={
        onLandOn &&
        ((e) => {
          // Stop here, or the group card underneath claims the drop and appends
          // to the end instead of landing on this raider.
          e.preventDefault();
          e.stopPropagation();
          onHover?.(true);
        })
      }
      onDragLeave={onHover && (() => onHover(false))}
      onDrop={
        onLandOn &&
        ((e) => {
          e.preventDefault();
          e.stopPropagation();
          onLandOn();
        })
      }
      className={cn(
        // SLOT_HEIGHT, matching the empty placeholder exactly. A chip even two
        // pixels taller than the gap it fills grows the card on every seating,
        // which walks the bench down the page and out from under the cursor —
        // and seating a raid is twenty-five clicks in a row.
        SLOT_HEIGHT,
        "group relative flex items-center gap-1 overflow-hidden rounded border border-transparent px-1.5 text-xs",
        /*
         * Somebody who doesn't exist yet, drawn as such. A board that reads as
         * a solved raid because two of its healers are trials is worse than an
         * obviously unfinished one — the border is the whole point.
         */
        member.prospect && "border-dashed border-muted-foreground/50",
        /*
         * One visual language for all three states: an outline, plus a word for
         * the two that are about to do something.
         *
         * They used to be a full border, a top-border and a ring, in two
         * colours — which read as three unrelated accidents rather than three
         * meanings, and the top-border variant shifted the chip's contents a
         * pixel as it appeared. Outlines sit outside the box model, so none of
         * these move anything.
         */
        held && "opacity-60 outline-2 outline-dashed outline-muted-foreground/50",
        hint === "insert" && "outline-2 outline-primary",
        hint === "swap" && "outline-2 outline-warn",
      )}
      title={
        hint === "swap"
          ? `Swap with ${member.name} — the group is full, so they take the other place`
          : hint === "insert"
            ? `Drop here — ${member.name} and everyone below move down one`
            : undefined
      }
      style={{ backgroundColor: classTint(member.wowClass) }}
    >
      {/*
       * Named, not just coloured. "Why is this one orange" is a question an
       * officer shouldn't have to hold in their head mid-drag, and a swap moves
       * two people where an insert moves one.
       */}
      {(hint === "insert" || hint === "swap") && (
        <span
          className={cn(
            "absolute right-0 z-10 rounded-l px-1 text-[9px] font-semibold",
            // Each fill carries its own ink: `primary` inverts between themes,
            // so a hardcoded white label would vanish on the light-on-dark one.
            hint === "swap" ? "bg-warn text-background" : "bg-primary text-primary-foreground",
          )}
        >
          {hint === "swap" ? "swap" : "above"}
        </span>
      )}
      {member.spec &&
        (onCycleSpec && next ? (
          <button
            type="button"
            // Every control here stops the click: the group card and the bench
            // are drop targets with their own onClick, so without this, picking
            // somebody up would immediately place whoever was held.
            onClick={(e) => {
              e.stopPropagation();
              onCycleSpec();
            }}
            title={`Counting ${member.name} as ${specLabel(member.spec)} — click for ${specLabel(next)}`}
            className={cn(
              "shrink-0 cursor-pointer rounded-sm",
              // Sky, deliberately not the primary or amber the drop states use:
              // "an officer changed this raider's spec" is a fact about the
              // board, not something about to happen to it.
              overridden && "ring-2 ring-info",
            )}
          >
            <SpecBadge spec={member.spec} wowClass={member.wowClass} iconOnly />
          </button>
        ) : (
          <SpecBadge spec={member.spec} wowClass={member.wowClass} iconOnly />
        ))}
      {renaming ? (
        <input
          autoFocus
          defaultValue={member.label ?? ""}
          placeholder={member.name}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => onRename?.(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") onRename?.(member.label ?? "");
          }}
          className="min-w-0 flex-1 bg-transparent font-medium outline-none"
          aria-label={`Name for this ${member.name} slot`}
        />
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPick();
          }}
          aria-pressed={held}
          title={memberTitle(member)}
          className="flex min-w-0 flex-1 cursor-pointer items-center text-left"
        >
          <span className="truncate font-medium" style={{ color: classColor(member.wowClass) }}>
            {member.label ?? member.name}
          </span>
        </button>
      )}
      {onRename && !renaming && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onStartRename?.();
          }}
          title={`Rename this ${member.name} slot — "Feral" filed as "OT Bear"`}
          className="shrink-0 cursor-pointer opacity-0 transition-opacity duration-75 group-hover:opacity-60 hover:opacity-100"
        >
          <Pencil className="h-3 w-3" aria-hidden />
        </button>
      )}
      {onMove && (
        <span className="flex shrink-0 flex-col opacity-0 transition-opacity duration-75 group-hover:opacity-70">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMove(-1);
            }}
            title="Move up — past the top of the group and they go into the one above"
            className="cursor-pointer hover:opacity-100"
          >
            <ChevronUp className="h-2.5 w-2.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMove(1);
            }}
            title="Move down — past the bottom and they go into the group below"
            className="cursor-pointer hover:opacity-100"
          >
            <ChevronDown className="h-2.5 w-2.5" aria-hidden />
          </button>
        </span>
      )}
      {onBench && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onBench();
          }}
          title={`Bench ${member.label ?? member.name} — set aside, still on the board`}
          className="shrink-0 cursor-pointer opacity-0 transition-opacity duration-75 group-hover:opacity-60 hover:opacity-100"
        >
          {/* h-3.5, not the h-3 its neighbours use — a wide, short glyph reads
              lighter than a square one at the same box size. */}
          <BenchIcon className="h-3.5 w-3.5" />
        </button>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title={`Delete this ${member.name} slot`}
          className="shrink-0 cursor-pointer opacity-0 transition-opacity duration-75 group-hover:opacity-60 hover:text-destructive hover:opacity-100"
        >
          <X className="h-3 w-3" aria-hidden />
        </button>
      )}
    </div>
  );
}

export function RaidBoard({
  pool,
  initial,
  /** Where this board is saved — a raid night, or one of the guild's rosters. */
  target,
  /** Groups the night's own logs give away, offered as a starting point. */
  recovered = [],
  /** What this pool is, one line. The holding hint shares its row so nothing shifts. */
  note,
  /**
   * Class-and-spec archetypes an officer can add, over and over.
   *
   * Present only on the planning board. A raid night's slots are the people the
   * log recorded, and inventing a twenty-sixth raider for a night that fielded
   * twenty-five would make the record a fiction — so creating slots is the one
   * capability the two boards don't share. Renaming and adding groups, they do.
   */
  palette,
  /**
   * This board arrived in a link rather than out of the database.
   *
   * It must not autosave. Somebody opening a plan you sent them has a plan of
   * their own, and quietly overwriting it the first time they nudge a slot
   * would be the worst possible way to find that out — so a shared board is
   * adopted on purpose or not at all.
   */
  shared = false,
}: {
  pool: PoolMember[];
  initial: Board;
  target: BoardTarget;
  recovered?: RecoveredParty[];
  note?: string;
  palette?: Archetype[];
  shared?: boolean;
}) {
  const [comp, setComp] = React.useState<Board>(() => sanitizeBoard(initial));
  const [held, setHeld] = React.useState<BoardSlot | null>(null);
  /** The raider currently being aimed at, so the board can preview the landing. */
  const [over, setOver] = React.useState<{ group: number; index: number } | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [msg, setMsg] = React.useState<string | null>(null);

  const view = React.useMemo(() => boardView(comp, pool), [comp, pool]);
  /** The board as last written to the database — what "unsaved" is measured against. */
  const [persisted, setPersisted] = React.useState(() =>
    boardFingerprint(sanitizeBoard(initial)),
  );
  /** Which slot's name is being edited, if any — template boards only. */
  const [renaming, setRenaming] = React.useState<string | null>(null);
  const current = boardFingerprint(comp);
  const dirty = current !== persisted;

  /*
   * Undo.
   *
   * The board autosaves, which means every mistake is committed before the
   * officer has finished noticing it — so "saved" cannot be allowed to mean
   * "final". Each change stacks the board as it was; Undo pops one and the
   * autosave writes *that*. Press it down to nothing and you are back to the
   * state the page opened in.
   *
   * Client-side only, and deliberately: a reload is a fresh session, and an
   * undo stack that survived one would let somebody rewind a board they hadn't
   * seen since last week.
   */
  const [past, setPast] = React.useState<{ comp: Board; key?: string }[]>([]);
  /*
   * Typing a group name fires this per keystroke. Consecutive changes carrying
   * the same key collapse into the one entry taken before the run started —
   * otherwise Undo walks back through a name letter by letter, which is not
   * what anybody means by "undo the rename".
   *
   * The key rides on the stack entry rather than in a ref, so the whole
   * decision happens inside the state updater and nothing reads mutable state
   * while rendering.
   */
  const remember = (previous: Board, key?: string) => {
    setPast((p) => {
      const top = p[p.length - 1];
      if (key !== undefined && top?.key === key) return p;
      return [...p, { comp: previous, key }].slice(-HISTORY_LIMIT);
    });
  };

  /*
   * Autosave.
   *
   * Arranging 25 people is twenty minutes of small moves, and a Save button
   * means every one of those minutes is work you can lose to a reload, a crash,
   * or simply closing the tab — which is precisely what happened before this.
   * So the board is always saved, and the only thing the officer has to know is
   * the word next to it.
   *
   * Debounced, because a drag is not a decision: bursts of moves collapse into
   * one write, and the write itself is cheap (no read-model rebuild — see
   * sqlite-repo.ts).
   */
  const [adopted, setAdopted] = React.useState(!shared);
  React.useEffect(() => {
    if (!adopted || current === persisted) return;
    const timer = setTimeout(() => {
      startTransition(async () => {
        const res = await saveBoard({
          target,
          groups: comp.groups,
          groupNames: comp.groupNames,
          bench: comp.bench,
        });
        if (res.ok) setPersisted(current);
        else setMsg(res.message);
      });
    }, 900);
    return () => clearTimeout(timer);
  }, [adopted, current, persisted, comp, target]);

  /**
   * Every change to the board goes through here, which is what makes Undo
   * complete: a code path that set `comp` directly would be a move that
   * silently couldn't be taken back.
   *
   * `coalesce` marks a run of keystrokes that should undo as one edit.
   */
  const apply = (next: Board, clearHold = true, coalesce?: string) => {
    setMsg(null);
    // A no-op move — a full group refusing a drop — must not stack an entry, or
    // Undo spends its first press doing nothing visible.
    if (boardFingerprint(next) !== current) remember(comp, coalesce);
    setComp(next);
    setOver(null);
    if (clearHold) setHeld(null);
  };

  const undo = () => {
    if (past.length === 0) return;
    setComp(past[past.length - 1].comp);
    setPast((p) => p.slice(0, -1));
    setOver(null);
    setHeld(null);
    setMsg(null);
  };

  const move = (ref: BoardSlot, to: number | "bench") => apply(place(comp, ref, to));

  /**
   * Clicking a raider does one of three things:
   *
   *  - holding somebody else, and this one is placed → the same landing
   *    `dropOnSlot` gives a drag, so click and drag never disagree;
   *  - on the bench → seated immediately (filling a raid is twenty-five clicks,
   *    not twenty-five drags);
   *  - already placed → picked up, to be put somewhere.
   */
  const pickOrSeat = (ref: BoardSlot) => {
    const spot = slotOf(comp, ref);
    if (held && slotKey(held) !== slotKey(ref) && spot) {
      apply(dropOnSlot(comp, held, spot.group, spot.index));
      return;
    }
    if (spot) {
      setHeld((h) => (h && slotKey(h) === slotKey(ref) ? null : ref));
      setMsg(null);
      return;
    }
    const next = placeInFirstOpen(comp, ref);
    if (next === comp) {
      setMsg("Every group is full — drop somebody onto a raider to swap instead.");
      return;
    }
    apply(next);
  };

  const drop = (to: number | "bench") => (e: React.DragEvent) => {
    e.preventDefault();
    // `held` is set on dragstart and carries the whole slot; the dataTransfer
    // payload exists because some browsers refuse a drop without one.
    if (held) move(held, to);
  };

  const placeHeld = (to: number | "bench") => {
    if (held) move(held, to);
  };

  /**
   * A palette click makes a *new* slot and seats it. Dragging one does the same
   * thing through the ordinary drop path, because `held` already holds the new
   * slot by then — which is why creating and moving need no separate rules.
   */
  const addFromPalette = (a: Archetype) => {
    const next = placeInFirstOpen(comp, archetypeSlot(a, newSlotId()));
    if (next === comp) {
      setMsg("Every group is full — add a group, or take one of these out first.");
      return;
    }
    apply(next);
  };

  /** Land the raider being carried on top of the one at this position. */
  const landOn = (group: number, index: number) => {
    if (!held) return;
    apply(dropOnSlot(comp, held, group, index));
  };

  const hintFor = (group: number, index: number) =>
    held && over?.group === group && over.index === index
      ? dropIntent(comp, held, group, index)
      : undefined;

  const cycleSpec = (member: PlacedMember) => {
    const choices = specChoices(member);
    if (choices.length < 2) return;
    const next = choices[(choices.indexOf(member.spec ?? "") + 1) % choices.length];
    const fallback = pool.find((m) => m.name.toLowerCase() === member.name.toLowerCase())?.spec;
    // Landing back on their own spec clears the override rather than pinning it,
    // so the board carries a marker only where an officer actually changed something.
    apply(setSlotSpec(comp, member.slot, next === fallback ? undefined : next), false);
  };

  const full = view.groups.filter((g) => g.members.length > 0).length;
  const savedState = !adopted ? "Shared" : pending ? "Saving…" : dirty ? "Unsaved" : "Saved";

  const adopt = () =>
    startTransition(async () => {
      const res = await saveBoard({
        target,
        groups: comp.groups,
        groupNames: comp.groupNames,
        bench: comp.bench,
      });
      if (!res.ok) {
        setMsg(res.message);
        return;
      }
      setPersisted(boardFingerprint(comp));
      setAdopted(true);
      setMsg("Saved as this guild's plan.");
    });

  return (
    <div className="space-y-3">
      {/*
       * One fixed row for the pool note and the holding hint. The hint used to
       * appear as its own line and shoved the whole board down the moment you
       * picked somebody up — the board has to stay still while you aim at it.
       */}
      <div className="flex h-5 items-center gap-2 overflow-hidden text-xs">
        <span className="truncate text-muted-foreground">{msg ?? note}</span>
        {held && (
          <span className="ml-auto shrink-0 font-medium text-primary">
            Holding {held.label ?? held.name} — click a group or a raider
          </span>
        )}
      </div>

      {/*
       * Every control here is always rendered — disabled rather than absent —
       * and the counts never wrap. A button that appears on the first change
       * can reflow this row onto a second line, which shoves the board down at
       * exactly the moment somebody is clicking into it.
       */}
      <div className="flex min-h-7 flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 font-medium whitespace-nowrap">
          <Users className="h-3.5 w-3.5" aria-hidden />
          {view.assigned} placed across {full} group{full === 1 ? "" : "s"}
        </span>
        <span className="whitespace-nowrap text-muted-foreground">
          {view.roles.tank} tank{view.roles.tank === 1 ? "" : "s"} · {view.roles.healer} healer
          {view.roles.healer === 1 ? "" : "s"} · {view.roles.dps} dps ·{" "}
          {view.bench.length} benched
        </span>

        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          {recovered.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              onClick={() => apply(withGroupCount(seedBoard(pool, recovered), comp))}
              title={`${recovered.length} grouping${
                recovered.length === 1 ? "" : "s"
              } the night's own logs give away — Battle Shout and jewelcrafting necks are party-scoped, so whoever had one was standing in the provider's group. Everyone else is filled in around them, for you to correct.`}
            >
              <Sparkles className="h-3.5 w-3.5" /> Suggest from log
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            onClick={() => apply(withGroupCount(seedBoard(pool), comp))}
          >
            Fill in order
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            onClick={() => apply(addGroup(comp))}
            disabled={comp.groups.length >= GROUP_COUNT}
            title="Add a group. Eight is as many as a raid frame has."
          >
            <Plus className="h-3.5 w-3.5" /> Group
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            onClick={() => apply(emptyBoard(comp.groups.length))}
            disabled={view.assigned === 0}
          >
            Clear
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            onClick={undo}
            disabled={past.length === 0}
            title={
              past.length === 0
                ? "Nothing to undo yet — this is how the board opened"
                : `Undo the last change. ${past.length} step${
                    past.length === 1 ? "" : "s"
                  } back to how the board opened, and the undone board saves itself like any other.`
            }
          >
            <RotateCcw className="h-3.5 w-3.5" /> Undo
            {/* Fixed width, so the count appearing can't reflow the row above
                the board. Blank rather than "0" when there is nothing. */}
            <span className="w-4 text-left tabular-nums opacity-60">
              {past.length > 0 ? past.length : ""}
            </span>
          </Button>
          <span
            className={cn(
              // Fixed width: "Saved" / "Unsaved" / "Saving…" are different
              // lengths, and this sits in the row above the board.
              "inline-flex w-19 items-center justify-center gap-1 rounded-full border px-2 py-0.5",
              !adopted
                ? "border-info-line bg-info-soft text-info-ink"
                : dirty || pending
                  ? "border-muted-foreground/30 text-muted-foreground"
                  : "border-success-line bg-success-soft text-success-ink",
            )}
            title={
              !adopted
                ? "A plan somebody shared with you. Nothing is saved until you adopt it, so your own board is untouched."
                : target.kind === "raid"
                  ? "Saved against this raid night, on its own — never shared with another raid or with a roster."
                  : target.kind === "roster"
                    ? "Saved as this roster, on its own — never mixed into another roster or a raid night's record."
                    : "Saved as the guild's planned shape, on its own — never mixed into a raid night's record."
            }
          >
            {savedState === "Saved" && <Check className="h-3 w-3" aria-hidden />}
            {savedState}
          </span>
          {!adopted && (
            <Button size="sm" className="h-7" onClick={adopt} disabled={pending}>
              Save as our plan
            </Button>
          )}
          {palette && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={() => {
                const url = new URL(window.location.href);
                url.searchParams.set("plan", encodePlan(comp));
                void navigator.clipboard?.writeText(url.toString());
                setMsg("Link copied — groups, names, labels and bench all travel with it.");
              }}
              disabled={view.assigned === 0 && (comp.bench?.length ?? 0) === 0}
              title="Copy a link to this exact board — the whole plan, not just who's in it"
            >
              <Link2 className="h-3.5 w-3.5" /> Share plan
            </Button>
          )}
        </span>
      </div>

      {palette && (
        <Card>
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-xs text-muted-foreground">
              Add a spec — click for a free slot, or drag one onto a group. Add the same one as
              many times as the raid needs.
            </CardTitle>
          </CardHeader>
          {/*
           * Grouped by class, icons only: nine small panels read as "the nine
           * classes" at a glance, where a flat list of twenty-seven labelled
           * buttons reads as a wall. The name lives on the hover title, and on
           * the chip once the slot is on the board.
           */}
          {/*
           * One straight line of icons per class, panels sized to their own
           * contents and flowing along the row until it runs out.
           *
           * `flex-nowrap` is the load-bearing part: Druid carries five specs
           * once the logs' own names are folded in, and letting it wrap inside
           * its own box made that one class two rows tall while the rest stayed
           * one — the class stops reading as a single block. Better that a class
           * keeps its line and the *strip* wraps between classes.
           */}
          <CardContent className="flex flex-wrap gap-2 p-3 pt-1">
            {paletteByClass(palette).map(({ wowClass, specs }) => (
              <div
                key={wowClass}
                className="flex flex-nowrap items-center gap-1 rounded-md border p-1.5"
                style={{ backgroundColor: classTint(wowClass) }}
              >
                {specs.map((a) => {
                  const icon = specIcon(a.wowClass, a.spec);
                  return (
                    <button
                      key={a.name}
                      type="button"
                      draggable
                      onDragStart={(e) => {
                        const slot = archetypeSlot(a, newSlotId());
                        e.dataTransfer.setData("text/plain", slotKey(slot));
                        e.dataTransfer.effectAllowed = "copy";
                        setHeld(slot);
                      }}
                      onDragEnd={() => {
                        setHeld(null);
                        setOver(null);
                      }}
                      onClick={() => addFromPalette(a)}
                      title={`Add a ${a.name}`}
                      // Fast and transform-only. The default `transition` runs
                      // 150ms over every animatable property; on a strip you
                      // sweep across, that reads as the icons lagging behind
                      // the cursor rather than answering it.
                      className="block cursor-pointer transition-transform duration-75 ease-out hover:scale-110"
                    >
                      {icon ? (
                        // Rendered here rather than through SpecBadge, which is
                        // fixed at the 16px a table row wants. A palette is
                        // something you aim at.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={iconUrl(icon, "medium")}
                          alt={a.name}
                          width={34}
                          height={34}
                          className="h-8.5 w-8.5 rounded border border-foreground/25"
                        />
                      ) : (
                        // No talent-tab icon for this name — same footprint, so
                        // one unknown spec can't break the grid.
                        <span
                          className="flex h-8.5 w-8.5 items-center justify-center rounded border border-foreground/25 bg-background/60 text-[9px] leading-tight font-medium"
                          style={{ color: classColor(a.wowClass) }}
                        >
                          {a.spec.slice(0, 4)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/*
       * The board. `items-start` so one card can never stretch its whole row,
       * and every card is a fixed height anyway — between them, nothing here
       * moves while raiders are being seated into it.
       */}
      <div className="grid items-start gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {view.groups.map((group) => (
          <Card
            key={group.number}
            onDragOver={(e) => e.preventDefault()}
            onDrop={drop(group.number - 1)}
            onClick={() => placeHeld(group.number - 1)}
            className={cn(
              "group/card transition-colors",
              held && group.members.length < GROUP_SIZE && "cursor-pointer border-primary/40 bg-primary/5",
            )}
          >
            <CardHeader className="p-2 pb-1">
              <CardTitle className="flex h-4 items-center gap-1 text-xs text-muted-foreground">
                {/*
                 * The name is an input, always — not a label that turns into
                 * one. A field that only appears once you've found the right
                 * pixel is a feature nobody discovers, and this way the header
                 * can't change height when it's clicked either.
                 */}
                <input
                  value={comp.groupNames?.[group.number - 1] ?? ""}
                  placeholder={`Group ${group.number}`}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    // Keyed so a whole rename undoes as one edit, not one letter
                    // at a time — see `remember`.
                    apply(
                      setGroupName(comp, group.number - 1, e.target.value),
                      false,
                      `group-name:${group.number}`,
                    )
                  }
                  className="min-w-0 flex-1 truncate bg-transparent outline-none placeholder:text-muted-foreground focus:text-foreground"
                  aria-label={`Name for group ${group.number}`}
                />
                {/*
                 * Two controls, and the difference between them is the whole
                 * point: the trash empties this group, the cross removes it.
                 * Always rendered — disabled rather than absent — so the header
                 * can't change height or width when the first raider arrives.
                 */}
                <button
                  type="button"
                  disabled={group.members.length === 0}
                  onClick={(e) => {
                    e.stopPropagation();
                    apply(clearGroup(comp, group.number - 1));
                  }}
                  title={
                    group.members.length > 0
                      ? `Empty ${groupLabel(comp, group.number - 1)} — the ${
                          group.members.length
                        } in it go to the bench, the group stays`
                      : `${groupLabel(comp, group.number - 1)} is already empty`
                  }
                  className="shrink-0 cursor-pointer opacity-0 transition-opacity duration-75 group-hover/card:opacity-60 hover:opacity-100 disabled:cursor-default disabled:opacity-0"
                >
                  <Trash2 className="h-3 w-3" aria-hidden />
                </button>
                <span className={cn("font-normal", group.members.length === 0 && "opacity-40")}>
                  {group.members.length}/{GROUP_SIZE}
                </span>
                {view.groups.length > 1 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      apply(removeGroup(comp, group.number - 1));
                    }}
                    title={
                      group.members.length > 0
                        ? `Delete ${groupLabel(comp, group.number - 1)} and all ${
                            group.members.length
                          } in it${palette ? "" : " — they go back to the bench"}`
                        : `Delete ${groupLabel(comp, group.number - 1)}`
                    }
                    className="shrink-0 cursor-pointer opacity-0 transition-opacity duration-75 group-hover/card:opacity-60 hover:text-destructive hover:opacity-100"
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 p-2 pt-0">
              {Array.from({ length: GROUP_SIZE }, (_, slot) => {
                const member = group.members[slot];
                return member ? (
                  <MemberChip
                    key={slotKey(member.slot)}
                    member={member}
                    held={held !== null && slotKey(held) === slotKey(member.slot)}
                    onPick={() => pickOrSeat(member.slot)}
                    onBench={() => move(member.slot, "bench")}
                    onRemove={palette && (() => apply(removeSlot(comp, member.slot)))}
                    onDragEnd={() => {
                      setHeld(null);
                      setOver(null);
                    }}
                    onCycleSpec={() => cycleSpec(member)}
                    // Crosses the group line at the edges — see `nudge`.
                    onMove={(direction) => apply(nudge(comp, member.slot, direction), false)}
                    onLandOn={() => landOn(group.number - 1, member.index)}
                    onHover={(isOver) =>
                      setOver(isOver ? { group: group.number - 1, index: member.index } : null)
                    }
                    hint={hintFor(group.number - 1, member.index)}
                    onRename={
                      palette &&
                      ((label) => {
                        apply(setSlotLabel(comp, member.slot, label), false);
                        setRenaming(null);
                      })
                    }
                    onStartRename={() => setRenaming(slotKey(member.slot))}
                    renaming={renaming === slotKey(member.slot)}
                  />
                ) : (
                  <div
                    key={`empty-${slot}`}
                    className={cn(
                      SLOT_HEIGHT,
                      "rounded border border-dashed border-muted-foreground/20",
                    )}
                  />
                );
              })}
              <GroupBuffPanel coverage={group.coverage} />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Bench */}
      <Card
        onDragOver={(e) => e.preventDefault()}
        onDrop={drop("bench")}
        onClick={() => placeHeld("bench")}
        // Extra separation from the board: the bench is where the click storm
        // happens, and a little air between it and the groups means an
        // overshoot lands on nothing rather than on somebody's slot.
        className={cn("mt-2", held && "cursor-pointer border-primary/40 bg-primary/5")}
      >
        <CardHeader>
          <CardTitle className="flex h-4 items-center overflow-hidden whitespace-nowrap">
            Bench
            <span className="ml-1 font-normal text-muted-foreground">
              — {view.bench.length} not placed. Click one to seat them in the first free slot
              {palette ? ", or ✕ to delete it." : "."}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="min-h-9 space-y-2">
          {view.bench.length === 0 ? (
            <p className="text-xs text-muted-foreground">Everyone in the pool has a group.</p>
          ) : (
            /*
             * Sections when the bench has something to split on, one flat run
             * when it hasn't — a raid night's pool is log actors with no roster
             * status, so it comes back as a single unlabelled section and looks
             * exactly as it did. See `benchSections`.
             */
            benchSections(view.bench).map((section) => (
              <div key={section.key} className="space-y-1">
                {section.label && (
                  <p className="text-[11px] font-medium text-muted-foreground">
                    {section.label}
                    <span className="ml-1 font-normal opacity-70">{section.members.length}</span>
                  </p>
                )}
                <div className="flex flex-wrap gap-1">
                  {section.members.map((member) => (
                    <MemberChip
                      key={slotKey(member.slot)}
                      member={member}
                      held={held !== null && slotKey(held) === slotKey(member.slot)}
                      onPick={() => pickOrSeat(member.slot)}
                      onDragEnd={() => {
                        setHeld(null);
                        setOver(null);
                      }}
                      onRemove={palette && (() => apply(removeSlot(comp, member.slot)))}
                      onRename={palette && ((label) => {
                        apply(setSlotLabel(comp, member.slot, label), false);
                        setRenaming(null);
                      })}
                      onStartRename={() => setRenaming(slotKey(member.slot))}
                      renaming={renaming === slotKey(member.slot)}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {view.unknown.length > 0 && (
        <p className="rounded-md border border-warn-line bg-warn-soft p-2 text-xs text-warn-ink">
          {view.unknown.join(", ")} {view.unknown.length === 1 ? "is" : "are"} in this board
          but not in the pool — deleted from the roster, or placed from another night. They stay on
          the board until you move them off.
        </p>
      )}

      <RaidBuffPanel view={view} />
      <PartyBuffMatrix view={view} />
    </div>
  );
}
