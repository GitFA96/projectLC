# src/lib/data — persistence

One direction of flow:

```
db.ts        raw node:sqlite — schema, migrations, row⇄entity mapping
  ↓
store.ts     EntityStore (plain entities) + createRepoFromStore (ALL derived data)
  ↓
sqlite-repo.ts / seed-repo.ts    the two backends
  ↓
repo.ts      the boundary — Repo (read) / WriteRepo (write). Pages see only this.
```

**Derived data is computed once, in `store.ts`.** Both backends run the same
`createRepoFromStore`, which is why the read-only seed demo answers every query
identically to SQLite. Never compute a summary in a backend.

## Rules

- **Pages and actions import `repo.ts` only.** `getRepo()` / `getWriteRepo()`
  pick the backend from `DATA_BACKEND`; `getWriteRepo()` throws under `seed`.
- **Every write calls `bumpDataVersion(db)`.** The read model is an in-memory
  rebuild triggered by that counter. Skip it and the write commits to disk and
  stays invisible until restart.
- **Every schema change after the first release needs an `addColumn()` line in
  `migrate()`.** The `CREATE TABLE` block only runs on a fresh database, so a
  missing migration works in tests and breaks the user's real database — the
  one failure mode nothing here catches. PK/constraint changes need a full
  table rebuild; copy `current_gear_overrides_spec` or `items_relaxed`.
- **Per-report settings go in `meta` under `<name>:<code>`, not a new table.**
  Four already do. Empty return = "unset, use defaults", and every getter
  sanitizes on read so a stale row can't crash a page.
- **The item cache has one authority, and it isn't us.** Wowhead owns an
  item's name, quality, icon and slot; the seed, wishlists and log snapshots
  are guesses that fill the gap until it answers. Only `saveResolvedItems` may
  overwrite those fields, and only it sets `items.verified`. Everything else
  goes through `addItemsIfMissing`, which fills holes and never overwrites.
  A row stays on `listUnresolvedItemIds()` until Wowhead has confirmed it —
  "has an icon" and "has the right icon" are different claims, and a cache that
  conflated them reported itself complete while showing eight wrong pictures.
  The one field an authoritative write may *clear* is `slot`, and only for a
  row it just identified as an armor token: "this is a token" is a positive
  statement that it has no slot, not the silence COALESCE exists to respect,
  and the shipped seed did invent slots for tokens.
  Zone, boss and phase are the opposite: the guild's own, never overwritten by
  any import — except when Wowhead's name for an id contradicts an unverified
  one, which means the row was curated onto the wrong item and its curation
  describes a different one. `setItemCuration` is the officer's writer;
  `applyCuratedItemSources` re-applies the shipped drop table to rows that have
  none, which is the only way a database seeded before that list was corrected
  ever sees the correction — both gap-fill, so a hand-set answer always wins.
- **A tier token and the piece it buys are one loot decision**, joined by
  `items.redeems_from` on the *piece*. `saveTokenRedemptions` is its writer and
  the only one — Wowhead's vendor listing is the sole source, so it overwrites
  rather than gap-fills. `store.ts` reads the column once into the lookup every
  wishlist and contention reader takes. See change-chains §4g.
- **Multi-row writes go in `withTx`** — one transaction, one version bump.
- **`accounts` and `auth_sessions` are outside the read model, and their writes
  do NOT bump `data_version`.** They are not guild data, they change on every
  login, and a bump there would rebuild the entire in-memory store each time
  somebody signs in — a silent performance collapse that nothing tests catch.
  The other identity tables (memberships, roles, invites, audit) *are* guild
  data and bump like anything else; a membership change that skips the bump
  leaves the roster showing a claim that is no longer there until restart.
- **An app admin may hold memberships**, and normally does. What keeps an
  operator out of a guild is not the schema — it is that `decide()` grants guild
  capabilities from a membership and never from the flag. A trigger enforcing
  the opposite existed briefly and was removed; see
  `consolidateAccountPrincipals` and docs/guild-and-player-profiles.md §7.
- **Zero-argument views are memoized for the life of a read model**
  (`MEMOIZED_VIEWS` in `store.ts`). They are pure over an immutable store and
  the model is rebuilt whenever `data_version` changes, so "this read model" is
  the whole cache key. Two consequences: only add a **zero-argument** reader to
  that list — one taking arguments would hand one caller's answer to another —
  and callers must **not mutate** what they get back, because it is now shared.

## Testing

`sqlite-repo.test.ts` is the big one. It builds throwaway databases; **never
point a test at `data/projectlc.db`** — that is the user's real guild data.
When you need to check behaviour against real data, copy the file to the
scratchpad first and set `PROJECTLC_DB` to the copy.

**Copy the `-wal` and `-shm` files with it.** The database runs in WAL mode, so
recent writes live in `projectlc.db-wal` until a checkpoint folds them in.
Copying only the `.db` gives you a snapshot that opens cleanly, answers every
query, and is silently missing the newest rows — which is the worst possible
way to be wrong about whether a migration works.

See [`docs/change-chains.md`](../../../docs/change-chains.md) §2, §3, §4, §8.
