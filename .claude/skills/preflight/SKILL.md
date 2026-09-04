---
name: preflight
description: What to run before saying a change is done in projectLC, and which changes need more than the test suite. Use when finishing a piece of work, before reporting completion, or when deciding whether a build or a container smoke test is needed.
---

# Before you say it is done

```bash
npm run check     # tsc --noEmit + vitest — always, no exceptions
npm run lint      # cached; ~2 s on a repeat
```

`check` covers the structural tests too: `docs.test.ts` fails when a sentence in
`docs/` stops being true, and the contract tests fail when a new `WriteRepo`
method or database column has not been listed. **A failure in one of those is
not a test to update — it is the change telling you a second place had to move.**
Read [`docs/change-chains.md`](../../../docs/change-chains.md) before editing
either side.

## When the suite is not enough

| You touched | Also run |
|---|---|
| a route, `layout.tsx`, or anything under `src/lib/auth/` | `NEXT_DIST_DIR=.next-build npm run build` |
| auth, the build, or the `Dockerfile` | `npm run image` |
| deployment config or env handling | `npm run doctor` |

**Build into `.next-build` whenever the dev server is up.** They share `.next`
by default and a build takes the running server down with it — and it does not
look like that: the server keeps answering top-level routes and 404s every
nested one, which reads as a routing bug and costs an hour.

`npm run build` is `next build` **plus two guards**. Never substitute a bare
`next build`; both guards exist because the mistake they catch shipped once.

## Say the operational half out loud

Some changes are only half-done in code. If yours is one of these, the officer
has to act, and a summary that leaves it out is wrong:

| Change | What the user must do |
|---|---|
| New tracked cast/aura id | **Re-import every WCL report** — the fetch is filtered server-side |
| New gear/gem/quality field from logs | Re-import; it is derived at import time |
| Guild enters a new phase | Set the active phase — the rare-gem rule keys off it |
| New enchant id seen | Import more SixtyUpgrades lists, or run the enchant resolver |

## Then report honestly

If a test fails, say so with the output. If you skipped a step above, say which
and why. Work picked from `docs/improvement-plan.md` §7 updates its row in the
same commit.
