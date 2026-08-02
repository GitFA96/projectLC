# Guild and player profiles — ideation

Working notes for turning projectLC from **one guild's officer tool** into a
service that hosts many guilds and the players inside them. Nothing here is
built yet except where marked. This is the shape we're aiming at, and the
reasoning for it, so the next change doesn't accidentally close a door.

Status: written 2026-08-01, at the point where the dashboard was renamed to the
**Guild** page and the loot-policy weighting moved onto it.

---

## 1. Where we are

The app is single-tenant by construction, not by accident:

- exactly one row in `guild`, read by `repo.getGuild()`
- every other table hangs off it, directly (`characters.guild_id`) or through a
  character (gear sets, comments, exemptions, current-gear pins)
- settings live in `meta` under bare keys — `loot_priority_weights`,
  `consumable_prices:<code>`, `excluded_fights:<code>`
- the priority sheet is a seeded markdown file, one phase, one guild
- there is no auth, no session, no user. Officers share a deployment.

That's the right shape for one guild and the wrong shape for twenty. The good
news is that the *domain* is already guild-scoped; what's missing is the
identity layer above it.

## 2. The two profiles

### Guild profile — "who we are and how we judge loot"

Today this is `/` (the page formerly called the dashboard). It already holds:

- **Identity** — name, realm, faction, active phase
- **Standing** — roster size, awards this phase, average wishlist completion,
  last raid, recent raids, most contested items, loot distribution
- **Policy** — the loot-priority weighting (new), with per-item spec priority
  chains edited on each item's own page

What it should grow:

- **Editable identity.** Name/realm/faction/active phase are seeded and
  read-only. Advancing the phase is currently a database edit, which is absurd
  for the thing that scopes half the app's derived numbers.
- **The priority sheet as a first-class object.** Right now it's a `.ts` file
  with one phase's markdown in it. It wants to be: paste a sheet → parse →
  preview what changed → save, per phase. Same flow as the SixtyUpgrades
  import, which already does exactly this shape (parse, diff, confirm).
- **Raid schedule and reset day.** `resetWeekStart()` hardcodes Wednesday (EU).
  A US guild needs Tuesday. That's a guild setting hiding in a constant.
- **Consumable prices.** Currently per-report. A guild-level default with
  per-report overrides is the honest hierarchy.
- **Membership and roles.** Who can edit? Officer vs raider vs read-only is the
  first thing a hosted version needs and the thing the app has least of.

### Player profile — "who I am across characters"

This is the one that genuinely doesn't exist yet. Today `/characters/[name]`
is a **character** profile: one toon, one class, one set of wishlists.

A *player* is the person behind several characters. The app already half-knows
this — `characters.main_character_id` links alts to a main, and the roster
resolves `mainCharacterName` / `altNames`. But the link is
character-to-character, not character-to-person, which breaks in the obvious
place: attendance, loot fairness and priority are all computed per character,
so a raider who brings their alt on farm night looks like two half-attending
raiders instead of one committed one.

What a player profile is for:

- **One identity, many characters.** Attendance summed across their toons,
  because they showed up. Loot counted across their toons, because a guild
  gives loot to *people*.
- **Their own view.** A raider should be able to see their wishlist status,
  attendance and where they sit on contested items without an officer opening
  it for them. That's most of the value of a hosted service over a spreadsheet.
- **Self-service.** Paste your own SixtyUpgrades set, mark yourself absent for
  a week, flag a spec change. Every one of those is currently officer work.

The migration is small in schema and large in semantics:

```
players (id, guild_id, display_name, …)
characters.player_id → players.id      -- replaces main_character_id
```

`main_character_id` becomes derivable ("the player's main character") rather
than the mechanism. Then `computeAttendance`, `computeFairness` and
`onSpecAwardsActivePhase` grow a "by player or by character?" parameter — and
the loot council almost certainly wants *by player*.

**This is the decision to make before building it:** does loot priority follow
the character or the person? Right now it follows the character, and the alt
multiplier (×0.7) is a crude stand-in for the answer. If it should follow the
person, that multiplier goes away and the alt simply inherits the player's
attendance and loot debt — which is both fairer and much easier to explain.

## 3. Routes

Current, and where each lands:

| Now | Then | Note |
|---|---|---|
| `/` | `/g/[guild]` | Guild profile. `/` becomes guild picker or redirect |
| `/roster` | `/g/[guild]/roster` | |
| `/characters/[name]` | `/g/[guild]/c/[name]` | Character profile |
| — | `/g/[guild]/p/[player]` | **New** — player profile |
| `/loot`, `/logs`, `/items`, … | `/g/[guild]/…` | All already guild-scoped |
| `/admin/import` | `/g/[guild]/import` | "admin" becomes a permission, not a path |

Nothing above needs to happen at once. The cheap version is a route group with
the guild resolved from a session, so URLs stay short until multi-guild is real.

## 4. What has to change under the hood

Roughly in the order the pain will arrive:

1. **`getGuild()` becomes `getGuild(id)`.** Every repo read implicitly filters
   by "the one guild"; those filters have to become explicit. The read model
   (`createRepoFromStore`) currently loads the whole database into memory and
   derives everything — fine for one guild, not for fifty. It becomes
   per-guild, cached per guild + data version.

2. **`meta` keys get a guild prefix.** `loot_priority_weights` →
   `guild:<id>:loot_priority_weights`, and likewise for prices and excluded
   fights. Cheap now, annoying later.

3. **The priority sheet moves into the database**, per guild and per phase,
   with the seeded markdown as the first row rather than the only source.

4. **Auth and permissions.** No user table today. Minimum viable: a session, a
   `guild_members` table with a role, and a check in every server action.
   Actions currently trust the caller completely — which is correct for a
   private officer deployment and unacceptable the moment it's hosted.

5. **Per-guild WCL credentials.** `hasWclCredentials()` reads process env.
   A hosted version needs a token per guild, stored encrypted.

6. **The item cache stays global.** Item names, icons and slots are facts about
   TBC, not about a guild — sharing it across tenants is the one place
   multi-tenancy makes things *better*.

## 5. Deliberate non-goals for now

- **Don't build auth yet.** It's the biggest change and the least useful while
  there's one guild; building it early means guessing at the permission model.
- **Don't split the read model yet.** It's fast because it's simple. Splitting
  it before a second guild exists is speculative work.
- **Don't rename routes yet.** Renaming `/` to `/g/[guild]` with one guild is
  churn. Rename when there are two.

The transition-shaped decisions worth making *now* are the ones that are cheap
today and expensive later: naming pages after their subject (done — "Guild",
not "Dashboard"), keeping guild-scoped settings in one place (done — the loot
policy lives on the guild page), and not writing anything new that assumes
there is exactly one guild.

## 6. Open questions

- Loot priority per **player** or per **character**? (see §2 — this shapes the
  scoring model, and the alt multiplier is a placeholder for the answer)
- Is a player global across guilds, or scoped to one? Cross-guild identity
  means a real user account; guild-scoped means a much simpler table.
- Does a raider see other raiders' contention rankings, or only their own
  standing? That's a social question more than a technical one.
- Phase advancement: manual per guild, or by date? Guilds progress at wildly
  different speeds, so manual seems right — but then it needs a UI.
