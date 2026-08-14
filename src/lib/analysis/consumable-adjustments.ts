import type { ConsumableAdjustment } from "@/lib/types";

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
