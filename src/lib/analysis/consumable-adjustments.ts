import type { ConsumableAdjustment } from "@/lib/types";
import {
  CONSUMABLE_GROUP_LABELS,
  CONSUMABLE_GROUP_ORDER,
  consumableGroupOf,
  type ConsumableGroup,
} from "@/lib/wcl/consumables";

/**
 * Officer corrections to what a raid's logs say a raider got through.
 *
 * The gold estimate is inferred, and inference is wrong at the edges. Warcraft
 * Logs never sees a flask bought and drunk before the raid started, a potion
 * used on the run back, or anything at all on a night somebody's client
 * dropped; equally, the prep model happily bills a raider twice for a flask
 * they held through one death. Officers know these things and had no way to
 * say so.
 *
 * An adjustment is that statement: a raider, a consumable, and how many uses
 * to add or take away. It is deliberately NOT a price edit — prices are the
 * other lever and they apply to the whole raid. This one says "the count was
 * wrong for this person".
 *
 * Everything is additive and reversible: the logged numbers are never
 * overwritten, so removing an adjustment restores exactly what the log said.
 */

/** One consumable line, as both the breakdowns and the gold math use them. */
export interface ConsumableLine {
  name: string;
  count: number;
}

/** A line with the officer edit behind it, when there was one. */
export interface AdjustedLine extends ConsumableLine {
  /** Net uses added (+) or removed (-) by hand. Absent when untouched. */
  delta?: number;
  /** True when nothing was logged and the whole line is an officer's. */
  added?: boolean;
}

/** Case- and space-insensitive, so "super mana potion" matches the logged name. */
function normalizeConsumableName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Case-insensitive match on the raider's logged name. */
export function adjustmentsFor(
  adjustments: ConsumableAdjustment[],
  actorName: string,
): ConsumableAdjustment[] {
  const slug = actorName.trim().toLowerCase();
  return adjustments.filter((a) => a.actorName.trim().toLowerCase() === slug);
}

/**
 * Fold one raider's adjustments into their logged lines.
 *
 * A removal can only take away what's there — the count floors at zero and the
 * line disappears rather than going negative, because "minus one flask" on a
 * raider who never had one is a mistake, not a refund. An addition for a
 * consumable the log never saw becomes a new line.
 */
export function applyAdjustments(
  lines: ConsumableLine[],
  adjustments: ConsumableAdjustment[],
): AdjustedLine[] {
  if (adjustments.length === 0) return lines.map((l) => ({ ...l }));

  const deltaByKey = new Map<string, number>();
  const nameByKey = new Map<string, string>();
  for (const adj of adjustments) {
    const key = normalizeConsumableName(adj.name);
    if (!key) continue;
    deltaByKey.set(key, (deltaByKey.get(key) ?? 0) + adj.delta);
    nameByKey.set(key, adj.name.trim());
  }

  const out: AdjustedLine[] = [];
  const used = new Set<string>();
  for (const line of lines) {
    const key = normalizeConsumableName(line.name);
    const delta = deltaByKey.get(key);
    used.add(key);
    if (delta === undefined || delta === 0) {
      out.push({ ...line });
      continue;
    }
    const count = Math.max(0, line.count + delta);
    // The line vanishing is the point of a removal — keep the arithmetic
    // honest by reporting the delta that was actually applied.
    if (count > 0) out.push({ name: line.name, count, delta: count - line.count });
  }
  // Consumables the log never saw at all.
  for (const [key, delta] of deltaByKey) {
    if (used.has(key) || delta <= 0) continue;
    out.push({ name: nameByKey.get(key) ?? key, count: delta, delta, added: true });
  }
  return out;
}

/** Gold for a set of lines at the raid's cost-per-use. */
export function goldOfLines(
  lines: ConsumableLine[],
  costPerUse: Record<string, number>,
): number {
  return lines.reduce((sum, l) => sum + (costPerUse[l.name] ?? 0) * l.count, 0);
}

/**
 * What the hand edits cost or saved: adjusted gold minus logged gold. Signed,
 * so the gold panel can show it as its own column instead of burying it.
 */
export function adjustmentGold(
  logged: ConsumableLine[],
  adjusted: ConsumableLine[],
  costPerUse: Record<string, number>,
): number {
  return goldOfLines(adjusted, costPerUse) - goldOfLines(logged, costPerUse);
}

/**
 * The adjustment list after one ± press on a raider's consumable line.
 *
 * Pure, and here rather than in the badge component, for the same reason the
 * bug-report widget keeps its arithmetic outside the DOM: the rule about which
 * entry a press lands on is the part worth testing, and it has a sharp edge.
 *
 * **A press merges into that raider's existing unnoted correction** — five
 * presses read as "+5", not as five entries in the audit list. **A note rides
 * along** — the entry keeps whatever reason was written against it.
 *
 * That last part used to be the opposite: a noted entry was never touched and a
 * new one was appended beside it, because the ± lived in the ranking row while
 * the reason was written in a separate card, and a button must not quietly
 * change the number a sentence elsewhere refers to. Both now sit on the same
 * line of the same panel, so a press is no longer silent, and one correction per
 * raider per consumable is what the panel shows. Old data with a split pair
 * still totals correctly — `applyAdjustments` sums every entry either way.
 *
 * A merge that lands on zero drops the row: "+0" in the audit list would claim
 * a correction nobody is making.
 */
export function bumpAdjustment(input: {
  adjustments: ConsumableAdjustment[];
  actorName: string;
  name: string;
  direction: 1 | -1;
  /** Stamped on the row this press touches. */
  at: string;
}): ConsumableAdjustment[] {
  const { adjustments, actorName, name, direction, at } = input;
  const sameActor = (a: ConsumableAdjustment) =>
    a.actorName.trim().toLowerCase() === actorName.trim().toLowerCase();
  const sameName = (a: ConsumableAdjustment) =>
    normalizeConsumableName(a.name) === normalizeConsumableName(name);

  const mergeable = adjustments.findIndex((a) => sameActor(a) && sameName(a));
  const next =
    mergeable === -1
      ? [...adjustments, { actorName: actorName.trim(), name: name.trim(), delta: direction, at }]
      : adjustments.map((a, i) => (i === mergeable ? { ...a, delta: a.delta + direction, at } : a));

  return next.filter((a) => a.delta !== 0);
}

/**
 * Stamp the author on the corrections a save actually changed.
 *
 * The whole list is replaced on every write, so a save carries entries nobody
 * touched alongside the one that was. Restamping all of them would credit this
 * officer with corrections another one made months ago, and trusting whatever
 * the client sent would let it claim the reverse. So an entry that matches a
 * stored one exactly keeps the author and timestamp it already had, and only a
 * new or altered entry gets this officer's name.
 *
 * Matching is on (raider, consumable, note, delta): change any of them and it
 * is a different statement, made by whoever made it. Two entries for the same
 * raider and consumable — one noted, one not — stay distinguishable, which is
 * what `bumpAdjustment` relies on.
 */
export function attributeAdjustments(input: {
  stored: ConsumableAdjustment[];
  incoming: ConsumableAdjustment[];
  actor: string;
  at: string;
}): ConsumableAdjustment[] {
  const { stored, incoming, actor, at } = input;
  const key = (a: ConsumableAdjustment) =>
    [
      a.actorName.trim().toLowerCase(),
      a.name.trim().toLowerCase(),
      a.note?.trim() ?? "",
      a.delta,
    ].join("\u0000");

  const unchanged = new Map<string, ConsumableAdjustment>();
  for (const entry of stored) unchanged.set(key(entry), entry);

  return incoming.map((entry) => {
    const before = unchanged.get(key(entry));
    if (before) return { ...entry, by: before.by, at: before.at };
    return { ...entry, by: actor, at };
  });
}

/**
 * Write, change or clear the reason on a raider's correction to one consumable.
 *
 * Only ever edits a correction that already exists: a reason with no number
 * behind it corrects nothing, and would show up in the audit list as a sentence
 * about a change nobody made. Clearing it back to empty drops the field rather
 * than storing `""`, so the entry matches how it would have been saved without
 * one — which is what keeps `attributeAdjustments` from reading a cleared note
 * as a fresh edit forever.
 */
export function setAdjustmentNote(input: {
  adjustments: ConsumableAdjustment[];
  actorName: string;
  name: string;
  note: string;
}): ConsumableAdjustment[] {
  const { adjustments, actorName, name, note } = input;
  const trimmed = note.trim();
  return adjustments.map((a) => {
    const match =
      a.actorName.trim().toLowerCase() === actorName.trim().toLowerCase() &&
      normalizeConsumableName(a.name) === normalizeConsumableName(name);
    if (!match) return a;
    if (trimmed === "") {
      const rest = { ...a };
      delete rest.note;
      return rest;
    }
    return { ...a, note: trimmed };
  });
}

/**
 * Record a consumable the log never saw at all.
 *
 * The one correction that cannot start from a ± on an existing line, because
 * there is no line: Warcraft Logs records nothing for a flask drunk before the
 * pull timer. Folds into an existing correction for the same consumable rather
 * than opening a second, for the same reason a repeat press does.
 */
export function addAdjustment(input: {
  adjustments: ConsumableAdjustment[];
  actorName: string;
  name: string;
  count: number;
  note?: string;
  at: string;
}): ConsumableAdjustment[] {
  const { adjustments, actorName, name, count, note, at } = input;
  const trimmedName = name.trim();
  const trimmedNote = note?.trim();
  if (trimmedName === "" || !Number.isInteger(count) || count === 0) return adjustments;

  const existing = adjustments.findIndex(
    (a) =>
      a.actorName.trim().toLowerCase() === actorName.trim().toLowerCase() &&
      normalizeConsumableName(a.name) === normalizeConsumableName(trimmedName),
  );
  const next =
    existing === -1
      ? [
          ...adjustments,
          {
            actorName: actorName.trim(),
            name: trimmedName,
            delta: count,
            ...(trimmedNote ? { note: trimmedNote } : {}),
            at,
          },
        ]
      : adjustments.map((a, i) =>
          i === existing
            ? { ...a, delta: a.delta + count, ...(trimmedNote ? { note: trimmedNote } : {}), at }
            : a,
        );
  return next.filter((a) => a.delta !== 0);
}
/* --- The breakdown panel's view of one raider, which is arithmetic --- */

/** A line priced at this raid's rates, with the reason written against it. */
export interface PricedLine extends AdjustedLine {
  /** The reason written against the correction, when there is one. */
  note?: string;
  /** Gold per use at this raid's prices. */
  cost: number;
}

/** One family of a raider's consumables, already in display order. */
export interface GroupedLines {
  group: ConsumableGroup;
  label: string;
  lines: PricedLine[];
}

/**
 * A raider's lines under their family headings.
 *
 * Grouping is applied *after* the gold sort, so the order inside a family is
 * still the frozen one and a press cannot move a line past its neighbour. Empty
 * families are dropped — a raider who drank no potions gets no Potions heading.
 */
export function groupLines(lines: PricedLine[]): GroupedLines[] {
  const byGroup = new Map<ConsumableGroup, PricedLine[]>();
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
 * One raider's panel: their lines, priced and grouped, plus what the open batch
 * has done to them.
 *
 * **Values follow the presses; the sort waits.** The order is computed against
 * the *saved* adjustments and the counts against the *pending* ones, so a line
 * cannot move under the officer's cursor mid-batch — a row that reshuffles on
 * every press is unusable, and the officer is comparing lines while they work.
 * The gold beside each line does move, because a number that sat still while
 * its neighbours changed would be the one thing on screen contradicting itself.
 *
 * A line the raid has no price for is dropped unless somebody corrected it: a
 * free line is noise, but a free line an officer touched is a statement.
 */
export function raiderBreakdown(input: {
  /** The raider's logged lines, before any correction. */
  logged: ConsumableLine[];
  actorName: string;
  /** What the server ranked against — the frozen order comes from these. */
  saved: ConsumableAdjustment[];
  /** What is on screen, including this batch's unsaved presses. */
  pending: ConsumableAdjustment[];
  costPerUse: Record<string, number>;
}): {
  groups: GroupedLines[];
  /** How many of this raider's lines an officer has touched. */
  corrections: number;
  /** Signed gold the corrections cost or saved. */
  delta: number;
} {
  const { logged, actorName, saved, pending, costPerUse } = input;
  const priceOf = (name: string) => costPerUse[name] ?? 0;

  const order = new Map(
    applyAdjustments(logged, adjustmentsFor(saved, actorName))
      .map((l) => [l.name, priceOf(l.name) * l.count] as const)
      .sort((a, b) => b[1] - a[1])
      .map(([name], i) => [name, i] as const),
  );

  const forRaider = adjustmentsFor(pending, actorName);
  const lines = applyAdjustments(logged, forRaider)
    .filter((l) => priceOf(l.name) * l.count > 0 || l.delta !== undefined)
    .sort((a, b) => (order.get(a.name) ?? order.size) - (order.get(b.name) ?? order.size));

  // The reason lives on the adjustment, not on the folded line — carry it back
  // so the panel can show and edit what was written against each correction.
  // Keyed the same way `applyAdjustments` matches, which is the point: a name
  // whose only difference is a doubled space folds into the logged line there,
  // and a looser key here would drop the officer's note on the way.
  const notes = new Map(forRaider.map((a) => [normalizeConsumableName(a.name), a.note]));

  return {
    groups: groupLines(
      lines.map((l) => ({
        ...l,
        cost: priceOf(l.name),
        note: notes.get(normalizeConsumableName(l.name)),
      })),
    ),
    corrections: lines.filter((l) => l.delta !== undefined).length,
    delta: adjustmentGold(logged, lines, costPerUse),
  };
}

/**
 * How many corrections the open batch actually represents — entries added,
 * dropped, or moved off their saved delta. Counting presses would be wrong:
 * pressing + then − again leaves nothing to save.
 */
export function countChanges(
  saved: ConsumableAdjustment[],
  pending: ConsumableAdjustment[],
): number {
  /*
   * The separator between the three parts is a NUL, and it has to be something
   * nobody can type: a raider's name, a consumable's name and an officer's
   * free-text note are all arbitrary strings, so any printable separator is one
   * an officer can put in a note to fold two different corrections onto one key
   * — which would silently undercount the batch.
   *
   * Written as the escape rather than as the byte. As a raw byte it made git
   * classify the file as binary: no diff, no auto-merge, `grep` skipping it,
   * and a line-ending change showing up as a whole-file rewrite. The escape
   * keeps the guarantee exactly and hands the file back to git.
   */
  const key = (a: ConsumableAdjustment) =>
    `${a.actorName.trim().toLowerCase()}\u0000${a.name.trim().toLowerCase()}\u0000${a.note ?? ""}`;
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

/* --- Carrying a night's corrections out of the app, and back in --- */

/**
 * Marks an exported file as this app's, and as this shape.
 *
 * A bare array of corrections is also accepted on the way in (see
 * `parseAdjustmentsFile`) — this is what makes a file *recognisable*, not what
 * makes it readable.
 */
export const ADJUSTMENTS_FILE_KIND = "projectlc.consumable-adjustments";

/**
 * How long a stored correction's text fields may be.
 *
 * One definition because there are two readers: the zod gate in the logs
 * actions, which decides what may be written, and `parseAdjustmentsFile`, which
 * has to hold an imported file to exactly that standard or hand the officer a
 * buffer that fails to save. Split in two, raising a limit in the gate and not
 * the parser truncates imported notes in silence — the parser is the half
 * nobody would think to look at.
 */
export const ADJUSTMENT_LIMITS = {
  actorName: 60,
  name: 80,
  note: 200,
  by: 80,
} as const;

/**
 * A raid's corrections as a file.
 *
 * Written so a human reading it can tell what it is and which night it came
 * from without opening the app: the corrections themselves are the officers'
 * reasoning, and the audit list is only as useful as it is portable.
 *
 * `code` is recorded, never enforced. A file exported from one night is
 * deliberately importable into another — "Thrainn always drinks his flask
 * before the pull timer" is true every week, and re-entering it by hand every
 * week is how it stops being recorded at all.
 */
export interface AdjustmentsFile {
  kind: typeof ADJUSTMENTS_FILE_KIND;
  version: 1;
  /** The report the corrections were made against. */
  code: string;
  /** When the file was written, ISO. */
  exportedAt: string;
  adjustments: ConsumableAdjustment[];
}

/** The current file, for one raid's corrections. Time is passed in — this layer is pure. */
export function exportAdjustments(input: {
  code: string;
  adjustments: ConsumableAdjustment[];
  at: string;
}): AdjustmentsFile {
  return {
    kind: ADJUSTMENTS_FILE_KIND,
    version: 1,
    code: input.code,
    exportedAt: input.at,
    // `by` and `at` ride along: who corrected what, and when, is half of what
    // makes the record worth keeping, and dropping them here would make an
    // export of a night lossy against the night it came from.
    adjustments: input.adjustments.map((a) => ({ ...a })),
  };
}

/** Trimmed if it is a usable string of at most `max` characters, else undefined. */
function boundedText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" || trimmed.length > max ? undefined : trimmed;
}

/**
 * Read corrections out of a parsed JSON file. `null` when it isn't one.
 *
 * **Tolerant on input, strict on output** — the import layer's rule, and it
 * earns its place twice here. A bare array is read as well as the envelope, so
 * a list somebody assembled by hand works. And every entry is held to the
 * limits the server's own gate enforces, so a file cannot produce a buffer that
 * fails to save later with a message about array elements.
 *
 * Where an entry breaks a limit, what happens depends on whether the field
 * *identifies* something: a raider or consumable name over length is dropped,
 * because a truncated identifier files the correction against the wrong person
 * or nothing at all. A note over length is prose and is truncated, because
 * losing the end of a sentence beats losing the correction it explains.
 *
 * `by` is read back but is not evidence of anything: the server restamps every
 * entry it does not recognise as already stored (`attributeAdjustments`), so an
 * import can never claim a correction on another officer's behalf.
 */
export function parseAdjustmentsFile(
  raw: unknown,
  /** Stamped on entries whose own timestamp is missing or unusable. */
  at: string,
): { code?: string; adjustments: ConsumableAdjustment[]; skipped: number } | null {
  const envelope = raw !== null && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : undefined;
  const list = Array.isArray(raw) ? raw : envelope?.adjustments;
  if (!Array.isArray(list)) return null;

  const adjustments: ConsumableAdjustment[] = [];
  let skipped = 0;
  for (const entry of list) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      skipped++;
      continue;
    }
    const e = entry as Record<string, unknown>;
    const actorName = boundedText(e.actorName, ADJUSTMENT_LIMITS.actorName);
    const name = boundedText(e.name, ADJUSTMENT_LIMITS.name);
    const delta = e.delta;
    // Zero is the one number that cannot be a correction — it would show up in
    // the audit list as a change nobody made.
    if (!actorName || !name || typeof delta !== "number" || !Number.isInteger(delta) || delta === 0) {
      skipped++;
      continue;
    }
    const note =
      typeof e.note === "string" ? e.note.trim().slice(0, ADJUSTMENT_LIMITS.note) : "";
    const by = boundedText(e.by, ADJUSTMENT_LIMITS.by);
    adjustments.push({
      actorName,
      name,
      delta,
      ...(note ? { note } : {}),
      ...(by ? { by } : {}),
      // Not one of the stored limits — the server takes any non-empty string
      // here. It is a sanity bound on a field that should hold 24 characters of
      // ISO, and anything past it falls back to the import time rather than
      // being refused.
      at: boundedText(e.at, 40) ?? at,
    });
  }
  return { code: boundedText(envelope?.code, 80), adjustments, skipped };
}

/**
 * Fold an imported list into the corrections already on screen.
 *
 * Two rules, and both exist so that exporting a night and importing it straight
 * back changes nothing:
 *
 * **The file wins per (raider, consumable), and only for the pairs it names.**
 * Not addition — adding an imported +2 onto the +2 already there would double
 * every correction on a re-import, which turns a backup into a trap. A pair the
 * file is silent about keeps whatever it had.
 *
 * **An import never removes a correction.** A file whose entries for one pair
 * cancel out says nothing storable about it, so the standing correction is left
 * alone rather than cleared. Undoing is what the ± and Discard are for; a file
 * quietly deleting an officer's judgement call is not something you can see
 * happen.
 *
 * Duplicate entries for one pair are summed before either rule applies, because
 * that is what `applyAdjustments` would have made of them — corrections written
 * before a press merged into its noted neighbour still come in pairs, and
 * last-one-wins would drop half of such a pair on the floor.
 *
 * Raiders this raid has no rows for are dropped and counted. They would
 * otherwise be stored and never shown: the ranking is built from the raiders
 * the log caught, so a correction against somebody who wasn't there is
 * invisible in the one place it would be reviewed.
 */
export function mergeImportedAdjustments(input: {
  /** The open batch, as it stands on screen. */
  current: ConsumableAdjustment[];
  imported: ConsumableAdjustment[];
  /** The raiders this raid ranked. Matched the way every other lookup here is. */
  knownActors: string[];
}): {
  adjustments: ConsumableAdjustment[];
  /** Corrections that landed on a raider in this raid. */
  applied: number;
  /** Corrections dropped because the raider is not in this raid. */
  absent: number;
} {
  const { current, imported, knownActors } = input;
  const known = new Set(knownActors.map((n) => n.trim().toLowerCase()));
  const keyOf = (a: ConsumableAdjustment) =>
    `${a.actorName.trim().toLowerCase()}\u0000${normalizeConsumableName(a.name)}`;

  const folded = new Map<string, ConsumableAdjustment>();
  let absent = 0;
  for (const entry of imported) {
    if (!known.has(entry.actorName.trim().toLowerCase())) {
      absent++;
      continue;
    }
    const key = keyOf(entry);
    const seen = folded.get(key);
    folded.set(
      key,
      seen
        ? { ...seen, delta: seen.delta + entry.delta, note: seen.note ?? entry.note }
        : { ...entry },
    );
  }
  for (const [key, entry] of folded) if (entry.delta === 0) folded.delete(key);
  const applied = folded.size;

  // Replaced in place, so a correction the file restates keeps its position and
  // the panel's frozen order survives an import. Whatever is left over is new
  // and goes on the end, which is where a hand-added correction lands too.
  const next = current.map((a) => {
    const key = keyOf(a);
    const replacement = folded.get(key);
    if (!replacement) return a;
    folded.delete(key);
    return replacement;
  });
  return { adjustments: [...next, ...folded.values()], applied, absent };
}
