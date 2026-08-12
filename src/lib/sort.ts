/**
 * One comparator for every sort that orders text.
 *
 * `"a".localeCompare("b")` with no arguments uses **whatever locale the process
 * happens to be running in**, which is the host's, not the guild's. On a
 * Norwegian machine "Åndor" sorts after "Zul"; on an English one it sorts next
 * to "Aandor". The same roster, rendered by the same code, comes out in a
 * different order depending on which box served it — and nothing about the
 * output says why, so it reads as a bug in whatever list you happened to open.
 *
 * `sensitivity: "base"` makes case and accents tie rather than separate, so
 * "Ashbringer" and "ashbringer" land together instead of in two places.
 * `numeric` sorts "Phase 2" before "Phase 10". A shared `Intl.Collator` is also
 * substantially faster than a `localeCompare` per comparison, which matters on
 * the roster-sized sorts this is mostly used for.
 *
 * **Nothing should call `localeCompare` directly.** That includes sorting ISO
 * timestamps and ids, where the locale genuinely cannot matter — the rule is
 * worth more as "always this" than as a judgement to re-make at each call site.
 */
export const compareText: (a: string, b: string) => number = new Intl.Collator("en", {
  sensitivity: "base",
  numeric: true,
}).compare;
