---
name: add-migration
description: Add a column, table or schema change to projectLC's SQLite database. Use when persisting a new field, adding a table, or changing a key or constraint — covers the migration step that works in tests and throws on the user's real database.
---

# Adding to the schema

**The whole reason this skill exists:** a column added to the `CREATE TABLE`
block in `SCHEMA` works perfectly in tests and on a fresh install, and throws on
`data/projectlc.db`. The schema string only runs for a database that does not
exist yet. Every column added after the first release needs a second entry.

Read [`docs/change-chains.md` §2](../../../docs/change-chains.md) for the
reasoning. This is the procedure.

## The chain, as a checklist

`db/schema.ts` **and** the list in `db/migrate.ts` → `store.ts` (`EntityStore`) →
`sqlite-repo.ts` → `repo.ts` (`Repo`/`WriteRepo`) → the right file under
`types/` → `import/schemas.ts` if it is seedable → `sqlite-repo.test.ts`.

## Which list

| Adding | Goes in |
|---|---|
| a column on any table but `items` | `COLUMN_MIGRATIONS` |
| a column on `items` | `POST_REBUILD_COLUMN_MIGRATIONS` |
| a new table | `SCHEMA` alone — `CREATE TABLE IF NOT EXISTS` reaches every database |
| a key, a constraint, a type change | a hand-written rebuild; `addColumn` cannot do it |

`items` is separate because the `items_relaxed` rebuild copies a fixed set of
columns, so anything created before it runs is dropped again — on exactly the
databases old enough to need the migration.

A rebuild is create-new → copy → drop → rename. There are worked examples in
`db/migrate.ts`: `current_gear_overrides_spec` and `items_relaxed`.

## What tells you it is wrong

`migrations.test.ts` walks every list entry against a real database and fails
when one is missing, and again when the entry and the `CREATE TABLE` line
disagree about the type, the NOT NULL or the DEFAULT. A pinned baseline snapshot
covers the other direction: adding to `SCHEMA` alone, or deleting a list entry,
shows up as a diff there. **Neither failure is a test to update.**

A rebuild migration needs its own case — the walk cannot see it. Write it the
way the five in `migrations.test.ts` are written: build the old shape by hand,
run `migrate()`, assert the new one. Then prove it red by neutering the call.

## The trap that fails silently

Several `insert*` writers name their columns explicitly and double as the
**update** path — `updateCharacter` calls `insertCharacter`. `INSERT OR REPLACE`
deletes the row and reinserts it, so a column missing from that list is reset to
its default on every update, not just on insert. Nothing fails: the write
succeeds, the tests pass, and the field empties whenever somebody edits
something unrelated. `characters.membership_id` is the live example — an officer
fixing a raider's spec would silently have unclaimed their account.

So: add the column to the writer's list in the same change, and if the value is
not part of the caller's draft, read it **from the row** rather than from the
read model, which may not have caught up.

## Before you finish

Every write bumps `data_version` and ends in `refreshAfterWrite()`.
`write-contract.test.ts` will tell you if the new writer does neither. Then run
`/preflight`.
