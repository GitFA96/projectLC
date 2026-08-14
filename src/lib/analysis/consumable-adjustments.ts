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
 * presses read as "+5", not as five entries in the audit list. An entry carrying
 * a NOTE is never touched; a new one is appended beside it instead, because
 * somebody wrote a sentence explaining that number and a ± button must not
 * quietly change what the sentence refers to.
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

  const mergeable = adjustments.findIndex((a) => sameActor(a) && sameName(a) && !a.note);
  const next =
    mergeable === -1
      ? [...adjustments, { actorName: actorName.trim(), name: name.trim(), delta: direction, at }]
      : adjustments.map((a, i) => (i === mergeable ? { ...a, delta: a.delta + direction, at } : a));

  return next.filter((a) => a.delta !== 0);
}
