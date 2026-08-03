# Pitfalls — refactoring and building features here

[`change-chains.md`](change-chains.md) says *what else to touch*. This file says
**how this codebase, and the docs around it, will mislead you.** Read it before a
refactor that crosses layers, or when adding a feature that spans more than one.

---

## 1. The docs tell you a coupling exists. They never tell you the list is complete.

The most dangerous thing about writing this all down is that it replaces
searching with reading. An agent that greps for `costPerUseMap` finds whatever is
there today. An agent that reads "§5: three call sites" finds three — and if
someone added a fourth without updating the doc, it now ships an incomplete
change **and cites the doc as justification**.

> Treat every list in `docs/` as a prompt to look, not a substitute for looking.
> Verify the current set with a search before you rely on it.

A doc that was right when written and wrong now is indistinguishable from a doc
that was always wrong. Only the code is authoritative.

## 2. When `docs.test.ts` fails, do not "fix" it by editing the expected list.

The guards in `src/lib/docs.test.ts` assert exact sets — three pricing call
sites, two untested analysis modules. A legitimate new call site makes that test
red, and the reflex is to add the file to the array and move on.

**That silences the alarm instead of answering it.** A red guard means one of:

| What happened | The right fix |
|---|---|
| You added a 4th pricing site | Make it agree with the other three, *then* update §5 and the list |
| You renamed something the doc names | Update the doc's prose too, not just the test |
| An invariant was genuinely broken | Fix the code, or make the case for changing the invariant out loud |

Editing the array without doing the corresponding work leaves a test that
asserts nothing and a doc that lies. Worse than deleting both.

## 3. This codebase contains deliberate duplication. A refactoring agent reads it as a smell.

Three of these will look like obvious DRY opportunities and are not:

- **The three consumable-gold call sites.** Same rules, genuinely different
  inputs and scopes. They were separated on purpose; they must *agree*, which is
  not the same as being one function. If you unify them, prove all three views
  still produce the numbers they did.
- **`Repo` / `WriteRepo`.** The read/write split is what makes
  `DATA_BACKEND=seed` a safe read-only demo. Collapsing it removes the guarantee.
- **The seed backend.** It looks like a parallel implementation of SQLite. It
  isn't — both run the *same* `createRepoFromStore`, which is precisely why the
  demo can't drift from the real thing. Don't "simplify" it away.

Before removing duplication, find out what it's buying. In this repo it's
usually buying a guarantee.

## 4. Curated lists look like dead constants. They are data in a query.

`TRACKED_CAST_IDS`, `SCROLL_CAST_IDS`, `SAPPER_CAST_NAMES`, `SHAMAN_TOTEM_CASTS`,
the aura tables in `consumables.ts` — an id in one of these often has no other
reference in the codebase. Dead-code analysis will flag them. Your instinct will
agree.

They are interpolated into the **server-side filter expression** Warcraft Logs
runs. Deleting an "unused" id silently stops collecting that event forever, and
nothing fails. The same is true of aura *names*, which are matched as strings.

> Nothing in `wcl/consumables.ts` or `wcl/class-tracks.ts` is unused. Removing an
> entry is a product decision, not a cleanup.

## 5. The test suite has one known blind spot, and it's the expensive one.

Tests build throwaway databases from scratch, so a schema change that works on a
fresh database passes everything — while breaking the user's real
`data/projectlc.db`, the only copy of their guild's history.

There *are* migration regression tests (they open a database, strip a column, and
re-boot), but only for a couple of the many `addColumn` migrations. **The pattern
exists; the discipline is per-column.** Most migrations have no test.

If you add or change a column, write the matching migration test. Copy
`"migrates a database created before the external column existed"` in
`sqlite-repo.test.ts`. A green suite is not evidence your migration works.

## 6. Mechanical refactors destroy the most valuable thing in this repo.

The per-symbol comments — `types.ts` explaining why each type exists,
`refresh.ts` explaining the duplicate-award bug it prevents, `store.ts`
explaining why derived data lives there — are the reason this codebase is
followable at all. They are worth more than the code they sit above.

Move-and-rename operations drop them, split them from what they describe, or
leave them describing the old arrangement. **When you move code, move its
reasoning with it,** and re-read the comment to check it's still true of the new
location.

## 7. Not every doc in `docs/` is normative.

[`guild-and-player-profiles.md`](guild-and-player-profiles.md) is **ideation** —
its own header says "nothing here is built yet except where marked." It describes
a possible multi-tenant future so today's changes don't accidentally close doors.

Do not implement from it. Do not treat it as a spec, a backlog, or evidence that
something exists. If a doc's status isn't obvious in its first paragraph, say so
when you add it.

## 8. Documentation is not the work.

Agents like writing docs; docs are easy and feel productive. The failure mode is
a new markdown file per feature until the context budget is back where it started
and nobody reads any of it.

- New layer guides stay under ~50 lines.
- A new file needs a reason no existing file covers.
- If it's about *one function*, it's a code comment.
- If it's about *one change*, it's a commit message.
- Only cross-cutting couplings and invariants earn a place in `docs/`.

---

## Before calling a cross-layer change done

- [ ] Searched for the coupling rather than trusting the chain list — and updated
      the list if it was wrong.
- [ ] If the same rule now lives in more than one place, **that's a new chain** —
      added to `change-chains.md`.
- [ ] Schema touched? Migration written *and* a migration test.
- [ ] Curated WCL list touched? Told the user to re-import, in the summary.
- [ ] `docs.test.ts` green because the claims are true, not because the arrays
      were edited.
- [ ] Comments moved with the code they explain.
