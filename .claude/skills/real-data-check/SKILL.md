---
name: real-data-check
description: Check something against projectLC's real guild database without touching it. Use when a question needs the live data — how many rows, does this migration work, what does this report actually contain — rather than the seed.
---

# Checking against the real database

`data/projectlc.db` is the guild's only copy of its own history: real
characters, real awards, real raid nights, no automated backup. **Never open
it** — not to write, and not to read. Work on a copy.

A `PreToolUse` hook refuses commands that name it. That is the guard working,
not a problem to route around.

## Make the copy

```bash
cp data/projectlc.db data/projectlc.db-wal data/projectlc.db-shm "$SCRATCH/"
export PROJECTLC_DB="$SCRATCH/projectlc.db"
```

**Copy the `-wal` and `-shm` with it.** The database runs in WAL mode, so the
newest writes live in `projectlc.db-wal` until a checkpoint folds them in.
Copying the `.db` alone gives you a file that opens cleanly, answers every
query, and is silently missing the last few hours — which is the worst possible
way to be wrong about whether something works.

`$SCRATCH` is the scratchpad directory named in the environment. Anywhere
outside `data/` will do; the hook checks the destination is not the live file.

## Then ask your question

Every read goes through the repo, not raw SQL, unless the point *is* the SQL:

```bash
npx vitest run path/to/your-scratch.test.ts --disable-console-intercept
```

A throwaway test file is the shortest path — it gets the `@/` aliases, the
seeded environment and `console.info` output. Delete it afterwards.

## What a copy is good for, and what it is not

Good for: does this migration run on a database that has been alive for months;
how many rows really have this column empty; what does the live item cache say.

**Not** good for a verdict. A number computed from the live data is a fact about
today's data, not a test — pin behaviour in the seed store, where the fixture is
committed and fictional. See `src/lib/__snapshots__/golden-verdicts.md`.

When you are done, say which questions the copy answered. Do not copy anything
back.
