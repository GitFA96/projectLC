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

### The blocker: the item cache is service-wide

`items` has no `guild_id`. One row per item id, shared by the whole deployment,
while the imports that fill it run per guild.

That is **right** for TBC — an item is an item, and Wowhead's answer does not
differ by who asked — and it is invisible while there is one guild. With two it
cuts both ways: the second guild inherits the first's Wowhead resolutions, which
is a genuine gift, and also its **curations**, which are the guild's own
judgement about which boss drops what and which phase it belongs to. A wrong
curation by guild A silently becomes guild B's data.

Three ways out, in rough order of preference:

1. **Split the fields.** Wowhead's answer (name, quality, icon, slot) stays
   service-wide because it has one correct value; the curated fields (zone,
   boss, phase, `redeems_from`) become per-guild. Matches what
   `src/lib/data/AGENTS.md` already says about who owns which field, and is the
   only option where nothing is lost.
2. **Per-guild override rows** over a shared base. Same effect, more joins.
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
