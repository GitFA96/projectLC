import {
  PARTY_BUFFS,
  RAID_BUFFS,
  type BuffScope,
  type RaidBuff,
} from "@/lib/constants/raid-buffs";
import { CLASS_SPECS, WOW_CLASSES, type WowClass } from "@/lib/constants/wow";
import type { WclPlayerFight, WclRole } from "@/lib/types";

import { compareText } from "@/lib/sort";

/**
 * Raid board: who stands in which group, and what that buys.
 *
 * Two questions, one model:
 *
 *  - **Planning.** Given 25 raiders and eight groups, which party buffs does
 *    each group actually get? TBC pays for grouping — Windfury and Bloodlust and
 *    Vampiric Touch stop at the party line — and no other page in this app can
 *    tell an officer they have put both shadow priests with the melee.
 *  - **Recording.** A raid night already happened. Warcraft Logs does not store
 *    group assignments, so the board of a past raid is something an officer
 *    writes down, seeded with the names the log proves were there.
 *
 * ## One board per thing, and nothing shared
 *
 * A board belongs to whatever it was written for. Two nights that fielded the
 * same 25 people are still two arrangements, because somebody swapped groups
 * between them, and a board that followed the roster around would quietly
 * rewrite history the first time anyone re-planned. So each has its own key —
 * `raid_board:<code>` for a night, `guild_roster:<id>` for one of the guild's
 * named rosters, `template_board` for the anonymous shape — and switching
 * between them never carries an arrangement across.
 *
 * ## Three coverage states, not two
 *
 * A buff is `covered`, `missing`, or **`conditional`** — someone of the right
 * class is in the group, but the spec or talent it needs was never confirmed.
 * That third state is the honest one and it is most of the interesting cases:
 * Warcraft Logs labels a spec per pull and leaves plenty blank, our roster's
 * spec is whatever an officer last typed, and neither knows whether that druid
 * specced Leader of the Pack. Collapsing `conditional` into `covered` invents an
 * aura; collapsing it into `missing` tells an officer to move somebody who was
 * already fine. See AGENTS.md invariant 4.
 *
 * Pure — read model in, view model out.
 */

export const GROUP_COUNT = 8;
export const GROUP_SIZE = 5;

/** One raider available to a board, however the caller identified them. */
export interface PoolMember {
  /** The name a slot holds — a character name, or the actor name from a log. */
  name: string;
  /** Character slug when this is a roster character (drives the profile link). */
  slug?: string;
  /** WCL's class string, or the roster's — never forced into an enum here. */
  wowClass?: string;
  spec?: string;
  role?: WclRole;
  /** Boss pulls they were in, when this pool came from a raid night. */
  pulls?: number;
  /**
   * Every spec an officer may count this raider as, their default first.
   *
   * A raider is not one spec. The roster records a main and an off-spec because
   * the shadow priest heals progression; a night's log records whatever they
   * actually played, which is sometimes both. Which one they were *in this
   * board* changes what the group got — a Restoration druid brings no
   * Leader of the Pack — so it is a property of the board, not of the person.
   *
   * Fewer than two entries means there is no choice to offer.
   */
  specOptions?: string[];
  /**
   * Buff ids this raider is logged as having *personally* provided that night
   * (`buffsProvidedBy`). Evidence travels with the raider rather than with the
   * board, because the board moves: drag a shaman into another group and his
   * Bloodlust goes with him, which a per-group set of observations could not
   * express.
   *
   * Empty (or absent) never means "they didn't" — see `buffsProvidedBy`.
   */
  broughtBuffs?: string[];
  /**
   * Somebody who isn't on the roster, invented on a guild roster to see whether
   * they'd fix anything. Marked so the board can say so: a plan that reads as
   * complete because two of the healers don't exist yet is worse than no plan.
   */
  prospect?: boolean;
  /**
   * "main" or "alt", for a pool built from the roster.
   *
   * The bench splits on it, because those are three different conversations:
   * who's raiding, who's bringing a second character, and who doesn't exist
   * yet. Absent on a raid night's pool — a log records an actor, not a roster
   * status — which is what collapses the bench back to one list there.
   */
  rosterStatus?: string;
}

/**
 * One place on the board.
 *
 * The name is the identity — so a board survives a character being
 * renamed or deleted, degrading into a name the pool no longer offers (which
 * reads correctly as "they weren't on this roster") rather than into a dangling
 * id. `spec` is the officer's answer to "which of their specs were they, here",
 * and only ever set when they chose something other than the default.
 */
export interface BoardSlot {
  name: string;
  spec?: string;
  /**
   * Identity, when the name isn't one.
   *
   * A raid night's board is people, and a person can only stand in one place —
   * so there the name *is* the identity and this stays absent. A planning
   * template is class-and-spec archetypes, and a raid wants three Restoration
   * Druids, which means each slot needs to be told apart from its twins.
   *
   * Everything that moves a slot keys on `slotKey`, so both work through the
   * same tested code and a board saved before this existed still reads.
   */
  id?: string;
  /** The officer's own name for the slot — "Feral" filed as "OT Bear". */
  label?: string;
}

/** What identifies a slot: its id when it has one, else its name. */
export const slotKey = (slot: BoardSlot): string => slot.id ?? slot.name.toLowerCase();

/** Who stands where. Groups are positional — index 0 is Group 1. */
export interface Board {
  groups: BoardSlot[][];
  /**
   * The officer's names for groups, positional. Absent (or a blank entry) means
   * "Group N". Only the template offers renaming; a raid night's groups are
   * numbered because that's what the raid frames said.
   */
  groupNames?: (string | undefined)[];
  /**
   * Slots set aside, for boards whose bench isn't derivable.
   *
   * A raid night's bench is "everyone the log saw, minus everyone placed", so
   * it needs no storing. A planning board's slots exist only because an officer
   * created them, so a benched one has nowhere else to be remembered — leave
   * this absent and the raid night's derived bench keeps working exactly as it
   * did.
   */
  bench?: BoardSlot[];
}

export const emptyBoard = (groups: number = GROUP_COUNT): Board => ({
  groups: Array.from({ length: clampGroupCount(groups) }, () => []),
});

/** Boards run from one group to eight — a raid frame has no more room than that. */
const clampGroupCount = (n: number): number =>
  Math.min(Math.max(Math.round(Number.isFinite(n) ? n : GROUP_COUNT), 1), GROUP_COUNT);

/** What a group is called: the officer's name for it, or its number. */
export const groupLabel = (comp: Board, index: number): string =>
  comp.groupNames?.[index]?.trim() || `Group ${index + 1}`;

export const isEmptyBoard = (comp: Board): boolean =>
  comp.groups.every((g) => g.length === 0);

/**
 * Force any stored, linked or hand-edited blob into a legal board: eight groups
 * of at most five, no blanks, nobody in two places.
 *
 * Accepts a bare name as well as a slot object, because boards saved before
 * spec overrides existed hold plain strings — and a stored board is the user's
 * record of a real raid night, so it has to keep reading forever. A saved board
 * can also outlive the roster it was built from, so this never drops a name for
 * being unknown, only for being malformed or duplicated.
 */
export function sanitizeBoard(
  raw: unknown,
  /**
   * How many groups the board has. Omitted keeps the eight a raid night always
   * has — every existing caller and every stored board depends on that, so the
   * variable count is strictly opt-in for the template.
   */
  opts: { groups?: number } = {},
): Board {
  const source = (raw as { groups?: unknown })?.groups;
  const count = clampGroupCount(opts.groups ?? GROUP_COUNT);
  const out = emptyBoard(count);
  if (!Array.isArray(source)) return out;

  const seen = new Set<string>();
  for (let g = 0; g < count; g++) {
    const group = source[g];
    if (!Array.isArray(group)) continue;
    for (const entry of group) {
      const slot = toSlot(entry);
      if (!slot) continue;
      const key = slotKey(slot);
      if (seen.has(key)) continue;
      if (out.groups[g].length >= GROUP_SIZE) break;
      seen.add(key);
      out.groups[g].push(slot);
    }
  }

  // A stored bench, for boards that keep one. Same dedupe pool as the groups —
  // a slot cannot be both benched and standing somewhere.
  const benched = (raw as { bench?: unknown })?.bench;
  if (Array.isArray(benched)) {
    const bench: BoardSlot[] = [];
    for (const entry of benched) {
      const slot = toSlot(entry);
      if (!slot) continue;
      const key = slotKey(slot);
      if (seen.has(key)) continue;
      seen.add(key);
      bench.push(slot);
    }
    if (bench.length > 0) out.bench = bench;
    else if (benched.length === 0) out.bench = [];
  }

  const names = (raw as { groupNames?: unknown })?.groupNames;
  if (Array.isArray(names)) {
    const cleaned = Array.from({ length: count }, (_, i) => {
      const value = names[i];
      return typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, 40) : undefined;
    });
    if (cleaned.some(Boolean)) out.groupNames = cleaned;
  }
  return out;
}

const text = (value: unknown, max: number): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, max) : undefined;

function toSlot(entry: unknown): BoardSlot | undefined {
  if (typeof entry === "string") {
    const name = entry.trim();
    return name === "" ? undefined : { name };
  }
  if (entry === null || typeof entry !== "object") return undefined;
  const { name, spec, id, label } = entry as Record<string, unknown>;
  const cleanName = text(name, 60);
  if (!cleanName) return undefined;
  const slot: BoardSlot = { name: cleanName };
  const cleanSpec = text(spec, 60);
  const cleanId = text(id, 60);
  const cleanLabel = text(label, 40);
  if (cleanSpec) slot.spec = cleanSpec;
  if (cleanId) slot.id = cleanId;
  if (cleanLabel) slot.label = cleanLabel;
  return slot;
}

/** Every name placed in a group, in board order. */
const assignedNames = (comp: Board): string[] =>
  comp.groups.flat().map((s) => s.name);

/**
 * Everything about a board, as one string — the "has this changed" test.
 *
 * Deliberately not `encodePlan`, which is the share format and drops slot ids.
 * Autosave keys on this, and a hash that ignored group names, labels or the
 * bench would leave an officer renaming a group and watching "Saved" never move.
 */
export const boardFingerprint = (comp: Board): string =>
  JSON.stringify([
    comp.groups.map((g) => g.map((s) => [s.id ?? "", s.name, s.spec ?? "", s.label ?? ""])),
    comp.groupNames?.map((n) => n ?? "") ?? [],
    comp.bench?.map((s) => [s.id ?? "", s.name, s.spec ?? "", s.label ?? ""]) ?? null,
  ]);

/*
 * A whole board as one shareable token — the only board format that goes in a
 * URL, and the reason every other selection in this app lives in the URL too.
 *
 * The payload is the board itself, minified and base64url'd, so nothing is
 * lost: group names, slot labels and the bench all travel. Slot ids are dropped
 * rather than transmitted — they only ever have to be distinct *within* one
 * board, so the reader mints fresh ones by position and two people opening the
 * same link get boards that behave identically without either inheriting the
 * other's private keys.
 */

type PackedSlot = [name: string, spec?: string, label?: string];
type PackedPlan = { g: PackedSlot[][]; n?: string[]; b?: PackedSlot[] };

const packSlot = (s: BoardSlot): PackedSlot =>
  s.label ? [s.name, s.spec ?? "", s.label] : s.spec ? [s.name, s.spec] : [s.name];

const unpackSlot = (p: unknown, id: string): BoardSlot | undefined => {
  if (!Array.isArray(p) || typeof p[0] !== "string") return undefined;
  const slot: BoardSlot = { name: p[0], id };
  if (typeof p[1] === "string" && p[1] !== "") slot.spec = p[1];
  if (typeof p[2] === "string" && p[2] !== "") slot.label = p[2];
  return slot;
};

const toBase64Url = (s: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const fromBase64Url = (s: string) => {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  return new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)));
};

/** A board as a URL-safe token. Empty string when there is nothing to share. */
export function encodePlan(comp: Board): string {
  const packed: PackedPlan = { g: comp.groups.map((g) => g.map(packSlot)) };
  if (comp.groupNames?.some(Boolean)) packed.n = comp.groupNames.map((n) => n ?? "");
  if (comp.bench?.length) packed.b = comp.bench.map(packSlot);
  try {
    return toBase64Url(JSON.stringify(packed));
  } catch {
    return "";
  }
}

/** Read a shared board back. Anything malformed reads as "no plan", never a throw. */
export function decodePlan(token: string | undefined | null): Board | undefined {
  if (!token) return undefined;
  try {
    const packed = JSON.parse(fromBase64Url(token)) as PackedPlan;
    if (!Array.isArray(packed?.g) || packed.g.length === 0) return undefined;
    const groups = packed.g.map((group, gi) =>
      (Array.isArray(group) ? group : [])
        .map((s, si) => unpackSlot(s, `g${gi}s${si}`))
        .filter((s): s is BoardSlot => s !== undefined),
    );
    const bench = (Array.isArray(packed.b) ? packed.b : [])
      .map((s, i) => unpackSlot(s, `b${i}`))
      .filter((s): s is BoardSlot => s !== undefined);
    return sanitizeBoard(
      { groups, groupNames: packed.n, bench },
      { groups: groups.length },
    );
  } catch {
    return undefined;
  }
}

/** Pool members nobody put in a group — the bench. */
export function benchOf(comp: Board, pool: readonly PoolMember[]): PoolMember[] {
  const placed = new Set(assignedNames(comp).map((n) => n.toLowerCase()));
  return pool.filter((m) => !placed.has(m.name.toLowerCase()));
}

/**
 * Names in a group that the pool doesn't know — someone deleted from the roster,
 * or a board pasted from another night. Kept visible rather than dropped:
 * a slot that silently empties is a slot nobody notices is wrong.
 */
export function unknownNames(comp: Board, pool: readonly PoolMember[]): string[] {
  const known = new Set(pool.map((m) => m.name.toLowerCase()));
  return assignedNames(comp).filter((n) => !known.has(n.toLowerCase()));
}

/* ------------------------------------------------------------ moving people */

/**
 * Everything that moves a slot takes either the slot itself or, for the common
 * case of a board keyed by person, just a name.
 *
 * The name form is what a raid night uses and what every one of these functions
 * was originally written for; the slot form is what the template needs, so that
 * three identical Restoration Druids stay three distinct slots. One code path
 * either way — the alternative was a parallel set of move functions, and these
 * rules are far too fiddly to be worth having two of.
 */
export type SlotRef = BoardSlot | string;

const asSlot = (ref: SlotRef): BoardSlot => (typeof ref === "string" ? { name: ref } : ref);
const keyOf = (ref: SlotRef): string => slotKey(asSlot(ref));

const without = (comp: Board, ref: SlotRef): Board => {
  const key = keyOf(ref);
  return {
    ...comp,
    groups: comp.groups.map((g) => g.filter((s) => slotKey(s) !== key)),
    bench: comp.bench?.filter((s) => slotKey(s) !== key),
  };
};

/** The slot holding a raider, if any — with the group they're standing in. */
export function slotOf(
  comp: Board,
  ref: SlotRef,
): { group: number; index: number; slot: BoardSlot } | undefined {
  const key = keyOf(ref);
  for (const [group, slots] of comp.groups.entries()) {
    const index = slots.findIndex((s) => slotKey(s) === key);
    if (index >= 0) return { group, index, slot: slots[index] };
  }
  return undefined;
}

/** A slot sitting on a stored bench, if this board keeps one. */
function benchSlotOf(comp: Board, ref: SlotRef): BoardSlot | undefined {
  const key = keyOf(ref);
  return comp.bench?.find((s) => slotKey(s) === key);
}

/** The lowest-numbered group with room, or undefined when the board is full. */
function firstOpenGroup(comp: Board): number | undefined {
  const index = comp.groups.findIndex((g) => g.length < GROUP_SIZE);
  return index < 0 ? undefined : index;
}

/**
 * Put a raider in a group (or on the bench), keeping any spec override they
 * already carried. A full target group is a no-op rather than an error: the
 * board should refuse the drop, not lose the raider.
 */
export function place(comp: Board, ref: SlotRef, to: number | "bench"): Board {
  const existing = slotOf(comp, ref)?.slot ?? benchSlotOf(comp, ref);
  const stripped = without(comp, ref);
  if (to === "bench") {
    // A derived bench needs nothing doing; a stored one has to actually hold them.
    return comp.bench ? { ...stripped, bench: [...(stripped.bench ?? []), existing ?? asSlot(ref)] } : stripped;
  }
  if (to < 0 || to >= comp.groups.length || stripped.groups[to].length >= GROUP_SIZE) return comp;
  return {
    ...stripped,
    groups: stripped.groups.map((g, i) => (i === to ? [...g, existing ?? asSlot(ref)] : g)),
  };
}

/* ----------------------------------------------------------- editing groups */

/**
 * Rename a group. Blank hands it back to "Group N".
 *
 * **Does not trim.** This runs on every keystroke of a controlled input, and
 * trimming here means the space between two words is eaten the instant it is
 * typed — "Melee" can never become "Melee two". Whitespace is dealt with where
 * it matters instead: `groupLabel` trims for display, and
 * `sanitizeBoard` trims on the way to storage, so nothing padded is ever
 * saved.
 */
export function setGroupName(comp: Board, index: number, name: string | undefined): Board {
  if (index < 0 || index >= comp.groups.length) return comp;
  const clean = name?.slice(0, 40);
  const groupNames = Array.from({ length: comp.groups.length }, (_, i) =>
    i === index ? clean || undefined : comp.groupNames?.[i],
  );
  return { ...comp, groupNames: groupNames.some(Boolean) ? groupNames : undefined };
}

/** Add an empty group. A board never grows past eight. */
export function addGroup(comp: Board): Board {
  if (comp.groups.length >= GROUP_COUNT) return comp;
  return {
    ...comp,
    groups: [...comp.groups, []],
    groupNames: comp.groupNames ? [...comp.groupNames, undefined] : undefined,
  };
}

/**
 * Remove a group, and everyone standing in it.
 *
 * On a planning board that really is a delete — those slots were created and
 * now they're gone. On a raid night nothing can be destroyed, because the pool
 * comes from the log: the raiders simply stop being placed and reappear on the
 * derived bench. Same call, and in both cases "Revert" is the way back.
 *
 * The last group can't be removed; a board with no groups isn't a board.
 */
export function removeGroup(comp: Board, index: number): Board {
  if (comp.groups.length <= 1 || index < 0 || index >= comp.groups.length) return comp;
  return {
    ...comp,
    groups: comp.groups.filter((_, i) => i !== index),
    groupNames: comp.groupNames?.filter((_, i) => i !== index),
  };
}

/**
 * Empty a group, keeping the group.
 *
 * The non-destructive half of the pair it sits next to. Everyone in it is
 * benched and the group itself — its name, its place in the order — survives,
 * which is what an officer wants when they're redoing one party rather than
 * dropping one. On a planning board the occupants land on the stored bench
 * rather than being destroyed, exactly as the chip's own bench button does; on
 * a raid night they reappear on the derived bench, as they would from anywhere.
 */
export function clearGroup(comp: Board, index: number): Board {
  if (index < 0 || index >= comp.groups.length) return comp;
  return comp.groups[index].reduce((acc, slot) => place(acc, slot, "bench"), comp);
}

/**
 * Take a slot off the board entirely, bench included.
 *
 * Only meaningful where slots are *created* — the template's archetypes. A raid
 * night's raiders can be benched but never deleted, because the log says they
 * were there.
 */
export const removeSlot = (comp: Board, ref: SlotRef): Board => without(comp, ref);

/** Put a benched raider in the first group with room. No room = unchanged. */
export function placeInFirstOpen(comp: Board, ref: SlotRef): Board {
  const target = firstOpenGroup(without(comp, ref));
  return target === undefined ? comp : place(comp, ref, target);
}

/**
 * Drop one raider onto another, and let the group make room.
 *
 * Two behaviours, picked by whether the target group has a free slot — which is
 * the one thing that decides whether anybody has to leave:
 *
 *  - **Room to spare: insert.** The mover takes the position hovered over and
 *    everyone from there down shuffles one place along — drop on position 1 and
 *    1 becomes 2, 2 becomes 3. Nobody is displaced, because nobody has to be.
 *  - **Group full: swap.** The only way into a full group is for somebody to
 *    come out, so the raider hovered over takes the mover's old place — or the
 *    bench, when the mover came from there. A swap is the honest reading of
 *    "put him here" when "here" is occupied and there is nowhere else to go.
 *
 * Reordering inside one group is always an insert, whichever way it goes: that
 * is what makes dragging up a list feel like a list rather than a series of
 * pairwise swaps.
 */
export function dropOnSlot(
  comp: Board,
  ref: SlotRef,
  group: number,
  index: number,
): Board {
  if (group < 0 || group >= comp.groups.length) return comp;
  const target = comp.groups[group];
  if (!target) return comp;

  const key = keyOf(ref);
  const occupant = target[index];
  // An empty slot isn't a landing site of its own — the group takes them.
  if (!occupant) return place(comp, ref, group);
  if (slotKey(occupant) === key) return comp;

  const from = slotOf(comp, ref);
  if (from && from.group === group) return moveWithinGroup(comp, group, from.index, index);

  const moving = from?.slot ?? asSlot(ref);

  if (target.length < GROUP_SIZE) {
    const groups = comp.groups.map((g, i) =>
      i === group ? [...g] : g.filter((s) => slotKey(s) !== key),
    );
    groups[group].splice(index, 0, moving);
    return { ...comp, groups };
  }

  const groups = comp.groups.map((g) => [...g]);
  groups[group][index] = moving;
  // No `from` means they came off the bench, and the occupant goes back to it —
  // already true, since the line above is the only copy of them.
  if (from) groups[from.group][from.index] = occupant;
  return { ...comp, groups };
}

/**
 * Which of the two `dropOnSlot` behaviours a drop would take, for the board to
 * show *before* the officer lets go. Getting a swap when you expected an insert
 * moves two people instead of one, and on a 25-man board that is a mistake you
 * notice three drags later.
 */
export function dropIntent(
  comp: Board,
  ref: SlotRef,
  group: number,
  index: number,
): "insert" | "swap" | "none" {
  const target = comp.groups[group];
  const occupant = target?.[index];
  if (!occupant) return "none";
  if (slotKey(occupant) === keyOf(ref)) return "none";
  const from = slotOf(comp, ref);
  if (from && from.group === group) return "insert";
  return target.length < GROUP_SIZE ? "insert" : "swap";
}

/**
 * Reorder inside a group. Position matters to officers even where the game
 * doesn't care — the tank leads the group, the healer sits under them — and a
 * board you can't order is a board that stops matching the raid frames.
 */
export function moveWithinGroup(
  comp: Board,
  group: number,
  from: number,
  to: number,
): Board {
  const slots = comp.groups[group];
  if (!slots || from === to) return comp;
  if (from < 0 || from >= slots.length || to < 0 || to >= slots.length) return comp;
  const next = [...slots];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return { ...comp, groups: comp.groups.map((g, i) => (i === group ? next : g)) };
}

/**
 * Move a raider one place up or down the board — across the group line, not
 * just inside it.
 *
 * A board reads as one column of groups, so "down" from the bottom of group 1
 * means the top of group 2, and the arrows have to agree with that or they
 * quietly stop working exactly where an officer needs them. Crossing a line
 * lands the same way a drop does: slide in when there is room, swap when the
 * group is full. Which makes the arrows a keyboard-reachable version of the
 * drag, rather than a second set of rules to learn.
 *
 * Up lands at the *end* of the group above and down at the *start* of the one
 * below, because that is where they are on the page — anything else teleports
 * them past the raider they were trying to trade with.
 */
export function nudge(comp: Board, ref: SlotRef, direction: -1 | 1): Board {
  const from = slotOf(comp, ref);
  if (!from) return comp;

  const within = from.index + direction;
  const group = comp.groups[from.group];
  if (within >= 0 && within < group.length) {
    return moveWithinGroup(comp, from.group, from.index, within);
  }

  const target = from.group + direction;
  if (target < 0 || target >= comp.groups.length) return comp;
  const into = comp.groups[target];
  // Past the end when there's room, so `dropOnSlot` appends rather than
  // insisting on landing on somebody.
  const index = direction === 1 ? 0 : into.length < GROUP_SIZE ? into.length : into.length - 1;
  return dropOnSlot(comp, from.slot, target, Math.max(index, 0));
}

/**
 * Count a raider as a given spec on this board. `undefined` hands them back to
 * whatever their pool entry says, which is how "reset to default" is expressed.
 */
export function setSlotSpec(comp: Board, ref: SlotRef, spec: string | undefined): Board {
  return editSlot(comp, ref, (slot) => {
    const next = { ...slot };
    if (spec === undefined) delete next.spec;
    else next.spec = spec;
    return next;
  });
}

/** The officer's own name for a slot; blank hands it back to its spec's name. */
export function setSlotLabel(comp: Board, ref: SlotRef, label: string | undefined): Board {
  const clean = label?.trim().slice(0, 40);
  return editSlot(comp, ref, (slot) => {
    const next = { ...slot };
    if (clean) next.label = clean;
    else delete next.label;
    return next;
  });
}

function editSlot(
  comp: Board,
  ref: SlotRef,
  edit: (slot: BoardSlot) => BoardSlot,
): Board {
  const key = keyOf(ref);
  return {
    ...comp,
    groups: comp.groups.map((g) => g.map((s) => (slotKey(s) === key ? edit(s) : s))),
    bench: comp.bench?.map((s) => (slotKey(s) === key ? edit(s) : s)),
  };
}

/* ------------------------------------------------------------------ specs */

/** WCL's spec strings vary in spacing and casing; ours come from a form. */
const normSpec = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/**
 * Does this raider satisfy the source's spec requirement?
 *
 * `undefined` means "cannot tell" — the source names specs and the raider's spec
 * is unknown to us. That is what produces a `conditional` row instead of a
 * confident answer either way.
 */
function meetsSpec(source: RaidBuff["sources"][number], member: PoolMember): boolean | undefined {
  if (!source.specs || source.specs.length === 0) return true;
  if (!member.spec) return undefined;
  const want = source.specs.map(normSpec);
  return want.includes(normSpec(member.spec));
}

export type CoverageState = "covered" | "conditional" | "missing";

/**
 * Coverage carries whichever member type it was computed from.
 *
 * A board's coverage holds `PlacedMember`s, and the UI needs that: a template's
 * slots are archetypes, so three Restoration Shamans share one `name` and only
 * `slotKey(slot)` tells them apart. Widening these to `PoolMember` here would
 * throw that identity away before the list ever gets rendered.
 */
export interface BuffCoverage<M extends PoolMember = PoolMember> {
  buff: RaidBuff;
  state: CoverageState;
  /** Raiders who bring it — spec confirmed, or the log caught them doing it. */
  providers: M[];
  /**
   * Raiders who *could* bring it and haven't been confirmed doing so — either
   * their spec was never recorded, or the buff competes with others they bring
   * instead (`exclusiveWith`). They may well bring it; the app refuses to claim
   * so.
   */
  possible: M[];
  /** Providers the log actually caught doing it — the evidence, not the prediction. */
  evidenced: M[];
}

/**
 * Coverage of one buff by a set of raiders.
 *
 * Evidence outranks prediction in one direction only. A raider the log caught
 * providing a buff counts even when their class or spec says they shouldn't —
 * that is how a jewelcrafting neck, which no roster can predict, gets counted,
 * and how a druid with no recorded spec stops being merely "conditional" the
 * moment the log shows him keeping the buff up.
 *
 * It never subtracts. Somebody who *can* bring a buff and didn't press it on
 * the pulls we have is a coaching question the logs page already answers; here
 * it would read as "this group has no Battle Shout", which is false.
 *
 * A buff its provider has to *choose* (`exclusiveWith`) is never covered by
 * prediction alone. One shaman is one totem per element, not eight totems, and
 * a tool that added them all up would be wrong in the direction that flatters —
 * the worst direction for something an officer plans a raid on.
 */
export function coverageOf<M extends PoolMember>(
  buff: RaidBuff,
  members: readonly M[],
): BuffCoverage<M> {
  const providers: M[] = [];
  const possible: M[] = [];
  const evidenced: M[] = [];

  for (const member of members) {
    if (member.broughtBuffs?.includes(buff.id)) {
      providers.push(member);
      evidenced.push(member);
      continue;
    }
    if (!member.wowClass) continue;
    const source = buff.sources.find((s) => s.wowClass === member.wowClass);
    if (!source) continue;
    const ok = meetsSpec(source, member);
    if (ok === false) continue;
    if (ok === true && !buff.exclusiveWith) providers.push(member);
    else possible.push(member);
  }

  const state: CoverageState =
    providers.length > 0 ? "covered" : possible.length > 0 ? "conditional" : "missing";

  return { buff, state, providers, possible, evidenced };
}

/** A raider on the board: their pool entry, as this board counts them. */
export interface PlacedMember extends PoolMember {
  /** Where they sit in the group, 0-based — what the reorder controls move. */
  index: number;
  /** An officer counted them as a spec other than their default. */
  specOverridden: boolean;
  /** The slot behind them — what every move function is addressed with. */
  slot: BoardSlot;
  /** The officer's own name for this slot, when they gave it one. */
  label?: string;
}

export interface GroupView {
  /** 1-based, as an officer says it. */
  number: number;
  members: PlacedMember[];
  /** Party buffs only — the ones grouping decides. */
  coverage: BuffCoverage<PlacedMember>[];
  covered: number;
}

export interface BoardView {
  groups: GroupView[];
  bench: PlacedMember[];
  unknown: string[];
  /** Raid-wide and on-the-boss buffs, across everyone assigned. */
  raid: BuffCoverage<PlacedMember>[];
  /** Assigned raiders by role — the "do we have four healers" line. */
  roles: Record<WclRole, number>;
  /** Assigned raiders by class, most first. */
  classes: { wowClass: string; count: number }[];
  assigned: number;
}

const scopeOrder: Record<BuffScope, number> = { party: 0, raid: 1, target: 2 };

/** The whole board, evaluated. */
export function boardView(
  comp: Board,
  pool: readonly PoolMember[],
): BoardView {
  const byName = new Map(pool.map((m) => [m.name.toLowerCase(), m]));

  const resolve = (slot: BoardSlot, index: number): PlacedMember => {
    const member = byName.get(slot.name.toLowerCase()) ?? { name: slot.name };
    // An override only counts as one when it actually differs — a slot pinned
    // to the spec the raider already is should not wear a "changed" marker.
    const overridden = slot.spec !== undefined && slot.spec !== member.spec;
    return {
      ...member,
      spec: slot.spec ?? member.spec,
      index,
      specOverridden: overridden,
      slot,
      ...(slot.label ? { label: slot.label } : {}),
    };
  };

  const groups: GroupView[] = comp.groups.map((slots, index) => {
    const members = slots.map(resolve);
    const coverage = PARTY_BUFFS.map((b) => coverageOf(b, members));
    return {
      number: index + 1,
      members,
      coverage,
      covered: coverage.filter((c) => c.state === "covered").length,
    };
  });

  const assigned = groups.flatMap((g) => g.members);
  const raid = RAID_BUFFS.filter((b) => b.scope !== "party")
    .map((b) => coverageOf(b, assigned))
    .sort(
      (a, b) =>
        scopeOrder[a.buff.scope] - scopeOrder[b.buff.scope] ||
        compareText(a.buff.category, b.buff.category) ||
        compareText(a.buff.name, b.buff.name),
    );

  const roles: Record<WclRole, number> = { tank: 0, healer: 0, dps: 0 };
  const classCounts = new Map<string, number>();
  for (const m of assigned) {
    if (m.role) roles[m.role] += 1;
    if (m.wowClass) classCounts.set(m.wowClass, (classCounts.get(m.wowClass) ?? 0) + 1);
  }

  return {
    groups,
    /*
     * A stored bench holds actual slots and is authoritative; a derived one is
     * "everyone in the pool nobody placed". A planning board has to use the
     * first — its palette is an infinite supply, so "unplaced palette entries"
     * would list every archetype in the game as benched.
     */
    bench: comp.bench
      ? comp.bench.map(resolve)
      : benchOf(comp, pool).map((m, index) => ({
          ...m,
          index,
          specOverridden: false,
          slot: { name: m.name },
        })),
    unknown: unknownNames(comp, pool),
    raid,
    roles,
    classes: [...classCounts]
      .map(([wowClass, count]) => ({ wowClass, count }))
      .sort((a, b) => b.count - a.count || compareText(a.wowClass, b.wowClass)),
    assigned: assigned.length,
  };
}

/** One labelled run of the bench. `key: "all"` means it wasn't worth splitting. */
export interface BenchSection {
  key: "main" | "alt" | "trial" | "other" | "all";
  label: string;
  members: PlacedMember[];
}

const BENCH_SECTIONS: { key: "main" | "alt" | "trial" | "other"; label: string }[] = [
  { key: "main", label: "Mains" },
  { key: "alt", label: "Alts" },
  { key: "trial", label: "Trials" },
  { key: "other", label: "Not on the roster" },
];

/**
 * The bench, split into the conversations it actually contains.
 *
 * Who's raiding, who's bringing a second character, and who doesn't exist yet
 * are three different questions, and thirty-nine names in one run answers none
 * of them. Order inside a section is left exactly as the pool built it — by
 * class — so this never disagrees with what "Fill in order" would do.
 *
 * **A bench with nothing to split stays one list.** A raid night's pool is
 * actors from a log, which carry no roster status, and a template's is
 * archetypes; both come back as a single unlabelled section and render as they
 * always have.
 */
export function benchSections(bench: readonly PlacedMember[]): BenchSection[] {
  const bucket = (m: PlacedMember): "main" | "alt" | "trial" | "other" =>
    m.prospect ? "trial" : m.rosterStatus === "main" ? "main" : m.rosterStatus === "alt" ? "alt" : "other";

  const splittable = bench.some((m) => bucket(m) !== "other");
  if (!splittable) return [{ key: "all", label: "", members: [...bench] }];

  return BENCH_SECTIONS.map(({ key, label }) => ({
    key,
    label,
    members: bench.filter((m) => bucket(m) === key),
  })).filter((s) => s.members.length > 0);
}

/* -------------------------------------------------- recovering groups from logs */

/** A party the logs give away, and the buff that gave it away. */
export interface RecoveredParty {
  /** The raider whose equipped item buffed the group. */
  wearer: string;
  /** The party buff that revealed them — the evidence, named. */
  buff: string;
  /** The wearer plus everyone the buff reached. Up to five, by definition. */
  members: string[];
  /** Boss pulls this exact grouping was seen on. */
  pulls: number;
}

/**
 * What a TBC log leaks about grouping.
 *
 * Warcraft Logs does not store group assignments, and almost no party buff
 * reaches the combat log — totem auras, blessings and paladin auras are all
 * invisible. Two things do come through with a source and a friendly target,
 * and both are party-scoped in TBC, which makes their recipient list a party by
 * definition: **Battle Shout** and the **jewelcrafting necks**. Everyone who had
 * Katzewarr's shout up was standing in Katzewarr's group.
 *
 * Read it as a floor, never a reconstruction:
 *
 *  - it recovers one party per shouting warrior or neck wearer, and says
 *    nothing at all about the rest of the raid;
 *  - a recipient list can be short — somebody who died early, or joined late,
 *    was in the group without appearing in it;
 *  - two pulls can disagree, because raids re-group mid-night. Each distinct
 *    grouping is returned with the number of pulls it held for, and the caller
 *    decides. Nothing here merges two observations into a party that was never
 *    actually seen.
 *
 * A single-member observation is dropped: a warrior who only ever shouted on
 * himself tells you he was alone in range, not who his group was.
 */
export function partiesFromLogs(rows: readonly WclPlayerFight[]): RecoveredParty[] {
  const partyBuffNames = new Set(
    PARTY_BUFFS.flatMap((b) => b.loggedAs ?? []).map((n) => n.toLowerCase()),
  );
  const seen = new Map<string, RecoveredParty>();
  for (const row of rows) {
    for (const track of row.upkeep) {
      if (!partyBuffNames.has(track.name.toLowerCase())) continue;
      const targets = (track.targets ?? []).filter((t) => t.player).map((t) => t.target);
      if (targets.length === 0) continue;
      const members = [...new Set([row.actorName, ...targets])];
      // Under two carries no grouping information; over five means the buff
      // isn't party-scoped after all, and a group that can't exist is worse
      // than no suggestion.
      if (members.length < 2 || members.length > GROUP_SIZE) continue;
      const key = `${row.actorName}|${track.name}|${[...members].sort().join(",")}`;
      const hit = seen.get(key);
      if (hit) hit.pulls += 1;
      else seen.set(key, { wearer: row.actorName, buff: track.name, members, pulls: 1 });
    }
  }

  return [...seen.values()].sort(
    (a, b) => b.members.length - a.members.length || b.pulls - a.pulls || compareText(a.wearer, b.wearer),
  );
}

/**
 * Seed a board from recovered parties, then fill the rest in pool order.
 *
 * Deliberately conservative: a recovered party is placed whole or not at all
 * (anyone already placed makes it a conflict, and the later one is skipped), and
 * everyone else lands wherever there's room. The result is a draft to correct,
 * which is the honest offer — the log knows one party, not eight.
 */
export function seedBoard(
  pool: readonly PoolMember[],
  parties: readonly RecoveredParty[] = [],
): Board {
  const comp = emptyBoard();
  const placed = new Set<string>();
  const inPool = new Set(pool.map((m) => m.name.toLowerCase()));

  let next = 0;
  for (const party of parties) {
    const members = party.members.filter((m) => inPool.has(m.toLowerCase()));
    if (members.length === 0) continue;
    if (members.some((m) => placed.has(m.toLowerCase()))) continue;
    if (next >= GROUP_COUNT) break;
    comp.groups[next] = members.slice(0, GROUP_SIZE).map((name) => ({ name }));
    for (const slot of comp.groups[next]) placed.add(slot.name.toLowerCase());
    next += 1;
  }

  for (const member of pool) {
    if (placed.has(member.name.toLowerCase())) continue;
    const group = comp.groups.find((g) => g.length < GROUP_SIZE);
    if (!group) break;
    group.push({ name: member.name });
    placed.add(member.name.toLowerCase());
  }
  return comp;
}

/**
 * A raid night's attendees as a pool to arrange.
 *
 * One entry per name the log caught on a boss pull — puggers included, because
 * they were in a group too. Each carries the spec they played *most* that night
 * (a raider who respecced mid-raid is one person, and the majority answer is
 * the one a board should be judged on), every spec they were seen in as
 * the options an officer can count them as, and the buffs the log caught them
 * providing.
 */
export function poolFromPullRows(rows: readonly WclPlayerFight[]): PoolMember[] {
  const byActor = new Map<string, WclPlayerFight[]>();
  for (const row of rows) byActor.set(row.actorName, [...(byActor.get(row.actorName) ?? []), row]);

  return [...byActor]
    .map(([name, actorRows]) => {
      const specs = new Map<string, number>();
      for (const r of actorRows) if (r.spec) specs.set(r.spec, (specs.get(r.spec) ?? 0) + 1);
      const ranked = [...specs]
        .sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]))
        .map(([spec]) => spec);
      return {
        name,
        wowClass: actorRows.find((r) => r.className)?.className,
        spec: ranked[0],
        specOptions: ranked,
        role: actorRows[0]?.role,
        pulls: actorRows.length,
        broughtBuffs: buffsProvidedBy(actorRows),
      } satisfies PoolMember;
    })
    .sort((a, b) => b.pulls - a.pulls || compareText(a.name, b.name));
}

/* --------------------------------------------------- the template's palette */

/** One class+spec an officer can drop onto a planning board, as often as they like. */
export interface Archetype {
  wowClass: WowClass;
  spec: string;
  /** "Feral Druid" — what the palette button says, and the slot's default name. */
  name: string;
}

const archetypeName = (wowClass: string, spec: string) => `${spec} ${wowClass}`;

/**
 * Spec names the logs emit that the guild doesn't plan with.
 *
 * Warcraft Logs labels a pull by what the raider was *doing*, so the same druid
 * build comes back as Feral or Warden depending on the fight, a protection
 * paladin as Protection or Justicar, and a warrior as Protection or Gladiator.
 * Those extra names are useful when reading a log and pure noise in a palette,
 * where they'd sit next to the spec they duplicate — a warrior is Arms, Fury
 * and Protection, and that's the list an officer plans from.
 *
 * This is the guild's call about their own vocabulary, not a claim about the
 * game. Only the template's palette drops them; a logged pull still renders
 * under whatever name Warcraft Logs gave it.
 */
const NOT_PLANNED_WITH = new Set(["warden", "justicar", "gladiator"]);

/**
 * Every class and spec a board can be planned from: the game's talent
 * trees, plus whatever this guild's own logs have called a spec on top.
 *
 * The second half is the point. Warcraft Logs emits names the talent trees
 * don't have — Dreamstate, Guardian — and those are the ones an officer
 * actually says out loud, so a palette without them would be a palette that
 * doesn't match the raid. They come from the logs rather than from a list here,
 * which is the same rule the sim section follows for the same reason. What the
 * guild doesn't want is subtracted afterwards, by name — see `NOT_PLANNED_WITH`.
 */
export function archetypePalette(
  logged: readonly { wowClass: string; spec: string }[] = [],
): Archetype[] {
  const out = new Map<string, Archetype>();
  const add = (wowClass: WowClass, spec: string) => {
    const norm = spec.toLowerCase().replace(/[^a-z]/g, "");
    if (NOT_PLANNED_WITH.has(norm)) return;
    const key = `${wowClass}|${norm}`;
    if (!out.has(key)) out.set(key, { wowClass, spec, name: archetypeName(wowClass, spec) });
  };

  for (const wowClass of WOW_CLASSES) for (const spec of CLASS_SPECS[wowClass]) add(wowClass, spec);
  for (const { wowClass, spec } of logged) {
    if ((WOW_CLASSES as readonly string[]).includes(wowClass)) add(wowClass as WowClass, spec);
  }

  return [...out.values()].sort(
    (a, b) => compareText(a.wowClass, b.wowClass) || compareText(a.spec, b.spec),
  );
}

/** The palette as one panel per class — the shape the picker renders. */
export function paletteByClass(
  palette: readonly Archetype[],
): { wowClass: WowClass; specs: Archetype[] }[] {
  const byClass = new Map<WowClass, Archetype[]>();
  for (const a of palette) byClass.set(a.wowClass, [...(byClass.get(a.wowClass) ?? []), a]);
  return WOW_CLASSES.filter((c) => byClass.has(c)).map((wowClass) => ({
    wowClass,
    specs: byClass.get(wowClass)!,
  }));
}

/** A fresh slot for one archetype. The id is what lets three of them coexist. */
export function archetypeSlot(a: Archetype, id: string): BoardSlot {
  return { id, name: a.name, spec: a.spec };
}

/**
 * The pool a planning board resolves its slots against.
 *
 * One entry per archetype, keyed by the slot name every copy shares — so three
 * "Feral Druid" slots all resolve to the same class and spec, and buff coverage
 * counts three providers without the palette needing to know about the board.
 */
export function poolFromPalette(palette: readonly Archetype[]): PoolMember[] {
  return palette.map((a) => ({ name: a.name, wowClass: a.wowClass, spec: a.spec }));
}

/** What the roster records about a raider's two specs. */
export interface RosterSpecs {
  name: string;
  spec?: string;
  offSpec?: string;
}

/**
 * Offer a raider's roster off-spec alongside the specs the night's log saw.
 *
 * A log records what somebody played, never what they *could* play, so a pool
 * built from one night can't answer "what if the priest heals this fight" on
 * its own. The roster can, for the raiders that are on it — puggers keep only
 * what the log saw, which is all anyone knows about them.
 *
 * Order is deliberate: the log's answer leads, because it is the one backed by
 * evidence.
 */
export function withRosterSpecs(
  pool: readonly PoolMember[],
  roster: readonly RosterSpecs[],
): PoolMember[] {
  const byName = new Map(roster.map((r) => [r.name.toLowerCase(), r]));
  return pool.map((member) => {
    const entry = byName.get(member.name.toLowerCase());
    if (!entry) return member;
    const options = [...(member.specOptions ?? (member.spec ? [member.spec] : []))];
    for (const spec of [entry.spec, entry.offSpec]) {
      if (spec && !options.some((s) => normSpec(s) === normSpec(spec))) options.push(spec);
    }
    return options.length > 1 ? { ...member, specOptions: options } : member;
  });
}

/**
 * Buff ids one raider is logged as having provided, from their own pull rows.
 *
 * Positive evidence only. A buff missing from this list means the log has
 * nothing to say — either nobody tracks it (blessings, totem auras and paladin
 * auras never reach a TBC combat log at all) or this raider simply wasn't seen
 * pressing it — and `coverageOf` treats it as silence, never as a denial.
 */
export function buffsProvidedBy(rows: readonly WclPlayerFight[]): string[] {
  const present = new Set<string>();
  for (const row of rows) {
    for (const track of row.upkeep) present.add(track.name.toLowerCase());
    for (const cast of row.cooldowns) present.add(cast.toLowerCase());
    for (const cast of row.castTimes) present.add(cast.name.toLowerCase());
  }
  return RAID_BUFFS.filter((b) => b.loggedAs?.some((n) => present.has(n.toLowerCase()))).map(
    (b) => b.id,
  );
}

/* ------------------------------------------------------ the guild's boards */

/**
 * A named board built from the guild's own raiders.
 *
 * The third kind, and the one the other two couldn't be. A **raid night** is a
 * record of people who were there. The **planner** is a shape, deliberately
 * anonymous. Neither answers "who, specifically, is going on Wednesday" — and a
 * guild that runs a split has more than one answer to that at the same time, so
 * there are as many of these as the officers want, each named.
 *
 * Unlike a raid night's, these are never seeded from anything: nothing observed
 * them, and there is nothing to refetch.
 */
export interface GuildRoster {
  id: string;
  name: string;
  /** ISO. Stable ordering that doesn't depend on how rows come back. */
  createdAt: string;
  prospects: Prospect[];
  board: Board;
}

/**
 * A raider who doesn't exist yet — a trial, a recruit, somebody's friend.
 *
 * Deliberately *not* a roster character. The question these answer is "would a
 * second resto shaman fix group four", asked before anyone has been recruited,
 * and creating a character to ask it would put a person who has never raided
 * into attendance, loot priority and every other page that counts the roster.
 * So they live on the board that invented them and nowhere else, and vanish
 * with it.
 *
 * Class and spec are optional because the honest answer is often "a healer,
 * don't care which" — the pool renders what it was given and claims nothing more.
 */
export interface Prospect {
  name: string;
  wowClass?: string;
  spec?: string;
  role?: WclRole;
}

/** What a guild roster's pool is built from — one roster character. */
export interface RosterMember {
  name: string;
  wowClass?: string;
  spec?: string;
  offSpec?: string;
  /** The roster's own wording ("Melee DPS"), not the log's — see `wclRoleOf`. */
  role?: string;
  /** Roster status; "pug" and "inactive" are left out of the pool. */
  status?: string;
}

/** Where a class sits in the list: the order `WOW_CLASSES` is declared in. */
const classOrder = (wowClass: string | undefined): number => {
  const at = wowClass ? (WOW_CLASSES as readonly string[]).indexOf(wowClass) : -1;
  return at === -1 ? WOW_CLASSES.length : at;
};

/**
 * The roster's four roles as the log's three.
 *
 * The roster distinguishes melee from ranged because loot does; a board
 * doesn't, because a party buff doesn't care. Structural, not a judgement —
 * anything unrecognised stays undefined rather than being guessed into "dps".
 */
export function wclRoleOf(role: string | undefined): WclRole | undefined {
  switch (role) {
    case "Tank":
      return "tank";
    case "Healer":
      return "healer";
    case "Melee DPS":
    case "Ranged DPS":
      return "dps";
    default:
      return undefined;
  }
}

/**
 * The guild's raiders as a pool to arrange.
 *
 * **Mains and alts, not pugs or the inactive.** A pug is by definition not the
 * guild's to plan with, and somebody who left the roster showing up in next
 * week's raid is a bug an officer would have to notice. An alt stays in,
 * because "bring your alt" is the whole reason a guild runs a split.
 *
 * Mains first, then alts, and **by class within each** — a raid is read as "how
 * many shamans have we got", so the shamans have to be next to each other. The
 * bench splits on the same order it is built in, so what "Fill in order" does
 * and what the list looks like can never disagree.
 */
export function poolFromRoster(roster: readonly RosterMember[]): PoolMember[] {
  return roster
    .filter((r) => r.status !== "pug" && r.status !== "inactive")
    .map((r) => {
      const specOptions = [r.spec, r.offSpec].filter((s): s is string => Boolean(s));
      return {
        name: r.name,
        slug: r.name.toLowerCase(),
        wowClass: r.wowClass,
        spec: r.spec,
        role: wclRoleOf(r.role),
        rosterStatus: r.status,
        ...(specOptions.length > 1 ? { specOptions } : {}),
      } satisfies PoolMember;
    })
    .sort(
      (a, b) =>
        (a.rosterStatus === "alt" ? 1 : 0) - (b.rosterStatus === "alt" ? 1 : 0) ||
        classOrder(a.wowClass) - classOrder(b.wowClass) ||
        compareText(a.name, b.name),
    );
}

/**
 * Fold a board's invented raiders into its pool.
 *
 * A prospect whose name has since joined the roster is dropped rather than
 * duplicated — that is what recruiting them looks like from here, and two
 * chips with one name would break `slotKey`, which identifies a person by it.
 */
export function withProspects(
  pool: readonly PoolMember[],
  prospects: readonly Prospect[],
): PoolMember[] {
  const taken = new Set(pool.map((m) => m.name.toLowerCase()));
  const extra: PoolMember[] = [];
  for (const p of prospects) {
    const key = p.name.toLowerCase();
    if (taken.has(key)) continue;
    taken.add(key);
    extra.push({ name: p.name, wowClass: p.wowClass, spec: p.spec, role: p.role, prospect: true });
  }
  // Appended, and by class among themselves — the same rule the roster follows,
  // so the bench reads the same way in all three of its sections.
  extra.sort((a, b) => classOrder(a.wowClass) - classOrder(b.wowClass) || compareText(a.name, b.name));
  return [...pool, ...extra];
}

/** Prospects on a board that the roster has since acquired — recruited, in other words. */
export function recruitedProspects(
  prospects: readonly Prospect[],
  roster: readonly RosterMember[],
): string[] {
  const onRoster = new Set(roster.map((r) => r.name.toLowerCase()));
  return prospects.filter((p) => onRoster.has(p.name.toLowerCase())).map((p) => p.name);
}

export function sanitizeProspects(raw: unknown): Prospect[] {
  if (!Array.isArray(raw)) return [];
  const out: Prospect[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") continue;
    const { name, wowClass, spec, role } = entry as Record<string, unknown>;
    const cleanName = text(name, 60);
    if (!cleanName || seen.has(cleanName.toLowerCase())) continue;
    seen.add(cleanName.toLowerCase());
    const prospect: Prospect = { name: cleanName };
    const cleanClass = text(wowClass, 30);
    const cleanSpec = text(spec, 60);
    if (cleanClass) prospect.wowClass = cleanClass;
    if (cleanSpec) prospect.spec = cleanSpec;
    if (role === "tank" || role === "healer" || role === "dps") prospect.role = role;
    out.push(prospect);
    if (out.length >= 60) break;
  }
  return out;
}

/**
 * Force a stored row into a legal board, or reject it.
 *
 * Rejects rather than repairs when the id or name is gone, because unlike a
 * board there is no sensible empty value: a board with no name is a pill
 * an officer can't tell from the others, and inventing one would hide the fact
 * that a row is corrupt.
 */
export function sanitizeGuildRoster(raw: unknown): GuildRoster | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const { id, name, createdAt, prospects, board } = raw as Record<string, unknown>;
  const cleanId = text(id, 60);
  const cleanName = text(name, 40);
  if (!cleanId || !cleanName) return undefined;
  const groups = (board as { groups?: unknown })?.groups;
  return {
    id: cleanId,
    name: cleanName,
    createdAt: text(createdAt, 40) ?? "",
    prospects: sanitizeProspects(prospects),
    board: sanitizeBoard(
      board,
      Array.isArray(groups) ? { groups: groups.length } : {},
    ),
  };
}

/** A fresh, empty board. The caller mints the id — this layer stays pure. */
export function newGuildRoster(id: string, name: string, createdAt: string): GuildRoster {
  return { id, name: name.trim().slice(0, 40) || "Roster", createdAt, prospects: [], board: emptyBoard() };
}

/** "Roster 3" — the first number this guild isn't already using. */
export function nextRosterName(existing: readonly { name: string }[]): string {
  const taken = new Set(existing.map((b) => b.name.trim().toLowerCase()));
  for (let n = 1; ; n++) if (!taken.has(`roster ${n}`)) return `Roster ${n}`;
}

/* ------------------------------------------------------- which board is open */

export type PlannerTab = "template" | "rosters";

/**
 * What `?board=` is asking for.
 *
 * Two tabs over three kinds of board. **Rosters & raids** is the guild's own
 * people — its named rosters and every raid night it has logged, which belong
 * together because both are about raiders who exist. **Template** is the
 * anonymous shape, classes and specs with nobody named.
 *
 * Rosters & raids is the default, and that is the point of the ordering: an
 * officer opens this page to sort out Wednesday, not to redesign the abstract
 * raid. The template is the thing you visit deliberately.
 *
 * **Nothing here is an alias for an older spelling.** Every value this reads is
 * one the app writes today; anything else falls to the default, which is also
 * where a link to a deleted roster lands. That is the whole reason this is one
 * tested function rather than parsing spread across the page.
 */
export interface BoardSelection {
  tab: PlannerTab;
  /** A guild roster id, when the rosters tab is showing one of them. */
  rosterId?: string;
  /** A report code, when the rosters tab is showing a raid night. */
  reportCode?: string;
}

const ROSTER_BOARD_PREFIX = "roster:";

/** The `?board=` value for one of the guild's rosters. */
export const rosterBoardKey = (id: string) => `${ROSTER_BOARD_PREFIX}${id}`;

export function selectBoard(
  boardKey: string | undefined,
  known: { reportCodes: readonly string[]; rosterIds: readonly string[] },
): BoardSelection {
  const key = boardKey?.trim();
  if (key === "template") return { tab: "template" };
  // `rosters` resolves the same way the default does, and is spelled out
  // anyway: the tab link writes it, and a value the app emits should not
  // depend on being unrecognised to land in the right place.
  if (key === "rosters" || key === undefined || key === "") {
    return { tab: "rosters", rosterId: known.rosterIds[0] };
  }
  if (key.startsWith(ROSTER_BOARD_PREFIX)) {
    const id = key.slice(ROSTER_BOARD_PREFIX.length);
    // An unknown id opens the first roster rather than nothing: the officer
    // asked for a roster, and the honest answer to one that was deleted is
    // another roster, not a different tab entirely.
    return { tab: "rosters", rosterId: known.rosterIds.includes(id) ? id : known.rosterIds[0] };
  }
  if (key && known.reportCodes.includes(key)) return { tab: "rosters", reportCode: key };
  return { tab: "rosters", rosterId: known.rosterIds[0] };
}
