# src/lib/auth — who is asking, and what they may do

```
capabilities.ts   the vocabulary a guild can grant, and what implies what
viewer.ts         Viewer — one person, resolved against ONE guild (pure)
can.ts            decide / can / ownsCharacter / requireCapability
                  + isAppAdmin / requireAppAdmin — a separate axis, see below
discord.ts        the OAuth round trip. `identify` scope only, PKCE, no token kept
session.ts        the session cookie, and the state that guards the OAuth hop
resolve.ts        session -> Viewer. The only file here that touches the database
claim.ts          the one-time deployment claim and the starter roles
invites.ts        the only way into a guild after the claim: issue / redeem / revoke
claims.ts         who plays what, set by an officer rather than by an invitation
roles.ts          the guild defining what its own roles mean
succession.ts     what happens when every owner of a guild goes quiet (pure)
```

**`viewer.ts` must stay free of data imports.** Every server action imports it,
and a static dependency on SQLite there would drag the database into the
capability tests. `resolveViewer()` reaches `resolve.ts` through a dynamic
import — the same shape `getRepo()` uses to pick a backend.

**One account per Discord identity**, with `app_admin` as a flag on it. An
operator may be a guild master; they get that power from their membership and
never from the flag, which is why the two share a row safely.

`capabilities.ts`, `viewer.ts` and `can.ts` are pure over their arguments — no
database, no session, no request. That is why every enforcement site in the app
could get its check before any of them could fail, and it is worth preserving:
the moment a capability decision needs I/O to make, it stops being testable and
starts being guessed at.

**Enforcement is on** (`PROJECTLC_AUTH=on`, since 2026-08-12). A wrong check
now refuses a real person rather than passing silently. `unrestrictedViewer()`
still exists for a deployment that has not switched it on, and reports itself as
unrestricted so it can never be mistaken in an audit log for a grant somebody
made. **It covers reads too.** A write is refused by `requireCapability()` at the
action; a page is refused by `pageView()` in its first two lines, and
`pages.test.ts` fails if a page declares nothing — which is what stops the next
page anybody adds from being open by default. Design and rollout:
[`docs/guild-and-player-profiles.md`](../../../docs/guild-and-player-profiles.md).

## Rules

- **The vocabulary is code; the grants are the guild's.** A capability exists
  because something checks it. Adding one to `CAPABILITIES` without an
  enforcement site puts a checkbox in the grant editor that protects nothing —
  and a guild will make decisions on it.
- **Deny by default, including for strings the code has forgotten.** Grants are
  stored rows; a capability retired in a release leaves them behind.
  `sanitizeCapabilities` drops them on read, and `decide()` denies anything not
  in the vocabulary rather than guessing.
- **A new capability ships denied to everyone but the guild master.** Shipping a
  feature must never quietly open data a guild had closed.
- **Being an app admin grants nothing inside a guild.** Not one capability, not
  even in their own guild — everything they can do in a guild comes from a
  membership. Reaching a guild they are not in takes an open, unexpired,
  correctly-scoped break-glass. If you find yourself adding an `appAdmin`
  shortcut to `decide()`, that is the back door §7 exists to prevent, and since
  the trigger went it is the *only* thing keeping operators out.
- **Break-glass audits itself, and that is why it works.** `decide()` sets
  `audit` only on that path and `requireCapability()` writes the line — so no
  call site has to remember, which is the only reason it happens at all across
  dozens of them. The write is fire-and-forget: losing a log line is bad,
  refusing an already-permitted action because the log was unavailable is worse.
  Opening an override is announced separately, immediately, before it has been
  used for anything — an operator who opens one and does nothing still leaves a
  trace, and the guild reads both.
- **Seeing your own record is not a capability.** `ownsCharacter()` is a fact
  about who plays the character. Never re-express it as a grant; a guild master
  could then switch it off and the reason a raider logs in disappears.
- **A code is single-use and dated in `invites.ts`, not in SQL.**
  `findInviteByCodeHash` answers "is there a row"; whether it may be *used* is a
  separate question, and both halves are re-checked inside the redemption
  transaction so two tabs on one code cannot both win. Any new path that claims
  a character must refuse one somebody already holds — silently reassigning it
  misattributes that raider's whole loot history.
- **Hiding a button is not a permission check.** A `can()` in a component is
  cosmetic. The server action checks again — same rule as input validation,
  where the client preview is a convenience and never a guarantee.
- **Ownership is plural, and never reaches zero.** A guild may have several
  owners; `removeGuildOwner` refuses the last, and `deleteMembership` refuses an
  owner outright. Ownership is not a capability, so a guild that loses its last
  owner cannot appoint another — it is the one unrecoverable state, and every
  guard exists to keep it unreachable.
- **A viewer belongs to one guild.** Pass `{ guildId }` when the subject is
  known; a viewer resolved elsewhere is then denied rather than trusted.

- **Service work is `requireAppAdmin`, not a capability.** Bug-report triage is
  the case that exists: reports are about the *application*, so no guild role
  may reach them. There is deliberately no `app.*` capability to grant — the
  two vocabularies stay apart so the mistake is unavailable, not discouraged.
- **Place the check before the first write, not inside the first `try`.** The
  `try` is usually the right home, because a throw lands in the action's
  existing `catch` and becomes `{ ok: false }`. But two things break that: a
  narrow `try` whose `catch` reports something else (a denial then reads as
  "the saved setup is unreadable"), and an early-return branch that writes
  *before* the `try` — which is a gate that guards one path and not its sibling.
  Both happened in `sim/actions.ts`; both look right in review.

## Testing

`can.test.ts` pins the claims that are load-bearing rather than the plumbing:
an app admin gets nothing, break-glass expires and is scoped, a real grant is
preferred over an override so the audit log stays honest, and auth-off reports
itself as `unrestricted` so nothing can mistake it for a grant somebody made.

`enforcement.test.ts` greps `src/app` for the capability names actually passed
to a check. It fails when a write capability has no enforcement site, and when a
site names a capability the vocabulary doesn't have — the two ways a permission
becomes decorative without anything going red.
