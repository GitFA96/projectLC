# Change chains — what else you have to touch

Most bugs in this codebase are not wrong code. They are **incomplete changes**:
the edit is correct, it compiles, its test passes, and it does nothing — because
a second or third place had to change with it.

This file lists those chains. If you are about to change something in the left
column, read the chain before you start.

> Keep this file about *couplings*, not inventories. A chain earns a place here
> only if missing a step fails **silently** — no type error, no red test.

---

## 1. Track a new consumable, cooldown, totem or uptime aura

**Chain:** `src/lib/wcl/consumables.ts` (or `class-tracks.ts`) → `src/lib/wcl/normalize.ts`
→ **re-import every report**.

The events fetch is filtered *server-side by Warcraft Logs*. `fetch-report.ts`
builds a filter expression out of the curated id/name lists:

```
ability.id IN (TRACKED_CAST_IDS ∪ SCROLL_CAST_IDS ∪ COOLDOWN_CAST_IDS)
  OR ability.name IN (SAPPER_CAST_NAMES ∪ SHAMAN_TOTEM_CASTS)
```

The Buffs fetch is filtered the same way (`BUFF_TRACK_NAMES` ∪ `FLASK_BUFF_IDS`
∪ `SCROLL_BUFF_IDS` ∪ `PET_BUFF_IDS`), so it carries the same cost. Every id set
is there for one reason — the pull's `combatantinfo` cannot carry it. The flasks
because Warcraft Logs leaves them out of the snapshot; the scrolls and pet food
because for a **pet** there is no snapshot at all (§5e).



So a report fetched **before** you added the id never contained the event, and
never will until it is re-fetched. The app will look completely healthy and
report zero uses forever.

- Adding an id without re-importing is a **no-op that reviews as correct**.
- Say so in the UI or the summary when you add one, so the officer knows to
  re-fetch. This is operational, not cosmetic.
- Buff-style auras (`classifyAura`) come from the pull's `combatantinfo`
  snapshot and match **by name first**, so those degrade more gracefully — but
  they still only appear in reports fetched after the name was known.

**Warcraft Logs credits a shared debuff to its owner, not to its caster.** There
is one Sunder aura on a target, and every event of it is filed under whoever
holds the window — so the player who opened it collects everyone else's work.
Probed on the 09 Aug Hydross kill: Byrd cast Devastate 78 times, Turdlord cast
Sunder Armor twice, and all 80 aura events came back under Turdlord. Read
straight, that is a fury warrior with 98% uptime and a protection warrior who
never sundered.

The repair is the cast stream, and it has three parts that must move together:
a track names its `appliedBy` casts (`class-tracks.ts`), `fetch-report.ts` puts
those names in the **casts** filter, and `normalize.ts` matches each aura event
to the nearest such cast on that target — every one of 1900 events across three
reports sits within 3ms of one. Miss the fetch step and the matcher silently
finds nothing and falls back to the log's own attribution, which is the bug it
exists to fix. **Devastate is the one nobody expects**: it is how a protection
warrior stacks Sunder, it applies the aura under its own cast name, and it is
the cast the tank actually spams.

Two consequences. A matched aura event hands the window over — the previous
holder's interval closes at that millisecond and the caster's opens — so
per-player intervals stay non-overlapping, the same shape the log produces for
the owner it picked. And "first sighting" rules have to ask about the **target**,
not the accumulator: a hand-over is the first thing the new holder's accumulator
ever sees, and treating that as a pre-pull application backdates their window to
0:00 (four warriors summing to 124% of a Lurker pull).

**A shared debuff needs two numbers, and they answer different questions.**
Uptime accumulates per source, which answers "did this raider do their job" and
cannot answer "was Sunder up on the boss" — the one the council asks. `mergeTargets`
in `analysis/debuff-merge.ts` unions every source's intervals per target: **union,
never sum**, since two warriors covering the same thirty seconds kept it up for
thirty. It reads `segments` that are already stored, so it answers for nights
imported months ago. Stacks are the other half: `applications` splits into
`stackUps` and `refreshes`, and `stackPoints` records the value the log reported
so `stackSpans` can reconstruct the target's real stack timeline from every
source's contributions. **Refreshes are derived, never counted** — one landed
Sunder emits a stack event and a refresh at the same millisecond, so counting
both would depend on which the log sends first and could exceed the casts they
split. The same-millisecond rule has an exception in the other direction: two
`applydebuffstack` events at one timestamp carrying *different* stack values are
two casts, not one, so the dedupe keys on timestamp **and** value. Whether the
split is *reported* is asked per pull, not per player — a warrior who only ever
refreshed raised no stacks, and hiding their split reads as "not recorded" when
the answer is "0 raised, 4 renewed". Stacks and attribution need a re-import;
the merge does not.

**A stack point is not an interval, and reading it as one invents uptime.** The
log says "somebody pushed it to N at T" and announces the drop somewhere else
entirely — in the `removedebuff` that closes a *segment*. So the stack timeline
has to be clipped to the segments (`stackSpans` takes both), or the last value
runs to the end of the pull: a real Hydross pull read Sunder up 10% of the fight
and at five stacks for 90% of it, from the same row. Inside a window the stack
opens at 1, because the log only numbers stacks from 2 up — so a re-application
after a drop starts over and must not inherit the previous window's five.

**Death recaps are fetched per pull, not per death or per night.** Per death is
~97 queries on a quiet night against an import that otherwise costs about seven;
the whole night unfiltered is ~5,000 events in the first page alone and pages
further. `fetchDeathRecapWindows` asks once per fight that had a death, filtered
to the players who died in *that* fight — about a dozen extra calls for a raid —
and `normalize` slices each death's own window out. The window is duplicated as a
plain number in `normalize` rather than imported from the fetch layer, because
normalize is pure and must not depend on it; the fetch deliberately asks for
slightly more than the slice keeps.

**Change an interval rule and you have two places, not one.** `normalize.ts`
computes uptime at import and `fight-upkeep.ts` computes it live for one pull,
and their comments say they share the same rules — which is exactly why a fix
lands in one and rots in the other. Both were wrong the same way: keyed on the
raw `targetID`, while WCL puts a *different* id on a debuff's `applydebuff` than
on its stacks and removal (probed: 161 for the apply, 163 for the rest of the
same Enchanted Elemental, instance 24 throughout). One debuff became two
accumulators, the half holding the apply never met its removal, and an unclosed
window is credited to the end of the fight — which then wins `bestPct`, because
the headline is the best single target. It read 88% off one application on an add
that lived twelve seconds. Both now key on **target name + instance**, and only
an exact `removedebuff`/`removebuff` closes a window (`removedebuffstack` is a
stack expiring off a debuff that is still up).

**A stored uptime number is only as good as the code that imported it.** The fix
above corrects new imports; 763 track entries already in the database keep their
inflated figures until those reports are re-imported, because the events behind
them were never stored. Same rule as the curated lists above.

**An import now files its own blind spots.** Auras seen at boss pulls that
`classifyAura` can't place are stored on the report
(`wcl_reports.unclassified_auras_json`) instead of being shown once in the import
result and lost, and anything appearing at several pulls opens a feedback report
from the import path — deduped by ability id against every existing report, open
or resolved, because the same aura turns up every raid night. The threshold is a
plain const in the import action, deliberately not a policy field (§4b): it
decides whether the app writes itself a note, not what any loot verdict is.

Two things follow for whoever curates the aura next. The stored dump is what lets
a curation say **which** reports are worth re-importing — `findStaleReports` asks
today's tables about each report's dump and badges the row beside its refetch
button, but only for reports imported after the column existed, so it says nothing
about older nights. And filing is best-effort: it runs after the import has
committed and swallows its own errors, because losing a night's data over a
self-addressed note would be a bad trade.

**Only a consumable makes a report stale.** An aura later ruled a class buff —
`Greater Intellect` was, after the auto-filer flagged it and a probe showed a mage
applying it to themself — changes nothing measurable, so flagging it would spend
an officer's evening tidying a dump. `findStaleReports` takes the classifier as an
argument and counts only what now classifies.

**Uptime tracks record their own staleness.** Every report stores the aura names
it was fetched with (`WclReport.upkeepTracks`, stamped in `saveWclReport`), so a
reader can tell "the raid never applied this" from "this report predates the
track" — the sim context audit turns that into either a finding or a "refetch
this report", and it can only do so because the record exists. Nothing else is
self-describing this way: cast ids, consumables and totems still need the rule
above.

**Facts keep turning up that were fetched all along and thrown away at
normalize.** The pre-potted potion's name, the timestamp on every death, the
label of a food whose buff isn't called "Well Fed", and the *killing blow* — WCL
puts `killerID` and a named `killingAbility` on every death event, and because
the events query already asks with `useAbilityIDs: false` the ability arrives as
"Arcing Smash" rather than an id to look up. All of them arrived in the events
and were reduced to a boolean or a counter. Recovering them needed no new query —
only storing what was already there — but it is still §1: the rows already in the
database don't have them, so **a re-import is what fills them in**, and each
feature says so on screen rather than reading as "no data".

The death record shows the gentlest version of that: `deathTimes` widened from
`number[]` to records, and its zod schema accepts **either**, so a bare number
from an older row parses to a record holding just the time. No table rebuild, and
the UI says "cause not recorded" for those rows instead of inventing one.

The food label is the exception that shows the pattern: it lands in `extras`
rather than being dropped, so `hasFood` recovers it at read time and curating a
new food re-grades every report already imported. Prefer that shape when the
label survives somewhere — a re-import you don't have to ask for is worth more
than a tidier column.

Worth generalising: before adding a fetch, check whether normalize is already
receiving the field and discarding it.

**One curated fact is read back at *read* time.** Ingest stores an elixir's
canonical label and drops its battle/guardian category, so `elixirCategoryOf`
looks the slot up again when the preparation grade is computed. That inverts the
rule above: placing an elixir in `AURA_DEFS` re-grades **every report already
imported**, with no refetch. The flip side is that an elixir the list doesn't
name is still *counted* — the name-pattern fallback catches it — but not
*placed*, and the raid page names it rather than guessing which half of the set
is missing.

**Never add a spell id or aura name from memory.** WCL matches auras by exact
name and TBC buff names routinely differ from item names (Elixir of Major
Agility applies `Major Agility`). Probe a real report first.

**`combatantinfo` is not a complete list of what a raider had at the pull.**
Preparation is graded from the pull's aura snapshot, and that snapshot silently
omits some auras. The Unstable Flasks are the known case: a raider drank one
five minutes before the pull, the snapshot at that pull lists eight auras with
no flask among them, and the preparation column showed a red cross all night on
the figure that feeds the loot score. Curating the ids could never have fixed
it — they were already curated, against an array the aura never appears in.

Those flasks are read from `applybuff`/`removebuff` intervals instead
(`FLASK_BUFF_IDS`, stamped in normalize step 5b) and never overwrite something
the snapshot did observe. **Before concluding "the raid didn't use X" from the
snapshot, check the buff stream for it** — and use `fightIDs` when you probe,
because the `startTime`/`endTime` form of the events query returns zero for
everything, including a control you know is there. That silent zero is how the
absence looked confirmed the first time.

**Quote names with double quotes in a filter expression.** `ability.name IN
('Rend')` matches nothing and reports no error — the query succeeds and returns
zero rows, which reads exactly like "the raid never did this". A probe built
that way once looked like proof that a debuff was absent.

**The escape hatch: fetch live for one pull.** `fight-casts.ts` and
`fight-upkeep.ts` query WCL at the moment somebody asks, unfiltered by the
curated lists, for a single fight. A question asked that way answers for reports
imported long before the question existed — no refetch. It costs a round trip
per pull, so it suits a panel someone opened, not a page everyone loads.

## 2. Add a persisted field

**Chain:** `db.ts` schema + `migrate()` → `store.ts` (`EntityStore`) → `sqlite-repo.ts`
→ `repo.ts` (`Repo`/`WriteRepo`) → `types.ts` → `import/schemas.ts` if it is
seedable → `sqlite-repo.test.ts`.

The step that fails silently is `migrate()`. A `CREATE TABLE` in the schema
string only runs for a **fresh** database, so:

- a new column added to the `CREATE TABLE` block works perfectly in tests and on
  a new install, and throws on the user's existing `data/projectlc.db`;
- every column added after the first release needs an `addColumn(table, column, ddl)`
  line in `migrate()` as well — that helper is idempotent and is the only path
  that reaches an existing database.

Changing a **primary key or constraint** cannot be done with `addColumn`; SQLite
needs a table rebuild (create new → copy → drop → rename). There are worked
examples in `db.ts` (`current_gear_overrides_spec`, `items_relaxed`).

**The `INSERT OR REPLACE` trap.** Several `insert*` writers name their columns
explicitly and are used as the *update* path — `updateCharacter` calls
`insertCharacter`. OR REPLACE deletes the row and reinserts it, so a column
missing from that list is set back to its default on **every update**, not just
on insert. Nothing fails: the write succeeds, the tests pass, and the field
empties out whenever somebody edits something unrelated. `characters.membership_id`
is the live example — an officer fixing a raider's spec would have silently
unclaimed their account.

Two things follow. Add the column to the writer's list in the same change. And
if the value is not part of the caller's draft, read it **from the row**, not
from the read model — `updateCharacter` uses `getCharacterMembershipId` because
a read model that has not caught up yet would hand back a null and the preserve
would preserve nothing.

## 3. Add a per-report setting

**Do not create a table.** Per-report officer settings live in `meta` under a
namespaced key. The ones that exist:

| Key | Written by |
|---|---|
| `consumable_prices:<code>` | `setReportConsumablePrices` |
| `excluded_fights:<code>` | `setReportExcludedFights` |
| `consumable_adjustments:<code>` | `setReportConsumableAdjustments` |
| `raid_board:<code>` | `setRaidBoard` |
| `template_board` | `setTemplateBoard` (guild-wide, no suffix) |
| `guild_roster:<id>` | `setGuildRoster` / `updateGuildRoster` (one row per named roster) |
| `guild_policy` | `setGuildPolicy` (guild-wide, no suffix) |
| `sim_profile:<class>:<spec>` | `setSimProfile` (not per report — per class and spec) |
| `sheet_item_ids` | `setSheetItemId` (guild-wide, no suffix) |
| `repair:<name>` | one-off data repairs in `migrate()` — a sentinel, not a setting |

**`excluded_fights:<code>` reaches every page that counts a pull, not just the
raid page.** It is the officer's "this one doesn't count" switch, and it used to
be read by `getRaidReport` alone — so excusing the farm boss cleaned up that
night's figures and left the same pulls scoring against every raider on their
own page, on the standing board and in the loot score. The read model now
filters on it in `careerRowsOf` and in `getCharacterPerformance`, which is what
makes one switch mean one thing. A new consumer of pull rows has to decide
whether it counts excused pulls, and the answer is almost always no.

The character page keeps the excused rows and marks them
(`PerformanceReportView.excusedFightIds`) rather than dropping them: the parse
on a farm boss is still worth reading. Only the summary is over the counted
ones.

**`consumable_adjustments:<code>` is saved as a whole list**, from one surface:
the panel a row of the gold table expands into. The save sends the entire list,
so it carries the snapshot it rendered with — two officers editing the same raid
at once means the later save wins outright rather than merging. If it ever
matters, the fix is a targeted upsert per (raider, consumable), not more client
state.

Which entry a ± press lands on is `bumpAdjustment` in
`analysis/consumable-adjustments.ts`, pure and tested there rather than in the
component: **one correction per raider per consumable**, with any reason written
against it carried through the press. It used to leave a noted entry alone and
append beside it, because the ± sat in the ranking row while the reason was
written in a separate card — a button must not silently change the number a
sentence elsewhere refers to. That card is gone and both now sit on one line of
one panel, so the premise lapsed. Old data with a split pair still totals
correctly: `applyAdjustments` sums every entry either way.

**Attribution is stamped server-side, never sent by the client.**
`attributeAdjustments` compares the incoming list against the stored one and
gives this officer's name only to entries that are new or changed — matching on
(raider, consumable, note, delta). Restamping everything would credit whoever
saved last with corrections another officer made months ago; trusting the
client's `by` would let it claim the reverse. The name comes from
`actingOfficer()`, the same helper every governance write uses.

**The corrections log groups by `at`, so a save must stamp one timestamp.**
`attributeAdjustments` takes a single `at` and puts it on every entry the write
touched, which is the only thing making a batch recoverable — there is no batch
id. Move that `new Date()` inside the per-entry loop and each correction gets its
own millisecond, the grouping silently degrades to one chunk per line, and
nothing fails: no type error, no red test beyond the ones in
`corrections-log.test.ts` that exist to catch exactly this.

**A correction is read back in two places, and the second spans raids.**
`getReportConsumableAdjustments` serves one night; `listConsumableAdjustments`
serves the corrections log on `/guild/audit?tab=corrections`, which exists to
answer "has anyone been adjusting this raider" and cannot be asked one report at
a time. A correction whose report was later deleted still appears there under its
bare code — reports get re-imported, and a record that vanishes with its report
is not a record.

**A ± press is not a write.** The presses buffer in `GoldTable` and go out as
one list when the officer saves, because each write busts the whole route cache
and re-ranks the table — one write per click meant the rows moved between
clicks. Two consequences for anything added to that table:

- **The row order and the badge order within a row are computed against the
  *saved* adjustments, never the pending ones**, so nothing re-sorts under a
  cursor mid-batch. Every number still moves on the press; only the sort waits.
  A new column that sorts or filters on adjusted values has to make the same
  split or it will reintroduce the jumping.
- **The buffer re-seeds from the server prop only while it is clean.** A save
  refreshes the route and streams the written list back down; taking that over
  unsaved presses would swallow whatever was clicked while it was in flight.
- **An open batch blocks navigation** through `useUnsavedGuard`, which listens
  for link clicks on the document in the capture phase — `beforeunload` alone
  covers a reload and nothing else, and the links that lose the work belong to
  components that have no idea it is open. It cannot cancel browser back or
  forward, so each panel keeps an unsaved marker visible rather than relying on
  the dialog.

**A panel using `useUnsavedGuard` must leave through the `leave` it returns, not
`router.push`.** The gold table and the price panel can both be dirty at once,
and a raw push out of the first dialog would drop the other's edits without ever
mentioning them. `leave` asks each remaining dirty panel in turn and navigates
once nobody objects; only the first-armed panel answers a click, so the turns
never overlap and two dialogs never stack. A third panel gets this for free —
what it owes is a *stable* `onIntercept` (a `useState` setter or a
`useCallback`), or the listener re-registers every render.

Deriving `dirty` by comparison rather than a flag is what keeps these honest: an
edit typed back to its saved value is not a change, and the price panel has to
compare through the same rounding `save` applies or a charges box left at 0
reads as dirty forever against the 1 that was written.

**`raid_board:<code>` is the one per-report setting that is not a correction to
something derived.** Warcraft Logs records no group assignments at all, so a
night's groups exist only if an officer wrote them down — there is nothing for
the import to fill in and nothing for a refetch to overwrite. Four things to
know before you touch it:

- A board is **scoped to its raid and nothing else.** The template and each
  guild roster save to their own keys, and switching pools never carries an
  arrangement across — otherwise one night's record would overwrite another's on
  the next save.
- **A slot's identity is its `id`, falling back to its name.** A raid night's
  slots are people, so the name *is* the identity and `id` stays absent; the
  template's are class/spec archetypes, and a raid wants three Resto Druids, so
  those carry ids. Everything that moves a slot keys on `slotKey`, which is why
  both boards run through one set of tested primitives. Deduping by name in a
  new code path would silently collapse the template's twins.
- **Two encodings, and they are not interchangeable.** `encodePlan`/`decodePlan`
  is the shareable `?plan=` token — the whole board, base64url'd, with slot ids
  minted fresh on read rather than transmitted. `boardFingerprint` is what
  autosave keys on, and it never appears in a URL: it hashes ids and labels,
  which `encodePlan` deliberately drops. Reaching for the wrong one either
  leaks private ids into a link or leaves an officer renaming a group and
  watching "Saved" never move.
- **A board opened from `?plan=` must not autosave.** The recipient has a plan
  of their own; overwriting it the first time they nudge a slot is the worst
  possible way for them to find out. The board takes a `shared` prop and waits
  for "Save as our plan".
- **The board writes are the only ones that skip `bumpDataVersion`**, and
  the exception is deliberate: nothing derived reads a board (both getters go
  straight to `meta`, like prices), so the bump would rebuild the whole read
  model to change nothing. The boards autosave as an officer drags people
  around, which turns that waste into lag. If a board ever feeds something
  derived, the bump has to come back — see §4.
- It holds **names, not ids**, so it outlives a deleted character rather than
  dangling; the board renders the name and flags it as unknown to the pool.
- **An empty board deletes the row**, so "never laid out" and "laid out, then
  cleared" are deliberately the same state.
- Slots grew a `spec` (an officer counting a raider as their off-spec), so a
  stored slot is `{name, spec?}` — but `sanitizeBoard` still accepts the
  bare strings boards were saved as before that, and must keep doing so. A
  stored board is the record of a real raid night; the old shape has no
  migration and needs none.

**`guild_roster:<id>` breaks two of the rules above, on purpose.** These are the
guild's own named rosters — several at once, because a guild that runs a split
has more than one — and they are the only board key that is neither
per-report nor guild-singular:

- **An empty board keeps its row.** `nothingToRemember` deletes a raid night's
  cleared board because "never laid out" is worth nothing to store. A roster
  exists because an officer made and named it, so clearing it must not take the
  name with it. Don't route these through that helper.
- **One row, three writers.** The row holds the name, the trials and the
  board, and each is edited by a different control — the board
  autosaves as an officer drags, the other two are deliberate edits. They all go
  through `updateGuildRoster`, which is read-modify-write inside the caller's
  transaction. A blind full write from any one of them drops the other two, and
  the officer finds out when a roster they renamed loses its groups.
- **A deleted board is not resurrected.** `updateGuildRoster` returns silently
  when the row is gone: an autosave still in flight from another tab must not
  bring back a roster somebody deleted.
- **`LIKE 'guild_roster:%'` is wrong** — `_` is a single-character wildcard in
  SQL LIKE. The listing query escapes it. Nothing writes a key that would
  collide today, which is exactly why a future one would go unnoticed.
- **Trials never become characters.** A prospect is a name on one board, with no
  row anywhere else. Creating a character to answer "would a second resto shaman
  help" would put somebody who has never raided into attendance, loot priority
  and every other page that counts the roster.

**`?board=` decides which board is open, and `selectBoard` is the only thing
that reads it.** `template`, `roster:<id>`, or a bare report code; anything else
is the default, which is the guild's first roster. **There are no aliases for
older spellings** — this page has been renamed twice and every legacy value was
dropped on purpose. Add a kind of board and it goes in that function, with a
test; a page that parses the parameter itself is how a stale link quietly starts
opening the wrong thing.

**Renaming a `?board=` value is only safe when the old spelling becomes
unrecognised.** `roster` used to mean the template and now names the *other*
tab, so the current value is the plural `rosters` — an old `?board=roster` falls
through to the default instead of opening a board it never meant. The same rule
saved `BoardTarget`: `"roster"` changed from the template to a guild roster, and
it is safe only because the new one carries an `id` the template never had, so a
stale `{kind: "roster"}` fails the discriminated union rather than writing one
record over the other. Give any fourth kind a field of its own for that reason —
bare string literals with no shape between them are one rename from crossing two
records in silence.

**`sim_settings:<slug>` is retired but not deleted.** Sim setups used to be per
character. `promoteSimSettingsToProfiles` in `db.ts` copies each one into its
spec profile on boot, resolving the spec from the setup's talent totals against
the builds this guild's logs have already named — and copies rather than moves,
because that fingerprint is genuinely ambiguous for some builds (the logs call
0/44/17 Feral, Guardian *and* Warden). What it can't place stays put and is
offered on the spec page for an officer to adopt by hand. Nothing reads the old
key otherwise; don't add a reader.

Each has a `get…` that returns an **empty value meaning "unset, use defaults"**,
and a sanitizer that drops junk on read — so a hand-edited or stale row can
never crash a page. Follow the existing shape rather than inventing another
pattern, and add the key to the table above.

## 4. Any write, ever

**Chain:** write via `WriteRepo` → `bumpDataVersion(db)` → `refreshAfterWrite(path)`.

> The board writes are the one documented exception to the bump — nothing
> derived reads them. §3 says why. Don't take it as licence for the next write.

Two independent caches, two independent mistakes:

1. **The derived read model.** `sqlite-repo.ts` builds the whole read model in
   memory once (`createRepoFromStore`) and rebuilds it lazily when `data_version`
   changes. A write that doesn't call `bumpDataVersion` commits to disk and
   stays invisible until the process restarts. Every write method in
   `sqlite-repo.ts` calls it — copy a neighbour.
2. **Next's route cache.** Call `refreshAfterWrite()` from `src/lib/refresh.ts`,
   never `revalidatePath()` inside a try block. The reasoning is in that file's
   header and it is not stylistic: a throw from the cache layer lands in the
   action's catch, the officer is told the write failed seconds after it
   committed, they retry, and the ledger gains a duplicate award.

There is a third cache that neither of those reaches: **anything memoized at
module scope**. `data_version` rebuilds the read model, but it cannot clear a
`let` in a module — that value lives as long as the process. So the moment
something seeded becomes something writable, its parse cache has to move inside
`createRepoFromStore`, where it dies with the model that owns it. The priority
sheet is the worked example: as a seed module a process-lifetime cache was
correct, and the day it became pasteable that same cache would have made every
paste report success and change nothing until a restart.

## 4a. Change what a loot decision records

`loot_awards.decision_json` freezes the board as it read when an award was made
— score, rank, factor arithmetic, the chain, and the weighting in force.

Two rules it lives or dies by:

- **Capture it server-side, from live contention.** It is computed inside
  `addLootAward`, never taken from the caller: a client-supplied score can be
  stale or simply wrong, and a snapshot's only value is being the arithmetic the
  app actually produced.
- **Never recompute it for display.** The weights have moved on; a recomputed
  score answers a question nobody asked. `AwardDecisionNote` renders the stored
  object and says so on screen.

NULL means the award never came from the ranking (a Gargul import, a hand-added
drop, an off-roster destination). It does **not** mean the winner scored zero,
and no view may present it as if it did.

## 4a2. Amend an award after it is recorded

**Chain:** `updateLootAward` / `deleteLootAward` (the write **and** its audit
line, one transaction) → `loot.amend` where a date moves → the `loot.*` kinds
the audit page's **Ledger** tab reads.

Three things here are easy to get half-right:

- **The date and the raid session are different facts.** `awardedAt` is when the
  item was won; the session is the import it arrived in. A re-date changes the
  first and leaves the second, so the two can legitimately disagree and the
  editor says so on screen. Re-filing the award under another night to keep them
  aligned would rewrite a second raid's record to fix one row.
- **An absent `awardedAt` means "leave it", never "today".** Every edit that
  isn't a re-date omits it, which is what keeps a Gargul timestamp — including
  its time of day, which survives a re-date too — from being quietly rounded to
  noon by an unrelated fix.
- **The audit line commits with the change.** Written inside the same
  transaction from the repo, not logged beside it in the action: an award that
  moved with nothing saying who moved it is the state this exists to prevent.
  No actor, no line — the repo is also driven by imports and tests, and "an
  officer" against a Gargul paste would be a lie in the record.

`loot.award` records new loot; `loot.amend` rewrites recorded loot, and
`can.test.ts` pins that neither implies the other. Everything derived from
"when" — recency, fairness windows, ledger order — reads the date, which is why
it is the one field with its own grant.

## 4b. Add a policy field

**Chain:** `analysis/policy.ts` (type + default) → `db.ts` `sanitizePolicy` →
the module that reads it → `policy-editor.tsx` → `policy.test.ts`.

Two steps fail quietly:

- **`sanitizePolicy` is an allowlist.** A field the sanitizer doesn't name is
  dropped on read, so the editor saves, the page reloads, and the value is
  simply back to its default with no error anywhere.
- **The default must reproduce today's behaviour.** `policy.test.ts` asserts the
  whole default object for exactly this reason: adopting a field must change no
  number until an officer edits one, and a "harmless" default that differs from
  the constant it replaced silently re-ranks the guild's loot.

Anything scored takes the policy as an argument with `DEFAULT_POLICY` as its
default — never imports the repo — so `src/lib/analysis` stays pure (§7).

## 4d. The standing board

**Chain:** `analysis/standing.ts` → `policy.roster` (§4b) → `policy-editor.tsx`
→ `store.ts` `getRosterStanding`.

It reads the same `RaiderMetrics` the loot score does and deliberately answers a
different question, so two things must stay true:

- **Loot owed never enters it.** Being owed loot is not a demerit. If it ever
  appears here, the board has become a second loot score.
- **Only placeable raiders set the scale.** Percentiles and distributions are
  drawn from raiders above `roster.minRaids`, not from everyone listed. Drawing
  them from everyone lifts every regular's placing — measured on the real
  roster, including the fourteen alts and trials moved the parse floor from 38
  to 7 and flattered all twenty-seven placed raiders.
- **One pool per group.** `buildRosterStanding` builds mains and alts
  separately, and `buildStandingBoard` ranks whatever it is handed. Pooling them
  is the same failure in a different coat: on this roster it put two alts at the
  bottom of the mains list and lifted the attendance median from 82 to 70.

**`roster.weights` is the one nested record in the policy.** `sanitizePolicy`
walks it explicitly, `resolvePolicy` merges it explicitly, and
`savePolicyAction` merges it explicitly. Miss any of the three and saving one
weight silently resets the other two — the generic one-level code handles every
other group and cannot handle this one.

## 4e. The development series

**Chain:** `analysis/development.ts` → `store.ts` `developmentOf` → the raider's
performance page, and `parseTrend` → `analysis/standing.ts` → the board's Trend
column.

One series feeds both, deliberately: the page and the board must never disagree
about which way somebody is going.

**The window is capped at half their nights.** It starts from
`attendance.recentRaids` — reusing the council's answer to "how far back is
recent" rather than adding a knob that means almost the same thing — but a
window that covers every night a raider has logged leaves nothing to compare
against. Uncapped, on the real roster, that produced a trend for **one of
twenty-seven** raiders. A comparison needs two sides.

**The trend is never scored.** It rides on `StandingInput` and out again to the
column. Making it move a placing is a policy change (§4b), not a fix: a raider
climbing and a raider arriving are different, and the board deliberately says
where somebody is while the trend says where they are heading.

## 5. Change how a consumable is priced or counted

**Chain:** all three call sites must agree — `src/app/logs/page.tsx`,
`goldPerRaid` in `analysis/comparison.ts`, `summarizeSeason` in `analysis/season.ts`.

They each independently build a `costPerUseMap` and apply
`adjustmentsFor`/`applyAdjustments`. That duplication is deliberate (different
inputs, different scopes) but it means a rule added to one makes **the same raid
night read two different ways** on the raid page and the career page. Nothing
catches this but a test that compares them.

**Two of the three read the same rows; all three must read the same *set* of
them.** A consumable used away from a boss pull has no fight row and arrives as
an off-pull record instead, so any count built from `WclPlayerFight` alone is
silently a boss-pull count. That is what went wrong: `goldPerRaid` folded
off-pull in, `summarizeRaidReport` did not, and the raid page priced one
raider's night at 80g against the 287g his career page charged him — while
showing 6 of the 21 sappers he threw. Probed on mbwNGRaxhPHMTpKB: 43% of that
night's sappers, 13% of its potions and ~315g were used on trash.

`summarizeRaidReport` now folds it in, and `summarizeSeason` inherits that
through `RaiderUsage`. Three rules hold it together:

- **Fold only into raiders who hold an included pull**, or the raid-wide totals
  stop being the sum of the per-raider rows printed beside them.
- **Pet food and pet scrolls are in**, because `goldPerRaid` has always priced
  them. Leaving them out of one site is the disagreement, not the fix.
- **The pull switch does not reach off-pull use.** Trash belongs to no pull, so
  excluding a farm wipe must not exclude the hour before it.

Per-pull views are the exception and stay per-pull: the character performance
page keeps off-pull under its own heading, because "what did this raider bring
to *this* wipe" is a different question from "what did the night cost".

**A pet's copy of a consumable is a different line from the raider's own, and
the label that makes it one is applied in two places.** A hunter reads one
Scroll of Agility V to themselves and one to the pet; the first arrives as a
prep buff on the pull, the second as an off-pull pet record, and under one name
they folded into a single line — so an officer's ±1 against that name moved
both, because a correction is keyed by the name it corrects. `petConsumableLabel`
suffixes the pet's copy, and **`summarizeRaidReport` and `goldPerRaid` both have
to apply it** or the raid page and the career page count the same night
differently. Two more steps fail quietly:

- **`effectivePrice` strips the suffix before either lookup.** A label the
  catalog does not know lands at 0 gold in silence (§5f), and the officer's
  override for the week is stored against the item.
- **The price panel lists items, not line labels.** Two rows for one scroll let
  a raid hold two prices for it, and only one of them would be read.

Nothing stored carries the suffix — it is applied where a breakdown is built, so
the item cache, the icons and the preparedness table go on seeing real names.

**Pet gold is the one figure the app reports as a range, and the range lives
outside the ranking.** All three sites charge the logged pet applications and
only those, which for a pet is a floor rather than a count (§5e). The gold tab's
pet card shows what keeping the same consumables up all night would cost beside
it, and folding that estimate into any of the three would have to move all three
in the same change — otherwise the raid page and the career page charge the same
hunter differently. Whether it should be folded in at all is the council's call,
not a modelling improvement.

**Season gold is stored unrounded, and rounded where it is drawn.** The season
view sums the same spend two ways — per raider and per consumable — and both
totals sit on one screen. A drum charge costs 0.24g and a scroll 0.5g, so
rounding each row before adding them puts the two totals tens of gold apart on a
full season, and the app then contradicts itself in public. `goldTotal` on a
raider and `gold` on a consumable row are therefore full precision; every
`Math.round` lives in the component. Adding a rounded field to
`SeasonRankingsView` re-opens this.

## 5i. Who counts as the guild, on a page built from logs

**Chain:** `characters.status` → `listCharacters` → the season branch of
`app/logs/page.tsx` → `SeasonRosterEntry` → `isGuildCharacter` in
`analysis/season.ts` → the spend tabs and the usage board's Guild-only switch.

Logs cannot answer "is this one of ours". A pug raids beside the guild and their
pulls, potions and gold look identical in every report — so the roster is the
only source, and it is joined in at the page rather than folded into
`RaiderUsage`, which is what a night's pulls know and nothing more.

Two consequences. **A character's `status` is now a display input to the logs
page**, so a status that stops being written, or a new one nobody teaches
`isGuildCharacter` about, silently moves spend between the two tabs — the rule
is one function for exactly that reason. And **the join is by slug** (the
character name, lowercased), the same key `RaiderUsage.slug` carries: a rename
that moves one and not the other drops that raider out of the guild view while
leaving them in the totals, which reads as a missing row rather than an error.

`inactive` is deliberately inside the guild. They raided with us and their
nights still have to add up — §6 of the invariants, one page down.

## 4f2. A lookup queue must record what it already asked

**Chain:** the resolver's `unmatched` → `recordRefusedItemNames` →
`listUnmatched*Names` (which filter on it) → the import card.

The two name queues (`listUnmatchedSheetNames`,
`listUnmatchedConsumableNames`) are built from what the item cache **cannot
match**. That makes "nobody has asked" and "we asked and Wowhead refused" the
same number, so the button offers four names, the press does nothing, and it
offers the same four next time — forever. The failure is silent and it is the
officer who absorbs it.

`item_name_lookups` is the difference, in the same shape the items table uses
for `armor_token`: absent means nobody asked, a row means we asked and the
answer needs a person. Three things follow:

- **Never record `reason: "error"`.** That is a transport failure and says
  nothing about the name; filing it takes a resolvable name out of a queue it
  belongs in. The resolver's own doc already calls errors "worth another press,
  unlike the rest".
- **Re-asking replaces the verdict.** A corrected sheet row or a relabelled
  consumable is a *different* name; the newer answer is the true one.
- **Settled means settled by any route.** A refusal is dropped once the name
  gains an id — including by a **pin**, which does not put the name in the item
  cache at all ("Warglaive of Azzinoth (Main Hand)" pins to an item called
  something else). Filtering on the cache alone leaves a finished job on the
  list permanently, which is the exact failure this record exists to prevent.

## 5g. A consumable whose rank only the id carries

**Chain:** `wcl/consumables.ts` (`SCROLL_IDS`) → `consumable-prices.ts` (a key
per rank) → **a re-import**.

Scrolls are the case that makes the rule. Their aura is named after the bare
stat — "Agility", never "Scroll of Agility IV" — so a name-matched scroll
arrives with **no rank at all**, and every rank collapses into one label priced
as one thing. On this guild's logs that was 202 uses of Agility IV and 121 of
Strength IV, all counted at the cheapest rank.

Three traps, all of which were live:

- **The name cannot be a fallback that recovers a rank.** It can't even always
  recover the consumable: WCL renames Protection to "Armor" and Spirit to
  "Versatility", and "Versatility" is *also* what it calls Elixir of Major
  Mageblood. A word meaning two consumables is only resolvable by id, which is
  why that alias is deliberately absent from `SCROLL_BUFF_NAMES`.
- **The rankless label is the rank I item's real name.** They collide, on
  purpose: inventing "(rank unknown)" would put a string no item is called into
  the officer's price editor for rows a re-import removes. An id-less scroll
  reads as the cheapest rank.
- **Every curated label needs a catalog entry**, or it lands on the family
  fallback — a wrong number on the gold page with nothing to notice it.
  `consumable-prices.test.ts` walks `SCROLL_LABELS` for exactly this.

The same ids are in **two** fetch filters, and they answer different questions.
`SCROLL_CAST_IDS` catches a scroll read during a pull; `SCROLL_BUFF_IDS` catches
one sitting on a pet, which is the only evidence a pet ever offers (§5e). Either
way widening the list is a §1 change: **re-import, or the lower ranks are never
found.**


## 5f. Rename a consumable's label

**Chain:** `wcl/consumables.ts` (the `label`) → `wcl/consumable-prices.ts` (the
key) → **a re-import**, or the rename half-lands.

A label is not a display string. Ingest writes it into the row, the price
catalog is keyed by it, and the item cache is searched by it — so moving one
moves three things and leaves history behind:

- **Stored rows keep the old label until the report is re-imported.** They are
  what the gold, the leaderboard and the preparedness table read, so the guild
  goes on seeing the old name where nothing has been refetched.
- **A relabel makes any stored refusal on the old name dead.** It is dropped
  automatically once nothing references that spelling (§4f2), and the four *new*
  names are simply "never looked up" — which is why the import card can show the
  same count after a re-import that changed everything.
- **A label with no price key falls through the family fallback**, which only
  catches `elixir of…` and `…elixir`. Anything else lands at **0 gold, free and
  silently** — which is exactly how a mana-regen elixir under its buff name
  priced at nothing for months. Price both names while old reports survive.

**Why it comes up at all:** Warcraft Logs names an aura, and the aura is
routinely not the item. WCL also resolves some TBC ids against a *modern* spell
database, so the log offers names for stats TBC doesn't have. The rule the file
already states — *an ability id from a log is a fact, an ability name from a log
is not* — is what settles it: take the id to Wowhead, and label the entry with
the item that lists it as a use-effect.

The failure that motivates this is duplication, not ugliness. One elixir sitting
under both its buff name and its item name is **two entries**: the buff-name one
collects every pull, the item-name one matches nothing, and the gold, the
leaderboard row and the icon are split between them with nothing to flag it.

## 5a. Change what counts as prepared

**Chain:** `analysis/preparation.ts` — and nowhere else.

Preparation used to be written out inline in four places under two different
rules, one of them named `isPrepared` while never testing food. Everything that
asks now goes through this module: the loot-priority factor, the raid page's
coverage percentage, improvements list and preparedness table, the career
rollup, the comparison page, and the per-pull tick on a character.

Two separate questions live here on purpose:

- `elixirCoverage` is a **fact** — flask, both slots, half a set, or nothing.
  True regardless of policy, and what the raid page reports.
- `hasConsumableCoverage` is the **standard** — whether that clears the bar
  the council set (`preparation.coverage`). Policy, therefore §4b.

Deriving either one inline again is the failure mode: the raid page and the
career page then disagree about the same night, and nothing catches it.

**Which pulls get asked is a third question, and it lives above this module.**
`policy.preparation.excusedEncounters` names bosses nobody is expected to flask
for — last phase's raid, cleared on the way past — and `summarizePerformance`
drops them before it measures. Deliberately not visible to `hasConsumableCoverage`:
a per-pull check that could see the list would be a second place deciding it.
When *every* pull in a set is excused the figures fall back to the whole set,
because a 0% nobody was asked to earn is worse than no exemption at all.

## 5b. Count a consumable that isn't a cast

**Chain:** `analysis/potions.ts` — then §5, because anything counted gets priced.

The pre-pull potion is the example and the reason the module exists. It reaches
the app as a **boolean on the pull**, not as a cast, because it was drunk before
the log started: `classifyAura` sees the buff already up. It is still a potion
somebody bought, so it counts in the totals, the per-raider breakdown and the
gold — and `potionsUsed` / `potionNames` are the one place that decides so.

Two things follow, and both have bitten:

- **Counted and flagged is having it both ways.** While the pre-pot was excluded
  from the totals, "no potion on a kill" excluded it too. Now that it counts,
  the finding asks `potionsUsed(r) === 0`. Whether a potion was well spent is a
  different question, and `sim/context.ts` already asks it — it knows the
  fight's length.
- **The name arrives later than the fact.** `classifyAura` knew which potion all
  along; ingest used to drop it. Rows imported before `prepot_label` existed
  count under `UNNAMED_PREPOT`, so a re-import is what turns "Pre-pull potion"
  into "Haste Potion" — see §1.

## 5h. "Recently" is one rule, and two pages show it

**Chain:** `analysis/loot-recency.ts` → the dashboard's BiS card
(`getDashboard` in `store.ts`) → the ledger's **when** filter
(`components/loot-view.tsx`).

The card lists the raid week's wishlist hits and links to the ledger filtered to
the same thing. Compute that window twice and the card shows rows its own link
does not, on a page where both halves look right in isolation — so the window
lives in one module and both read it.

**A raid week is anchored to the last raid, not to today.** An award carries its
session's DATE and every award of a night shares one timestamp; the Gargul
export lands whenever somebody remembers. Probed on the live data: the newest
loot session was 2026-08-19 against a newest log of 2026-08-26, so a literal
"last 7 days" card was empty on the day it would have shipped. Anchor to the
newest **award**, not the newest session — a raid that dropped nothing, or whose
export has not arrived, otherwise anchors the week to itself and hides the week
before it.

Two smaller traps, both live:

- **Compare by day, never by the timestamp string.** Every award is currently
  midnight, so a string compare happens to work and would start dropping the
  last night of a window the first time an import records a real clock time.
  `dayOf` is the comparison that means the same thing either way.
- **A URL filter needs seeding at both ends.** `match` and `when` are read from
  the query string exactly as `character`/`session`/`winner` already are. A link
  the ledger silently ignores is worse than no link: it answers a different
  question than the card it came from, confidently.

**"BiS" here means the winner's wishlist and nothing more.** There is no first
choice versus second in this data — the council was asked and said the call is
too situational to automate, which is why `item_comments` carries the argument
instead (§5c). A SixtyUpgrades wishlist is the raider's BiS list for its phase,
so a matched award is the strongest honest reading the app can make. Tier tokens
count as what they buy, because `matchAwardToWishlists` already resolves
redemptions — on the probed week that was 5 of the 9 hits, so dropping it would
have halved the card.

## 4c. A ranked wishlist fallback

**Chain:** `analysis/contention.ts` → `analysis/loot-priority.ts` →
`contender-table.tsx`, and the cost of a filler is a policy field (§4b).

One stored row feeds two unrelated answers, which is the part that surprises:

- **Who is on the board.** Contention builds its wishers from the imported gear
  set, which names one item per slot. A fallback is the only way a raider whose
  second choice drops appears at all, so `computeItemContention` reads
  `alternatives` as well as the wishlists.
- **What served their slot.** Each award carries `listRank` (0 their pick, 1+ a
  fallback) and `notListed` (checked, and it wasn't on any list), and
  `slotServedAdjustment` charges `drop`, `fillerDrop` or `offListDrop`.
  Off-list is **zero by council decision**: a drop nobody asked for shouldn't
  weaken their claim on the one they did.

  Both fields absent is a third state — *no list to check* — costed like their
  own pick, because treating it as off-list would hand a discount to anyone
  who never imported a wishlist. `computeItemContention` never emits it (you
  reach the board through a list), but a `ContenderAward` built by hand can.

**Check every phase's list, never just the active one.** This guild runs P2
with P3 lists imported. Scoping the lookup to the active phase found nothing
for anybody, read the whole roster as never having asked for a single item they
won, and — with off-list at zero — would have deleted the slot-served penalty
for all 63 raiders carrying one. The wisher check above has never been
phase-scoped; scoping this one made the two disagree about the same wishlist.

`listRank` on a **wisher** and `listRank` on an **award** answer different
questions (what they want here / what they already got). Both come from the same
table, and mixing them up reads as plausible nonsense.

**The rank never moves a ranking.** A fallback wisher contends on equal footing
with a BiS wisher, badged. That is a council decision, recorded here so nobody
"fixes" it: whether a second choice should stand aside depends on the raider's
other options and what those block, so the argument goes in the item's notes
(§5c). Making the rank score something is a policy change (§4b), not a bug fix.

## 4h. An officer's chain for one item

**Chain:** `item_priority_rules` → `getItemPriorityRules` → `store.ts`
(`priorityRuleFor` **and** `getPrioritySheet`) → `setItemPriorityRule` →
`saveItemPriorityAction` → `ItemPriorityEditor`, which is handed its phase by
**every** caller.

**A chain is keyed by phase as well as name, and the two readers use that key
differently.** Getting this backwards is what shipped the bug:

- **`getPrioritySheet(phase)` passes only that phase's chains.** A chain the
  phase's sheet doesn't name is listed as "not on this sheet", so a guild-wide
  key put both Warglaives — a P3 ruling — on the P2 page under "Officer edit".
- **`priorityRuleFor` walks `lookupPhases`** — active phase first, then the rest
  newest back to oldest, exactly as the sheet lookup does (§4c). The phase
  decides which sheet *page* lists a chain, never whether the chain is in force:
  a P3 ruling still governs a P3 drop while the guild farms P2.

Two consequences worth knowing before you touch either side. Clearing a chain is
**phase-scoped** — an empty chain hands the item back to one phase's sheet and
leaves the other phase's ruling standing, which is why the UI only offers "Reset
to sheet" on a chain the page's own phase owns. And the editor takes its phase
from the caller rather than reading the active one, because the sheet page and
the item page mean different things by "this item's phase": the sheet page means
the sheet being read, the item page means the tier its drop comes from.

**The phase key can go stale, so the row says when it has.** The item page files
a chain under `item.phase ?? activePhase`, and most of TBC's launch items carry no
phase until the `phase_checked` backfill answers for them (§4f) — so a chain filed
today can end up describing a drop from another tier. `getPrioritySheet` carries
`itemPhase` beside `quality` for exactly this comparison, and a mismatch renders
as "filed under P2 · drops in P4" with `moveItemPriorityRule` behind the button.
That move is **one repo call** rather than a write plus a clear (the halves
failing apart would duplicate or lose the ruling), and it **refuses** when the
target phase already has a chain, because that is a second ruling somebody made.
The warning is for an officer's chain only: a council sheet listing another
tier's drop is the document meaning what it says.

The migration is a **table rebuild**, not an `addColumn` (§2): the primary key
gained a column. Its backfill resolves each existing chain through the same
name → id path the sheet view uses — an officer's `sheet_item_ids` pin first,
then an exact name match — and takes that item's phase, falling back to the
guild's active phase for a name the cache can't place. It runs *after*
`relaxItemColumns` because it reads `items.phase`.

## 4f. Trust a new source of item data

**Chain:** the writer → `items.verified` → `listUnresolvedItemIds` in `store.ts`.

The item cache merges many sources, and exactly one of them is authoritative.
`addItemsIfMissing` fills holes and never overwrites; `saveResolvedItems` is
the Wowhead path and is the only writer allowed to overwrite name, quality,
icon and slot — and the only one that sets `verified`.

The failure this exists to prevent is silent by construction: a hand-written
entry has every field populated, so a queue built on "missing a field" never
offers it up, and a wrong icon renders perfectly forever. **The queue is
built on `verified`, not on completeness.** If you add a source that can
supply item data, it fills gaps — it does not get to mark rows verified,
however good it is, or the queue stops meaning anything.

One asymmetry worth knowing: an authoritative write never *overwrites*
`source_json` or `phase` — an empty column is filled, a curated one still wins.
Both come out of the same XML the resolver already fetches: the phase from the
tooltip markup, the zone and boss from the JSON block's `sourcemore`. The
exception is a name that contradicts an unverified row: that row was curated
onto the wrong id, so its zone, boss and phase describe some other item and are
dropped rather than carried.

**The zone comes from `raidOfBoss`, not from Wowhead's zone id.** The response
locates the boss by a numeric id, and turning that into a name would cost a
second request *and* give back Wowhead's spelling — while `ZONE_TO_PHASE` and
the loot plan are keyed on this app's. Mapping the boss name through the raid
table keeps one source of truth for what a raid is called. The cost is that a
boss the table doesn't know (heroics, world drops) yields nothing, which is the
right answer: `items.source.zone` is what puts a drop on a raid's loot plan, so
a confident wrong zone is worse than a blank an officer fills in.

**`phase_checked` is why that backfill terminates.** Most of TBC's launch items
carry no phase tag at all, so a queue built on "has no phase" would ask about
them again on every press for ever. The column records that we asked, not what
came back — the same absent/false/true distinction `armor_token` makes — and the
lowest tier of `listUnresolvedItemIds` drains on it exactly once per item.

**Wowhead's subclass ids are only unique within their class.** `-2` is "Armor
Tokens" under class 15 (Miscellaneous) and "Rings" under class 4 (Armor), so
testing the subclass alone filed every ring as a tier token. Nothing failed
loudly: the token-mapping queue filled with rings whose pages name no pieces and
never drained however often an officer pressed, and — worse — an authoritative
write clears the slot of anything it believes is a token, so every ring in the
cache lost the slot that the wishlist slot families and the "already served this
slot" loot penalty read. `repairArmorTokenClass` un-verifies the affected rows so
the resolver re-answers and the same write puts the slot back.

**A second lookup goes the other way: name → id.** The priority sheet is written
in item names, and most of what a sheet lists nobody has wishlisted or won, so
the cache has no id and the row renders as bare text with no Wowhead hover.
`resolveItemIdsByName` closes that, and its rule is exact-name equality with
exactly one hit (`pickExactItem`) — a search will happily answer a misspelling
with something plausible, and a plausible id here puts the wrong item's tooltip
under an officer's cursor mid-raid. Those rows land **unverified**, so the
ordinary resolver still confirms them afterwards.

**The priority sheet is also a drop table, and reading it as one is a third way
`items.source` gets filled.** A sheet is written boss by boss, so every `###`
heading states where the rows under it drop — a fact the loot plan needs and the
cache often lacks, because ids learned from wishlists arrive with a name and
nothing else. `sheetSectionSource` turns a heading into a zone and boss,
`listSheetDropSources` matches it to cached rows with **no source at all**, and
`applySheetItemSources` gap-fills them on the same press as the shipped table.
Three rules keep it honest:

- It writes `source` and nothing else. A section heading has no standing to
  supply a name, an icon or a phase.
- It only fills blanks, and it runs *after* `applyCuratedItemSources` — a
  priority document read for provenance is weaker evidence than a drop table.
  Measured against this guild's live cache the two sources disagree once in 189
  rows, and that once is a leading article.
- A heading it cannot place yields **nothing**. Same reasoning as the zone rule
  above: a confident wrong zone is worse than a blank an officer fills in.

**Boss names are compared with `bossKey`, and grouping by the raw string is a
bug.** Wowhead files Black Temple's council under "Illidari Council"; the raid
table and Warcraft Logs say "The Illidari Council". `bossKey` strips a leading
article — from the *raw* name, where a following space proves it is a word, so
that a future "Thekal" does not become "kal" — and carries a small alias table
for names that differ outright ("Opera Event" against "Opera Hall"). Both
failures were silent and both were live: the loot plan sorted the council's
drops past Illidan, then, once the sheet had placed the rest of them, rendered
him as two cards holding one and eight items. Nothing errored either time.

**Trash is a drop source that is not an encounter.** `TBC_RAIDS` lists bosses,
and a log has no "Trash" fight, so anything ordering a *zone's drops* rather
than its kills has to place `TRASH_BOSS` itself — first, where the raid meets
it. Left to the raid table it sorts with the unknowns, after the last boss.

What no lookup can settle is a name two items share exactly — both Warglaives of
Azzinoth are called "Warglaive of Azzinoth", and the sheet's "(Main Hand)" is the
council's annotation rather than anyone's item name. That is what `sheet_item_ids`
is for: an officer pins the id, keyed by the normalized name so a re-pasted sheet
keeps it.

**A verified row is never asked about again, which is also how a wrong answer
becomes permanent.** That is what eight "wrong icon" reports were, each fixed by
hand. `unverifyItem` withdraws the stamp and nothing else — the row keeps its
name and icon until a better answer arrives, and keeps the guild's curation,
which is not Wowhead's to overwrite. It is on the item's own curation panel,
because "the icon is wrong" and "it drops in Karazhan" are the same job.

Because they can be dropped, they have to be reachable: `setItemCuration` is
the officer's way back, on the item's own page. **`items.source.zone` is the
only thing that puts a drop on a raid's loot plan** (`getLootPlan` filters on
it), so an item with no zone is invisible there however well known it is.

## 4h2. The drop table has two layers, and only one of them is yours

**Chain:** `boss_drops` (operator) + `guild_boss_drops` (one guild) →
`mergeDropTable` → what that guild reads.

What a boss drops is a **fact about the game** and belongs to whoever runs the
service; what a guild does about it is a **judgement** and belongs to them.
Welding the two together is what made a one-letter item-name typo — "Hammer of
Judgment" against the real "Hammer of Judgement" — a code change and a deploy.

Three rules, all of which fail quietly if broken:

- **An overlay never mutates the foundation.** `mergeDropTable` copies; it does
  not splice. An operator correcting a name must not silently revert a guild's
  ruling, and a guild must never edit what another guild reads.
- **There is no `move` action**, only `add` and `hide`. A move is a hide plus an
  add, which is clumsier to write and impossible to half-apply — a single
  `move` row would need a target that could name a boss the overlay does not
  otherwise mention. An item that two bosses both drop is keyed per *pair*, so
  hiding it under one leaves the other alone.
- **The writer normalizes, exactly once.** `bossKey` and `normalizeItemName` are
  applied on the way in, and every reader compares stored keys directly.
  `rowKey` deliberately does NOT normalize again: a second, quieter normalizer
  is how a writer and a reader come to disagree, and a fixture that reimplements
  one is how that passes its tests. See the note on `rowKey`.

**`sheetItemIdFor` is the single rule for "which item does this sheet row mean",
and it consults the officer's pin first.** Three readers need it — the sheet
page, the drop-source pass and the loot plan — and it used to be inline in one
of them. The two newer readers matched on name alone, so a pinned drop rendered
on the loot plan as unlinkable text *beside the very item it was pinned to*.
Any fourth reader goes through the same function.

## 4k. A guide has two owners and neither wins

**Chain:** `guides(kind, subject, section, owner)` → `findGuides` → `GuidePanel`.

`class_guides` became `guides` so that a **boss** could have one too, and so
that both could be written twice over: the operator's shared baseline and the
guild's own, side by side. That is a **key change**, so it needed a table
rebuild rather than an `addColumn` — see `migrateClassGuidesToGuides` and its
test in `identity.test.ts`. Existing rows are filed under the guild that wrote
them; nothing becomes an operator baseline by accident.

- **They are never merged.** `findGuides` returns both, and the page labels
  them. Collapsing them would have to pick a winner and there is no winner:
  the baseline says how a fight works, the guild's own says what they do about
  it. A guild reading its own ruling and believing it shipped with the app is
  the failure to avoid.
- **The owner is resolved server-side and never taken from the client.** A form
  that could name its own owner would let anyone holding `guides.edit` write the
  shared baseline by changing one field. `asOperator` is a request; `isAppAdmin`
  is the answer.
- **`OPERATOR_OWNER` is a reserved string.** Guild ids are generated, so nothing
  can claim it by accident — but a future id scheme must keep that true.
- **Raid sections match on `bossKey`, class sections match exactly.** A guide
  written while a source spelled him "Illidari Council" has to be found under
  "The Illidari Council"; a class's specs are a closed set where a near miss is
  a typo, not a spelling.

**`requireCapability` must be written inline as
`requireCapability(await resolveViewer(), "…")`.** `enforcement.test.ts` scans
for exactly that shape, and a capability it cannot see is one it cannot prove is
checked — which is §11's whole point. Hoisting the viewer into a variable to
reuse it silently drops the capability off the enforced list.

## 4h5. The drop table records how a drop was WRITTEN, not what it is CALLED

**Chain:** `boss_drops.item_name` → `resolveDropNames` → the plan, the sheet,
the boss page.

A drop table is written by hand, in names, off a loot list. Eleven of this
guild's 488 rows carried a spelling Wowhead disagrees with — eight are hyphen
casing (`Blood-Stained` against `Blood-stained`), which `normalizeItemName`
already reconciles; the rest are a real typo, a possessive, and the council's own
annotation. So the stored name is **half the key and a record of what somebody
typed** — never an authority on what the item is called. `getDropTable` reads
the display name back off the item cache, which is what stops the table becoming
a second copy that rots: a Wowhead correction reaches every reader at once.

Two exceptions, both learned the hard way:

- **A name two drops share is not corrected.** Both Warglaives of Azzinoth are
  called "Warglaive of Azzinoth"; the sheet's "(Main Hand)" is the only thing
  separating the two rows under Illidan and the two chains attached to them.
  `resolveDropNames` counts resolved names per boss and leaves a colliding pair
  as written, recording `resolvedName` so the row is still traceable.
- **The loot plan has to be told.** It names a row from the item cache, so the
  table's annotation never reached it and Illidan dropped the same thing twice.
  `LootPlanEntry.displayName` carries it.

**Dedupe on the ITEM, not the name.** The seed gathers from sheets and then from
the item cache; keyed on the written name, the sheet's "Hammer of Judgment" and
the cache's "Hammer of Judgement" are two rows for one drop, and since the
table's key IS that name, no upsert will ever collapse them. Three of this
guild's rows were duplicated exactly so. `listDuplicateDrops` finds them and
`seedFoundationalDrops` clears them; the survivor is the spelling a priority
sheet uses, because the sheet references the table and its wording may carry a
distinction the item name cannot.

## 4h4. A hidden drop still needs somewhere to live

**Chain:** `guild_boss_drops` (action `hide`) → `getLootPlan` → `LootPlanBoss.hidden`.

A hidden drop is, by definition, not on the plan — so there is no row to un-hide
it from. `buildLootPlan` therefore carries hides separately and **keeps a card
for a boss whose only trace is a hidden drop**, or the action is one-way and an
officer who hid the wrong thing needs a developer.

Two consequences that are easy to miss:

- **`unmapped` is not "no items".** A boss with nothing showing but something
  hidden was mapped and then emptied, which is a different state and a different
  sentence on the card. `unmapped` has to consult the hides.
- **The spine fires when there are hides, even with no drops at all.** The zone
  is otherwise "nothing here yet", and the empty state would swallow the only
  route back.

`items.curate` gates this, the same capability as "which boss does this item
drop from" on the item's own page — the identical judgement, reached from the
page where an officer actually notices it. Keep its `gates` text in step; it is
shown to whoever assigns roles.

## 4h3. The loot plan reads the drop table, and the switchover must be invisible

**Chain:** `getDropTable` → `getLootPlan` → `buildLootPlan`.

The plan assembles, in order: cached items the zone drops, drops the table knows
an id for that the cache has not attributed, drops the table names with no id at
all, and finally the council's sheet for anything still unaccounted for. **The
fourth source is what keeps a zone nobody has seeded from going blank** — remove
it and switching the read path empties every plan until an operator presses a
button.

Two rules that fail silently:

- **A guild's `hide` has to be applied to sources that do not come from the
  table.** `getDropTable` applies the overlay to its own rows; a drop reaching
  the plan from `items.source` or from a sheet heading arrives by another door
  and would otherwise survive being hidden.
- **That check keys on the PAIR, through `dropKey`.** Keyed on the item alone it
  also hides the copy the guild just re-added under a different boss — which is
  exactly how a move between bosses is written, so the common correction
  silently half-applied. `sqlite-repo.test.ts` covers the move for this reason.

`seedFoundationalDrops` **reads a guild's priority sheets**, which is worth
knowing because `/service` otherwise never touches guild business. It takes the
factual half only — boss heading, item name, slot wording — and leaves the chain
and the notes column behind. Those are the council's judgement. If you extend
the seed, keep that line: an operator console that quietly ingested a guild's
rulings would break the promise the `/service` page makes in its own comment.

## 4i. The loot plan has three inputs, and two of them are silent

**Chain:** `store.getLootPlan` → `buildLootPlan(zone, entries, sheetDrops)` →
`bossSpineFor`.

The plan used to be one input — cached items filtered by `source.zone` — and a
thin plan was indistinguishable from a thin cache. It now assembles three, and
dropping any of them still renders a page that looks finished:

1. **Cached drops.** As before. `items.source.zone` is still the only thing that
   puts one on a plan.
2. **The boss spine.** Every boss `TBC_RAIDS` names appears, `unmapped` when
   nothing reached him. Omit it and four cards for a nine-boss raid read as a
   complete plan. The spine is suppressed entirely when the zone has *nothing*,
   so the view's empty state (which keys on `bosses.length === 0`) still fires —
   nine empty cards would bury the only useful thing on that page.
3. **Sheet-only drops.** Items the council's sheet names that no id exists for
   anywhere. `getLootPlan` passes them; **a caller that forgets silently loses
   every drop nobody has wishlisted or won**, which is most of a tier. They are
   deduped against the whole item cache by name, not against the zone, because
   a name with an id belongs to whichever plan its own attribution says.

`LootPlanItem.itemId` is optional for (3) — there is no item page to link to and
no icon to show. That one is *not* silent: it is a type error at every call site
that assumed an id, which is why it was made optional rather than faked.

## 4j. A council note is filed against a key, not a name

**Chain:** `bossCommentKey` → `boss_comments(zone, boss_key)` → the plan's
`LootPlanBoss.key`.

Both halves matter and both fail quietly. **Zone** is part of the key because
trash is a drop source in every raid, so "Trash" alone pools Hyjal's notes with
Black Temple's. **`bossKey`** is the other half, so a note written while a source
spelled him "Illidari Council" is still found once the plan heads the card "The
Illidari Council" — the writer and the reader going through different
normalizations means the note is stored, returns success, and never appears.

The label is stored beside the key deliberately: the key is what a reader looks
*up* by, the label is what they *recognise*, and neither substitutes for the
other. Notes are appended and never edited — a decision that changed is a second
note, and the first one is why it changed.

## 4g. Tier tokens and the pieces they buy

**Chain:** `items.redeems_from` → `tokenRedemptions` in `store.ts` → **every
reader that compares two item ids.**

A tier token is the only drop that isn't the thing anyone wants. Gargul records
`Helm of the Vanquished Champion`; a SixtyUpgrades list names `Cataclysm Helm`.
Nothing joins them but this edge, and every join in the app is `itemId ===
itemId`, so a reader that forgets it is not slightly wrong — it silently drops a
quarter of the loot ledger out of whatever it computes.

The edge lives **on the piece** (`redeems_from`), not on the token. One token
buys nine pieces; a piece has exactly one token. Storing it the one-to-one way
means "which piece did they mean" is answered by intersecting the token with the
raider's own list rather than by a rule about specs.

What has to change together when a new reader compares item ids:

- **`lib/items/tier-tokens.ts`** owns the comparison — `delivers(awarded,
  wanted)`. Readers take a `TokenRedemptions` and default it to
  `NO_TOKEN_REDEMPTIONS`, which makes every item deliver only itself. That
  default is why an untouched test keeps passing, and also why a new reader
  that forgets to ask for the real one fails silently. **Grep for `delivers`
  before adding an `itemId ===` comparison to loot or wishlist code.**
- The readers wired today are `computeWishlistRows`, `matchAwardToWishlists`
  and `computeItemContention` (which is what `getLootPlan` reads). All three
  get theirs from the one `tokenRedemptions(items)` built in `store.ts`.
- `delivers` runs **one direction only**. A token delivers its piece; winning
  the piece is not winning the token, and two pieces of the same token are not
  interchangeable.

**The mapping is fetched, never written from memory.** `parseTokenRedemptions`
reads Wowhead's own vendor listing off the token's item page, and counts a row
only when the token is the entire price — the arena sets take a token *or*
arena points, and the Sunwell upgrades take a Sunmote *and* the old piece.
Adding a tier by hand would be inventing domain knowledge (root `AGENTS.md`
§4); press the button on the import page instead.

Two operational notes, because both are silent:

- **The mapping is not there until an officer runs it.** Every token award
  reads as off-list until then, which under `offListDrop: 0` costs its winner
  nothing in loot owed.
- **The backfill queue skips anything a gear set names**, since a token can't
  be equipped. It deliberately does *not* skip on "has no slot", though a token
  has none: the shipped seed invented slots for a dozen tokens, and a queue
  that trusted the slot skipped exactly the rows that were wrong.

## 5c. Notes on an item

`item_comments` is deliberately outside every score. The council was asked
whether a second-choice wisher should contend against a BiS wisher and how far
behind, and answered that it depends on the raider's other options and what
those block — so the app records the argument instead of encoding it. If a
future change makes a note move a ranking, that is a policy decision (§4b) and
belongs on the guild page, not in the note.

A note may name a raider. Deleting that raider **unlinks** it (§ invariant 6) —
`deleteCharacter` sets `character_id` to NULL rather than deleting the row, and
`validateStore` enforces that a set id still resolves.

## 5e. The preparedness table's two silent dependencies

**Chain:** `analysis/preparedness.ts` → the table → **two things that live
somewhere else entirely**, and both fail by quietly showing less rather than by
breaking.

- **Consumable icons need the item cache to know the name.** Warcraft Logs
  reports a flask as an *aura*, which ingest matches to a curated item **name**
  — a name is all it ever carries. An icon, a quality colour and a Wowhead
  tooltip all need an **id**, so the table renders anything unresolved as plain
  text. `listUnmatchedConsumableNames` is the queue and the import page's
  "Identify N consumables" button is what drains it, through the same
  `resolveItemIdsByName` the priority sheets use. A fresh deployment therefore
  shows a correct table with no icons, which looks like a bug in the table and
  is not one.
- **One pull is a bad witness for gear.** Warcraft Logs fires exactly one
  `combatantinfo` per player per fight (probed: 475 events, 25 players × 14
  pulls, never two for the same pair), so there is no in-fight swap to read —
  but there IS a swap *between* pulls, and Lurker is spawned by fishing. That
  pull catches raiders holding a level 30 rod: honest about the pull, useless as
  "how geared are they". Item level therefore reads the **most-worn item per
  slot** across the report, and `weaponSwaps` names what changed. Seen 29 times
  with a fishing lure on the rod and 13 more without one, so the lure is not a
  sufficient signal on its own — the raider's own other pulls are.
- **The pet record is per report, and carries its own clock.** Pet food outlives
  the pull it was applied in, so ingest keeps it on the off-pull record — one
  per player per *report*, with no fight that owns it. The night's total shown
  against a single pull reads as a bug ("Kibler's Bits ×3" on one boss), so each
  application stores `atMs` and, when it landed inside a pull, `fightId`. A
  scoped view then answers what landed here and how much came earlier, which is
  the question actually being asked. **A bare string is a row imported before
  the timing** — it parses to a name and nothing else, exactly as `deathTimes`
  does, and a re-import fills the rest in.
- **The cast stream is the weak witness for a pet, not the strong one.** A pet
  is scrolled and fed *between* pulls, and a log holds no out-of-combat time, so
  the cast that would name the item is usually never recorded. Probed on
  mbwNGRaxhPHMTpKB, a full SSC/TK clear: **one** scroll cast in 73,837 casts and
  none on a pet, on a night whose aura stream shows a hunter's pet holding two;
  and 20 pet-food auras across three hunters' pets against 3 casts, one of those
  hunters having fed a pet the cast stream never saw. Across 21 imported reports
  the cast path found 60 pet scrolls against 4,286 for players, and its zero
  nights are not roster nights — the same three hunters raided 01 Jul and 08 Jul
  for 0 and 8. So `petBuffsSeen` reads the pet's own aura stream instead
  (`SCROLL_BUFF_IDS`, `PET_BUFF_IDS`), which for a pet is the whole evidence
  base: there is no `combatantinfo` for one.
- **"No Well Fed on a pet" was a name problem, not a limit.** An earlier probe
  found 138 "Well Fed" events across six ids and none on a pet, and read that as
  a pet's fed-ness being unknowable. Feeding a pet applies **"Pet Treat"**
  (43771) — the buff is not named after the item, exactly like Skullfish Soup
  applying "Enlightened". Match pet consumables by **id**; the name can name
  neither the item nor, for a scroll, its rank.
- **A sighting is not a use, and merging them would charge for the difference.**
  A pet re-entering play republishes its entire aura set in one millisecond —
  eleven auras from eight sources 79ms after `Call Pet`, probed — and leaving
  play drops all of them the same way. So `petBuffsSeen` carries no count and is
  never priced; `petConsumables` stays the thing gold is built from (§5). It is
  named unlike its neighbour on purpose, because §5's gold sites enumerate
  off-pull fields by hand. `PreparednessPet.held` drops anything a cast already
  counted, or one scroll read during a pull would render as two.


- **The preparedness tab and the gold tab read one pet view, not two.**
  `RaidReportView.petSpend` feeds the pet tally and the `→ ×N` marks in the Pet
  column as well as the gold card, so the two tabs cannot quote different counts
  for the same hunter. The tally is deliberately scope-independent — a pet is
  fed once for the night — while the estimate is drawn only in the all-pulls
  view, because a night's figure beside a single pull reads as a per-pull count.
- **A consumable only ever *seen* on a pet has no price unless the page asks
  for one.** `costPerUseMap` is built from the usage breakdowns, and a scroll
  the cast stream never recorded appears in neither — so the gold tab's pet card
  seeds the price map from `petSpend` as well. Miss that and the card prices the
  invisible half of a hunter's night at 0g, which is exactly the silence it
  exists to break, and the officer never gets the name in the price panel to
  correct. `analysis/pet-consumables.ts` is the model and takes its re-buy
  windows as an argument, from the `PREP_HOURS` a raider's own food and scrolls
  already use: a pet's Scroll of Agility V is the raider's Scroll of Agility V,
  and a second copy of that number would drift silently.
- **An empty pet cell is "nothing logged", never "they forgot".** Warcraft Logs
  types hunter pets, shaman totems, druid treants and Shadowfiend identically
  (`type: Pet, subType: Pet`, probed on a real report), so **who owns a feedable
  pet is not derivable** — a cross against a raider on that basis would be an
  accusation the log does not support. Naming pet classes from memory to fix
  this is exactly the invention AGENTS §4 forbids.
- **A weapon buff is two facts, not one.** Both hands carry their own temporary
  enchant and a dual-wielding rogue runs a different poison on each, so
  `weaponEnchants` reports both. `weaponBuff` — the stored boolean, and what the
  pip strip reads — stays "either hand had one", which is what `normalize`
  writes; the pair is only visible once a pull is scoped to on its own.
- **A weapon "buff" is any temporary enchant, including ones nobody bought.**
  `normalize` sets `weaponBuff` from `temporaryEnchant > 0` on either weapon
  slot, and **Windfury Totem reaches a party's weapons the same way an oil
  does** — as does a fishing lure. On this guild's logs that is 905 player-pulls
  credited for preparation nobody paid for, 16% of every pull flagged. It feeds
  `weaponBuffPct` on the raid page and the performance page; it does **not**
  feed `isPrepared`, so no loot ranking moves on it. Naming the ids (§ the
  enchant dictionary) is what makes this visible at all — before that the
  column could only say "something was applied".
- **The enchant badge links to an anchor.** It points at `#enchants` on the
  performance page, because that card is the one place that names *which* slots
  are bare — repeating the audit in the table would be a second place to get it
  wrong. Renaming or dropping that `id` leaves a link that still works and
  lands in the wrong place, which nothing catches.

**What the table does NOT do is score anything new.** `prepared` is
`isPrepared` (§5a), computed in the analysis layer so no component invents a
second definition on the way to the screen. Enchants, gems and item level ride
along as facts and are deliberately unscored: folding them into that figure
would re-rank every raider's loot priority and standing, which is §4b's
business and the council's call.

**Every column states a percentage, and only two of them are the score.** The
compound figure is unactionable on its own — "0% prepared" does not say whether
they went unflasked or unfed — so each strip carries its own share in the same
unit, and the two the figure is made of are marked. Two traps come with that:

- **A column that paints a fact must count the standard.** The flask strip
  colours a half set amber whatever the policy says, but whether half *counts*
  is `preparation.coverage`. So `PreparednessPull` carries `grade` and
  `covered` separately and the strip reads one for each; count the pip instead
  and under `coverage: "full"` the column reads 100% beside a Prepared 0%,
  which makes the breakdown contradict the number it is decomposing.
- **Weapon buff must stay out of the score no matter how it is displayed.**
  Giving it a percentage next to the two that count is exactly when somebody
  will fold it in. It is set by any temporary enchant — Windfury Totem and
  fishing lures included, 905 player-pulls in this guild's history — so scoring
  it credits a shaman's totem as a raider's oil, and it would move loot
  priority. Changing that is §4b, on the guild page, not here.

**Extras is the second figure, and it is credit rather than a requirement.**
Scrolls and a weapon buff are real effort that `isPrepared` is structurally
blind to — it reads the same 100% whether or not they bothered — so they get
`extrasPct` in `analysis/preparation.ts`, shown beside Prepared and **scored
into nothing**. Three rules, each of which was wrong the obvious way first:

- **It counts the weapon buff the raider provided, not the boolean.** The raw
  flag credited three raiders on this roster for a shaman standing next to
  them: Greymatter reads 92% weapon buff and 0% once totems are excluded, and
  so does Risbexwx. `isOwnWeaponBuff` in `wcl/enchants.ts` does the classifying,
  **by name**, since the ranks are separate ids. A shaman's own Windfury
  *Weapon* deliberately counts — it is their imbue in the slot an oil would
  take, and excluding it would penalise a class rather than a behaviour.
- **The two slots are independent, never an AND.** Most of this roster runs no
  scrolls, so an AND would zero out the oil of everyone who buys one and not
  the other — the exact behaviour the figure exists to notice.
- **It never renders as a failure.** Zero extras is muted, not red. A raider who
  buys no scrolls has not failed a standard, because there is no standard here.

Widening `isPrepared` to swallow any of this is §4b and the council's call.

## 5d. A panel seeded from props on a page that switches subject

**Chain:** the client component's `useState(initial)` → **a `key` at the render
site.**

`/logs` and `/raid-planner` both keep the reader on one route and swap which
report they are showing. A client component that seeds its state from props
seeds it **once, on mount**, and a client-side navigation into the same tree
position does not remount it — so the previous report's data stays on screen
under the new report's code, and anything that autosaves then writes it there.
That is not a display bug; it overwrites one raid night's record with another's.

The fix is a `key` carrying the report code, and it has to be at the render
site because that is the only place that knows the subject changed. `RaidBoard`,
`FightFilter`, `GoldTable` and `ConsumablePricePanel` all carry
one. **A new per-report panel needs one too**, and nothing will fail if you
forget: it type-checks, it renders, and it is wrong only after the second click.

## 6. Add a route or a server action

- Pages are **server components by default**; `"use server"` action files are
  colocated with the route they serve, one per feature area.
- Nothing fetches from the network while rendering. Wowhead and Warcraft Logs
  are called at *import* time only. If you find yourself adding a `fetch` to a
  page, you are adding it in the wrong layer.
- Filter/selection state goes in the **URL**, not React state, so a view is
  shareable and only one variant renders server-side (`?gear=`, `?chars=`,
  `?report=`).
- **`src/app/loading.tsx` is what makes a nav click feel like anything.**
  Without a loading boundary the router keeps the *old* page on screen until the
  new segment resolves, so the click reads as broken and then everything appears
  at once. Delete that file and every slow page goes back to feeling dead.
- **Don't hand a client component a whole table to do one lookup.** The award
  dialog used to receive the entire item cache as a prop — six figures of JSON
  serialized into every visit to the loot ledger, for a dialog most visits never
  open. It needed one item by id, so it asks for one (`lookupItemAction`). The
  same shape is worth checking wherever a page passes a `list*()` straight
  through to a client component.
- **`DataTable` paginates by default** (100 rows). Sorting and filtering still
  run over the whole set — only rendering is windowed, and a table under one
  page shows no controls. A caller that genuinely needs every row in the DOM
  must say so with `pageSize={Infinity}`.
- **A `columns` memo must not depend on which rows are selected.** It reads as
  the obvious way to write a checkbox cell and it costs a full re-render of
  every visible row per tick — new column definitions mean new cell renderers.
  Selection reaches the checkboxes through `SelectionProvider` instead, so
  `columns` depends only on what changes a column's *shape*. Nothing catches a
  regression here: the table stays correct and quietly does far more work.
- **`DataTable` is memoized, which only helps if its props are stable.** An
  inline `initialSorting={[…]}` or a `columns` array rebuilt each render
  defeats it silently — hence the module-level `LOOT_SORT` / `ROSTER_SORT`.

## 7. Add an analysis module

`src/lib/analysis/**` is **pure** — verified: not one file there imports
`@/lib/data`. Read model in, view model out. Keep it that way; it is why this
layer is testable without a database.

Every module there has a `.test.ts` beside it except `contention.ts` and
`fairness.ts`. Match the convention.

## 8. Touch the seed backend

`DATA_BACKEND=seed` serves `src/data/seed/*.json` read-only through the *same*
`createRepoFromStore`, so derived output is identical to SQLite by construction.
Two consequences:

- A new `EntityStore` field needs a default in `seed-data.ts` or the seed
  backend throws at boot.
- `validateStore()` enforces referential integrity and **throws** — a broken
  seed file is a hard boot failure, on purpose.

## 9. Give something a colour

The app has two themes, so a colour is never a one-place change. **Components
name a role, never a palette step or a hex** — `bg-warn-soft`, `text-success-ink`
— and `src/app/globals.css` decides what each role looks like per theme. Write a
component that way and it is right in dark mode without a `dark:` variant.

- **A colour that goes through inline `style` cannot be themed by a class.** That
  is why class colours, item quality, parse percentiles and the graph series are
  CSS variables (`var(--class-text-warrior)`) rather than hex — a `dark:` rule
  can't reach a `style` attribute. Reaching for a hex there breaks dark mode
  silently, and only in the theme you weren't looking at.
- **A new status role means adding all five parts** — `-soft`, `-fill`, `-line`,
  `-ink`, and the bare solid — to *both* `:root` and `.dark`, then mapping it in
  `@theme inline`. Miss the mapping and the utility just doesn't exist; Tailwind
  generates nothing and the element renders unstyled.
- **Chart colours are validated, not chosen.** Both themes' values are selected
  steps run through the dataviz palette validator against their own surface.
  Changing one means re-running it, not eyeballing it.

## 10. Touch the feedback widget

The widget is the only thing in this app a non-officer can write with, and the
only write that carries data the app collected rather than the user typed. Two
rules follow from that, and neither is stylistic:

- **Nothing reaches `context` that the reporter wasn't shown.** The panel
  renders `contextLines(context)` from the *same object* it submits, so a new
  field appears on screen the moment it exists. Adding one to
  `feedbackContextSchema` without adding it to `contextLines` makes the panel
  lie about what it sends.
- **The consent switch is the only thing that enables collection.** Picking an
  element is gated behind it, and turning it off discards what was picked.
  Anything that sets `shareContext` for the reporter defeats the feature.

- **The export is a contract with whoever fixes the bug.** `formatReportForAgent`
  is what gets pasted to a developer or a coding agent, so a field worth
  collecting is a field worth putting there. `likelyRouteFile` is a mechanical
  route→file guess and is labelled "likely" for that reason — a route rendered
  by a client component has its real bug under `src/components`.
- **Triage never edits the report.** `priority` and `adminNote` are the
  officer's, and `setFeedbackTriage` can reach nothing else: a tool that could
  rewrite `body`, `route`, `url` or `context` would make the record worthless a
  month later, which is the only reason it is kept. The note renders beside the
  reporter's words and exports under its own heading, never merged into theirs.
  `priority` starts at `unset` because "nobody has looked at this" is a state,
  and the listing sorts it *above* `minor` for the same reason.
- **Closing a report signs it; reopening unsigns it.** `resolved_by` and
  `resolved_at` are written by **both** doors — `setFeedbackStatus` and a
  `setFeedbackTriage` that sets `status` — and cleared when a report goes back to
  open, because a signature on a live report claims a call nobody is standing
  behind. Closing without a name is allowed: an unsigned closure beats a tool
  that refuses to close. Reports closed before this existed carry neither, and no
  backfill can invent them.

A new **table**, unlike a new column, needs no `migrate()` line — `db.exec(SCHEMA)`
runs `CREATE TABLE IF NOT EXISTS` on every boot. §2's warning is about columns
added to an existing block, which `CREATE TABLE` will not retrofit — and
`feedback.kind` is exactly that case: the table shipped without it, so it needs
both the `CREATE TABLE` entry (fresh databases) and the `addColumn` line (every
database that already filed a report).

---

## 11. Add a capability, or gate something with one

**Chain:** `src/lib/auth/capabilities.ts` → at least one enforcement site → the
role templates a guild starts from → whether it may sit in the **baseline**.

`src/lib/auth/enforcement.test.ts` pins the set of write capabilities with no
enforcement site at **empty**. It used to be an allowlist of features not yet
built; it is not any more, so a failure there means a capability was added
without wiring it up.

Every step fails silently on its own:

- **A capability with no enforcement site** renders as a checkbox in the grant
  editor that protects nothing. The guild reads it, believes it, and hands out
  a role on the strength of it. Nothing errors — the permission is simply a
  claim the app does not keep.
- **An enforcement site with no capability** is the reverse: a page or action
  that nothing can grant. Since enforcement went on it is unreachable for
  everyone but the guild master, immediately and silently.
- **A capability nobody's role template holds** ships denied to every existing
  guild. That is the *intended* default (deny by default, §4 of the design
  doc), but it means adding a capability to gate an existing feature silently
  takes that feature away from everyone below GM. Grant it in the templates in
  the same change, or say out loud that it is meant to be re-granted by hand.

- **A capability that hands out capabilities cannot be in the baseline.**
  `NEVER_BASELINE` refuses it, because every member holds the baseline and any
  of them could then grant themselves everything — the permission system would
  still render and mean nothing. That list is drawn at exactly that
  contradiction and nothing wider: which *other* writes a guild puts under
  every member is the guild's call, the same way loot weights are, and the
  editor states the consequence instead of refusing.

**Checks enforce.** `PROJECTLC_AUTH=on` since 2026-08-12, so a check added
today refuses somebody the moment it is wrong — there is no longer a dormant
period in which a mistake is invisible. Test the capability, not the call site.
Reads are gated too now, but by a *different* mechanism: `pageView()` at the top
of each `page.tsx`, and each `route.ts` for itself. A `requireCapability` in an
action says nothing about who can read the page that action sits on.

**Hiding a button is not a permission check — but showing one that always
fails is its own bug.** A `can()` in a component is cosmetic: it stops a raider
clicking something that would fail. The server action checks again, every time.

The converse is the failure that actually gets reported: a control rendered to
somebody whose action will refuse it reads as the app being broken, and the
raider tells an officer who cannot reproduce it. Every editor on the guild page
was in that state until the settings were gated on the capability each one's
action requires. When you add a control, gate its *visibility* on the same
capability its action checks — two expressions of one decision, and neither is
optional. Exactly the same rule as input validation,
where the client-side preview is a convenience and never a guarantee — and the
same failure if you skip it, except this one is a data leak rather than a bad
row.

See [`src/lib/auth/AGENTS.md`](../src/lib/auth/AGENTS.md) and
[`guild-and-player-profiles.md`](guild-and-player-profiles.md).

---

## 12. Add a page, or change who may see one

**Chain:** the `page.tsx` → its `pageView()` declaration → the public allowlist
in `src/lib/auth/pages.test.ts`.

**Every page declares what it needs, in its first two lines.** `pageView()`
resolves the viewer and either hands it back or refuses; a signed-out visitor
who needs more than `"public"` is redirected to sign in, and a member who lacks
the capability gets `<NoAccess>` rather than a 404 — they know the guild exists,
they are standing in it, and a 404 reads as the site being broken.

The failure this chain exists to catch is an **omission**. A new page with no
declaration compiles, renders, looks right, and serves whatever it reads to
anyone with the URL. Nothing else notices, which is why `pages.test.ts`
enumerates every `page.tsx` and fails when one is undeclared. Treat a failure
there as the prompt it is; `pageView("public")` is an acceptable answer, but it
has to be given rather than assumed.

**The public allowlist is a decision, not a default.** That test also pins the
exact set of routes declared `"public"`. Growing it is a choice about what this
guild publishes to the world, so it takes a deliberate edit in two places.
§6 of the design doc draws the line: the public face may show what Warcraft
Logs already publishes, and may never show the guild's own judgements — the
ledger, the priority sheet, standing, attendance, comments.

**A page gate is not a write check.** Hiding a page does not stop a POST. The
server action still calls `requireCapability`, every time, exactly as before —
these are two independent layers and dropping either is a hole. Same rule as
§11's "hiding a button is not a permission check", one level up.

**Widening the public face is a four-place change**, and every one of them is
deliberate on purpose: `PublicProfileInput` (what may be published at all), the
mapping in `store.ts` (what is actually copied across), `buildPublicProfile`
(which preset reveals it), and the leak test in `public-profile.test.ts`. The
projection is never handed an award, a standing or a `status`, so there is no
filter anybody can forget — but there is also no shortcut. That is the trade §6
chose over a filtered member page.

**A `route.ts` is not a page either.** `pages.test.ts` walks `page.tsx`, so a
route handler declares nothing and is gated by nothing. Converting a server
action into a route handler — which is a *performance* change, and reads like
one in review — silently drops the `requireCapability` the action carried.
`src/lib/auth/routes.test.ts` is the counterpart, and it strips comments before
matching, because the first version of it was satisfied by its own header.

**The layout is not a page, and `pageView()` does not reach it.** Whatever
`layout.tsx` fetches is serialized into *every* response, including a signed-out
stranger's — so it may only ask for things an outsider may have.
`src/app/layout.test.ts` pins that list. This is not hypothetical: the nav's
item search was handed the whole demand list there, and every anonymous request
to the public profile carried 1458 item names with `wisherCount` and
`awardCount` attached, through an app whose pages were all correctly gated. The
same applies to any component the layout renders for everybody.

**Reading a session makes a route dynamic.** `pageView()` reaches the cookie, so
every gated page is server-rendered per request and no longer prerendered. That
is the price of the gate and it is already paid across the app; do not try to
claw a page back to static by skipping the declaration.

## Operational chains (things the officer must do, not the code)

Some changes are only half-done in code. Say these out loud when they apply:

| Change | What the user must do |
|---|---|
| New tracked cast/aura id | Re-import every WCL report |
| New gear/gem/quality field from logs | Re-import (it is derived at import time) |
| Guild enters a new phase | Set the active phase — the rare-gem rule keys off it |
| New enchant id seen | Import more SixtyUpgrades lists, or run the enchant resolver |
