# Improvement plan — structure, tests, and working with agents

> **Status: proposed 2026-09-03. Phase 0 done and phase 1 under way, 2026-09-04.**
> Phase 0 and the first three phase-1 items landed in `a3c08c0`; A2 and A3
> followed.
> Every item carries a state in §7, and the change that does the work updates
> that row in the same commit. The measurements in §2 were re-taken on
> 2026-09-04 and will drift again — re-measure before quoting one.
>
> Each guard added so far was proven by breaking the thing it guards and
> watching it go red, then restoring. That step is not optional: a guard nobody
> has seen fail is a guard nobody knows works.

This file is the standing plan for the *codebase* — how it is structured, how
it is tested, and how agents work in it. Product decisions and blocked features
stay in [`backlog.md`](backlog.md). Couplings stay in
[`change-chains.md`](change-chains.md). Nothing here restates either; it points.

## 0. How to use this file

1. Pick an item from §7 whose state is `open` and whose dependencies (§5) are
   `done`. Do the whole item, in one branch or worktree.
2. Before starting, read the chain the item names. Before finishing, run the
   preflight (E1) and update the item's row.
3. If doing the item turns up a coupling that is not in `change-chains.md`, add
   it there in the same change. That is the only kind of doc this plan asks for.
4. If an item turns out to be wrong, change its state to `dropped` and say why
   in the row. Do not delete it — the next agent will otherwise re-derive it.

The one principle behind every item: **this project already turns prose into
checks** — `docs.test.ts`, `enforcement.test.ts`, `pages.test.ts`,
`routes.test.ts`, `sort.test.ts`, the two build guards, the image smoke test.
Each exists because a rule that lived only in a doc was broken silently. The
plan extends that pattern to the rules that are still prose.

## 1. The shape, and where it is fragile

The whole app is one pipeline with one durable store:

```
SixtyUpgrades · Gargul · Warcraft Logs · Wowhead
        │  import time only — src/lib/import, src/lib/wcl, src/lib/items
        ▼
SQLite  — src/lib/data/db.ts: schema, migrate(), the meta-key settings
        │  loadStore → EntityStore
        ▼
createRepoFromStore — src/lib/data/store.ts: EVERY derived number, once,
        │  rebuilt when data_version moves; calls src/lib/analysis (pure)
        ▼
Repo / WriteRepo — src/lib/data/repo.ts: the only boundary pages may see
        │
page.tsx  →  pageView() gate, then reads
actions.ts →  requireCapability → WriteRepo → bumpDataVersion → refreshAfterWrite
        │
components — name a colour's role; "use client" only for interactivity
```

Three caches sit on that pipeline, and each has its own failure:

- **The read model**, keyed on `data_version`. A write that does not bump it
  commits to disk and is invisible until restart (§4 of the chains).
- **Next's route cache**, cleared by `refreshAfterWrite()`. Called any other
  way, a cache throw reports a committed award as failed and invites a
  duplicating retry (`src/lib/refresh.ts`).
- **Module scope**, which nothing clears. The priority sheet's parse cache had
  to move inside the read model the day sheets became pasteable.

Where the risk concentrates, and which doc owns each:

| Fragility | Why it is silent | Owner |
|---|---|---|
| A curated id added without a re-import collects nothing, forever | the WCL events fetch is filtered server-side by the curated lists | chains §1, `src/lib/wcl/AGENTS.md` |
| A column added to `CREATE TABLE` alone works in every test and throws on the live database | `CREATE TABLE IF NOT EXISTS` never retrofits; only `migrate()` reaches an existing file | chains §2, pitfalls §5 |
| A write that skips one of the two cache steps | the write succeeds; the page is stale | chains §4 |
| Consumable gold priced in three places | different scopes, same rules, no test compares them | chains §5, pitfalls §3 |
| Authorization is a surface, not a framework | the dangerous mistake is an omission; only enumeration catches it | chains §11–12, `src/lib/auth/AGENTS.md` |
| Foundational data vs a guild's overlay | reading the wrong layer changes another council's verdict | [`shared-and-guild-data.md`](shared-and-guild-data.md) |
| A number that changes a verdict living outside `policy.ts` | it re-ranks the guild's loot with nothing red | root `AGENTS.md` invariant 5 |

Everything above is already documented. What §2 records is which of those
rules have a check behind them and which are still only sentences.

## 2. Findings — measured 2026-09-03, re-measured 2026-09-04 after phase 0

| Measure | Value |
|---|---|
| Source modules (`.ts`/`.tsx`, non-test) | 320 files, ~82k lines |
| Test files / tests / wall time | 97 / 1864 / 22 s, all green (was 94 / 1831) |
| Typecheck (`tsc --noEmit`) | 12 s, clean — `npm run typecheck`, and `npm run check` with the tests |
| Lint | one warning (`data-table.tsx`, TanStack's `useReactTable`); ~20 s cold, ~2 s cached |
| Column migrations (`addColumn` lines in `migrate()`) | 44, plus 8 table-rebuild or repair migrations |
| Migration regression tests | 5 |
| Pages / route handlers / action files / exported actions | 35 / 4 / 30 / 101 |
| Largest modules | `db.ts` 3971 · `store.ts` 2398 · `normalize.ts` 2168 · `sqlite-repo.ts` 2035 · `types.ts` 1674 · `import-tabs.tsx` 1584 · `preparedness-table.tsx` 1509 · `raid-planner.ts` 1472 |
| Last twelve commits | 1,300–5,900 changed lines each |

**Enforced by a check today.** Analysis purity and its per-module tests;
the three pricing *call sites* (by count, not by agreement); the WCL filter
being built from the lists; the meta-key table; every write capability having
a site; every page declaring a need; every route handler checking; the layout
fetching only outsider-safe data; no bare `localeCompare`; no prerendered
page; no database in the artifact; the seven image assertions.

Phase 0 added three more. **Invariant 1** is now a hook
(`.claude/hooks/guard-live-db.mjs`): a command naming `data/projectlc.db` is
refused unless it is a copy out of `data/`, reads included, because the `.db`
without its `-wal` is silently stale. The same hook family now refuses a bare
`next build`, which skips the two guards `npm run build` wraps it in, and a
build while `:3000` answers unless it is sent to `.next-build`. And the
**"except …" sentences** in `analysis/AGENTS.md` and chains §7 must now name
exactly what `docs.test.ts` exempts — the drift below is what motivated it.

Phase 1 has since added three more, each proven by breaking it on purpose.
**Layer boundaries** are `no-restricted-imports` rules in `eslint.config.mjs`,
so a violation fails in the editor rather than at test time (A5). **Every server
action** must reach a capability check and, if it writes, a
`refreshAfterWrite()` — following calls, so the good patterns already here
(`operator()`, `requireOwner()`, delegation to a gated sibling) keep working
(A6). And **the verdicts themselves** are a readable file snapshot of the seed
guild's standing, contention order, loot plan and dashboard, so a change to who
ranks first shows up as a sentence in a diff (A7).

**Still prose only.**

- **Invariant 3, per method.** `data/AGENTS.md` says "copy a neighbour". Five
  writers skip the bump on purpose (the raid, template and guild-roster
  boards) and nothing pins which five.
- **The three pricing sites agreeing.** Chains §5 says "nothing catches this
  but a test that compares them". There is no such test — `comparison.test.ts`,
  `season.test.ts` and `raid-report.test.ts` each exercise one site alone.

**Logic living where tests cannot reach it.**

- `src/app/logs/page.tsx` *is* one of the three pricing sites (it builds a
  `costPerUseMap` twice).
- `src/app/characters/[name]/performance/page.tsx` holds pure helpers
  (`coverage`, `usesOf`, `upkeepAverages`) in a 1,078-line page.
- `components/logs/gold-table.tsx` holds the saved-versus-pending ordering rule
  chains §3 spends four paragraphs on, plus `countChanges` and `groupLines`.
- `components/logs/preparedness-table.tsx` holds a module-level scale store.
- `src/lib/wcl/fetch-report.ts` builds the server-side filter expression
  inline; `docs.test.ts` can only grep for the list names.

**Doc drift, found and fixed (A8).** Chains §7 said every analysis module has a
test "except `contention.ts` and `fairness.ts`" — `contention.test.ts` had
existed for months. Pitfalls §2 said "two untested analysis modules"; there was
one. The structural test pinned the array and never read the sentences quoting
it, so both stayed wrong through every green run. Both are corrected, and
`docs.test.ts` now parses the sentences themselves.

**Tooling absent.** No coverage reporter, no formatter, no dead-export or
dependency-graph tool. *Closed in phase 0:* branch protection on `main`, a PR template, the
`typecheck` and `check` scripts, a cached lint, and the SQLite
`ExperimentalWarning` that printed fifteen times a run — `vitest.setup.ts`
now silences it exactly as `instrumentation-node.ts` does for the app.

**Operations.** Backups are manual. `v0.1.0` is not tagged. Rate limiting is
absent. `local/` is gitignored, so an agent in a fresh worktree or clone cannot
read the cycle log — that is deliberate (it holds host details) and worth
knowing.

## 3. Principles for the work

1. **Prose becomes a check.** If a rule can be decided mechanically, it gets a
   test or a hook, and the sentence in the doc points at it.
2. **Reasoning moves with code.** Pitfalls §6. A split or an extraction that
   drops a comment is a regression, whatever the tests say.
3. **No verdict moves without a diff.** A7's golden snapshots run on every
   change; a snapshot diff in a PR is either a bug or a decision, and the PR
   says which.
4. **Re-import notes are part of the change**, not the summary's last line.
5. **Small units.** One item per branch, one worktree per parallel agent, the
   §7 row updated in the same commit. The last twelve commits average
   thousands of lines; nobody can review that, and neither can a model.
6. **No new docs.** This file, `change-chains.md` when a coupling is found, and
   skills of forty lines that point at the chain. Pitfalls §8.
7. **Duplication here buys guarantees.** The three pricing sites stay three,
   the seed backend stays, `Repo`/`WriteRepo` stays split. Pitfalls §3.

## 4. Workstreams

Each item: why · do · done when · size (S/M/L) · model (§4E4) · risk.

### A. Guardrails — invariants into checks

**A1. Live-database guard hook.** *Why:* invariant 1 is the only root
invariant with nothing behind it, and the cost of one mistake is the guild's
history. *Do:* `.claude/hooks/guard-live-db.mjs` on `PreToolUse` for
`Bash|PowerShell`, same shape and fail-open discipline as
[`guard-dev-server.mjs`](../.claude/hooks/guard-dev-server.mjs): deny any
command that names `data/projectlc.db` (any suffix) or sets `PROJECTLC_DB` to
it, except a copy *from* it whose destination is outside `data/`. Extend the
existing hook to deny a bare `next build` (the guards only run through
`npm run build`) and to deny `npm run build` while `:3000` answers unless the
sanctioned `.next-build` dist dir is named. Note for whoever writes it: the
existing hook's dist-dir regex captures up to the next whitespace, so a
heredoc that merely *mentions* the variable with a backtick after it is
denied — that is how this plan had to be written with a different tool. Tighten
the capture to the sanctioned name and its punctuation. *Done when:* each deny
and allow case has a test (widen `vitest.config.ts` to include
`.claude/hooks/*.test.mjs`). S · Sonnet · low.

**A2. Write-contract test.** *Why:* per-method bumping is held by "copy a
neighbour". *Do:* a table of every `WriteRepo` method with a minimal valid
call; assert `data_version` moved, except a pinned exception list — today
`setRaidBoard`, `setTemplateBoard`, `createGuildRoster`, `updateGuildRoster`
and `deleteGuildRoster`, for the reason chains §3 gives. A reflective check
that every method on the write interface is in the table, so a new writer
fails until it is listed. *Done when:* temporarily removing one bump turns it
red. M · Sonnet, exception list reviewed by Opus · low.

**A3. Migration walk.** *Why:* 44 column migrations, 5 tests, and pitfalls §5
says the discipline is per-column. Node 22.13 ships SQLite 3.47, which supports
`DROP COLUMN`. *Do:* hoist the `addColumn` calls into an exported
`COLUMN_MIGRATIONS` list that `migrate()` iterates in order (a data change, not
a behaviour change — the order must be preserved exactly). Then one test: for
each entry, fresh database from `SCHEMA`, drop the column, close, open the repo,
assert the column is back and one read of the owning entity succeeds. Columns
`DROP COLUMN` refuses (indexed, keyed) go in a pinned skip list with the
reason. The eight rebuild/repair migrations keep hand-written tests; write the
missing ones. *Done when:* deleting any entry from the list is red.
M · Opus for the hoist, Sonnet for the tests · medium (migration order).

**A4. Pricing-agreement test.** *Why:* §2. *Do:* after B3, one raid night —
a test-built fixture with on-pull, off-pull and pet records — through
`summarizeRaidReport`, `goldPerRaid` and `summarizeSeason`; assert the same
per-raider gold from all three, with and without adjustments. Update
`docs.test.ts`'s call-site list and chains §5 to name the test. *Done when:* a
deliberate rule change in one site is red. M · Opus · medium.

**A5. Layer boundaries as lint.** *Why:* `docs.test.ts` checks analysis only,
at test time; lint runs in the editor and in CI before tests. *Do:*
`no-restricted-imports` overrides in `eslint.config.mjs`: `src/lib/analysis/**`
may not import `@/lib/data/*`, `next/*` or `@/lib/wcl/client`;
`src/components/**` may not import `@/lib/data/*` (move the `AccountRow` type
to `types.ts`); `src/app/**` may import `@/lib/data/repo` and nothing else from
the data layer — verify current usage first, and fix rather than allow. Keep
the analysis check in `docs.test.ts` too. *Done when:* a violating import fails
lint. S · Sonnet · low.

**A6. Action-shape test.** *Why:* §2. *Do:* a structural test beside
`enforcement.test.ts` that walks `src/app/**/*actions.ts`, strips comments (the
`routes.test.ts` lesson), and for every `export async function` requires a
`requireCapability`, `requireAppAdmin` or `can(` before the first repo call —
or membership in a pinned allowlist (`signOutAction`, `whoAmI`, the pure
`preview*` parsers). Second assertion: a function that calls `getWriteRepo()`
calls `refreshAfterWrite(`. *Done when:* removing a check from any action is
red. M · Sonnet · low.

**A7. Golden verdicts.** *Why:* invariant 5 is unobservable today. *Do:* over
the seed store (fictional, safe to commit) under `DEFAULT_POLICY`, file
snapshots (`toMatchFileSnapshot`) of `getRosterStanding()`, `listItemDemand()`
with the contender order for the ten most-wanted items, `getLootPlan` for one
zone, `getDashboard()`, and `getCharacterPerformance` summaries for two seeded
raiders. Extend the seed with a second fictional report if the first leaves
standing empty. *Done when:* the snapshots exist and CI diffs them; the PR
template (D1) asks for the diff to be explained. S · Sonnet · low.

**A8. Doc truth.** *Do:* fix the two stale sentences in §2 now; extend
`docs.test.ts` so the "except …" sentence in `analysis/AGENTS.md` and chains §7
must name exactly `documentedExceptions`. S · Sonnet · low.

### B. Structure

**B1. Split `types.ts` by domain** — `types/loot.ts`, `types/wcl.ts`,
`types/identity.ts`, `types/items.ts`, `types/feedback.ts`, with `types.ts`
re-exporting everything so no import path changes. Every doc comment moves with
its type. S/M · Sonnet · low.

**B2. Split `db.ts`** into `data/db/schema.ts`, `data/db/migrate.ts` (with
A3's list and the rebuilds, in their current order), `data/db/meta/` one file
per key family (boards, guild rosters, prices and payback, adjustments and
excluded fights, policy, sheets and rules, sim profiles, guides, alternatives),
and `data/db/rows.ts`; `db.ts` stays as the barrel. `docs.test.ts` reads
`db.ts` for the meta keys — point it at the directory. Chains §2 and §3 name
`db.ts`; update them. *Done when:* the migration walk (A3) and the whole suite
are green and no comment was lost (diff the comment lines). M/L · Opus ·
medium. Depends on A3.

**B3. Page logic into the library.** Move the `logs/page.tsx` pricing site
into a store getter or an analysis module fed by the store, so all three sites
live in `src/lib` and A4 can compare them; move the performance page's helpers
into `analysis/performance-view.ts` with tests; leave both pages as
composition. No number may change — A7 is the proof. Update chains §5 and the
`docs.test.ts` list. M · Opus · medium. Depends on A7.

**B4. Split `sqlite-repo.ts` writes by domain** — gear, loot, wcl, items,
governance, meta — each a module taking `db` and `readModel`, composed into
`getSqliteRepo()`. A2 pins the bump across the split. M · Sonnet · low.
Depends on A2.

**B5. Decompose `createRepoFromStore`.** Extract per-domain view builders
(characters and summaries, attendance, performance and development, loot and
contention, sim) as pure functions of `(store, config)`; `store.ts` composes
them and keeps the two things that must not move: the per-model parsed-sheet
cache and the zero-argument memoization, with its "do not mutate what you get
back" rule. Last of the structural items, because it is the one where a silent
change is easiest and A7 plus C1 are the only net. L · Opus · high. Depends on
A7, C1.

**B6. Client components.** `import-tabs.tsx` into one file per tab plus the
imported-reports card. The gold table's `countChanges`, `groupLines` and its
saved-versus-pending ordering into `analysis/consumable-adjustments.ts` (already
home of `bumpAdjustment`), tested. The preparedness table's scale store into a
hook file. Check what `board.tsx` still holds that `analysis/raid-planner.ts`
does not. Pure moves; confirm in the browser afterwards. M · Sonnet · low.

**B7. Filter builder.** Extract `buildEventFilter(lists)` from
`fetch-report.ts` as a pure function and unit-test it: every list present,
names double-quoted (the chains §1 trap), and the dispel, interrupt and
enemy-cast fetches unfiltered. `docs.test.ts` can then assert the fetch uses
the builder instead of grepping for list names. S · Sonnet · low.

### C. Test coverage

**C1. Coverage, reported before gated.** `@vitest/coverage-v8`, a
`test:coverage` script, the summary uploaded from CI. After one baseline, set
thresholds only for the pure layers — `src/lib/analysis`, `src/lib/auth`,
`src/lib/loot`, `src/lib/sim`, `src/lib/wcl/normalize.ts` — at the measured
value, and ratchet. Never gate components. S · Sonnet · low.

**C2. Tests for untested pure modules.** `auth/capabilities.ts` (implication
closure, `sanitizeCapabilities`), `auth/session.ts` (verify what
`oauth.test.ts` already covers first), `items/enchant-names.ts`,
`loot/priority-chain.ts`, `loot/award-context.ts`, `import/diff.ts`,
`comments.ts`, `theme.ts`, and `sim/run.ts` + `sim/setup.ts` with the
subprocess injected. One module per unit of work. S each · Sonnet · low.

**C3. Behaviour tests only where B6 cannot reach.** `use-unsaved-guard.ts` is
the one candidate: a single `// @vitest-environment jsdom` file with
testing-library. Optional; skip if B6 leaves nothing untestable. M · Sonnet.

**C4. Build-guard tests.** `check-dynamic-routes.mjs` and
`prune-standalone.mjs` have none (`doctor` does). Split each into a pure
function plus a CLI, like `doctor-checks.mjs`, and test against a fake
manifest and a fake standalone tree. S · Sonnet · low.

**C5. Developer experience.** A vitest `setupFiles` entry that silences the
SQLite `ExperimentalWarning` the way `instrumentation-node.ts` does; scripts
`typecheck` and `check` (typecheck + test); `lint` with `--cache`; the three
listed in root `AGENTS.md` Commands. S · Sonnet · low.

### D. Continuous improvement

**D1. PR template and branch protection.** `.github/pull_request_template.md`
carrying the pitfalls checklist plus two lines: *re-import needed?* and *A7
snapshot diff explained?* Require both CI jobs on `main` (verify on GitHub; not
checkable from this workstation). S · human.

**D2. Tags.** Tag `v0.1.0` (the deploy-hardening cycle is the natural point)
and a tag per cycle thereafter; the deploy skill's snapshot step names the tag
being deployed. S · human.

**D3. Backups.** `scripts/backup.mjs` — `VACUUM INTO` through `node:sqlite`,
dated file, keep the last N, exit 1 on failure — behind `npm run backup`;
scheduled by the host or a compose sidecar; the
[deploy skill](../.claude/skills/deploy/SKILL.md) points at it and a restore
onto a scratch path is the check. The highest-value non-code item in the
deployment spec. M · Sonnet, scheduling by a human · low.

**D4. Rate limiting at the proxy**, documented in the deploy skill. The CSP
nonce stays in `backlog.md` with its trigger. S · doc.

**D5. Dependencies.** Dependabot is in place. Add `npm audit --omit=dev` as an
informational CI step, not a gate. S.

**D6. Lint speed.** 70 s is most of the inner loop; `--cache` with a
gitignored cache location, then measure. S · Sonnet.

### E. Agents — skills, hooks, subagents, model routing

**E1. Skills.** Each in `.claude/skills/<name>/SKILL.md`, forty lines at most,
shaped like the existing `deploy` skill: a procedure that points at the chain
rather than restating it.

| Skill | Carries |
|---|---|
| `preflight` | what to run before saying done — `check`, lint, the docs test; when to build into `.next-build` (routes, layout or auth touched) and when `npm run image` (auth, build or Dockerfile touched); the operational-chains table |
| `real-data-check` | copy `projectlc.db` **with `-wal` and `-shm`** to the scratchpad, point `PROJECTLC_DB` at the copy, never the live file |
| `probe-wcl` | plus `scripts/probe-wcl.mjs`: one GraphQL query against a report with the env credentials, output to the scratchpad; the traps — `fightIDs` not `startTime`/`endTime`, double quotes in filters, `combatantinfo` omits auras, `useAbilityIDs: false` |
| `add-migration` | chains §2 as a checklist, the A3 list to append to, the test template |
| `add-tracked-consumable` | chains §1 and §5f/§5g, the price key, the re-import note in the summary |
| `add-policy-field` | chains §4b |
| `cycle` | how to append to the local cycle log and update §7 here |

**E2. Hooks.** A1's guard. A `PostToolUse` hook on `Edit|Write` that prints
the chain when a chain file is touched — `consumables.ts`/`class-tracks.ts`
("re-import; say so"), the `SCHEMA` block ("`COLUMN_MIGRATIONS` + test"),
`policy.ts` ("`sanitizePolicy`, editor, `policy.test`"), `capabilities.ts`
("enforcement site, templates, `NEVER_BASELINE`"). A `SessionStart` hook that
prints whether `:3000` is up and how many §7 items are open. All fail open.

**E3. Subagents** in `.claude/agents/`, all read-only and Sonnet:
`chain-reviewer` (given the diff, names the chain files touched and the links
not touched), `docs-truth` (sentences in `docs/` naming a file or function
that no longer exists), `pure-test-writer` (a test for one named pure module in
the neighbour's style). `/code-review` stays the first reviewer; these add
what it does not know about this repo.

**E4. Model routing.**

| Work | Model | Why |
|---|---|---|
| Chain-following with a skill (A8, B1, B7, C2, C4, C5, D6, skill text) | Sonnet | mechanical and checkable; the skill carries the reasoning |
| Structural tests that pin a surface (A2, A5, A6, A7) | Sonnet writes, Opus reviews the exception list | the hard part is deciding what is exempt |
| Anything that can move a verdict, touch auth, reorder migrations or cross layers (A3 hoist, A4, B2, B3, B5) | Opus or Fable | failures are silent; the whole chain must be in context |
| Curating an id or aura name | Opus, against a real report, never from memory | invariant 4 |
| Every item | preflight green; A7 diff explained | — |

**E5. Work-unit conventions.** One §7 item per branch; a worktree per parallel
agent; commits of a few hundred lines where the item allows; the §7 row
updated in the same commit; never a second dev server; builds into
`.next-build` while one runs.

**E6. Permission allowlist** for read-only commands (`git status`, `git diff`,
`npx vitest run`, `npx tsc --noEmit`) through the `fewer-permission-prompts`
skill, so agents stop asking for what cannot hurt.

**E7. Pointers.** Root `AGENTS.md` and `backlog.md` link here. Done in the
change that added this file.

## 5. Sequencing

| Phase | Items | What it buys |
|---|---|---|
| 0 — cheap guards | **done** (A1, A8, C5, D1, E6, E7) | the live database is protected; the docs are true; the inner loop is quieter |
| 1 — invariants into checks | A2, A3, A5, A6, A7 **done**; B7, C4, E1 (`preflight`, `real-data-check`, `probe-wcl`), E2 open | every rule in §1 has something red behind it before anything is moved |
| 2 — logic where tests reach | B1, B3 → A4, B6, C1, C2, E1 (the rest), E3 | the pricing sites can be compared; the big pages and components shrink |
| 3 — split the big files | B2, B4, C3, D2, D3, D6 | `db.ts` and `sqlite-repo.ts` become navigable; backups exist |
| 4 — the read model | B5 | after which the backlog's multi-guild prerequisites (meta-key prefix, the `items` split) are tractable |

Hard dependencies: A4 after B3 · B2 after A3 · B4 after A2 · B3 after A7 ·
B5 after A7 and C1. Everything else can run in parallel worktrees.

## 6. Not doing, on purpose

- **No ORM or query builder.** `node:sqlite` with hand-written SQL is the
  zero-native-module choice that keeps the image portable.
- **No unifying the three pricing sites** into one function. They must
  *agree*; that is A4. Pitfalls §3.
- **No removing "unused" curated ids.** A dead-export tool, if ever adopted,
  ignores `src/lib/wcl/`. Pitfalls §4.
- **No app-wide component testing.** Logic moves out to where node-environment
  tests already reach it; C3 is the single exception.
- **No new docs** beyond this file and the skills.
- **No policy or weight changes.** A7 makes a move visible; it decides
  nothing.
- **No multi-guild routing** until the schema decision in `backlog.md` lands.

## 7. State

States: `open` · `in progress (branch)` · `done (commit)` · `dropped (why)`.

| Id | Item | State | Notes |
|---|---|---|---|
| A1 | Live-database guard hook | done | `guard-live-db.mjs` + `guard-checks.mjs` (pure) + `hook-io.mjs`; bare `next build` and build-while-serving added to the dev-server guard; 25 tests |
| A2 | Write-contract test | done | `src/lib/data/write-contract.test.ts` — a case per `WriteRepo` method, plus a reflective parse of the interface so a new writer fails until it is listed. The five board writes are asserted **not** to bump, each proving its write landed first. Eight methods (`setReportPayback`, the three roster writes, `setSimProfile`, `addAbilities`, `addEnchantNames`, `harvestItemCache`) had no test call anywhere before this |
| A3 | Migration walk | done | `COLUMN_MIGRATIONS` + `POST_REBUILD_COLUMN_MIGRATIONS` in `db.ts`, walked by `migrations.test.ts` (43 entries, not the 44 §4 guessed). No skip list was needed — `DROP COLUMN` refuses three of them only because a block comment sits in front of the table’s last column, so the harness strips comments rather than skipping. Found and fixed real drift: `fight_start_ms` was in `migrate()` and never in `SCHEMA`. The completeness half is a pinned baseline of the columns no migration covers, so both adding one to `SCHEMA` alone and deleting a list entry show up in that diff. The nine rebuild/repair migrations were measured by neutering each call and running the suite: four were covered, five were not, and the five now have hand-written cases — including the ambiguity guard in `promoteSimSettingsToProfiles`, which the first fixture tripped by accident |
| A4 | Pricing-agreement test | open | after B3 |
| A5 | Layer boundaries as lint | done | analysis, components and app each get their own rule and message; `AccountRow` moved to `types.ts`; the eight governance files that legitimately reach `db.ts` are pinned by name |
| A6 | Action-shape test | done | follows calls transitively; six actions deliberately check no capability, each with its argument. Found a real bug: `previewPolicyAction` took a **write** repo for a pure read, so the policy preview threw under `DATA_BACKEND=seed` |
| A7 | Golden verdicts | done | `src/lib/__snapshots__/golden-verdicts.md`. Standing uses `roster.minRaids: 1`, stated on the page: the seed ships one raid night and the real default of 3 places nobody |
| A8 | Doc truth | done | both sentences fixed; `docs.test.ts` now parses them and fails on the drift that had gone unnoticed for months |
| B1 | Split `types.ts` | open | |
| B2 | Split `db.ts` | open | unblocked — A3 done |
| B3 | Page logic into the library | open | after A7 |
| B4 | Split `sqlite-repo.ts` writes | open | after A2 |
| B5 | Decompose `createRepoFromStore` | open | after A7, C1 |
| B6 | Client components | open | |
| B7 | Filter builder | open | |
| C1 | Coverage, reported then gated | open | |
| C2 | Tests for untested pure modules | open | one module per unit |
| C3 | `use-unsaved-guard` behaviour test | open | optional |
| C4 | Build-guard tests | open | |
| C5 | Developer experience | done | `vitest.setup.ts` silences the SQLite warning; `typecheck` and `check` scripts; cached lint (~20 s → ~2 s) |
| D1 | PR template, branch protection | done | template written; `main` requires the `test` and `image` jobs, blocks force-pushes and deletion, and leaves `enforce_admins` **off** — a solo maintainer's direct pushes still work, and a required check cannot pass on a commit that does not exist yet. Tighten to `enforce_admins: true` if the work ever moves to PRs |
| D2 | Tags | open | human |
| D3 | Backups | open | |
| D4 | Rate limiting doc | open | |
| D5 | `npm audit` step | open | |
| D6 | Lint speed | open | |
| E1 | Skills | open | seven named in §4E1 |
| E2 | Hooks | open | |
| E3 | Subagents | open | |
| E4 | Model routing | done (this file) | the table in §4E4 |
| E5 | Work-unit conventions | done (this file) | §4E5 |
| E6 | Permission allowlist | done | eleven read-only entries in `.claude/settings.json`; writes still prompt, and both guards run ahead of the permission either way |
| E7 | Pointers from `AGENTS.md` and `backlog.md` | done (this change) | |
