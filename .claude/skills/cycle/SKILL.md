---
name: cycle
description: Record a stretch of projectLC work — open a cycle in the local log or close one out, and keep a plan's state table honest while one is open. Use when starting a new body of work, when finishing one, and whenever a plan item changes state.
---

# Recording a cycle

Two places, and they answer different questions. **A plan's state table says
what state each item is in. `local/dev-cycles.md` says how it went.** Neither
substitutes for the other. The one plan this repo has had,
`docs/improvement-plan.md`, closed on 2026-09-07 with its §7 full; it stays as
the record and as the shape the next one takes.

## A plan's state table — same commit, not a follow-up

While a plan is open: one item per branch, and its row changes in the **same
commit** as the work. States are `open` · `in progress (branch)` ·
`done (commit)` · `dropped (why)`.

The Notes column is where a later reader learns something. Put in it what the
plan did not know: a count that turned out wrong, a module already covered, a
bug the work uncovered. If the proposal and what you built differ, that is a
row in the plan's *where the plan was wrong* section as well — same commit,
same rule. `docs/improvement-plan.md` §8 is what that section looks like at
close, and what it shows: the guesses that failed were counts and approaches
written without opening the file. Write the *why* and the *done-when* in
advance; take the count and the shape from the code when you do the work.

Also update the sequencing row when an item completes, and any dependency note
that has just been unblocked.

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
