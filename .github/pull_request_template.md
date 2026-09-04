<!--
Keep this short. A checklist nobody fills in is worse than none — every line
below exists because skipping it once shipped a bug that looked correct in
review. Delete any section that genuinely does not apply, rather than ticking it.
-->

## What changed, and why

<!-- One or two sentences. The reasoning belongs in the code; this is the summary. -->

## Chains

<!--
docs/change-chains.md lists what else had to change. Name the chain you followed,
or say "none" — and remember pitfalls §1: the list tells you a coupling exists,
never that the list is complete. Search before you rely on one.
-->

- [ ] Searched for the coupling rather than trusting the chain list, and updated
      the list where it was wrong
- [ ] A rule that now lives in more than one place has been added to
      `docs/change-chains.md` as a new chain
- [ ] Comments moved with the code they explain (pitfalls §6)

## Things that fail silently

- [ ] **Schema touched?** Migration written *and* a migration test — a column
      added to `CREATE TABLE` alone works on every fresh database and throws on
      the user's real one
- [ ] **Write added?** It bumps `data_version` and the action ends in
      `refreshAfterWrite()`
- [ ] **Page or route added?** It declares `pageView()`, or the handler checks
      for itself
- [ ] **A number that changes a verdict?** It lives in `analysis/policy.ts`, not
      as a `const` in the module that reads it

## Does the officer have to do anything?

<!--
The operational chains at the end of docs/change-chains.md. A curated WCL list
that grows without a re-import collects nothing, forever, and the app looks
completely healthy while it does.
-->

- [ ] **Re-import needed?** If a curated cast, aura, consumable or dispel list
      changed — say so here **and** in the merge summary. If not, say "no".

## Checks

- [ ] `npm run check` (typecheck + tests) green
- [ ] `npm run lint` clean
- [ ] `src/lib/docs.test.ts` green **because the claims are true**, not because
      an expected array was edited (pitfalls §2)
- [ ] Golden verdict snapshots: unchanged, or the diff is explained above
      <!-- Lands with item A7; ignore this line until then. -->
- [ ] Auth, build or Dockerfile touched? `npm run image` — two shipped security
      bugs were invisible to the whole suite and to a workstation build

## Plan

- [ ] If this completes an item in [`docs/improvement-plan.md`](../docs/improvement-plan.md),
      its §7 row is updated in this same PR
