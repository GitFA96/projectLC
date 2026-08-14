# src/lib/wcl — Warcraft Logs ingest

```
client.ts        OAuth + GraphQL transport
fetch-report.ts  the queries — and the server-side event filter
normalize.ts     raw JSON → the rows we persist (pure)
consumables.ts   curated consumable knowledge (ids, aura names, categories)
class-tracks.ts  curated cooldowns / uptime auras / totem casts
consumable-prices.ts, enchants.ts, fight-graph.ts
```

## The one thing to internalise

**Everything is derived at import time.** Pages never call Warcraft Logs. What
a report can show is fixed by the code that existed when it was fetched.

`fetch-report.ts` asks WCL to filter events **server-side** by the curated id
and name lists. A report fetched before you added an id simply does not contain
those events. So:

> Adding a spell id without re-importing is a no-op that reviews as correct,
> passes CI, and reports zero uses forever.

Whenever you extend a curated list, **tell the user to re-import**. That is part
of the change, not a footnote.

You will not always be the one who notices. An import stores the auras it could
not place on the report and files a feedback report for anything that shows up at
several pulls, so the curation queue arrives on its own — that is how the two
vanilla flasks below were found, after eleven pulls of one had already graded as
"no flask".

## Rules

- **Never add a spell id or aura name from memory — probe a real report.** WCL
  matches auras by *exact name*, and TBC buff names routinely differ from item
  names (`Elixir of Major Agility` applies `Major Agility`). Aura names in
  [`docs/class-tracking/`](../../../docs/class-tracking/) were verified against
  this guild's own logs for exactly this reason.
- **A label stored by ingest is looked up again later.** `elixirCoverage` asks
  `elixirCategoryOf` which slot an elixir fills, from this same curated list, at
  read time. So adding an elixir here re-grades reports imported months ago
  without a refetch — the one place that rule doesn't apply. An elixir the list
  doesn't name still counts as coverage (the pattern fallback in `classifyAura`
  catches it) but stays unplaced, and the raid page names it for curation.
- **A food that names its own buff has to be curated, or its eaters read as
  unfed.** TBC dishes don't all apply "Well Fed" — Skullfish Soup applies
  "Enlightened", which sat in the off-slot bucket and cost three raiders their
  food on 84 pulls. `isFoodLabel` recovers those at read time from `extras`, the
  same trick as `elixirCategoryOf`, so curating one fixes the past too. When you
  add a food, check the buff name against the item rather than assuming.
- **Raw JSON is parsed with loose zod schemas.** WCL's blobs (rankings, events)
  aren't covered by its GraphQL schema. Unknown fields must never break an
  import; missing expected fields degrade to "metric unavailable". Keep new
  schemas `z.looseObject`.
- **One mob is not one actor id.** A debuff's `applydebuff` can name a different
  `targetID` than its own stacks and removal — probed on a Vashj pull: id 161 for
  the apply, 163 for everything after, same name, same `targetInstance`. Uptime
  accumulators therefore key on **target name + instance**, in both
  `normalize.ts` and `fight-upkeep.ts`. Keying on the id split one debuff in two
  and left the half holding the apply with nothing to close it, so it ran to the
  end of the fight and won `bestPct` — 763 stored track entries were inflated
  that way, up to 88% off one application on an add that lived twelve seconds.
- **A death recap is one fetch per pull that had a death**, filtered to the
  players who died in that pull. Not per death — 97 queries on a quiet night —
  and not the whole night, which is ~5,000 events in the first page alone. See
  `fetchDeathRecapWindows`.
- **Only `removedebuff`/`removebuff` close a window.** `removedebuffstack` is one
  stack expiring off a debuff that is still up. The two paths above must agree on
  this; they claim to share the same interval rules.
- **`normalize.ts` is pure** — no db, no network. That's what makes
  `normalize.test.ts` possible.
- Ids under-count when wrong, names break when wrong. Prefer id matching for
  casts, name matching for auras (all ranks, no id list to maintain).
- Some ids are genuinely ambiguous and can't be split — 28499 is both Super
  Mana Potion and Auchenai Mana Potion. Say so in a comment rather than
  pretending precision.

## Curated-list ownership

`class-tracks.ts` is the *what we measure* list and has a written rationale in
[`docs/class-tracking/README.md`](../../../docs/class-tracking/README.md),
including the exclusion philosophy (passive procs, churn auras and whole-fight
prep auras are deliberately not tracked). Read it before adding a track.

See [`docs/change-chains.md`](../../../docs/change-chains.md) §1.
