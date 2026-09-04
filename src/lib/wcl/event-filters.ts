import {
  ELIXIR_BUFF_IDS,
  ELIXIR_BUFF_NAMES,
  FLASK_BUFF_IDS,
  PET_BUFF_IDS,
  SAPPER_CAST_NAMES,
  SCROLL_BUFF_IDS,
  SCROLL_CAST_IDS,
  TRACKED_CAST_IDS,
} from "@/lib/wcl/consumables";
import {
  APPLY_CAST_NAMES,
  BUFF_TRACK_NAMES,
  COOLDOWN_CAST_IDS,
  DEBUFF_TRACK_NAMES,
  SHAMAN_TOTEM_CASTS,
} from "@/lib/wcl/class-tracks";

/**
 * The `filterExpression` each event fetch sends to Warcraft Logs.
 *
 * These are the reason change-chains §1 exists. The fetch is filtered
 * **server-side**, so a report imported before an id joined one of these lists
 * never contained the event and never will until it is refetched: adding an id
 * without re-importing is a no-op that reviews as correct, and the app reports
 * zero uses for ever while looking perfectly healthy.
 *
 * They live here rather than inline in `fetch-report.ts` for two reasons. The
 * strings can be asserted without a network call — `event-filters.test.ts`
 * checks that each curated list actually reaches the expression rather than
 * merely being imported near one. And an empty list becomes a **crash at
 * import**, which is the only loud failure available: an expression built from
 * nothing either matches nothing or asks for the whole log, and both of those
 * are silent for a raid night and then wrong for ever.
 *
 * Not every fetch has one, and the ones that do not are as deliberate as the
 * ones that do — see `UNFILTERED_ON_PURPOSE` at the bottom.
 */

/** WCL's filter language quotes names with double quotes; the trap is forgetting to. */
function quote(name: string): string {
  if (name.includes('"')) {
    // Nothing curated contains one. If something ever does, work out how WCL
    // escapes it rather than shipping an expression the API rejects at import
    // time with a message about syntax and nothing about which name.
    throw new Error(`Cannot put a double quote in a WCL filter: ${name}`);
  }
  return `"${name}"`;
}

/**
 * `ability.id IN (…) OR ability.name IN (…)`, from whichever lists are given.
 *
 * Ids and names both, because the two match different things on purpose: an id
 * pins one exact spell, and a name covers every rank of it at once. Duplicates
 * are dropped — several lists overlap by design, and the expression is sent on
 * every fetch.
 */
export function buildEventFilter(lists: {
  ids?: Iterable<number>[];
  names?: Iterable<string>[];
}): string {
  const ids = [...new Set((lists.ids ?? []).flatMap((l) => [...l]))];
  const names = [...new Set((lists.names ?? []).flatMap((l) => [...l]))];

  const clauses: string[] = [];
  if (ids.length > 0) clauses.push(`ability.id IN (${ids.join(", ")})`);
  if (names.length > 0) clauses.push(`ability.name IN (${names.map(quote).join(", ")})`);

  if (clauses.length === 0) {
    throw new Error(
      "A WCL event filter was built from nothing. Every curated list feeding it is empty, so " +
        "this fetch would either match no events or ask for the entire log — and the first of " +
        "those looks exactly like a raid where nobody used a consumable.",
    );
  }
  return clauses.join(" OR ");
}

/**
 * Casts worth keeping.
 *
 * Sappers and totems are matched by name — one entry covers every rank. Scrolls
 * ride along so a hunter buffing their PET is visible; a raider scrolling
 * themselves is already read off the auras at the pull. `APPLY_CAST_NAMES`
 * rides along for the reason chains §1 spends most of its length on: for a
 * shared debuff the cast stream is the only record of who actually cast it,
 * because WCL credits the aura to whoever holds the window.
 */
export const CASTS_FILTER = buildEventFilter({
  ids: [TRACKED_CAST_IDS, SCROLL_CAST_IDS, COOLDOWN_CAST_IDS],
  names: [SAPPER_CAST_NAMES, SHAMAN_TOTEM_CASTS, APPLY_CAST_NAMES],
});

/** Debuff uptime — curses, Thunder Clap, the rest of the tracked windows. */
export const DEBUFFS_FILTER = buildEventFilter({ names: [DEBUFF_TRACK_NAMES] });

/**
 * Buff uptime, plus four id sets that are here because no snapshot carries them.
 *
 * The flasks because Warcraft Logs leaves them out of the pull's
 * `combatantinfo`; the scrolls and pet food because for a **pet** there is no
 * snapshot at all; the elixirs because the snapshot is taken when the pull
 * starts, so one drunk mid-pull appears in no snapshot anywhere.
 */
export const BUFFS_FILTER = buildEventFilter({
  ids: [FLASK_BUFF_IDS.keys(), SCROLL_BUFF_IDS.keys(), PET_BUFF_IDS.keys(), ELIXIR_BUFF_IDS.keys()],
  names: [BUFF_TRACK_NAMES, ELIXIR_BUFF_NAMES],
});

/**
 * The fetches that ask for everything, and why each one has to.
 *
 * Named rather than left as three bare `undefined`s so that removing a filter
 * is a decision with a place to write itself down, and adding one to a stream
 * listed here is visibly a reversal rather than a tidy-up. `docs.test.ts`
 * asserts these stay unfiltered, because a `filterExpression` on any of them
 * would break a promise the docs make with nothing else failing.
 */
export const UNFILTERED_ON_PURPOSE = {
  /**
   * The stream is already narrow (492 events across a full MH+BT night) and
   * every event names the spell that did the removing — so storing the id lets
   * `dispelAbilityOf` classify at READ time, and a newly curated dispel
   * re-grades reports imported months ago without a refetch.
   */
  Dispels: "read-time classification: a curated dispel re-grades old reports",
  /**
   * The same trade, earned the same way: 262 events across a full night, of
   * which 239 were real interrupts. Filtering would also hide the interrupts
   * nobody thought to curate, which are exactly the ones worth seeing.
   */
  Interrupts: "read-time classification, and the uncurated presses are the point",
  /**
   * An interrupt count with no denominator cannot answer "what did we let
   * through". Narrowing this by ability — or worse, by the abilities we already
   * interrupted — would report a clean sheet for exactly the caster nobody ever
   * kicked. Affordable because it is scoped by PULL instead: 1,084 events
   * across all 23 boss pulls of the probed night, in one page.
   */
  EnemyCasts: "the denominator has to include what nobody kicked",
} as const;
