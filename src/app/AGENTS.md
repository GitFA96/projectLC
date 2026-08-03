# src/app — routes and server actions

**Read the Next.js docs in `node_modules/next/dist/docs/` before writing here.**
This is Next 16 with Turbopack; the App Router conventions in your training data
may be stale. `params` and `searchParams` are **Promises** — `await` them.

## Layout

Each route colocates its own server actions (`actions.ts`, `award-actions.ts`,
`wcl-actions.ts`, …). There is one `route.ts` API handler (`api/fight-graph`),
and it exists because that data is fetched live per request rather than at
import time — everything else reads the database.

## Rules

- **Server components by default.** `"use client"` is for interactivity, not for
  data. If a client component needs data, pass it down.
- **Nothing fetches while rendering.** Wowhead and Warcraft Logs are called at
  *import* time only, and the results are cached in the database. A `fetch` in a
  page is a layering mistake — the page will be slow, flaky and offline-hostile.
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
  directly.

## Result shapes

Actions return discriminated results (`{ ok: true, … } | { ok: false, error }`),
not thrown errors, so the UI can show what happened. Match the neighbours.

See [`docs/change-chains.md`](../../docs/change-chains.md) §4, §6.
