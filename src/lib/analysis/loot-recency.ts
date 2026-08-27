/**
 * "When" a loot award happened, for the two places that ask.
 *
 * The dashboard card names the raid week's BiS wins and links into the ledger
 * filtered to the same thing. If those two computed the window separately the
 * card would list rows the link doesn't show, which is the quietest kind of
 * wrong: both pages look right on their own. So the window is defined once,
 * here, and both read it.
 *
 * **A raid week is anchored to the last raid, not to today.** An award carries
 * its session's DATE, not a clock time — every award of a night shares one
 * timestamp — and this guild raids twice a week with the Gargul export arriving
 * whenever somebody remembers. Probed on the live data: the newest loot session
 * was 2026-08-19 while the newest log was 2026-08-26, so a literal "last 7
 * days" card was empty on the day it shipped and would stay empty until the
 * next export. Anchoring to the newest session means the card always answers
 * the question actually being asked — "who got their BiS last time out" — and
 * the label carries the real dates so nothing is hidden.
 *
 * Pure, and time is passed in rather than read, per this layer's rules.
 */

/** Days a raid week spans, counting the anchor day itself. */
export const RAID_WEEK_DAYS = 7;

/** Days the rolling window covers, counting today. */
export const RECENT_DAYS = 30;

export type LootWindowKey = "all" | "week" | "recent";

/** The ledger's "when" options, in the order the control shows them. */
export const LOOT_WINDOWS: { key: LootWindowKey; label: string }[] = [
  { key: "all", label: "Any time" },
  { key: "week", label: "Last raid week" },
  { key: "recent", label: `Last ${RECENT_DAYS} days` },
];

export function isLootWindowKey(value: string): value is LootWindowKey {
  return LOOT_WINDOWS.some((w) => w.key === value);
}

/** Inclusive date range, both ends `YYYY-MM-DD`. */
export interface LootWindow {
  from: string;
  to: string;
}

/** `YYYY-MM-DD` shifted by whole days, without a timezone anywhere near it. */
function shiftDays(day: string, days: number): string {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/**
 * The date part of a stored timestamp.
 *
 * Awards store `2026-08-19T00:00:00` — a session date wearing a time. Comparing
 * those as strings works only while every one of them is midnight, which is
 * true today and is exactly the assumption that breaks silently the first time
 * an import records a real clock time. Cutting to the day is the comparison
 * that keeps meaning what it says either way.
 */
export function dayOf(timestamp: string): string {
  return timestamp.slice(0, 10);
}

/**
 * The window a key resolves to, or undefined for "no filter at all".
 *
 * `newestSessionDay` is the most recent raid the guild has loot for; absent
 * when they have none, which collapses the raid week to nothing rather than to
 * an accidental "everything".
 */
export function lootWindowRange(
  key: LootWindowKey,
  newestSessionDay: string | undefined,
  today: string,
): LootWindow | undefined {
  switch (key) {
    case "all":
      return undefined;
    case "week":
      return newestSessionDay === undefined
        ? undefined
        : { from: shiftDays(newestSessionDay, -(RAID_WEEK_DAYS - 1)), to: newestSessionDay };
    case "recent":
      return { from: shiftDays(today, -(RECENT_DAYS - 1)), to: today };
  }
}

/** Does a stored award timestamp fall inside the window? Undefined means yes. */
export function inLootWindow(timestamp: string, window: LootWindow | undefined): boolean {
  if (window === undefined) return true;
  const day = dayOf(timestamp);
  return day >= window.from && day <= window.to;
}
