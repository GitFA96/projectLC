# src/lib/wcl — Warcraft Logs ingest

```
client.ts        OAuth + GraphQL transport
fetch-report.ts  the queries — and the server-side event filter
normalize.ts     raw JSON → the rows we persist (pure)
consumables.ts   curated consumable knowledge (ids, aura names, categories)
class-tracks.ts  curated cooldowns / uptime auras / totem casts
dispels.ts       curated dispel spells — labels only, never a filter
deployables.ts   the five things laid on the ground; flags casts already fetched
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
several pulls, so the curation queue arrives on its own — that is how the
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
- **A pet has no `combatantinfo`, so its consumables live in the buff stream.**
  WCL writes one snapshot per player per pull and none for a pet. The cast that
  applied a scroll or a meal is usually not logged either — both happen *between*
  pulls, and a log contains no out-of-combat time: one scroll cast in 73,837 on a
  probed full clear, none on a pet, and 3 pet-food casts against 20 pet-food
  auras. `SCROLL_BUFF_IDS` and `PET_BUFF_IDS` put those ids in the **Buffs**
  filter so the pet's own aura stream can answer instead. Read it as a sighting
  and never as a use: a pet re-entering play republishes every aura it holds in a
  single millisecond, so counting them bills a hunter for each summon.
- **Pet food's aura is "Pet Treat", not "Well Fed".** The buff is not named after
  the item — the same trap as Skullfish Soup applying "Enlightened", and the
  reason an earlier probe concluded a pet's fed-ness could not be read at all.
  Match pet consumables by id.

- **A food that names its own buff has to be curated, or its eaters read as
  unfed.**
 TBC dishes don't all apply "Well Fed" — Skullfish Soup applies
  "Enlightened", which sat in the off-slot bucket and cost three raiders their
  food on 84 pulls. `isFoodLabel` recovers those at read time from `extras`, the
  same trick as `elixirCategoryOf`, so curating one fixes the past too. When you
  add a food, check the buff name against the item rather than assuming.
- **A deployable is one press in two shapes, and neither may swallow the other.**
  `deployables.ts` names the Mother Shahraz kit: four items (Goblin Land Mine,
  Thornling Seed, Dog Whistle, Gnomish Flame Turret) curated as consumables and
  one hunter ability (Snake Trap) curated as a cooldown. The list adds **no
  fetch** — it only marks the cast moment, so the item stays priced as spend,
  the ability stays unpriced, and a third view can ask "was the kit down at
  0:05 or at 1:50". Which means every id in it has to already be in
  `TRACKED_CAST_IDS` or `COOLDOWN_CAST_IDS`; one in neither would be curated,
  reviewed, merged and never seen. `analysis/deployables.test.ts` pins it.
- **Three of the four deployable items are named after what they summon.** WCL
  logs the Dog Whistle as `Summon Tracking Hound`, the Thornling Seed as `Plant
  Thornling` and the Gnomish Flame Turret as `Flame Turret` — the same trap as
  Adept's Elixir applying "Spellpower Elixir", so the label is the item and
  `loggedAs` keeps the log's spelling for anyone probing the report. A press
  turning up on six or seven different classes is itself the evidence it is an
  item and not a class ability.
- **Gnomish Flame Turret has a cast time and the other four don't.** It emits
  `begincast` as well as `cast` — 3 real casts against 6 events on the probed
  night. normalize drops `begincast`, which is the only thing keeping three
  turrets from reading as six.
- **Dispels are the one stream fetched unfiltered, and the inversion matters.**
  Every other fetch here is narrowed server-side by a curated list, so a spell
  added later is missing from old reports forever. `Dispels` is small enough
  (492 events across a full MH+BT night) to ask for whole, and normalize stores
  the spell **id** beside the name — so `dispelAbilityOf` classifies when the
  page is drawn and curating a dispel re-grades nights imported months ago. Put
  a `filterExpression` on that fetch and you quietly trade that away. What still
  needs a re-import is the fetch itself: a report older than it has no dispel
  rows at all, and the raid page says so rather than reading as a quiet night.
- **A dispel outside a boss pull needs a zone, and some segments are not raid
  work.** Most dispelling happens on trash — 432 of 492 on the probed night —
  which belongs to no pull, so it is counted per instance from the unfiltered
  `allFights` list. Two traps: a night that ran Hyjal *and* Black Temple answers
  two different questions, so one figure for the night answers neither; and a
  report contains world PvP on the way in. The probed night opened with a duel
  and a skirmish outside Hyjal — twelve purges between players that read exactly
  like cleansing. The discriminator is **a segment with no enemy NPC**, not "a
  segment with hostile players in it", which would also throw away real Black
  Temple trash a stray enemy player wandered into.
- **A totem's cleanse is not in the dispel stream.** Poison Cleansing Totem was
  dropped 51 times in the probed report and produced zero dispel events; no
  source in the whole stream is anything but a Player actor. Same silence as the
  totem *buffs* (see `SHAMAN_TOTEM_CASTS`), so a shaman's cleansing work is the
  drop timeline plus their own casts, and never a number that adds the two.
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
- **An aura's name is not the item's name, and a `label` must be the item's.**
  WCL names the buff — "Spellpower Elixir" for what Adept's Elixir applies — and
  resolves some TBC ids against a *modern* spell database on top of that. Label
  an entry with the buff and you get a **second entry** the day somebody curates
  the item: one consumable's pulls, gold and icon split across two names, with
  nothing to flag it. Take the id to Wowhead and label the entry with the item
  that lists the spell as a use-effect. Renaming a label later is
  [change-chains §5f](../../../docs/change-chains.md) and needs a re-import.
- Some ids are genuinely ambiguous and can't be split — 28499 is both Super
  Mana Potion and Auchenai Mana Potion. Say so in a comment rather than
  pretending precision.

## Curated-list ownership

`class-tracks.ts` is the *what we measure* list and has a written rationale in
[`docs/class-tracking/README.md`](../../../docs/class-tracking/README.md),
including the exclusion philosophy (passive procs, churn auras and whole-fight
prep auras are deliberately not tracked). Read it before adding a track.

See [`docs/change-chains.md`](../../../docs/change-chains.md) §1.
