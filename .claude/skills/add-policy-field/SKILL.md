---
name: add-policy-field
description: Add or change a number in projectLC's scoring policy. Use when a constant would change a loot verdict, when moving a hard-coded number into policy.ts, or when adding a field to the guild's policy editor.
---

# Adding a policy field

**If changing a number changes a verdict, it belongs in
`src/lib/analysis/policy.ts`** — not as a `const` in whichever module happens to
use it. Scoring weights and loot policy are the guild's call, and the officer
edits them on the guild page. Surface the question; do not answer it in code.

Read [`docs/change-chains.md` §4b](../../../docs/change-chains.md) for the
reasoning. This is the procedure.

## The chain

`analysis/policy.ts` (the type **and** the default) → `db.ts` `sanitizePolicy` →
the module that reads it → `policy-editor.tsx` → `policy.test.ts`.

## Two steps that fail quietly

- **`sanitizePolicy` is an allowlist.** A field the sanitizer does not name is
  dropped on read: the editor saves, the page reloads, and the value is back to
  its default with no error anywhere.
- **The default must reproduce today's behaviour exactly.** `policy.test.ts`
  asserts the whole default object for this reason — adopting a field must
  change no number until an officer edits one. A "harmless" default that differs
  from the constant it replaced silently re-ranks the guild's loot.

## Keep the layer pure

Anything scored takes the policy as an argument with `DEFAULT_POLICY` as its
default, and **never imports the repo**. That is what keeps `src/lib/analysis`
pure, and there is a lint rule and a `docs.test.ts` case behind it — a failure
there is the layer boundary talking, not a rule to widen.

## Show it, then check it

The golden-verdicts snapshot (`src/lib/__snapshots__/golden-verdicts.md`) is
where a policy change becomes visible. Regenerate it in the same change and read
the diff: a field adopted correctly moves nothing. **If it moves a verdict, that
is a decision for the guild, not a snapshot to accept** — say what moved and
why, and let the officer decide.

Then `/preflight`.
