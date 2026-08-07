# src/lib/analysis — derived views

Read model in, view model out. **This layer is pure**: not one file here imports
`@/lib/data`, and that is the property worth protecting. It's why every rule the
council actually argues about can be tested without a database.

Called from `store.ts` (`createRepoFromStore`) and from page components. Never
the reverse — analysis must not reach for a repo.

## Rules

- **No I/O.** No repo, no `fetch`, no `Date.now()` baked into a result you want
  to assert on. Pass time in.
- **A module gets a `.test.ts` beside it.** Every file here has one except
  `contention.ts` and `fairness.ts`.
- **Don't invent domain knowledge the app can't justify.** The house rule
  throughout: name what a source actually says, and stay silent otherwise. An
  enchant nobody's imported list names stays a bare id rather than being graded
  "mediocre" from a stat model this app doesn't have.
- **Scoring weights are guild policy, not defaults you get to tune.** Anything
  that changes what a loot score means is the officer's decision — surface it,
  don't quietly rebalance it. Those numbers live in `policy.ts` and are edited
  on the guild page: **if changing a number changes a verdict, it belongs
  there**, not as a `const` in the module that happens to use it. Take the
  policy as an argument with `DEFAULT_POLICY` as the default, so the layer stays
  pure and a test can pass its own.

## The duplication to watch

Consumable gold is computed in **three** places that must agree:
`app/logs/page.tsx`, `goldPerRaid` in `comparison.ts`, `summarizeSeason` in
`season.ts`. Different inputs and scopes, same rules. Change one and the same
raid night reads two different ways on the raid page and the career page —
nothing catches it but a test that compares them.

See [`docs/change-chains.md`](../../../docs/change-chains.md) §5, §7.
