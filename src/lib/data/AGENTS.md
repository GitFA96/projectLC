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
- **Multi-row writes go in `withTx`** — one transaction, one version bump.

## Testing

`sqlite-repo.test.ts` is the big one. It builds throwaway databases; **never
point a test at `data/projectlc.db`** — that is the user's real guild data.
When you need to check behaviour against real data, copy the file to the
scratchpad first and set `PROJECTLC_DB` to the copy.

See [`docs/change-chains.md`](../../../docs/change-chains.md) §2, §3, §4, §8.
