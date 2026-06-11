# projectLC

Loot Council tracker for **World of Warcraft: The Burning Crusade**. A character-based view of who has what, who wants what per phase, and who got what — combining **SixtyUpgrades** gear sets (current gear + phase wishlists) with **Gargul** loot exports.

## What's in the app

| Page | Purpose |
| --- | --- |
| `/` Dashboard | Guild KPIs, recent raids, most contested wishlist items, loot distribution bars |
| `/roster` | All characters: class/spec/role, per-phase wishlist completion, items won, add raiders |
| `/characters/[name]` | **The centerpiece** — current gear paper-doll, P1–P5 wishlist tabs with awarded/equipped/open status, "upcoming stats" (current vs wishlist stat diff), loot history |
| `/characters/[name]/edit` | Edit character details; manage imported sets (update via re-import, delete stale ones) |
| `/loot` | Loot ledger: every award with wishlist-match status; filter by character, class, phase, session, off-spec |
| `/items/[itemId]` | Item contention: who has it wishlisted (open demand first), who already won it |
| `/admin/import` | Commit SixtyUpgrades JSON sets and Gargul award pastes, with preview and validation |

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
- **M2 (this)** — SQLite persistence, commit-enabled SixtyUpgrades/Gargul imports, character editing, wishlist update flow with change confirmation ✓
- **M3** — LC decision support: contention ranking, fairness upgrades, manual winner resolution, item-cache backfill; **TODO: validate the Gargul parser against a real export** (+ column mapping if needed)
- **M4** — Warcraft Logs integration: performance, enchant/gem/consumable audits per raid

## License

See [License.md](License.md) — all rights reserved.
