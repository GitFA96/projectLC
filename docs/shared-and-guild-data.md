# Shared knowledge and a guild's own

Some of what this app knows is true for everybody and some of it is one
council's opinion. They look alike on a page and they are not the same kind of
claim, so they have different owners, different tables and different rules.

The dividing question, and it is about the data rather than who happens to edit
it: **how the fight works is the same everywhere; what we do about it is not.**
Which items a boss drops is a fact about the game. Who should get one is a
judgement that belongs to the council making it.

## The two layers

**Foundational** is service-wide and has no `guild_id`. `boss_drops` is the
worked example: one row per (zone, boss, item), edited on `/service` behind
`app-admin`, and identical for every guild on the deployment.

**Overlay** is a guild's disagreement with it, and it is a delta rather than a
copy — `guild_boss_drops` carries an `action` of `add` or `hide`. A guild that
thinks the table is wrong does not edit the foundational row; they add or hide
in their own overlay, which changes what they read and nothing that anybody else
reads.

Guides work the same way with a different shape: an operator writes a baseline
that every guild can read as a template, a guild writes its own beside it, and
**neither overwrites the other** because they answer different questions. A page
shows both and says which is which.

## The rule that matters

**Verdict paths read the merged guild view. The bare foundational table is the
operator's editing surface only.** The repo boundary says which is which —
`getFoundationalDropTable` is the shared table as its owner sees it, and the
guild-facing read applies the overlay before anything downstream sees it.

Reading the foundational layer directly to decide something about a named raider
would let one deployment's curation change another council's answer. That is the
same hazard as a `const` that changes a verdict, and the same rule applies: it
belongs to the guild, so the guild's view is what feeds it.

`src/lib/analysis` never reaches for either — it is pure and takes what it needs
as arguments, enforced by `src/lib/docs.test.ts`. The choice of *which* view to
pass is the caller's, and it is always the merged one.

## When you add a new kind of shared knowledge

Decide the layer before writing the table, because retrofitting an overlay after
rows exist is a migration:

- If it has one correct value that no council could reasonably dispute, it is
  foundational and needs no overlay.
- If a guild could look at it and say "not here, not for us", it needs an
  overlay **before a second guild exists**, not after.

What is still unsplit, and why it is blocked, is in
[`backlog.md`](backlog.md) — `items` remains service-wide and two of its curated
fields have no per-guild answer yet.
