# projectLC

Loot Council tracker for **World of Warcraft: The Burning Crusade**. A character-based view of who has what, who wants what per phase, who got what — and how they perform — combining **SixtyUpgrades** gear sets (current gear + phase wishlists), **Gargul** loot exports and **Warcraft Logs** reports.

## What's in the app

| Page | Purpose |
| --- | --- |
| `/` Dashboard | Guild KPIs, recent raids, most contested wishlist items, loot distribution bars |
| `/roster` | Guild roster (class/spec/role, wishlist completion, **log attendance**, items won) plus **known puggers** and **untracked log names** — checkbox bulk actions move/track/delete across the lists; remove-demo-data action |
| `/characters/[name]` | **The centerpiece** — current gear paper-doll, P1–P5 wishlist tabs with awarded/equipped/open status, "upcoming stats" (current vs wishlist stat diff), loot history |
| `/characters/[name]/edit` | Edit character details; manage imported sets (update via re-import, delete stale ones) |
| `/characters/[name]/performance` | **Warcraft Logs dashboard** — per-pull parses (with ilvl-bracket percentile), deaths, consumables at/in every pull, class cooldowns + debuff/shout upkeep (expand any boss row), enchant audit, per-report + career rollups |
| `/loot` | Loot ledger: every award with wishlist-match status; filter by character, class, phase, session, off-spec, winner status; resolve unmatched winners inline |
| `/items` | Item index: every known item with wishlist demand, open contention and drop history — the "something just dropped" lookup |
| `/items/[itemId]` | Item contention: who has it wishlisted (open demand first), who already won it |
| `/admin/import` | Commit SixtyUpgrades JSON sets, Gargul award pastes and Warcraft Logs reports, with preview and validation |

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS v4 · shadcn-style components · zod · TanStack Table · SQLite via Node's built-in `node:sqlite` (no native modules). Item icons from the Wowhead CDN, hover tooltips via the Wowhead widget (graceful fallback when blocked).

## Run it

```bash
npm install
npm run dev    # http://localhost:3000
npm test       # parser + repository tests (vitest)
```

## How data flows (Milestone 2)

Data lives in a local SQLite database at `data/projectlc.db` (override with `PROJECTLC_DB`). A fresh database is **seeded from the demo data** in `src/data/seed/` — delete the file to reset. Set `DATA_BACKEND=seed` for a read-only in-memory demo without a database.

Imports are committed through server actions: the paste is parsed and validated server-side against the same zod schemas (`src/lib/import/schemas.ts`) that gate everything entering the database. The parsers live in `src/lib/import/` and are shared by the client-side preview, the server-side commit, and the test suite.

### Updating a wishlist / current gear

Gear sets are **one per character for current gear, one per character+phase for wishlists** (enforced by the database). Re-importing is the update flow:

1. Every set on a character profile has an **Update** link that opens the import page prefilled.
2. Paste the newer SixtyUpgrades export and commit — if a set already exists, nothing is written yet; you get a **confirmation showing exactly which slots change** (rings/trinkets compared as pairs, not positions).
3. Confirm to replace. Loot history is never touched by set updates or deletions; wishlist matching is re-derived live.

### Gargul commits

Each paste becomes one raid session. Winners are matched to roster characters by name (realm suffixes stripped); unmatched winners are kept by name and flagged. **Already-recorded awards are skipped** (same item + winner + timestamp), so re-pasting an overlapping export is safe — if everything is a duplicate, no session is created. Item links in the paste teach the item cache new items (name + quality from the link color).

### Resolving winners

Awards whose winner didn't auto-match the roster show up amber in the ledger (and as a dashboard banner). Each one can be **assigned to a roster character** (typo, rename, late roster add — wishlist matching re-derives instantly) or **marked off-roster** (disenchanted, banked, PUG), which settles it without inventing a character. Both are reversible; `rawWinnerName` always keeps exactly what Gargul said.

### Warcraft Logs (performance)

One-time setup: create a free API client at [warcraftlogs.com/api/clients](https://www.warcraftlogs.com/api/clients) (any name, no redirect URL) and put the pair in `.env.local`:

```
WCL_CLIENT_ID=…
WCL_CLIENT_SECRET=…
```

Then paste a report URL on the import page's **Warcraft Logs** tab (optionally linking it to the night's Gargul session). One import costs ~7 API calls (the free tier allows thousands/hour) and records, per raider per boss pull:

- **parse percentile** (DPS; HPS for healers; tanks in their bracket) plus the **ilvl-bracket percentile** — high parse + low bracket reads "carried by gear", the reverse reads "outplaying their gear"
- **deaths**, bucketed per pull
- **preparation**: flask/elixirs/scrolls, Well Fed and weapon buff at the pull (from combatant info), pre-pots, and potions/drums/runes/healthstones/mana gems/seeds used in-fight (from cast events)
- **class toolkit**: major cooldown casts (Death Wish, Combustion, Innervate, Bloodlust…) and the **uptime of maintained debuffs/buffs** — warlock curse assignments, Thunder Clap, Demoralizing Shout, shouts, judgements, Faerie Fire, Earth Shield. Uptime is computed per player on their best enemy target (≈ the boss) and matched by aura *name*, so every spell rank counts
- **gear snapshot + enchant audit**: every worn item (Wowhead-linked, with ilvl, permanent enchant and socketed gems) from the latest pull, expected slots flagged when unenchanted, the weapon's temp buff called out, and a Phase-2 enchant reference list right next to it. Socket counts aren't in the log, so empty sockets are invisible — compare gems against the item tooltip
- **spec as played**: the spec from rankings shows on the report ("played as Destruction"), per pull when someone respecs mid-night, and the roster flags characters whose logged spec disagrees with their roster entry

Players are matched to tracked characters by name, exactly like Gargul winners; re-fetching a report replaces it wholesale. Everything lands on `/characters/[name]/performance` (linked from the profile), per report and as a career rollup — each boss row expands into the pull's items used, cooldowns and upkeep.

The import result includes a **consumable-tuning dump**: every aura at a boss pull the tables didn't recognize (known class buffs pre-filtered), copy-pastable for curation when a consumable goes untracked.

### Guild roster vs known puggers

Characters have a status: `main` / `alt` / `inactive` (the guild roster) or **`pug`** — a known off-roster player (PUG, friend's alt). Pugs get full profiles, loot history and performance pages, but stay **out of roster KPIs and loot-fairness stats**. Moving someone between the lists is just a status change (edit page, or the one-click buttons on `/roster`).

Names seen in imported logs that match nobody appear on the roster page under **“Seen in logs, not tracked”** with class/spec prefilled from the log — track them as puggers (or add to the roster) and their already-imported log history attaches instantly: log↔character matching is re-derived at read time, no re-fetch needed.

All three lists support **checkbox bulk actions** (select-all included): move roster members to puggers or inactive, promote puggers back, track many log names at once — or **delete characters outright**. Deleting never destroys history: awards reopen in the ledger under the raw Gargul name and log pulls return to the untracked list.

Imported reports also drive **attendance**, led by a **per-reset check** (EU reset, Wednesday): one dot per raid week the guild logged — filled if the character raided that week, hollow if not. Weeks where the guild didn't log don't exist, and weeks before a character's first appearance don't count against them. The classic raids-attended % and pull coverage (late joins/early leaves) stay in the tooltip and as secondary numbers. Shows as a roster column (with a one-click jump to each character's performance page), on profile headers, and on the performance page.

### Removing the demo data

A fresh database is seeded with fictional demo content so the UI isn't empty. Once real imports are in, the roster page shows a **“Remove demo data”** banner: it deletes the demo characters, their sessions/awards/gear sets and the seed log report, keeps the item cache (real TBC entries) and everything you imported, and unlinks (never deletes) real rows that pointed at demo ones.

### Model decisions

- A **wishlist is a whole gear set** (`kind: "wishlist"` + phase), exactly like a SixtyUpgrades export. Stat comparison is a pure diff of the two sets' computed stat blocks — the app never computes WoW stats itself.
- **Loot ↔ wishlist matching is derived at read time** (never persisted), so importing wishlists after the loot they satisfy still matches.
- Awards are attributed to a **phase by raid zone**, not date (farming Kara in P2 stays P1 loot).
- Rings/trinkets compare as **multisets**, never by slot index.
- Characters are **never deleted** (set them inactive) — past loot decisions stay explainable.

> **Note on seed data:** the roster, gear sets and awards are fictional demo data. Item IDs/names/icons are best-effort real TBC entries to make Wowhead tooltips work, but expect a few inaccuracies — they exist to exercise the UI and get replaced by your real imports.

> **Note on export formats:** the SixtyUpgrades parser is **built against a real export** (checked in as a test fixture under `src/lib/import/__fixtures__/`) — `items` array, UPPER_SNAKE slot names, `gameClass`, per-set `phase`, computed stats. The Gargul parser still targets an *assumed* format (**TODO:** validate against a real Gargul export — tolerant column-shape detection and item links should cover most configs until then).

## Roadmap

- **M1** — UI draft on realistic seed data ✓
- **M2** — SQLite persistence, commit-enabled SixtyUpgrades/Gargul imports, character editing, wishlist update flow with change confirmation ✓
- **M3 (in progress)** — LC decision support: manual winner resolution ✓, item demand index ✓, per-phase fairness ✓; fixed: item hover tooltips no longer dismiss after ~1s ✓; **remaining: validate the Gargul parser against a real export** (+ column mapping if needed)
- **M4 (in progress)** — Warcraft Logs integration: API client + report import ✓ (validated against real reports), per-character performance dashboard (parses, deaths, consumables, enchant audit) ✓, class toolkit (cooldown casts + maintained debuff/buff uptime) ✓; **remaining: validate the uptime event fetch against a live report** (the name-based filter degrades to a warning if the API rejects it), raid-wide preparation overview

## License

See [License.md](License.md) — all rights reserved.
