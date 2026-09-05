---
name: add-tracked-consumable
description: Track a new consumable, cooldown, totem or uptime aura in projectLC, or rename one. Use when adding an ability id or aura name to the curated WCL lists — covers the re-import that makes the change real and the pricing key that makes it cost something.
---

# Tracking a consumable

**Adding an id without re-importing is a no-op that reviews as correct.** The
events fetch is filtered *server-side by Warcraft Logs*, so a report fetched
before you added the id never contained the event and never will. The app looks
completely healthy and reports zero uses forever.

Read [`docs/change-chains.md` §1, §5f and §5g](../../../docs/change-chains.md)
for the reasoning. This is the procedure.

## The chain

`wcl/consumables.ts` (or `class-tracks.ts`) → `wcl/normalize.ts` →
`wcl/consumable-prices.ts` → **re-import every report**.

`event-filters.ts` builds the filter from those curated lists and
`fetch-report.ts` sends it — you do not touch either. An empty list now throws
at import rather than matching nothing.

## Name or id

**An ability id from a log is a fact; an ability name from a log is not.** WCL
names the *aura*, and the aura is routinely not the item — it renames Protection
to "Armor" and Spirit to "Versatility", and "Versatility" is also what it calls
Elixir of Major Mageblood. A word meaning two consumables is resolvable only by
id, which is why that alias is deliberately absent from `SCROLL_BUFF_NAMES`.

So: take the id to Wowhead and label the entry with the item that lists it as a
use-effect. Do not name an entry from memory — probe a real log (`/probe-wcl`).

Where a rank lives only in the id (scrolls), the name cannot recover it. A
name-matched scroll arrives with no rank and every rank collapses into the
cheapest one — that was 202 Agility IV and 121 Strength IV on this guild's logs.

## Price it, or it is free

Every curated label needs a key in `consumable-prices.ts`. A label with no key
falls through the family fallback, which only catches `elixir of…` and
`…elixir`; anything else lands at **0 gold, silently**. That is how a mana-regen
elixir under its buff name priced at nothing for months.
`consumable-prices.test.ts` walks `SCROLL_LABELS` for exactly this.

One consumable under two labels is **two entries**: one collects every pull, the
other matches nothing, and the gold, the leaderboard row and the icon split
between them with nothing to flag it.

## Renaming one

A label is not a display string — ingest writes it into the row, the price
catalog is keyed by it, and the item cache is searched by it. Stored rows keep
the old label until re-import, so the guild goes on seeing the old name
everywhere nothing has been refetched. **Price both names while old reports
survive.**

## Say the operational half out loud

The change is half-done in code. Tell the officer to re-import, in the UI or in
your summary — this is operational, not cosmetic. `/preflight` has the table of
changes that carry one of these.
