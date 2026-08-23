# projectLC

Loot Council tracker for **World of Warcraft: The Burning Crusade** — a
character-based view of who has what, who wants what, who got what, and how they
actually perform.

## The problem it solves

A TBC loot council decides in about ninety seconds, at 22:40, with a boss corpse
on the floor. The information that should drive that call is scattered: wishlists
in SixtyUpgrades, awards in a Gargul export, performance in Warcraft Logs, and
"didn't they pass on something last week?" in somebody's memory.

projectLC joins those three sources against one roster, so the council can answer
**"who should get this, and can we defend it?"** from one screen — and so the
answer is still explainable a month later.

### The three sources

| Source | What it contributes |
|---|---|
| **SixtyUpgrades** | Gear sets — each raider's current gear and a wishlist per phase. Also the *only* dictionary that names the enchant ids logs carry. |
| **Gargul** | The loot ledger — who won what, when, off-spec or not. |
| **Warcraft Logs** | Performance and preparation — parses, deaths, consumables, cooldowns, buff uptime, and the gear actually worn on each pull. |

Everything else — contention, fairness, wishlist completion, loot priority — is
**derived** from those three at read time, never stored as a second source of
truth to reconcile.

## Run it

```bash
npm install
npm run dev    # http://localhost:3000
npm test
```

Data lives in a local SQLite database at `data/projectlc.db` (override with
`PROJECTLC_DB`). A fresh database is seeded with fictional demo content so the UI
isn't empty — delete the file to reset, or use the **Remove demo data** banner on
the roster once real imports are in. `DATA_BACKEND=seed` gives a read-only
in-memory demo with no database at all.

For Warcraft Logs, create a free API client at
[warcraftlogs.com/api/clients](https://www.warcraftlogs.com/api/clients) (any
name, no redirect URL) and put the pair in `.env.local`:

```
WCL_CLIENT_ID=…
WCL_CLIENT_SECRET=…
```

One report import costs ~7 API calls; the free tier allows thousands per hour.

### Accounts and sign-in

People sign in with Discord. Create an application at
[discord.com/developers](https://discord.com/developers/applications), add
`http://localhost:3000/api/auth/discord/callback` as a redirect, and add:

```
DISCORD_CLIENT_ID=…
DISCORD_CLIENT_SECRET=…
DISCORD_REDIRECT_URI=http://localhost:3000/api/auth/discord/callback

PROJECTLC_AUTH=on
```

`PROJECTLC_AUTH` is what makes permissions real. **Leave it off until Discord
works and you have claimed the deployment** — switching it on with no way to
sign in locks everybody out of an app that is working exactly as designed. With
it off, every check passes, which is how this app behaved before it had
accounts.

Then start the server and read the console: it prints a **claim code** once. Take
it to `/claim` and you become the first guild master. Everybody after you gets in
by invitation, issued on `/roster/members`.

---

# The pages

## Getting in — `/claim`, `/signin`, `/join`

Three doors, and only these three are open to somebody with no account.

**`/claim`** runs once. Whoever holds the claim code printed on the server
console becomes the first guild master, and the page closes itself the moment
anybody holds an account — leaving the form up would invite people to try codes
against it.

**`/signin`** is the only other way in: Discord, `identify` scope, and the token
is thrown away once it has answered who you are. There is no password to lose.
Whether you also operate the service is a flag on your account, not a second
account and not a mode you pick here.

**`/join`** redeems an invitation. Invitations are the only way into a guild
after the claim — there is no request-to-join and no open registration, because
an invite is issued *against a character already on the roster*, which is what
makes "who is this person" answerable at the moment they arrive.

Every other page needs a session. A signed-out visitor is sent here; a signed-in
member without the capability gets a plain refusal rather than a 404, because
pretending a page does not exist is a worse answer than saying no.

## Guild `/`

Two different pages behind one address, chosen by who is asking.

**A member** gets the guild's standing: roster size, awards this phase, average
wishlist completion, recent raids, the most contested items, and loot
distribution. It also holds the guild's **settings** — the loot-priority
weighting the council scores contenders with, loot policy, the guild's own name
and realm, the active phase, how long owners may be quiet before the guild can
appoint its own, and what it publishes.

**Everybody else** gets the public profile, which is composed separately rather
than filtered — it is never handed the ledger, standing, attendance or a council
note, so there is no rule to get wrong. It starts on **Private**: name, realm
and faction and nothing else, because a deployment that upgrades into this must
not publish a roster by surprise.

## Members `/roster/members`

Who is in this guild as a *person*, as opposed to `/roster`, which is who is in
it as a *character*. Officers invite somebody against a character already on the
roster, hand out the guild's roles, link a raider to the characters they play,
and remove people. Invite codes are shown once and stored only as a hash — an
officer who loses one issues another, which supersedes it.

The two are separate on purpose. A raider is one person with several characters;
permissions hang off the person, and loot weight hangs off the character.

## Roles `/guild/roles`

What this guild's roles *mean*. `Member`, `Raider` and `Officer` ship as a
starting point and can be renamed, recoloured, regranted or deleted — they are
the guild's, not the app's. Handing somebody an existing role is a smaller act
and lives on the members screen.

Note that whoever can edit roles can grant themselves anything, which the editor
says out loud rather than burying.

## Audit `/guild/audit`

Everything that changed who is in this guild and what they may do — who joined,
who let them in, who changed what a role means, who owns the guild, and anyone
who reached in from outside. **Every member can read it**, not just officers:
the entries it exists hardest to surface are the ones the people being
administered most need.

Not loot decisions — those are on the ledger, where they are defensible. What
the **Ledger** tab records is the ledger being *changed* afterwards: an award
re-dated, edited or removed, and by whom. Re-dating one is its own permission
(**Amend loot history**), because every recency and fairness number reads that
date.

## Public preview `/guild/preview`

What each publishing level would show, side by side, before choosing one.
Answering "what does an outsider actually see?" by reading the code is not a
question a guild master should have to ask twice.

## Roster `/roster`

Three lists in one place: the **guild roster** (class/spec/role, wishlist
completion, attendance, items won), **known puggers**, and **names seen in logs
that match nobody**. Checkbox bulk actions move people between the lists, track
log names, or delete outright.

Characters have a status — `main` / `alt` / `inactive` / `pug`. Puggers get full
profiles and history but stay out of roster KPIs and loot-fairness stats. An alt
can be linked to its main, and both directions link through.

Deleting never destroys history: awards reopen in the ledger under the raw Gargul
name and log pulls return to the untracked list.

## Character profile `/characters/[name]`

**The centrepiece.** Gear per slot, wishlist tabs per phase (awarded / equipped /
open), the stat difference between what they wear and what they want, loot
history, and an officer comment log.

Each open wishlist slot also carries **alternatives** — what the raider will take
if their BiS doesn't drop, in their own order. The wishlist itself stays a whole
imported set (that's what SixtyUpgrades exports and what the stat diff needs);
these sit beside it, ranked from the first fallback. Order comes from position,
so two items can never both claim second place and removing one closes the gap.

They do two things on the loot side. A fallback **puts the raider on the item's
board** — without it, a second choice dropping never reaches the council at all
— badged with where it sits on their list. And "already served this slot" now
reads what actually served it: their own pick costs full, a ranked fallback
costs whatever the council says, and **a drop they never listed costs nothing**
— being handed something nobody asked for shouldn't weaken their claim on the
item they did ask for. A raider with no list on record is counted in full
instead, because a missing wishlist shouldn't buy a discount.

Loot can be **awarded by hand** from any open wishlist row or from the ledger —
no Gargul paste needed — and a hand-entered award is an ordinary award in every
downstream calculation.

### Two answers to "what are they wearing?"

A TBC raider has no single gear set: resist pieces come out for one boss, a
threat trinket for another, a shield for one phase of the night. So the gear card
has a **source picker** rather than one paper-doll:

- **SixtyUpgrades** — the imported set. What they *built*. Drives stat
  comparisons and wishlist equipped-status, and is only as fresh as their last
  export.
- **Logged** — what they actually wore, per slot, over the last few raids. Every
  item seen in that slot, most recent first, with the pulls it covers. Anything
  after the first is badged **swap** — that's the resist set, the threat trinket,
  the one-boss shield.

Each item's Wowhead tooltip carries the enchant and gems it was worn with, read
from the most recent pull wearing it, so hovering shows the piece exactly as it
was equipped.

## Character edit `/characters/[name]/edit`

Character details, off-spec, main/alt link, and the imported sets (update via
re-import, delete stale ones). Current gear and off-spec gear are pinned per slot
here when the imported set is wrong or missing.

## Standing `/roster/standing`

*"Hvem bør vi erstatte?"* — the roster ranked against itself, weakest first.

Every figure is a **placing inside this guild**, not a score against a target.
"95% is good" is a judgement the app has no standing to make; "third from bottom
of twenty-seven on preparation" is a fact about the guild, and it's the sentence
an officer can defend in a conversation nobody enjoys having. It also keeps
working as the guild improves: when everyone gets better, the bar moves with
them.

Three columns — attendance, median parse, preparation — weighted on the guild
page. **Loot owed is deliberately absent**: being owed loot is not a demerit.

**Two boards.** Mains are placed against mains; alts and inactive raiders get
their own. Pooling them lets somebody's occasional alt sit at the bottom of the
data and lift every regular above them, so the guild reads healthier than it is
— and an alt isn't a seat to reconsider anyway. Pugs are in neither.

**50 is the middle of the group, not a pass mark.** Nobody scores 100 by being
good, only by being first, so a low number means "behind the others here" and
never "bad" — the bottom quarter of a strong roster may be playing perfectly
well. Each placing carries the quarter it falls in, which is arithmetic rather
than a standard.

Two things it refuses to do. A raider with no figure for a column has it
**dropped from their average** rather than counted as zero, because an import
gap is not a verdict. And a raider below the council's raid minimum is **listed
but not placed** — and doesn't set the scale for anyone else either, so a
handful of alts and trials can't flatter the whole roster from underneath.

A **Trend** column carries the same parse delta as the development view: where
somebody is and where they are heading are different questions, and folding one
into the other would lose both. Shown, never scored.

Above the table, each column's own shape: median, range, and how many raiders
have a figure. A column where everyone sits within a few points is separating
nobody, and the spread says so rather than the app quietly deciding for you.

## Performance `/characters/[name]/performance`

The Warcraft Logs dashboard for one raider, per report and as a career rollup.
Expand any boss row for that pull's detail.

- **Parses** — DPS (HPS for healers) percentile, plus the **ilvl-bracket**
  percentile. High parse + low bracket reads "carried by gear"; the reverse reads
  "outplaying their gear". A **boss-damage** percentile separates real
  contribution from cleave padding.
- **Development** — the same raider night by night, with the recent nights'
  parse and preparation measured against everything earlier. Every other number
  on the page is a career rollup, which can't answer *which way is this going* —
  and a raider at the bottom who is climbing needs the opposite conversation
  from one who is sliding. The window is the council's "recent" setting, capped
  at half their nights so a comparison always has two sides.
- **Preparation** — flask/elixirs/scrolls, food, weapon buff, and
  potions/drums/runes used. A flask and a battle+guardian pair are both a full
  set; **half a set** (one elixir, one empty slot) is marked as such rather than
  reading like a flask. A pre-pull potion counts as a potion — it was bought and
  drunk — without counting as a virtue.
- **Class toolkit** — major cooldowns with the moment each was pressed, shaman
  totem drops, and the uptime of the debuffs/buffs their spec is supposed to
  maintain.
- **Gear audit** — every worn item with ilvl, quality, **named and graded
  enchants**, and gems, with unenchanted slots and sub-par gems flagged.
- **Attendance** — a per-reset check (one dot per raid week the guild logged),
  with excused absences an officer can mark.

The sim comparison used to be a tab here; it lives at [`/sim`](#sim-sim) now,
because a wowsims setup describes a spec rather than a person. The header keeps a
**Sim** button that opens it with this raider already chosen.

## Raid logs `/logs`

One raid night at a time, or **All raids** ranked, in three tabs.

**Which pulls count** is a switch, not a setting: click a pull in the header to
leave it out and everything recomputes without it. A joke pull or a two-man farm
boss stops skewing the night in one click, and the exclusion survives a re-fetch.

- **Where the pulls break down** — per boss, hardest first: the median moment
  of the first death, deaths across the pull in tenths of its own length, and
  who dies here most. A count says the raid loses people; **when** says whether
  it's an opener nobody survives or attrition late on, and those need opposite
  fixes. The app never names a cause — it doesn't fetch what killed anybody, and
  reading that off a clock would be an invention.
- **Overview** — preparation coverage (with the full-set / half-set split),
  uptime **by boss** (bands across the pull,
  gaps are exactly the downtime) and **by player** (who actually *had* Battle
  Shout or Innervate, and who put it on them), totem drops, cooldown and potion
  usage, and a worst-first improvements list.
- **Rankings** — the whole raid as parse boards, one table per role, a column per
  boss kill, switchable between all-damage and boss-only.
- **Groups** — which groups *this* night was run in, seeded with everyone the
  log caught on a pull, and saved against this raid alone. Warcraft Logs records
  no group assignments, so it's the officer's record rather than an import — but
  the log gives some of it away, and **Suggest from log** offers what it gives.
  Same board as [`/raid-planner`](#raid-planner-raid-planner), editing the same
  record.
- **Gold spent** — the night priced, with editable per-raid consumable prices and
  **manual adjustments**: add or remove uses the log got wrong, each logged with
  a reason and undoable, flowing through to every other gold figure.

## Raid planner `/raid-planner`

Eight groups of five, a bench, and what each arrangement actually buys. TBC pays
for grouping — shouts, totems, Bloodlust and a shadow priest's mana all stop at
the party line — so who stands where is a decision, and this is the page that
shows it changing as you drag.

Two tabs. **Rosters & raids** is about people and opens first; **Template** is
about classes. Which board is open lives in `?board=` — `template`,
`roster:<id>`, or a raid's report code.

### Rosters & raids

Your own raiders, in two forms.

**Rosters** are named boards built from the guild roster — mains and alts. Make
as many as you run: a main team, a split's second group, next Wednesday. Each is
renamed in place and owns its own arrangement.

The bench splits into **Mains**, **Alts** and **Trials**, because those are three
different questions, and each section is **grouped by class** — a raid is read as
"how many shamans have we got", so the shamans sit together. It is the order the
pool is built in, so the bench and **Fill in order** can never disagree.

On a roster you can also add **trials** — a name, optionally a class, spec and
role, for somebody who isn't on the roster yet. They seat and buff like anyone
else, so you can see whether a second resto shaman actually fixes group four
before recruiting one, and they're drawn with a dashed border so a board held
together by people who don't exist can't read as solved. They live on the board
that invented them and **never become characters**: a trial who has never raided
must not turn up in attendance or loot priority.

**Raid nights** are the other half: who really stood where, pooled from the log
with the spec each of them played, saved against that raid alone.

### Template

Designs the *shape*: classes and specs, as many of each as the raid needs, saved
once for the guild. It is deliberately not built from named raiders — a plan
pinned to people goes stale the moment somebody can't come, and "two shadow
priests with the casters" is the decision actually being made. Any slot can be
renamed, so "Feral" can be filed as "OT Bear".

**Share plan** puts the whole board in a link — groups, their names, every
slot's label, and the bench. Whoever opens it sees exactly what you sent and
nothing of theirs is touched: a shared board doesn't save until they press
**Save as our plan**.

### Both

Every board moves people identically, and on every one you can **name a group**
and **add** one. Each group header carries two controls that are deliberately
different: the **trash** left of the count *empties* it — everyone in it goes to
the bench, the group and its name stay — and the **✕** on the right *deletes*
the group outright. What differs between boards is where slots come from: the
template invents archetypes, a roster invents trials, and a raid night invents
nothing at all, because a twenty-sixth raider on a night that fielded
twenty-five would make the record a fiction.

Click someone on the bench and they take the first free slot; arrows order them
inside a group and carry on into the next one at the edges. Drop a raider **onto
another raider** and the group makes room: with a free slot they slide in above
and everyone below moves down one; with the group full the two **swap**, because
the only way into a full group is for somebody to come out. The board says which
it will be before you let go.

A raider with more than one spec has a **spec icon you can click** — count the
shadow priest as Holy and watch what the group loses.

Every buff reads in one of three states, and the third one is the point:
*covered*, *missing*, or **unconfirmed** — either the right class is standing
there with nothing confirming the talent, or it's one they have to choose
between. One shaman is one totem per element, not eight.

Where the log can settle it, it does. A buff the log caught someone providing
counts as brought, whatever the roster says — which is how a jewelcrafting neck,
which no class predicts, gets counted at all.

**Everything saves itself.** The board writes as you arrange it, so closing the
tab or reopening the project brings back exactly what you left. **Every board
owns its own record** — pick a raid and you're editing that raid's, the same one
the Groups tab on `/logs` shows; pick a roster and you're editing that roster's.
Switching never carries an arrangement across, because one night's record
overwriting another's is exactly the history this app exists to keep. The
template keeps a board of its own and also mirrors into the URL, so a plan is a
link as well.

**Undo** steps back through the changes you've made, one at a time, and the
undone board saves itself like any other — so "saved" never means "final".
Renaming a group undoes as one edit rather than letter by letter. It reaches
back to how the board opened, and no further: a reload starts a fresh session.

Deleting a roster is the one thing Undo can't take back, since the board it
lived on goes with it. It's allowed — a plan for a raid that hasn't happened
isn't history — behind a confirm.

## Fight graph `/fight-graph`

Pick a (player, raid, pull) — or two — and overlay DPS, cooldown and consumable
usage, boss health and buff windows on one time axis. Graph data is fetched live
per view, so this is the one page that talks to Warcraft Logs while you're
looking at it.

## Sim `/sim`

What perfect play would have produced on a pull that actually happened — the
raider's own gear, talents and kill time, run through
[wowsims](https://github.com/wowsims/tbc-new).

Entered by **class and spec**, not by raider: a wowsims export describes a spec's
rotation, buffs and consumables, and almost nothing about the person, since
everything personal comes from the pull. So one setup is pasted per spec, and any
raider who played it can be run against it — pick the spec, then the raider, the
boss and the night.

- **The pre-run check** states what the shared setup assumes against what the log
  recorded for that pull — class, spec, build, race, professions — and flags the
  disagreements without blocking the run. "What would he have done as Fury" is a
  question worth being able to ask.
- **The context audit comes before the DPS numbers**, deliberately: a gap
  explained by a raid buff nobody brought is not a rotation problem.
- **What the logs say** ranks the differences by the damage behind them, and
  **Rotation** breaks down casts, damage, a timeline and an action-by-action
  event log for both sides.

Specs are read off the pulls themselves — boss kills only, since a wipe has no
number worth comparing. Where Warcraft Logs left a kill unlabelled, the build
recovers the spec using the naming the logs supplied on pulls they did label; the
app never maps a talent tree to a spec name on its own, and it says so when a
build has been logged under more than one name. Needs `wowsimcli` on disk
(`WOWSIMCLI_PATH`); setups can be pasted without it, but nothing runs.

## Compare `/compare`

Two to four characters side-by-side on the contribution that drives a council
decision: median output, parses, attendance, consumable coverage, the buffs and
debuffs they keep up, and each one's comment log. Leader highlighted per metric.
A per-column log picker scopes the log-derived numbers to chosen nights, so you
can compare everyone on the same raid or each player at their best. The selection
lives in the URL — comparisons are shareable.

## Loot ledger `/loot`

Every award with its wishlist-match status, filterable by character, class,
phase, session, off-spec and winner status. A **Decided on** column shows the
rank and score the award was made at, with the whole arithmetic on hover; the
item's own page prints it in full under the award it explains. Fully editable: add a missing drop,
fix an item or winner, delete awards, or delete a whole import.

Awards whose winner didn't match the roster show amber. Each can be **assigned to
a character** (typo, rename, late add) or **marked off-roster** (disenchanted,
banked, PUG) — both reversible, and the raw Gargul name is always kept.

## Priority sheet `/loot/priority`

The council's written spec priority, as a document rather than one item at a
time — which is the only way to read most of it, since a sheet lists everything
a boss can drop and the tracker has only heard of the items somebody wishlisted
or won.

One phase at a time, with the phase in `?phase=`. Rows are drawn as rungs
because the `>` between tiers is the whole meaning of the notation, and a tier
the app can't evaluate ("Set completion") is drawn amber to say nobody is ranked
into it. An officer's per-item edit shows over the sheet's own wording, and
edits for items the sheet never listed get their own section — they're in force
either way, so leaving them out would make the page a lie.

**A phase's sheet is pasted here**, stored as the markdown itself so replacing
next phase's is a paste and the source of every rule stays one glance away. The
preview states what the text parses to before anything is stored. Saving
replaces that phase outright; per-item edits survive it, because those are keyed
by item name and layered on whatever sheet is in force. Deleting a pasted sheet
reverts the phase to the one the app shipped with.

An item is looked up in the active phase's sheet first and then in every other
phase's, newest first — a P3 boss still drops P3 loot while the guild farms it
later, and its chain is still the chain.

## Loot plan `/loot/plan`

*"Kan man lage en loot plan for alle items før raid?"* — the night's drops with
who they should go to, boss by boss, in the order the raid will meet them.

Three answers per item, and the third is the one that saves time on the night:

- **contested** — open contenders, best first. Read the top two names.
- **served** — everyone who lists it already has it. Expect a pass.
- **nobody lists it** — decide the offspec/disenchant rule now, not at 22:40.

Nothing is re-scored: the order is contention's own, so the plan and the item
page can never disagree. The zone is in the URL, so a plan is a link you can
paste into Discord.

**It's built from the item cache**, which knows only what has been imported — a
thin plan means a thin cache rather than a generous boss, and it fills in as
loot and logs arrive.

## Items `/items` and `/items/[itemId]`

The "something just dropped" lookup: every known item with wishlist demand, open
contention and drop history. An item's own page shows who has it wishlisted (open
demand first), who already won it, and the spec priority chain the council
applies to it.

It also carries **notes** — a raider's about their own claim ("2nd choice for
me, I'd rather hold for the T5 gloves"), an officer's about the council's
("agreed she gets the next one"). None of it is scored, on purpose: whether a
second choice should stand aside for a BiS wisher depends on the raider's other
options and what those block, which is judgement rather than arithmetic. The
board ranks; the notes hold the part it can't.

## Class guides `/guides`

What the guild expects from each class and spec, in the officers' own words.
One page per class; a shared section that applies to every spec of it, then one
per spec. Editable in the app, because a standard the council argues about
doesn't belong in a file only a developer can reach.

A guide is a **summary with its sources linked**, never a copy of someone
else's page. Pasted guides rot silently; a few lines an officer wrote get
corrected the moment they stop being true, and the source stays one click away.
This is the same house rule the rest of the app follows — name what a source
says, and stay silent otherwise — which is why the app ships no guides at all.

Saving an empty summary clears that guide: "nobody has written it yet" and "we
looked and had nothing to say" are different claims, and only the first one is
true of a blank.

## Service `/service`

Running the deployment, as opposed to running a guild — and the split is the
point. Importing logs and sheets is *guild* work and lives on the guild's own
import page; what is left here is the tenancy, the shared item cache, and the
reports people file about the app itself.

Each card carries the one number that decides whether you need to open it, so a
glance is enough to know there is nothing to do.

**An operator is not a member of the guilds on their deployment.** Nothing here
reads a guild's judgements, and no role inside a guild can reach these pages.

## Tenancy `/service/tenancy`

The accounts on this deployment, and the levers for when one goes wrong:
disabling an account ends its access to the service, and revoking its sessions
signs it out everywhere at once. It shows *how many* guilds somebody belongs to
and never which — an operator administers the tenancy, and what somebody holds
inside a guild is that guild's business.

Also where an operator reaches into a guild they are not in: a **break-glass**
override, which needs a written reason, expires by itself, and is announced in
that guild's audit log when it opens and again for every capability it is used
for. An override the guild cannot see would be a back door.

## Import `/guild/import`

Commit SixtyUpgrades sets, Gargul pastes and Warcraft Logs reports, with preview
and validation. Also **backfills item names, icons and enchant names** for
anything still showing as a bare id, and **maps tier tokens to the pieces they
buy** — until that has been run, a token win satisfies nobody's wishlist,
because a wishlist names `Cataclysm Helm` and the boss drops `Helm of the
Vanquished Champion`.

---

# How it thinks

These are the decisions that shape everything else. They change rarely — when one
does change, it's worth a conversation.

- **A wishlist is a whole gear set**, exactly like a SixtyUpgrades export. Stat
  comparison is a pure diff of two computed stat blocks; the app never computes
  WoW stats itself.
- **Loot ↔ wishlist matching is derived at read time**, never persisted — so
  importing wishlists *after* the loot they satisfy still matches.
- **Awards belong to a phase by raid zone**, not by date. Farming Karazhan in P2
  stays P1 loot.
- **Rings and trinkets compare as multisets**, never by slot index.
- **Characters are never really deleted** — set them inactive. Past loot
  decisions have to stay explainable.
- **Hand-entered loot is ordinary loot.** No parallel "manually marked" state to
  reconcile.
- **A decision is frozen at the moment it's made.** Awarding from the contention
  board stores the score, the rank, the factor arithmetic and the weighting in
  force, so "why was he ranked first in June" still answers in June's terms
  after the council has retuned. Everything *else* reads current policy — only a
  decision that was actually made gets frozen. An award that didn't come from
  the board (a Gargul import, a hand-added drop) carries no snapshot, and that
  absence means "not from the ranking", never "scored zero".
- **The item cache stores partial knowledge.** Every field but the id is
  optional, and an import only ever *fills a gap* — so a Gargul name, a log's
  icon and a Wowhead lookup compose instead of overwriting each other. Partial
  knowledge beats a fabricated "Item #30048".
- **Enchant names come from the guild's own lists, never from a guess.** Warcraft
  Logs reports a permanent enchant as a bare id, and nothing public names those.
  The guild's SixtyUpgrades imports do — each set is both a *dictionary* (id →
  name, valid for every raider's logs) and a *standard* (what that character
  should have). An enchant no imported set has ever named stays an id; the app
  won't call an enchant "mediocre" without a stat model it doesn't have.
- **Re-import is the update flow.** Importing over an existing set writes nothing
  until you confirm, showing exactly which slots change first.
- **A failed cache refresh can never fail a write.** A completed award is never
  reported as failed — that would invite a retry, and the retry would duplicate
  it.
- **Everything from logs is derived at import time.** Pages never call Warcraft
  Logs (the fight graph aside). This is why new tracking needs a re-import.

### Building a set by hand

The **By hand** tab writes a wishlist or a current-gear set without a
SixtyUpgrades export. The loot rules read a raider's lists from *every* phase,
so a phase nobody has exported is a hole in what the council can see — and
before this, testing that a P4 list behaved meant going and building one on
SixtyUpgrades first. **Start from** copies an existing list so you change the
few slots that differ rather than typing seventeen item ids. Saved with
`source: "manual"`, so it stays obvious that a person typed it.

## Feedback `/service/feedback`

**Report a bug** and **Feedback** sit in the bottom-right corner of every page —
one for what's broken, one for what would be better. Same workflow either way,
and the kind is switchable mid-report, because people open "bug" and realise
halfway through that they're describing a wish.

Someone writes what happened and optionally points at the element involved: the
picker highlights whatever's under the cursor and captures a readable name and a
CSS path. The click is swallowed, so pointing at "Delete" deletes nothing.

Page details are **off until switched on**, and the switch is the only thing
that turns them on. Whatever would be sent — page, element, window size, theme,
browser — is printed in the panel above the Send button, rendered from the same
object that gets stored, so the list can't drift from the payload. A first-time
reporter sends prose only; that's deliberate.

Reports land on this page, open ones first. Resolve is reversible, delete isn't,
and nothing is ever edited — a report has to still mean what it said a month
later.

### Handing a report over

**Copy** on any report, or **Copy N open** at the top, puts it on the clipboard
as markdown: the reporter's words verbatim, the route and the App Router file it
likely came from, the element and its selector, and the environment. It is meant
to be pasted straight to a developer or a coding agent with nothing else
attached.

## Known limits

- **Enchant coverage tracks imported lists.** An enchantment id nobody's set
  names stays an id. Importing more lists is the only lever, and it's guild-wide.
- **Totem uptime doesn't exist in TBC logs** — only drops do. The app shows drops
  rather than inventing coverage.
- **Empty gem sockets are invisible.** The log carries the gems, never the socket
  count.
- **New tracking needs a re-import.** Gem icons, item quality, cast timing,
  off-pull consumables and any newly tracked consumable are all captured at
  import time. Older reports keep working, but show less until re-fetched.
- **Some spell ids are genuinely ambiguous** — 28499 is both Super Mana Potion
  and Auchenai Mana Potion, and no log can separate them.
- **One deployment holds one guild.** The permission model is guild-scoped
  throughout and one account can hold a membership in several, but the routing
  and the shared item cache still assume a single guild. See
  [`docs/backlog.md`](docs/backlog.md).

> **On the seed data:** the demo roster, gear sets and awards are fictional. Item
> IDs and names are best-effort real TBC entries so Wowhead tooltips work; expect
> a few inaccuracies. They exist to exercise the UI and get replaced by your real
> imports.

## Stack

Next.js (App Router) · TypeScript · Tailwind v4 · shadcn-style components · zod ·
TanStack Table · SQLite through Node's built-in `node:sqlite` (no native
modules). Item icons and tooltips come from Wowhead, with a graceful fallback
when blocked.

## Working on the code

Start with **[`AGENTS.md`](AGENTS.md)**, then
**[`docs/change-chains.md`](docs/change-chains.md)** — most bugs here are edits
that look complete but silently do nothing, because a second place had to change
too. Each major directory under `src/` has its own `AGENTS.md`, and
[`docs/class-tracking/`](docs/class-tracking/) covers what we measure per class
and what we deliberately don't.

> **Keeping this file honest:** the README describes *what the product does and
> why*, in the officer's vocabulary. It deliberately carries **no file paths,
> function names or implementation detail** — that's what `AGENTS.md` and `docs/`
> are for, and it's the part that rots silently. If you're tempted to document a
> mechanism here, it probably belongs in `docs/change-chains.md`.

## License

See [License.md](License.md) — all rights reserved.
