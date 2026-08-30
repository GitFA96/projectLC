import { consumableGroupOf } from "@/lib/wcl/consumables";
import { compareText } from "@/lib/sort";
import type { PetSpendLine, PetSpendRow, PetSpendView, WclPlayerOffPull, WclRole } from "@/lib/types";

/**
 * What a night's pets cost — the one place that reads a range instead of a count.
 *
 * Every other consumable in this app is priced off a cast, because a raider
 * drinks and throws things during a pull and the log records it. **A pet is
 * fed and scrolled between pulls, where the log holds no events at all**
 * (docs/change-chains.md §5e: one scroll cast in 73,837, on a night whose aura
 * stream shows a hunter's pet holding two). So the cast count is a floor and
 * nothing more, and pricing it alone reports a hunter's pet gold as a fraction
 * of what it was.
 *
 * The honest answer is two numbers, and this module produces both:
 *
 *   - **logged** — applications the cast stream actually recorded. This is what
 *     the gold ranking already charges, and it does not move.
 *   - **maintained** — what keeping the same consumable up for the whole night
 *     takes, at the re-buy window the app already uses for the raider's own
 *     flask, food and scrolls. The ceiling.
 *
 * Neither is "the" number, which is why nothing here folds one into the other
 * or into the ranking: an officer reads the gap and decides. What closes the
 * gap is not a better model — it is asking the hunter.
 *
 * **A sighting is evidence, never a count.** A pet re-entering play republishes
 * its entire aura set in one millisecond, so `petBuffsSeen` says the item was
 * on the pet and can never say how many were read (§5e). It therefore opens a
 * line — a scroll no cast ever saw is exactly the spend that was invisible —
 * and contributes 0 to `logged`.
 */
export interface PetSpendInput {
  /** This report's off-pull records — where everything done to a pet lives. */
  offPull: WclPlayerOffPull[];
  /** The report's span. The denominator of the maintained reading. */
  spanHours: number;
  /**
   * How long one application lasts before it is re-bought, per kind.
   *
   * Passed in rather than declared here, and deliberately: these are the same
   * windows `PREP_HOURS` gives a raider's own food and scrolls, and a pet's
   * Scroll of Agility V is the raider's Scroll of Agility V. A second copy of
   * that judgement would let the two drift, and the drift would be silent.
   */
  windowHours: { food: number; scroll: number };
  /**
   * Raiders who hold at least one included pull, by lowercased name.
   *
   * The same fold rule the rest of the raid page runs on (§5): somebody who
   * appears only in an off-pull record has no row anywhere else on this night,
   * and inventing one to carry two scrolls would put a stranger in the totals.
   */
  actors: Map<string, { name: string; slug?: string; className?: string; role: WclRole }>;
}

export function summarizePetSpend(input: PetSpendInput): PetSpendView {
  const { offPull, spanHours, windowHours, actors } = input;

  const rows: PetSpendRow[] = [];
  for (const off of offPull) {
    const actor = actors.get(off.actorName.toLowerCase());
    if (actor === undefined) continue;

    const logged = new Map<string, number>();
    for (const applied of off.petConsumables) {
      logged.set(applied.name, (logged.get(applied.name) ?? 0) + 1);
    }
    // Sightings open a line of their own, but never add to one: a cast and the
    // aura it raised are the same scroll, and counting both would charge twice.
    const seen = new Set(off.petBuffsSeen.map((s) => s.name));
    const names = new Set([...logged.keys(), ...seen]);
    if (names.size === 0) continue;

    const lines: PetSpendLine[] = [...names]
      .map((name) => {
        // Asked of the curated list that named it, never pattern-matched here —
        // a newly curated pet food files itself, the same as it does in the
        // preparedness table.
        const group: PetSpendLine["group"] = consumableGroupOf(name) === "scroll" ? "scroll" : "food";
        const count = logged.get(name) ?? 0;
        return {
          name,
          group,
          logged: count,
          seen: seen.has(name),
          // Never below what was logged: a hunter who re-fed more often than
          // the window says is telling us about their own night, not making a
          // case that the window is wrong.
          maintained: Math.max(count, windowsIn(spanHours, windowHours[group])),
        };
      })
      .sort(
        (a, b) =>
          b.maintained - a.maintained || b.logged - a.logged || compareText(a.name, b.name),
      );

    rows.push({
      name: actor.name,
      ...(actor.slug === undefined ? {} : { slug: actor.slug }),
      ...(actor.className === undefined ? {} : { className: actor.className }),
      role: actor.role,
      lines,
      loggedUses: lines.reduce((s, l) => s + l.logged, 0),
      maintainedUses: lines.reduce((s, l) => s + l.maintained, 0),
    });
  }

  rows.sort(
    (a, b) =>
      b.maintainedUses - a.maintainedUses ||
      b.loggedUses - a.loggedUses ||
      compareText(a.name, b.name),
  );

  return {
    rows,
    spanHours,
    windowHours,
    loggedUses: rows.reduce((s, r) => s + r.loggedUses, 0),
    maintainedUses: rows.reduce((s, r) => s + r.maintainedUses, 0),
  };
}

/**
 * How many applications a night this long needs to keep one buff up.
 *
 * At least one whenever there is any evidence at all — the pet had the thing,
 * so somebody bought one — and a report with no usable clock (a span of zero,
 * which is what unparseable timestamps read as) falls back to exactly that
 * rather than to a number invented out of a missing timestamp.
 */
function windowsIn(spanHours: number, windowHours: number): number {
  if (!Number.isFinite(spanHours) || spanHours <= 0 || windowHours <= 0) return 1;
  return Math.max(1, Math.ceil(spanHours / windowHours));
}
