/**
 * Where a logged name's on-demand record lives.
 *
 * One function because the link is built from four places that have nothing
 * else in common — the parse boards, the consumable providers, the preparedness
 * table's enchant badge, and the page's own night picker — and a page keyed by
 * a *name* is one encoding mistake away from 404ing on the raiders whose names
 * need encoding most. Lowercased for the same reason the roster's slugs are: a
 * log spells a name however the raider typed it at character creation, and two
 * spellings must not be two pages.
 *
 * JSX-free and pure, like `raid-filter-url` next door, so the decisions are
 * reachable from a node test.
 */

/**
 * The page for one logged name, optionally opening a particular night.
 *
 * Without a report it opens their most recent night, which is what somebody
 * clicking a name in a table means. With one it opens that night — the link
 * from a table that is already about a specific report, where landing on a
 * different one would silently answer a different question.
 */
export function logPlayerHref(name: string, reportCode?: string): string {
  const base = `/logs/player/${encodeURIComponent(name.toLowerCase())}`;
  return reportCode ? `${base}?report=${encodeURIComponent(reportCode)}` : base;
}

/** The gear audit on that page — the anchor the preparedness badge aims at. */
export function logPlayerGearHref(name: string, reportCode: string): string {
  return `${logPlayerHref(name, reportCode)}#enchants`;
}
