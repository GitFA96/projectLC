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

**Never add a spell id or aura name from memory.** WCL matches auras by exact
name and TBC buff names routinely differ from item names (Elixir of Major
Agility applies `Major Agility`). Probe a real report first.

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
| `loot_priority_weights` | `setLootPriorityWeights` (guild-wide, no suffix) |

Each has a `get…` that returns an **empty value meaning "unset, use defaults"**,
and a sanitizer that drops junk on read — so a hand-edited or stale row can
never crash a page. Follow the existing shape rather than inventing another
pattern, and add the key to the table above.

## 4. Any write, ever

**Chain:** write via `WriteRepo` → `bumpDataVersion(db)` → `refreshAfterWrite(path)`.

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

---

## Operational chains (things the officer must do, not the code)

Some changes are only half-done in code. Say these out loud when they apply:

| Change | What the user must do |
|---|---|
| New tracked cast/aura id | Re-import every WCL report |
| New gear/gem/quality field from logs | Re-import (it is derived at import time) |
| Guild enters a new phase | Set the active phase — the rare-gem rule keys off it |
| New enchant id seen | Import more SixtyUpgrades lists, or run the enchant resolver |
