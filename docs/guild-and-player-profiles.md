# Guild and player profiles — identity, permissions and rollout

The design of record for turning projectLC from **one guild's officer tool**
into a service that hosts many guilds, the players inside them, and the
strangers looking in from outside.

**This file is no longer ideation.** It was, until 2026-08-11; the identity
layer described here is now partly built, and where it is, this document
describes what the code does rather than what somebody hoped it would. §9 says
which parts are which. Where a decision has a reason, the reason is written
down — not as history, but because the next person to look at it will otherwise
re-open it.

Status as of 2026-08-11:

| | State |
|---|---|
| Capability model, viewer, `can()` | **built**, enforcing on every guild-data write |
| Enforcement | **on** since 2026-08-12 — writes are refused without the capability |
| Read gating | **built** — every page declares what it needs; a signed-out visitor is sent to sign in |
| Public profile | **built** — `/` serves it to outsiders, Private by default |
| Nav | **built** — shows only what the viewer can reach |
| Succession | **built** — windows on the guild row, a banner, and a claim that adds an owner without removing one |
| Membership & ownership controls | **built** on `/roster/members` — remove a member, promote a co-owner, step down, remove a quiet one |
| Tenancy console | **built** at `/service/tenancy` — disable an account, revoke its sessions, grant the operator flag |
| Permissions preview | **built** at `/guild/preview` — read-only; previews a viewer, never becomes one |
| Guild identity | **built** — name, realm and faction behind `guild.edit`, audited old → new |
| Break-glass | **built** — reasoned, capped at two hours, expires by itself, and every *use* writes into the guild's own log |
| Audit log | **readable** at `/guild/audit`, behind the baseline — until this existed the table was write-only |
| Accounts, sessions, Discord sign-in | **built**, and round-tripped against real Discord |
| Deployment claim | **built**, and used — this deployment is claimed |
| Invites | **built** and used — issue at `/roster/members`, redeem at `/join`. A second person has joined for real |
| Signing in and out from the app | **built** — the account menu in the nav |
| Roles and the grant editor | **built** — `/guild/roles` defines them, `/roster/members` assigns them |
| Read gating | **built** — every `page.tsx` declares what it needs; `pages.test.ts` fails on one that declares nothing, `routes.test.ts` on a `route.ts` with no check |
| The public profile | **built** — `/` serves it to anyone outside the guild, starting on Private; preview the presets at `/guild/preview` |
| The service/guild split | **built** — `/service` runs the deployment, `/guild/import` is guild work |
| Multi-guild routes | not built — blocked on the item cache, see [`backlog.md`](backlog.md) |

---

## 1. Where we are

The domain is single-tenant by construction, not by accident:

- exactly one row in `guild`, read by `repo.getGuild()` — no argument, because
  there is nothing to choose between
- every other table hangs off it, directly (`characters.guild_id`) or through a
  character (gear sets, comments, exemptions, current-gear pins)
- per-report settings live in `meta` under bare keys — no guild prefix, because
  there is no second guild to collide with

The identity layer above it now exists. What that means precisely, because "we
have auth" is the kind of sentence that hides the interesting half:

- **Writes are gated.** Every server action that writes guild data calls
  `requireCapability`. Reads are not — those wait for the viewer-scoped repo
  in §8.
- **The gate is open.** `PROJECTLC_AUTH` is off by default, `resolveViewer()`
  returns an unrestricted viewer, and every check passes. The app behaves
  exactly as it did before any of this existed.
- **Nobody has signed in.** The flow is written and unit-tested; it has never
  completed a round trip against Discord. Until it does, treat sign-in as
  unproven rather than working.

So the sequencing risk is spent but the integration risk is not. Turning
`PROJECTLC_AUTH` on before somebody has signed in successfully would lock the
officers out of their own tool.

---

## 2. Three things that all sound like "role", and are not

Get this apart first. Unpicking it later means touching the scoring model and
the permission model in the same change.

| | What it is | Where it lives | Values |
|---|---|---|---|
| **Roster standing** | how much loot weight someone carries | `characters.status`, scored by `policy.ts` | main, alt, trial, inactive, pug |
| **Guild role** | what someone may see and do | new — guild-defined | Officer, Loot Council, Raider, Social |
| **App role** | who operates the *service* | new — orthogonal to any guild | app admin |

`characters.status` **already exists and is not a permission.** It is an input
to the priority score. A trial can be an officer; a guild master can raid on an
alt; "pug" is a scoring category, not a stranger. Any design that reads a
permission off `status` produces the guild master who cannot edit the guild
because they logged in on their warlock.

Keep the three independent for the same reason `src/lib/analysis` stays pure:
they answer different questions and are changed by different people at
different times for different reasons.

---

## 3. Identity: account, membership, character

Three entities, in a deliberate order:

```
accounts      a login. Global to the deployment. One human, one row.
memberships   account x guild. Carries the guild roles. THIS is the player
              profile — a person as seen from inside one guild.
characters    a toon. Gains membership_id (nullable). Keeps everything else.
```

**The player profile is a membership, not a global `players` table.** The
earlier draft proposed `characters.player_id -> players.id`, which scopes a
person to exactly one guild — and the question that motivates this rewrite,
"what does an outsider see looking at *another* guild", is unanswerable under
it. The same human must be a member here and a stranger there at the same
moment. Account is global; membership is per guild; the pair is the player.

`characters.main_character_id` becomes *derivable* — "the membership's main
character" — rather than the mechanism. It does not get dropped the day
memberships land. It is the only thing that currently groups alts, it works, and
per invariant 6 the way to retire a link is to stop reading it.

**`membership_id` is nullable and stays nullable.** Most characters will never
be claimed: raiders who won't sign up, pugs who came once, and years of history
belonging to people who left. An unclaimed character behaves exactly as it does
today. Invariant 6 again — deleting a membership unlinks its characters and
never touches their awards.

**A guild master with no claimed character still holds every power.** Claiming a
character is about seeing *your own* wishlist, attendance and awards — it is
never an input to a capability check, and there is no code path from a character
to a grant. The deployment claim links no character, so the first guild master
starts with none: their raider profile and their account are simply unconnected
until somebody links them on `/roster/members`. This is the structural reason
the failure in §2 — the guild master locked out because they logged in on their
warlock — is unavailable here rather than merely avoided.

### What a player profile is *for*

Not a second character page. Three things a character page structurally cannot
say:

- **One person, many toons.** Attendance summed because they showed up. Loot
  counted across their characters, because a guild gives loot to *people*.
- **Their own view, without an officer opening it.** A raider seeing their own
  wishlist status, attendance and standing is most of the value of a hosted
  service over a spreadsheet.
- **Self-service.** Paste your own SixtyUpgrades set, mark yourself absent next
  week, flag a spec change. Every one of those is officer work today.

### Answered: loot priority follows the character

**Decided 2026-08-11.** Scoring stays per character. An account links several
characters for *identity and self-service* — one login, one place to see all
your toons — and for nothing else.

That is a real decision with teeth, not a deferral:

- `computeAttendance`, `computeFairness` and the priority score keep their
  current subject and **do not** grow a "by player" mode. The refactor the
  earlier draft anticipated is now explicitly not happening.
- The alt standing multiplier is **a live policy knob, not a placeholder.** It
  is how the council says what an alt's claim is worth, and it keeps that job.
- Two characters belonging to one person have two standings, two attendance
  figures and two loot histories. That is the intended reading: the council
  awards to a character, and the board shows characters.

### Nothing crosses a guild boundary

**Decided 2026-08-11**, and it is the invariant that keeps this simple. A
membership binds an account to *one guild's* data. A character who pugs someone
else's raid contributes nothing to this guild's numbers, and this guild's
numbers travel nowhere.

- No cross-guild aggregation of attendance, loot or performance. Ever.
- A person in two guilds has two memberships that know nothing of each other.
- The per-guild read model in §8 is therefore a clean partition, not a filter —
  which is why it stays fast.

The temptation later will be "wouldn't it be nice to show a recruit's loot
history from their old guild". It would not: that data belongs to the guild that
recorded it, and the moment it leaks across a boundary nobody can explain who is
allowed to see what.

### Joining: invite-only, against a character that already exists

**Decided 2026-08-11.** There is no self-registration. An officer issues an
invite **for a character already on the roster**, and redeeming it does two
things at once: it creates the membership, and it claims that character.

This is the cheap answer and the correct one. It disposes of three problems
without writing any code for them:

- **Proving you are who you say.** An officer already knows who plays
  Thrallmaster. Nothing needs to verify it, and this project has no business
  building identity verification.
- **Abuse handling.** A closed door needs no spam defence.
- **Orphan accounts.** Every account arrives attached to a character, so there
  is no state where somebody has signed up and belongs to nothing.

Claiming further characters is the same act repeated, and stays an officer's to
grant (`members.manage`). A raider cannot claim a toon by asserting it is
theirs — that is the one place where "just trust the user" would let somebody
attach themselves to another raider's loot history.

Two rules fall out of "the same act repeated", and both are load-bearing:

- **An invite redeemed by an existing member reuses that membership.** One
  person with a main and two alts is one membership and three claimed
  characters; a second membership would split their loot history in half.
- **An invite adds roles and never replaces them.** The roles on an invite are
  a choice an officer made, so widening is deliberate — but a routine "here is
  your alt" invite must not be able to quietly demote an officer to whatever
  the invite happened to carry.

An invite also never takes a character that is already claimed. Getting that
wrong misattributes years of wishlists and awards; re-issuing a code costs
nothing, so the invite is the recoverable side of that trade.

---

## 4. Roles: the guild names them, the code names the capabilities

The brief is "self-defining roles". The split that makes that safe:

- **Capabilities are code.** A capability exists because a line of code checks
  it. A guild cannot invent one, because inventing one grants nothing. The
  vocabulary is a fact about what the app does — the same category as what the
  item cache knows about an item.
- **Roles are the guild's.** Name, colour, sort order, and which capabilities
  they hold. All data, all editable by the guild master, none of it a `const`.

The same shape as the loot policy, for the same reason: the app surfaces the
question and ships a default, the guild answers it.

```
guild_roles              (id, guild_id, name, colour, sort, ...)
guild_role_capabilities  (role_id, capability)
membership_roles         (membership_id, role_id)      -- many-to-many
```

Ship *suggested* roles — Officer, Raider, Social — the way `DEFAULT_POLICY`
ships numbers: a starting point a guild is expected to edit, not a constraint.

### Ownership, co-owners and succession

**Built 2026-08-11.** A guild has one *or more* owners. Ownership is still not a
capability — no role grants it — which is what makes losing it the one state a
guild cannot repair by itself. Co-ownership is the primary answer: two or three
owners turn a disappearance from an emergency into a non-event.

Four rules, enforced in code rather than convention:

- **A guild can never reach zero owners.** `removeGuildOwner` refuses the last
  one, and `deleteMembership` refuses an owner outright — demote deliberately
  first. Nothing removes ownership as a side effect of removing a member.
- **Stepping down is always allowed**, if you are not the last. Nobody is
  trapped owning a guild.
- **One owner may remove another only after that other has gone quiet.**
  Otherwise co-ownership is a race to remove the other person first. Two active
  owners who disagree simply cannot remove each other — that is the guild's
  argument to have, and the app admin arbitrates if it has to be settled.
- **Every ownership change is audited into the guild's own log**, in the same
  transaction that makes it.

Handing over is `addGuildOwner` then `removeGuildOwner`, in that order and
deliberately not in one transaction: each primitive opens its own, and adding
first means an interruption leaves *two* owners — a valid state somebody can
finish — rather than none.

### When every owner goes quiet

`successionState()` is pure and answers "where does this guild stand". The
escalation is **cumulative**: once a tier opens it stays open, and a later tier
only widens the pool.

| Tier | Who | Default |
|---|---|---|
| — | another owner who is still around | keeps the guild healthy; nothing happens |
| 1 | holds `roles.manage` or `members.manage` | 30 days |
| 2 | any member | 60 days |

Tier 1 is defined by **capability, not role name**, because roles are
guild-defined and "officer" is not a concept the code has. Cumulative tiers are
what covers a guild with owners and plain members but nobody in between: the
first tier is simply empty, nothing happens at 30 days, and the second opens at
60. No special case.

Three details that are load-bearing:

- **Quietness is measured from the *most recent* owner**, not the oldest. One
  active owner keeps the whole guild healthy — that is what co-ownership is for.
- **A warning appears at two thirds of the first window**, naming the date it
  unlocks. A takeover should never be a surprise.
- **An owner who has never signed in starts the clock now**, not at the
  beginning of time. "Never seen" is a guild that was just set up, not one
  abandoned for eternity.

Windows are guild-tunable but **bounded** (14–180 days) and cannot be switched
off: unbounded configuration would let an owner set ten years and defeat the one
protection that exists to guard a guild *from* its owner. The member tier can
never open before the administrative one.

**`last_seen_at` had to be fixed first.** It was written only at sign-in, so with
a 30-day session an owner using the app daily still looked a month idle — every
window above would have fired on a guild's most active people. It now refreshes
on real use, throttled to an hour.

Still to build: persisting a guild's chosen windows, the warning banner, and the
claim action itself.

### Two roles that cannot be data

- **Guild master is ownership, not a role.** Exactly one per guild, holds every
  capability implicitly, cannot be deleted, cannot have capabilities stripped,
  and is transferable. Were GM an ordinary role, a GM could edit their own row
  badly and lock the guild out with no recovery path short of a database edit.
  Ownership is what guarantees someone can always fix it.
- **`@member` is the implicit baseline** every membership carries. It makes
  "what can a plain raider see" one editable row rather than a role somebody has
  to remember to assign to each new person — and forgetting to assign it is the
  failure where a new raider sees nothing and files a bug.

### Capability vocabulary — sketch, to be settled against real call sites

Named after the question being gated, `resource.verb`:

| Capability | Gates |
|---|---|
| `guild.view` | the guild profile beyond its public face |
| `guild.edit` | name, realm, faction, active phase |
| `policy.edit` | the loot weights and everything else in `guild_policy` |
| `roster.view` | the roster and character profiles |
| `roster.edit` | create, edit, delete characters |
| `loot.view` | the ledger — who got what, and when |
| `loot.award` | recording awards; the loot plan |
| `priority.view` / `priority.edit` | the priority sheet and per-item chains |
| `logs.view` | raid reports, parses, preparation, deaths |
| `raid.plan` | the planner, boards and saved rosters |
| `import.run` | Warcraft Logs, SixtyUpgrades and Gargul import |
| `members.manage` | invites, assigning roles, claiming characters |
| `roles.manage` | creating roles and granting capabilities |

Three rules that keep this honest:

1. **Deny by default.** An unlisted capability is denied. A capability added in
   a later release ships denied to every role except GM — so shipping a feature
   can never silently expose data a guild had chosen to keep closed.
2. **Every capability has at least one enforcement site.** One that gates
   nothing is a lie told by the permissions UI, and a guild will make decisions
   on the strength of it.
3. **`roles.manage` is GM-equivalent, and the UI must say so.** Anyone who can
   grant capabilities can grant themselves all of them. Pretending otherwise in
   the interface is how a guild master hands out "just the role editor" and is
   surprised later.

### Seeing your own record is not a capability

A raider always sees their own wishlist, attendance, awards and standing,
whatever their roles say. That is ownership of your own data, not a grant — as a
grant, a guild master could switch it off by accident and the entire reason a
raider logs in disappears.

"Can I see *other people's* standing" is the genuinely contested one, and it is
a social question: some councils publish the board to build trust, others find
it starts arguments. So it is a guild setting with a conservative default, not a
decision made in code.

---

## 5. Four viewers

1. **Outsider** — no membership in *this* guild. May well be signed in and a
   guild master somewhere else. Sees the public profile, §6.
2. **Member** — the `@member` baseline plus whatever roles they hold, plus
   their own record unconditionally.
3. **Officer** — not a tier. Whatever the guild granted; the word is a label on
   a role, and different guilds will draw it differently.
4. **Guild master** — owner. Everything, always.

Orthogonal to all four: the **app admin**, §7.

---

## 6. The public profile — what a guild shows the world

The part with no existing code to reason from, and the part most likely to leak
if it is built casually.

**The outsider view is a different page, not a filtered member page.** Build it
as the member page with fields blanked and the next field somebody adds is
public until they remember it shouldn't be — nothing fails, nothing turns red,
and the guild finds out from a rival. A separately composed page can only show
what it explicitly names. That is the whole argument, and it is worth the
duplication.

### The line: Warcraft Logs parity

**Decided 2026-08-11.** The public face may show what Warcraft Logs already
publishes about this guild. It may never show the guild's own judgements.

That is a better line than "counts, not names", which was the earlier guess.
A named roster is not a secret — it is on the guild's WCL page, with classes,
specs and every parse, and pretending otherwise protects nothing while making
the public page useless for recruiting. What is *not* anywhere else is the
council's reasoning, and that is the thing worth closing.

Public by default — the WCL-shaped face:

- name, realm, faction, active phase, progression
- the roster **by name**, with class and spec
- raid nights and schedule, if the guild set one
- which raids were logged, and when

Never public, at any preset — the guild's judgements about its own people:

- the loot ledger and who was awarded what
- the priority sheet and per-item priority chains
- roster standing, attendance figures, preparation scores
- officer comments, exemptions, the loot plan, anything with an opinion in it

Guild-configurable, but as a **small set of named presets** — Private,
Recruiting, Open — not fifteen toggles. Fifteen toggles is a configuration
surface no guild will get right, and getting it wrong is silent. The presets
move the first list; they never reach the second.

Visibility settings live in guild settings, **not** in `GuildPolicy`.
`GuildPolicy` is consumed by pure functions in `src/lib/analysis`; putting
visibility there drags authorization into the one layer whose value is that it
has no idea who is asking.

---

## 7. The app admin is not a super guild master

The separation, as a principle: **the app admin runs the service; they do not
run anybody's guild.**

The app admin owns:

- accounts — reset, suspend, delete
- guilds as tenants — create, suspend, delete, quota
- the **shared item cache**, and the ability and enchant name caches. Item
  names, icons and slots are facts about TBC, not about a guild. This is the one
  place multi-tenancy makes things *better*: one Wowhead lookup serves everyone.
- feedback triage
- Warcraft Logs credentials and request budget
- migrations, backups, health

The app admin does **not** get a guild's loot ledger, priority sheet, officer
comments or performance rankings. If they do, "who can see our loot drama" has
no answer — and loot drama is precisely what this application stores.

### One account, and why the separate-admin-account idea was dropped

**Decided 2026-08-11, revised the same day.** One account per Discord identity.
`app_admin` is a flag on it. An app admin may hold memberships and normally
does — the person running the service is usually somebody's guild master.

The first version of this section said the opposite: a separate operator
account holding no memberships, enforced by a database trigger. That was
borrowed from enterprise practice, where a second admin account exists because
your everyday workstation is what gets phished. **It does not transfer here,
and the reason is Discord.** Both accounts sat behind the same login, so the
split bought session-deep separation only — at the cost of a model too awkward
to keep straight, which is its own kind of security failure.

The mistake underneath was collapsing two questions:

1. **May an app admin read a guild's data?** No, not without audited
   break-glass. This is the promise worth keeping.
2. **Must an app admin be a separate account?** No. This is what got
   over-solved.

**The first never depended on the second.** `decide()` grants guild
capabilities from a *membership* and never from the flag, so an operator
already has nothing in a guild they are not a member of, whichever row the flag
sits on. Being guild master of your own guild is a separate power with a
separate source, and you are entitled to it.

What that leaves, stated plainly:

- In **your** guild you have everything, via `isGuildMaster` — not via the flag.
- In **anybody else's** guild you have nothing, and reaching it means opening
  break-glass, which lands in that guild's own audit log.
- The flag's only effect is opening the service console.

**What this gives up.** A stolen session cookie can reach the admin console,
where two accounts would have needed two thefts. The proportionate answer is
re-authentication on the genuinely destructive service actions — deleting a
guild, promoting an operator — not a second identity. Cheaper, stronger where
it matters, and it does not ask anybody to keep a spare Discord account.

### `/admin` was two different things wearing one path

**Split, 2026-08-12.** Importing is guild-scoped officer work — it writes that
guild's reports, wishlists and awards — so it lives at **`/guild/import`**
behind `import.run`, with the rest of a guild's own business. Feedback is
service work, bug reports about the application across everybody, so it lives
at **`/service/feedback`** behind the app-admin flag. `/admin` is gone.

The old draft said "admin becomes a permission, not a path" — half right. It
became a permission *and* two paths, because there were two things.

One thing the split makes visible rather than solves: **`items` has no
`guild_id`.** The cache is service-wide — one row per item id, shared by every
guild — while the imports that fill it run per guild. That is right for TBC (an
item is an item) and invisible with one guild. With two, the second inherits the
first's Wowhead resolutions, which is a gift, and its wrong curations, which is
not. Multi-guild has to answer that; the note lives on `/service` so whoever
gets there next reads it.

**Half of this is already true in the code.** Import is gated on `import.run`
and feedback triage on `requireAppAdmin`, so the two axes are separated at the
action layer even though they still share a URL prefix. Only the move is left.

`submitFeedback` is deliberately the one action in the app with no check at all.
It is the only thing a non-officer can write with, and gating it would close the
channel that tells us the gates are wrong.

---

## 8. Where the check lives

Not in pages: there are too many, they grow, and one missed page is a leak that
looks like a working feature.

Not only in server actions: better, since they are the write surface and already
re-validate their input — but still one check per site, and the sites that get
forgotten are the ones nobody is thinking about.

**At the repo boundary.** `getRepo()` becomes `getRepo(viewer)` and hands back a
repo that can only answer what that viewer may ask. One gate, deny by default,
on the layer every page and action already goes through.

Two honest complications:

- **Reads need field filtering, not just method gating.** `getDashboard()`
  returns loot distribution and contested items in one object; an outsider may
  see neither, a member both. So the scoped repo composes the public answer from
  named fields rather than redacting a private one — the §6 argument again, for
  the same reason.
- **The read model becomes per guild.** `createRepoFromStore` loads everything
  and derives everything, which is fast because it is simple. It gets keyed on
  guild *and* `data_version`. Not before a second guild exists.

And the rule that belongs in `change-chains.md` the day this ships:

> **Hiding a button is not a permission check.** A `can()` helper in the UI is
> cosmetic — it stops a raider clicking something that would fail. The server
> action checks again, every time. Exactly like input validation: the client
> preview is a convenience, never a guarantee.

---

## 9. Getting there without breaking the live database

`data/projectlc.db` holds one real guild's real history. The plan is worthless
if step one locks its officers out.

1. **Auth off by default.** Until an account exists the app behaves exactly as
   today: one guild, everything permitted, no login. Nothing regresses on the
   day this lands.
2. **The first account claims the deployment** — app admin, and guild master of
   the guild already in the database. Avoids seeding credentials nobody knows.
3. **Every character starts unclaimed** and keeps working. Officers link people
   as they sign up; nothing is blocked on adoption.
4. **Additive migrations only**, `addColumn()` in `migrate()`, with a migration
   test — the `CREATE TABLE` block only runs on a fresh database, so a missing
   migration passes every test and breaks only the user's real data.
5. **`meta` keys get a guild prefix.** Cheap now, annoying later, still not done.
6. **Per-guild Warcraft Logs credentials.** `hasWclCredentials()` reads process
   env; hosted needs a token per guild, encrypted.

### Order of work

Sequenced so the risky half stays invisible until it is complete. Steps 1–3 are
built; the reasoning that shaped them lives in §3–§8, not here.

1. **Capability vocabulary, viewer resolution, `can()`.**
   *Built.* Pure code, no schema, no UI: every server action that writes guild
   data carries its check while every check still passes. Wiring it taught two
   things worth keeping — the vocabulary was five capabilities short of what the
   real call sites needed (`logs.edit`, `sim.edit`, `items.curate`,
   `comments.write`, `guides.edit`), and read capabilities were left unenforced
   at this stage because reads belong to the page layer — step 8, since done.

2. **Accounts, sessions, Discord sign-in, the deployment claim.** *Built and
   proven.* PKCE, an opaque state nonce, sessions as revocable rows keyed by the
   hash of the cookie, `resolveViewer()` reading them. Round-tripped against
   real Discord on 2026-08-11: consent, callback, session cookie, claim. What
   the round trip caught that the unit tests could not was the claim writing no
   audit entry, while every other ownership change writes one.

3. **Co-ownership and succession.** *Built.* Several owners per guild, zero
   unreachable, the cumulative 30/60-day ladder, and `last_seen_at` tracking
   real use rather than sign-in. The windows persist on the guild row (clamped
   on read, so a hand-edited value is brought into range rather than trusted),
   the banner appears for **every** member once the clock matters — a takeover
   nobody saw coming is the failure worth designing against — and the claim
   **adds an owner without removing one**. An owner who was in hospital comes
   back to a co-owner and a conversation, not to a guild they no longer own.

   The starter `Officer` holds `members.manage`, which makes it administrative
   for succession — so a guild that never touches its roles has officers as its
   designated successors at 30 days, which is what the word "officer" leads
   people to expect. It deliberately does **not** hold `roles.manage`: that one
   is guild-master-equivalent by construction, because anybody with it can grant
   themselves anything.

   A guild that strips `members.manage` from its officers gets the empty-tier
   case instead — nothing happens at 30 days and the 60-day member tier is what
   rescues the guild. The cumulative ladder was designed for exactly that, and
   it still works; it is just slower.

4. **Invites.** *Built.* An officer
   issues one for a character already on the roster; redeeming creates the
   membership and claims the character in one act. Until an officer can actually
   issue one, the claimer remains the only person who can sign in, which makes
   this the real blocker on step 6, not enforcement.

   What the code holds that the schema does not: single use and expiry are
   decided in `src/lib/auth/invites.ts`, not in SQL — the row finder answers "is
   there a row", which is a different question from "may this be used", and a
   caller that only asked the first would let a year-old redeemed code back in.
   Both are re-checked *inside* the redemption transaction, so two tabs on one
   code cannot both win.

   `/roster/members` is where an officer does this — the roster seen as people
   rather than as characters, which is also where a character gets linked to a
   member without an invitation at all. That second path is not a convenience:
   the deployment claim makes somebody the owner of a guild, which is a
   different fact from *which raider they are*, and nothing else would ever
   connect the two.

   `/join` is the other end. The code travels through the Discord hop in the
   httpOnly state cookie exactly as the claim code does — never in the URL, so
   it stays out of browser history and Discord's request logs. The callback
   checks the invitation *before* the exchange, so a dead code costs a sentence
   rather than a consent screen followed by a refusal, and no account is created
   for a sign-in that was never going to work.

5. **Prove a redeemed invite end-to-end.** Sign-in itself is proven, and the
   invite path is proven against a copy of the real database — issue, redeem,
   replay-refused, all three audited. What is *not* proven is a second real
   Discord account going through `/join`. Cheaper to find broken here than after
   step 6.

6. **Turn enforcement on.** *Done, 2026-08-12.* One flag, after a rehearsal
   against a copy: anonymous refused everything, the owner held everything even
   with every role stripped, the operator flag granted nothing inside the guild,
   and revoked sessions and disabled accounts both resolved to nobody.

   The rehearsal's real finding was about what the flag *isn't*: every page
   still answered 200 to a browser with no session, with real character names in
   it. Enforcement covers **writes**. It does not make a guild's data private,
   and anyone reading the flag's name would assume otherwise.

   Two things have to exist first, and neither is enforcement itself. **A way to
   sign in from the app**: without an account menu the only route to `/signin`
   is typing the URL, so flipping the flag refuses every write with nothing on
   screen offering a way in. *Built.* And **the grant editor below**: with the
   flag on and no editor, a wrong role is unfixable without a database edit.

7. **Guild-defined roles and the grant editor.** *Built.* `STARTER_ROLES` are
   suggestions with no special status — `/guild/roles` renames, recolours,
   regrants and deletes them, and invents new ones. Two things there are
   structural rather than editable: the **baseline** role cannot be deleted,
   because something has to be the floor every membership stands on, and it
   cannot hold a capability that hands out capabilities (`NEVER_BASELINE`),
   because every member holds the baseline and any of them could then grant
   themselves everything.

   That line is drawn at the contradiction and nowhere wider. A guild that puts
   `loot.award` under every member is answering a question about how it runs;
   answering it in code would be the same overreach as shipping loot weights
   nobody can edit (invariant 5). The editor names the consequence and gets out
   of the way.

   Assigning a role is a *different* power from defining one — `members.manage`
   versus `roles.manage` — and they live on different pages for that reason.
   The succession windows are edited on the guild page rather than here — they
   are a guild setting, not a statement about what a role means.

8. **Read gating.** *Built, bar the public face.* Every `page.tsx` declares
   what it needs with one `pageView()` call, and `src/lib/auth/pages.test.ts`
   fails when a page declares nothing — which is the deny-by-default property,
   because the dangerous mistake here is always an omission and an omission is
   invisible unless something enumerates the whole surface.

   **Deliberately not `getRepo(viewer)`.** A repo that filters by viewer is the
   mistake §6 already argues against for pages, moved down a layer: ~200 methods
   each having to remember, where the next one added is open until somebody
   notices. It would also drag authorization into `createRepoFromStore`, which
   the seed backend shares and whose value is having no idea who is asking. One
   declaration per page is 28 decisions instead of 200. What a filtering repo
   would have bought — safety when somebody forgets — the test buys instead.

   Every gated route is now dynamic, because reading a session reads a cookie.
   That is the price and it is worth paying.

   **The public profile is built.** `/` serves two separately composed pages —
   the dashboard to a member, `PublicProfile` to everybody else — and the second
   can only render what `buildPublicProfile` names. Its input type is the
   guarantee: it is never handed an award, a standing, an attendance figure or
   even a `status`, so no filter can be forgotten. Presets are Private (default),
   Recruiting and Open, cumulative, on `guild.visibility`.

   The nav now shows only what the viewer can reach, asking the server the same
   `permits()` the page will — one rule, one place. Hiding a link stays
   presentation; the page refuses on its own.

   Two things §6 lists that the app has no data for, and so does not claim:
   **progression** and a **raid schedule**. Neither exists as a field anywhere.
   When they do, they are additions to `PublicProfileInput`, which is exactly
   the deliberate edit that design is meant to require.

9. **Split `/admin`** into the service console and guild-scoped import. *Done.*

10. **Multi-guild routing** (`/g/[guild]/...`). Last, and only when a second
    guild exists — renaming every route while there is one is churn. The seam is
    already there: `resolveViewer(guildId)` takes the guild it resolves against.

---

## 10. Decisions and what is still open

Settled by the guild master on 2026-08-11, each written up where it belongs:

| Question | Answer | Where |
|---|---|---|
| Loot priority per player or per character? | **Per character.** Accounts link characters for identity, never for scoring. | §3 |
| Self-registration or invite-only? | **Invite-only**, issued against a character already on the roster. | §3 |
| Does a guild see anything from outside itself? | **No.** Nothing crosses a guild boundary. | §3 |
| Does an outsider see character names? | **Yes** — Warcraft Logs parity. Names and parses are public; the council's judgements never are. | §6 |
| Does the app admin get break-glass? | **Yes**, with all four properties, the audit write not optional. | §7 |
| Is the admin a separate login? | **Separate account, shared login system.** An `app_admin` account holds no memberships. | §7 |
| Phase advancement: manual or by date? | Manual — which is what shipped. | — |

Still genuinely open, and none of them block step 1:

- **What does a role template ship as?** Officer, Raider and Social need actual
  default grants. Naming them is easy; deciding what a plain Raider sees is the
  guild's first real policy argument, and worth having *before* the UI exists.
- **Do the visibility presets differ from the WCL line at all?** §6 says the
  presets move the public list and never touch the private one. If Private and
  Recruiting end up the same page, there are two presets, not three.
- **Does break-glass expire in hours or in days?** Short enough that nobody
  leaves it on, long enough to be useful. Needs one number.
- **What happens to a membership when its last character is deleted?** Invariant
  6 says unlink, never destroy — so the membership survives with no characters.
  Whether it should still appear on the roster page is undecided.
