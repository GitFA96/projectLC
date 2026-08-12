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

## 7. Check what a doc claims about itself before believing it.

[`guild-and-player-profiles.md`](guild-and-player-profiles.md) **was** ideation
and is now the design of record for identity and permissions — partly built,
partly not. Its own status table says which is which, and that table is the
thing to read first: implementing from the unbuilt half is fine, assuming the
unbuilt half exists is not.

The general rule stands. A doc that describes a future is not evidence that the
future arrived, and the only way to tell is that the doc says so plainly. If a
doc's status isn't obvious in its first paragraph, say so when you add it.

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

## An item id is not a unique key

TBC lets a raider wear two of the same non-unique trinket, and six contender
rows on this guild's data do. `key={item.itemId}` over a per-slot list is
therefore a React duplicate-key error and a row that may be dropped — key by
**slot**, which is unique inside a gear set, and carry the slot through
whatever maps the list. Same trap for rings.

The list that *is* safe to key by id is a search result over the item cache,
where ids are the primary key.

## `localeCompare()` sorts differently depending on who runs the process

A bare `a.localeCompare(b)` uses the *host's* default locale, and this project
is developed under `nb-NO`. Norwegian collation treats "aa" as "å", which sorts
after "z" — so a character named Aandor appears below Zul here, and above
Baldur on a container that defaults to `en`. Nothing fails; the roster is just
in a different order in dev than in production, and it reads as a sorting bug
that cannot be reproduced.

**Nothing calls it directly any more.** Every comparison goes through
`compareText` in `src/lib/sort.ts`, and `sort.test.ts` fails if a bare
`.localeCompare(` reappears anywhere in `src/` — because the failure mode here
is a *new* call site written the obvious way, not the ones already found.

The sweep deliberately covered the sites sorting ISO timestamps and ids too,
where no locale can disagree. Nothing was gained on those individually; what was
gained is that the rule needs no judgement at the call site, which is what makes
it enforceable at all.

## The theme script warns on every client render, and that is correct

React logs *"Encountered a script tag while rendering React component"* against
`src/app/layout.tsx`. The string lives only in
`react-dom-client.development.js` — it is not in the production build — and
what it means is that the inline theme script will not run again during a
client re-render. That is the desired behaviour: the class was stamped before
first paint and re-running it would achieve nothing.

Do not "fix" it. The script exists to beat the stylesheet to the first paint,
and every alternative loses that: `next/script` with `beforeInteractive` is
documented as not blocking hydration, a `<template>` needs JS to activate it,
and moving the preference to a cookie so the server can stamp the class means
reading a cookie during layout render — which opts every page in the app out of
static rendering. The warning is the cheapest of the four options.


## "Inactive" means two unrelated things

`characters.status = "inactive"` is a **loot-scoring judgement about a toon** —
the guild has decided this one carries less weight. An inactive *person* is
`accounts.last_seen_at` going quiet, which is a fact about a login and nothing
to do with any character.

Only the second has anything to do with succession. Reading the first one there
would start the countdown on a guild master because they benched an alt, and
then hand their guild to somebody else — which looks from every angle like the
succession logic being wrong rather than like a word being read twice.

The same trap in general form is §2 of `guild-and-player-profiles.md`: nothing
about a *character* may ever decide what a *person* may do.


## A writer with no caller is not a finished feature

Seven of them accumulated here before anybody noticed: `deleteMembership`,
`removeGuildOwner`, `transferGuildOwnership`, `setAccountDisabled`,
`revokeAccountSessions`, `purgeExpiredAuthSessions`, `purgeExpiredInvites` —
each written, tested, carefully reasoned, and reachable from nothing. Four
appeared in the codebase *only inside comments describing what they would do*.
The same happened to `signOutAction`, to `succession.ts` and to break-glass.
All of them have a surface now; `transferGuildOwnership` and `listBreakGlass`
were the two that ended the other way, deleted once it was clear the paths
already wired did the same job in steps a person can see.

It reads as done from every angle that usually catches things. The code exists,
the tests pass, the doc describes it. What was missing was the sentence "and
here is where a person clicks it", and no test asks that question.

So when a layer's writers land ahead of its UI — which is the right order —
**leave the list of what is not yet reachable somewhere that will be read**, and
check it before calling the layer finished. `grep -rn "functionName" src/ |
grep -v db.ts | grep -v test` takes ten seconds and answers it exactly.


## Gating every page still leaves the chrome wide open

Read gating was built, every `page.tsx` declared what it needed, a test proved
none had been missed, and a rehearsal showed a signed-out visitor being turned
away from all of them. All true, and the app was still serving 216 KB of the
council's item-demand data to anybody who loaded the public profile — because
the nav's search box was handed the whole list in `layout.tsx`, one level above
everything the gate could see.

The lesson generalises past this app: **an authorization layer is only as good
as its least-examined entry point**, and the entry point nobody examines is the
one that is not a page. Layouts, providers, error boundaries and any component
rendered for everybody all sit outside a per-page check and are serialized into
the response regardless.

Two habits catch it. Measure a real anonymous response and grep it for something
that should never be there, rather than reasoning about which pages are gated.
And when a component needs a whole table to do one lookup, notice — that was
already written down as its own pitfall for the award dialog, and it turned out
to be the same bug wearing a different hat.


## A log nobody can read is not accountability

`guild_audit` was written to by every governance path in the app — the claim,
invitations, role changes, ownership, character links, break-glass — for the
whole time the identity layer was being built, and **nothing could read it**.
No repo method, no page, no component.

That is not merely a missing feature. Several safeguards were justified *by*
that table: "an override the guild cannot see is a back door, so the audit write
is part of the grant" is only true if the guild can see it, and it could not.
The code was right, the reasoning was right, and the conclusion was false
because one end of it was never built.

When a design leans on visibility as the thing that makes a power safe — an
audit trail, a notification, a public record — **the reader is part of the
safeguard, not a follow-up**. Ship it in the same change, or write down plainly
that the power is currently unaccountable.
