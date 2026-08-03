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

## Rules

- **Never add a spell id or aura name from memory — probe a real report.** WCL
  matches auras by *exact name*, and TBC buff names routinely differ from item
  names (`Elixir of Major Agility` applies `Major Agility`). Aura names in
  [`docs/class-tracking/`](../../../docs/class-tracking/) were verified against
  this guild's own logs for exactly this reason.
- **Raw JSON is parsed with loose zod schemas.** WCL's blobs (rankings, events)
  aren't covered by its GraphQL schema. Unknown fields must never break an
  import; missing expected fields degrade to "metric unavailable". Keep new
  schemas `z.looseObject`.
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
