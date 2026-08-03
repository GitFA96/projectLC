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

---

# The pages

## Guild `/`

The guild's identity and standing: roster size, awards this phase, average
wishlist completion, recent raids, the most contested items, and loot
distribution. It also holds **policy** — the loot-priority weighting the council
scores contenders with.

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

## Performance `/characters/[name]/performance`

The Warcraft Logs dashboard for one raider, per report and as a career rollup.
Expand any boss row for that pull's detail.

- **Parses** — DPS (HPS for healers) percentile, plus the **ilvl-bracket**
  percentile. High parse + low bracket reads "carried by gear"; the reverse reads
  "outplaying their gear". A **boss-damage** percentile separates real
  contribution from cleave padding.
- **Preparation** — flask/elixirs/scrolls, food, weapon buff, pre-pots, and
  potions/drums/runes used in-fight.
- **Class toolkit** — major cooldowns with the moment each was pressed, shaman
  totem drops, and the uptime of the debuffs/buffs their spec is supposed to
  maintain.
- **Gear audit** — every worn item with ilvl, quality, **named and graded
  enchants**, and gems, with unenchanted slots and sub-par gems flagged.
- **Attendance** — a per-reset check (one dot per raid week the guild logged),
  with excused absences an officer can mark.

## Raid logs `/logs`

One raid night at a time, or **All raids** ranked, in three tabs.

**Which pulls count** is a switch, not a setting: click a pull in the header to
leave it out and everything recomputes without it. A joke pull or a two-man farm
boss stops skewing the night in one click, and the exclusion survives a re-fetch.

- **Overview** — preparation coverage, uptime **by boss** (bands across the pull,
  gaps are exactly the downtime) and **by player** (who actually *had* Battle
  Shout or Innervate, and who put it on them), totem drops, cooldown and potion
  usage, and a worst-first improvements list.
- **Rankings** — the whole raid as parse boards, one table per role, a column per
  boss kill, switchable between all-damage and boss-only.
- **Gold spent** — the night priced, with editable per-raid consumable prices and
  **manual adjustments**: add or remove uses the log got wrong, each logged with
  a reason and undoable, flowing through to every other gold figure.

## Fight graph `/fight-graph`

Pick a (player, raid, pull) — or two — and overlay DPS, cooldown and consumable
usage, boss health and buff windows on one time axis. Graph data is fetched live
per view, so this is the one page that talks to Warcraft Logs while you're
looking at it.

## Compare `/compare`

Two to four characters side-by-side on the contribution that drives a council
decision: median output, parses, attendance, consumable coverage, the buffs and
debuffs they keep up, and each one's comment log. Leader highlighted per metric.
A per-column log picker scopes the log-derived numbers to chosen nights, so you
can compare everyone on the same raid or each player at their best. The selection
lives in the URL — comparisons are shareable.

## Loot ledger `/loot`

Every award with its wishlist-match status, filterable by character, class,
phase, session, off-spec and winner status. Fully editable: add a missing drop,
fix an item or winner, delete awards, or delete a whole import.

Awards whose winner didn't match the roster show amber. Each can be **assigned to
a character** (typo, rename, late add) or **marked off-roster** (disenchanted,
banked, PUG) — both reversible, and the raw Gargul name is always kept.

## Items `/items` and `/items/[itemId]`

The "something just dropped" lookup: every known item with wishlist demand, open
contention and drop history. An item's own page shows who has it wishlisted (open
demand first), who already won it, and the spec priority chain the council
applies to it.

## Import `/admin/import`

Commit SixtyUpgrades sets, Gargul pastes and Warcraft Logs reports, with preview
and validation. Also **backfills item names, icons and enchant names** for
anything still showing as a bare id.

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
