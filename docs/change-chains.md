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

**Never add a spell id or aura name from memory.** WCL matches auras by exact
name and TBC buff names routinely differ from item names (Elixir of Major
Agility applies `Major Agility`). Probe a real report first.

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
| `loot_priority_weights` | `setLootPriorityWeights` (guild-wide, no suffix) |
| `sim_profile:<class>:<spec>` | `setSimProfile` (not per report — per class and spec) |

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

## 5. Change how a consumable is priced or counted

**Chain:** all three call sites must agree — `src/app/logs/page.tsx`,
`goldPerRaid` in `analysis/comparison.ts`, `summarizeSeason` in `analysis/season.ts`.

They each independently build a `costPerUseMap` and apply
`adjustmentsFor`/`applyAdjustments`. That duplication is deliberate (different
inputs, different scopes) but it means a rule added to one makes **the same raid
night read two different ways** on the raid page and the career page. Nothing
catches this but a test that compares them.

## 6. Add a route or a server action

- Pages are **server components by default**; `"use server"` action files are
  colocated with the route they serve, one per feature area.
- Nothing fetches from the network while rendering. Wowhead and Warcraft Logs
  are called at *import* time only. If you find yourself adding a `fetch` to a
  page, you are adding it in the wrong layer.
- Filter/selection state goes in the **URL**, not React state, so a view is
  shareable and only one variant renders server-side (`?gear=`, `?chars=`,
  `?report=`).

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

---

## Operational chains (things the officer must do, not the code)

Some changes are only half-done in code. Say these out loud when they apply:

| Change | What the user must do |
|---|---|
| New tracked cast/aura id | Re-import every WCL report |
| New gear/gem/quality field from logs | Re-import (it is derived at import time) |
| Guild enters a new phase | Set the active phase — the rare-gem rule keys off it |
| New enchant id seen | Import more SixtyUpgrades lists, or run the enchant resolver |
