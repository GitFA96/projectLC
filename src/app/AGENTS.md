# src/app — routes and server actions

**Read the Next.js docs in `node_modules/next/dist/docs/` before writing here.**
This is Next 16 with Turbopack; the App Router conventions in your training data
may be stale. `params` and `searchParams` are **Promises** — `await` them.

## Layout

Each route colocates its own server actions (`actions.ts`, `award-actions.ts`,
`wcl-actions.ts`, …). `route.ts` handlers are the exception rather than the
pattern: the sign-in hop needs real HTTP redirects and cookies, and
`api/fight-graph` fetches live per request rather than at import time because
four compared players through a server action ran serially. Everything else
reads the database.

## Rules

- **Server components by default.** `"use client"` is for interactivity, not for
  data. If a client component needs data, pass it down.
- **Nothing fetches while rendering.** Wowhead and Warcraft Logs are called at
  *import* time only, and the results are cached in the database. A `fetch` in a
  page is a layering mistake — the page will be slow, flaky and offline-hostile.
- **A `route.ts` gates itself.** `pageView()` covers `page.tsx` and nothing
  else, so a handler that reads guild data checks its own capability — and the
  moment somebody converts a server action into a route for speed, the
  `requireCapability` at the top of the action is not carried across by
  anything. That is not hypothetical: it is how `/api/fight-graph` came to serve
  live Warcraft Logs data, on this deployment's own API credentials, to
  anonymous callers. `src/lib/auth/routes.test.ts` fails on a handler with no
  check, and its allowlist is the sign-in flow only.
- **Every action ends with `refreshAfterWrite()`** from `@/lib/refresh`, never a
  bare `revalidatePath()` inside a try block. Read that file's header once: a
  throw from the cache layer would otherwise report a *committed* write as
  failed, the officer retries, and the ledger gains a duplicate award.
- **Actions re-validate their input** through `@/lib/import/schemas`. The
  client-side preview validating first is a convenience, not a guarantee.
- **Selection state lives in the URL** (`?gear=`, `?chars=`, `?report=`), not in
  React state — so only one variant renders server-side and every view is
  shareable. Officers paste these links at each other; that's the point.
- **Data comes from `@/lib/data/repo`**, never from `db.ts` or a backend
  directly — now enforced by `no-restricted-imports` in `eslint.config.mjs`
  rather than left to habit. **One exception: identity writes go through
  `@/lib/auth`.**
  Invites, character claims and the deployment claim have rules that exist in
  exactly one place — hashing a code, one use only, refusing a character
  somebody already holds, all inside a single transaction. Routing them through
  `WriteRepo` would either duplicate those rules or make it a passthrough that
  pretends to own something it doesn't. *Reads* still come through the repo, and
  the read model serves them (`getMembersView`).

  In practice eight governance and tenancy files reach `db.ts` **directly** —
  accounts, sessions, memberships, ownership, audit and break-glass all sit
  outside the read model on purpose (`src/lib/data/AGENTS.md`). That set is
  listed by name in `eslint.config.mjs`, which makes it a pin rather than a
  hole: a ninth file fails lint until somebody adds it there deliberately.
  Ordinary guild data never belongs on that list.

## Result shapes

Actions return discriminated results (`{ ok: true, … } | { ok: false, error }`),
not thrown errors, so the UI can show what happened. Match the neighbours.

See [`docs/change-chains.md`](../../docs/change-chains.md) §4, §6.
