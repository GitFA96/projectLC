---
name: cycle
description: Record a stretch of projectLC work — open a cycle in the local log, close one out, or update the improvement plan's state table. Use when starting a new body of work, when finishing one, and whenever a plan item changes state.
---

# Recording a cycle

Two places, and they answer different questions. **`docs/improvement-plan.md`
§7 says what state each item is in. `local/dev-cycles.md` says how it went.**
Neither substitutes for the other, and a change that touches one usually touches
both.

## §7, every time — same commit, not a follow-up

One item per branch. When an item changes state, its row changes in the **same
commit** as the work. States are `open` · `in progress (branch)` ·
`done (commit)` · `dropped (why)`.

The Notes column is where a later reader learns something. Put in it what the
plan did not know: a count that turned out wrong, a module already covered, a
bug the work uncovered. If §4's proposal and what you built differ, that is a
row in **§8** as well — same commit, same rule. §8 is the running record of
where the guess and the code disagreed and the code won.

Also update §5's phase row when an item completes, and any dependency note that
has just been unblocked.

## `local/dev-cycles.md`, per cycle

Gitignored, newest first, append-only. What became true of the *project* goes in
`docs/`; this is the narrative of how it got there — decisions taken, bugs found
and what is still open.

Each cycle carries a **tag** (`deploy-hardening`), and you refer back by tag
rather than by date, because dates move when a cycle spans several days.

To open one: put it above the previous cycle with a new tag, keep the same
sections, and move the `**current**` marker off the old one.

**Never rewrite a finished cycle.** If something it decided was later reversed,
or something it listed as still open has since been done, say so in the *new*
cycle and link the old tag. A cycle is a record of what was believed at the
time; editing it destroys exactly the thing it is for.

## What belongs in a cycle entry

The bugs are the valuable part, and the most valuable are the ones the suite was
green through. Say what was invisible and what now catches it. "Decisions made"
earns its place when a decision was genuinely open — record the option that was
rejected and why, so the next cycle does not re-derive it.

Counts and inventories do not belong in either file. Root `AGENTS.md` says why:
they go stale without anyone noticing and buy nothing.
