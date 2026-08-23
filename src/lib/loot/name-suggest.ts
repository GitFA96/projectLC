/**
 * "Did you mean…?" for a drop nobody can identify.
 *
 * A drop table and a priority sheet are both written by hand, in names, by
 * people reading a loot list off a screen. `Judgment` for `Judgement`,
 * `Antonidas'` for `Antonidas's`, a hyphen capitalised differently — the exact
 * matching everywhere else in this app is deliberate and right, because a
 * plausible wrong id puts the wrong tooltip under an officer's cursor mid-raid.
 * The cost of that rule is that a near miss becomes a dead end.
 *
 * This is the way back, and it **suggests only**. Nothing here resolves
 * anything: a person picks, and what they pick gets recorded. That is the same
 * division `pickExactItem` makes — the machine is allowed to be certain or
 * silent, and a human owns everything in between.
 *
 * Pure.
 */

import { compareText } from "@/lib/sort";

/** A thing that could be meant, as the caller thinks of it. */
export interface SuggestCandidate {
  /** Already normalized — the caller's own rule, never a second one here. */
  key: string;
  /** What to show a person. */
  label: string;
  /**
   * Lower sorts first among equally-close matches. Callers use it to prefer
   * the same boss over the same zone over anywhere at all, because a misspelled
   * drop is nearly always a drop from the boss you were already writing about.
   */
  rank?: number;
}

export interface Suggestion extends SuggestCandidate {
  /** Edit distance from the query, for showing how close a call it was. */
  distance: number;
}

/**
 * How wrong a name may be and still be worth offering.
 *
 * Scaled to length, because one wrong letter in "Belt" is a different item and
 * one wrong letter in "Antonidas's Aegis of Rapt Concentration" is a typo. The
 * floor of 1 keeps very short names from matching everything; the cap keeps a
 * long name from dragging in half the table.
 */
export function tolerance(key: string): number {
  return Math.max(1, Math.min(4, Math.floor(key.length / 8)));
}

/**
 * Levenshtein distance, abandoned as soon as it cannot come in under `max`.
 *
 * The early exit is what makes this safe to run against every drop in a zone on
 * a page render: most candidates are nothing like the query and stop after a
 * row or two.
 */
export function boundedDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        previous[j] + 1, // deletion
        current[j - 1] + 1, // insertion
        previous[j - 1] + cost, // substitution
      );
      current.push(value);
      if (value < best) best = value;
    }
    // Every path through this row already costs more than we will accept, and
    // distance never decreases as rows are added.
    if (best > max) return max + 1;
    previous = current;
  }
  return previous[b.length];
}

/**
 * The closest few candidates to a name, nearest first.
 *
 * Ties break on the caller's `rank` — same boss before same zone before
 * anywhere — and then alphabetically, so the list is stable between renders
 * rather than reshuffling on every keystroke.
 */
export function suggestNames(
  queryKey: string,
  candidates: SuggestCandidate[],
  limit = 3,
): Suggestion[] {
  if (!queryKey) return [];
  const max = tolerance(queryKey);
  const hits: Suggestion[] = [];
  for (const candidate of candidates) {
    // An exact match is not a suggestion — the caller had no question to ask.
    if (candidate.key === queryKey) continue;
    const distance = boundedDistance(queryKey, candidate.key, max);
    if (distance <= max) hits.push({ ...candidate, distance });
  }
  return hits
    .sort(
      (a, b) =>
        a.distance - b.distance ||
        (a.rank ?? 0) - (b.rank ?? 0) ||
        compareText(a.label, b.label),
    )
    .slice(0, limit);
}
