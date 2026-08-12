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

The Buffs fetch is filtered the same way (`BUFF_TRACK_NAMES` ∪ `FLASK_BUFF_IDS`),
so it carries the same cost.

So a report fetched **before** you added the id never contained the event, and
never will until it is re-fetched. The app will look completely healthy and
report zero uses forever.

- Adding an id without re-importing is a **no-op that reviews as correct**.
- Say so in the UI or the summary when you add one, so the officer knows to
  re-fetch. This is operational, not cosmetic.
- Buff-style auras (`classifyAura`) come from the pull's `combatantinfo`
  snapshot and match **by name first**, so those degrade more gracefully — but
  they still only appear in reports fetched after the name was known.

**Uptime tracks record their own staleness.** Every report stores the aura names
it was fetched with (`WclReport.upkeepTracks`, stamped in `saveWclReport`), so a
reader can tell "the raid never applied this" from "this report predates the
track" — the sim context audit turns that into either a finding or a "refetch
this report", and it can only do so because the record exists. Nothing else is
self-describing this way: cast ids, consumables and totems still need the rule
above.

**Three facts were fetched all along and thrown away at normalize.** The
pre-potted potion's name, the timestamp on every death, and the label of a food
whose buff isn't called "Well Fed" all arrived in the events and were reduced to
a boolean or a counter. Recovering them needed no
new query — only storing what was already there — but it is still §1: the rows
already in the database don't have them, so **a re-import is what fills them
in**, and both features say so on screen rather than reading as "no data".

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

## 5a. Change what counts as prepared

**Chain:** `analysis/preparation.ts` — and nowhere else.

Preparation used to be written out inline in four places under two different
rules, one of them named `isPrepared` while never testing food. Everything that
asks now goes through this module: the loot-priority factor, the raid page's
coverage percentage and improvements list, the career rollup, the comparison
page, and the per-pull tick on a character.

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

What no lookup can settle is a name two items share exactly — both Warglaives of
Azzinoth are called "Warglaive of Azzinoth", and the sheet's "(Main Hand)" is the
council's annotation rather than anyone's item name. That is what `sheet_item_ids`
is for: an officer pins the id, keyed by the normalized name so a re-pasted sheet
keeps it.

Because they can be dropped, they have to be reachable: `setItemCuration` is
the officer's way back, on the item's own page. **`items.source.zone` is the
only thing that puts a drop on a raid's loot plan** (`getLootPlan` filters on
it), so an item with no zone is invisible there however well known it is.

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
`FightFilter`, `ConsumablePricePanel` and `ConsumableAdjustmentsPanel` all carry
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
