/**
 * Where the raid filter's presses go in the URL. Pure and JSX-free — the filter
 * next door owns the rendering, this owns the query string (the same split
 * `season-consumable-picker.ts` uses, and the reason there is no jsdom here:
 * the decisions move out to where a node test already reaches them).
 *
 * Picks are repeated `raid` params rather than one comma-joined value, because
 * a raid name contains punctuation of its own — `Gruul's Lair` — and any
 * separator picked here is a separator somebody's raid name will eventually
 * contain. `URLSearchParams` escapes each one on its own.
 */

const RAID_PARAM = "raid";

/**
 * The current query with its raid picks replaced, keeping every other param.
 *
 * "Every other param" is the whole job: the filter presses while a report,
 * a scope or a preparedness link is already in the URL, and rebuilding the
 * query from the picks alone would quietly close the night being read.
 *
 * An empty selection removes the parameter rather than leaving `raid=`, so the
 * unfiltered URL is the plain one somebody would write by hand.
 */
export function withRaidPicks(currentQuery: string, picked: readonly string[]): string {
  const params = new URLSearchParams(currentQuery);
  params.delete(RAID_PARAM);
  for (const raid of picked) params.append(RAID_PARAM, raid);
  return params.toString();
}

/**
 * The link to one night, carrying the picks with it.
 *
 * This is what stops choosing a night from undoing the narrowing: the press
 * navigates, the server reads these back, and the officer lands on the same
 * shortened list rather than on all of them again.
 *
 * Deliberately built from scratch rather than from the current query — the
 * other params are about the night being *left* (which report, which
 * preparedness tab), and carrying those onto a different night would open it
 * on a tab nobody asked for.
 */
export function nightHref(code: string, picked: readonly string[]): string {
  const params = new URLSearchParams();
  params.set("report", code);
  for (const raid of picked) params.append(RAID_PARAM, raid);
  return `/logs?${params.toString()}`;
}

/** Toggle one raid in or out of the picks, keeping the order they were added. */
export function toggleRaid(picked: readonly string[], raid: string): string[] {
  return picked.includes(raid) ? picked.filter((r) => r !== raid) : [...picked, raid];
}
