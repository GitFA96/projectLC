# Backlog

Work that is understood but not started, and the reasons it is not. Nothing
here is a promise — it is a record of decisions already made, so the next person
does not re-derive them or start something that is blocked.

For work in progress and the identity layer's own sequence, see
[`guild-and-player-profiles.md`](guild-and-player-profiles.md) §9.

---

## Multi-guild — one deployment, many guilds

**Blocked, deliberately.** The design has assumed this from the start and the
seams are in: `memberships` is UNIQUE on `(guild_id, account_id)` so one account
can belong to several guilds, `resolveViewer(guildId)` resolves a viewer against
**one named guild** rather than whichever membership turns up first, and every
capability decision is guild-scoped. None of that is speculative — it was built
that way because the alternative silently hands somebody their officer powers in
a guild they are only visiting.

What is missing is routing and one real data problem.

### The blocker: the item cache is service-wide — half resolved

`items` has no `guild_id`. One row per item id, shared by the whole deployment,
while the imports that fill it run per guild.

That is **right** for TBC — an item is an item, and Wowhead's answer does not
differ by who asked — and it is invisible while there is one guild. With two it
cuts both ways: the second guild inherits the first's Wowhead resolutions, which
is a genuine gift, and also its **curations**, which are the guild's own
judgement. A wrong curation by guild A silently becomes guild B's data.

**The which-boss-drops-what half is done.** `boss_drops` holds the shared table
and `guild_boss_drops` holds each guild's `add`/`hide` delta over it — option 2
below, applied to the curation that hurt most. See
[`shared-and-guild-data.md`](shared-and-guild-data.md).

**What is left is `phase` and `redeems_from`**, still service-wide on `items`
with no per-guild answer. Both are curations, both can be wrong, and a wrong one
still crosses guilds.

Three ways out, in rough order of preference:

1. **Split the fields.** Wowhead's answer (name, quality, icon, slot) stays
   service-wide because it has one correct value; the curated fields become
   per-guild. Matches what `src/lib/data/AGENTS.md` already says about who owns
   which field, and is the only option where nothing is lost.
2. **Per-guild override rows** over a shared base. Same effect, more joins —
   and now the pattern the drop table already uses, which argues for it.
3. **Accept it** and say so out loud in the import UI. Cheapest, and defensible
   for a deployment whose guilds trust each other — but it has to be a stated
   decision rather than a thing nobody noticed.

Whichever, it is a schema change with a migration and a migration test, and it
should land **before** a second guild exists rather than after.

### The routing

`/g/[guild]/...` for everything guild-scoped, with the guild slug feeding
`resolveViewer(guildId)`. The seam is already there — `resolve.ts` takes the
parameter and falls back to "the only guild" precisely so this change is a
plumbing job rather than an audit.

Also needed:

- **A guild switcher** for accounts in more than one. This is the thing that
  behaves like a tenant switch; a *character* switcher is not, and should not be
  built — permissions never come from which character you play, and making
  "active character" into session state re-opens the trap the design closed.
- **`meta` keys get a guild prefix.** Noted in §9 and still not done. Per-report
  settings, priority sheets and policy all live in `meta` under unprefixed keys.
- **Per-guild Warcraft Logs credentials.** `hasWclCredentials()` reads process
  env; a hosted deployment needs a token per guild, encrypted.
- **`/service` grows a guilds list.** It shows one today because there is one.

---

## Pet gold is reported, not charged

The gold tab's pet card puts what the log recorded beside what keeping the same
pet consumables up all night would cost, and stops there — the ranking, the
career page and the season page all still charge the logged half only.

Folding the estimate in is a §5 change: all three pricing sites in one edit, or
the same hunter's night reads two ways. It is deliberately not started, because
**which end of the range a guild bills is policy, not modelling** — it would
belong in `analysis/policy.ts` and on the guild page (§4b), defaulting to
today's behaviour so adopting it changes no number until an officer says so.
What would actually settle it is asking the hunters what a night costs them; the
card exists to make that conversation possible.

## Foundational knowledge cannot leave a deployment

`boss_drops` is curated by hand and there is no export, import or version of it
— the service actions seed it from what this deployment already knows, add a
row, or remove one. All local. A second deployment starts from nothing and
re-curates the same table.

That matters whichever way the hosting goes: one deployment serving many guilds
needs it so a self-hoster can receive the operator's curation, and a container
per guild needs it so the same table is not curated N times. **So it is not
blocked on the hosting decision** — it is the same work either way, which is the
reason to build it before that argument is settled rather than after.

Shape already decided: content diff rather than a version counter. You can tell
you are behind by comparing rows, and the diff is what an officer has to see
before adopting anyway. A version or hash is a cheap "is there anything new"
pre-check, not the mechanism. **Adoption is explicit** — a baseline that changed
a verdict without anyone deciding is the hazard the whole layering exists to
avoid.

## Nothing records which game state a judgement describes

A guide saying to skip a phase cannot be re-derived and cannot be refuted by
anything in the database. Only the author can say what they were describing, and
today nothing asks them. As tuning moves, those documents become confident lies
about six months ago.

**Probed 30 Aug 2026 against live reports — Warcraft Logs carries no game
build.** `masterData.gameVersion` was 3 and `logVersion` 17 on every report
across three weeks; `revision` tracks `segments`, so it is the report's own
upload revision. Do not add a `game_build` column: there is no source for it.

**`Zone.partitions` is the real stamp.** It is WCL's own era concept, per zone,
and `default: true` marks the current one — so "the era moved" is a sourced
signal rather than our guess. The Tier-N zones carry explicit `(Skips)`
partitions, which is parse culture as data. Two traps: zone identity is itself
versioned (two different ids both named `SSC / TK`, with different partition
sets), so the stamp is the pair `(zone_id, partition_id)` and never a partition
alone; and there is no global "current phase" — zones default to different
partitions at the same moment.

**The limit:** partitions are named by content phase, so a mid-phase tuning
hotfix creates no new partition. They are coarser than "every Blizzard edit".
A free-text note from the author covers the rest — unverifiable by design, and
provenance rather than something to compute on.

Prerequisite: `wcl_reports.zone` stores the zone *name*, not its id, and
`fetch-report.ts` already queries both `zone` and `masterData`, so capturing the
id is adding fields to a call that is already made.

## Attribution on shared rows is free text

`boss_drops.author` and `guild_boss_drops.author` are `TEXT`, commented "there
is no auth" — which was true when they were written and is not now.

It is cosmetic while a row never leaves the deployment that made it. It stops
being cosmetic the moment foundational rows are published, because nothing
external can verify a judgement: attribution is the only gate there is, and a
typed string is not one. Belongs with the game-state stamp above — "who says
this, describing what, as of when" is one record, and doing it as three separate
retrofits after the rows have been distributed is the expensive version.

## CSP allows inline script, and only a nonce fixes it

`next.config.ts` serves a Content-Security-Policy in production, and its
`script-src` carries `'unsafe-inline'`. Next injects its own inline bootstrap
scripts — the RSC flight payload — whose content differs per page, so neither a
hash list nor any static header can enumerate them. The real fix is a
per-request nonce generated in `middleware.ts`, which this app deliberately does
not have.

**Not urgent, and the reason is worth keeping.** The whole app contains exactly
one `dangerouslySetInnerHTML`, and it is our own static theme script in
`layout.tsx`. Every piece of text a person writes — character and item comments,
boss comments, guides, feedback — reaches the page through React, which escapes
it. So the directive that `'unsafe-inline'` weakens is guarding against an
injection route that does not currently exist.

It stops being true the moment anything renders user-supplied markup — a
rich-text guide editor is the obvious way it happens. **That change and the
nonce are one piece of work**, not two, and doing the markup half alone is how
this becomes a real hole.

Adding middleware has its own cost worth weighing first: it puts an Edge-runtime
layer in front of every request in an app that currently has none.

## Smaller things, already decided

- **Handing a guild over is two steps, on purpose.** `transferGuildOwnership`
  was deleted rather than wired. It argued that one call stops somebody
  abandoning the job half done — but `removeGuildOwner` refuses the last owner,
  so the half that would hurt (stepping down before anyone else owns it) is
  already unreachable, and the other half leaves a guild with two owners, which
  is a valid state. Promote on `/roster/members`, then step down. If a guild
  ever asks for one click, this is the reasoning to overturn.
- **`listBreakGlass` was deleted too.** `/guild/audit` narrates overrides
  through the audit entries, interleaved with everything else that happened to
  the guild, which is the surface that matters; a separate list of the same rows
  had no reader.
- **The guild page keeps its settings; there is no `/guild/settings`.**
  Considered when the settings half reached six cards. They are
  `CollapsibleCard`s gated on the capability each one's action needs, so a
  raider sees none of them and an officer sees collapsed strips — and the loot
  weights sit directly under the loot-distribution chart that shows what they
  did, which a separate page would break. Revisit if a card ever needs to be
  open by default.
- **`Officer` holds `members.manage`, and not `roles.manage`.** Settled rather
  than open: the 30-day succession tier was empty, which is not what the name
  leads anybody to expect. `roles.manage` stayed out because it is
  guild-master-equivalent — an officer holding it can grant themselves
  ownership-equivalent power. **This changes `STARTER_ROLES`, so it applies to
  deployments claimed from now on**; a guild that already exists changes its own
  roles on `/guild/roles`.
