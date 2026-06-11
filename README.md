# projectLC

Loot Council tracker for **World of Warcraft: The Burning Crusade**. A character-based view of who has what, who wants what per phase, and who got what — combining **SixtyUpgrades** gear sets (current gear + phase wishlists) with **Gargul** loot exports.

## What's in the app

| Page | Purpose |
| --- | --- |
| `/` Dashboard | Guild KPIs, recent raids, most contested wishlist items, loot distribution bars |
| `/roster` | All characters: class/spec/role, per-phase wishlist completion, items won |
| `/characters/[name]` | **The centerpiece** — current gear paper-doll, P1–P5 wishlist tabs with awarded/equipped/open status, "upcoming stats" (current vs wishlist stat diff), loot history |
| `/loot` | Loot ledger: every award with wishlist-match status; filter by character, class, phase, session, off-spec |
| `/items/[itemId]` | Item contention: who has it wishlisted (open demand first), who already won it |
| `/admin/import` | Import previews for SixtyUpgrades JSON sets and Gargul award pastes |

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS v4 · shadcn-style components · zod · TanStack Table. Item icons from the Wowhead CDN, hover tooltips via the Wowhead widget (graceful fallback when blocked).

## Run it

```bash
npm install
npm run dev    # http://localhost:3000
```

## How data flows (Milestone 1)

Everything renders from **seed JSON** in `src/data/seed/`, validated at boot by the zod schemas in `src/lib/import/schemas.ts` — the same schemas the real import parsers (Milestone 2) will emit. Swapping mock → real data is a data-source change behind `src/lib/data/repo.ts`, not a rewrite.

Key model decisions:

- A **wishlist is a whole gear set** (`kind: "wishlist"` + phase), exactly like a SixtyUpgrades export. Stat comparison is a pure diff of the two sets' computed stat blocks — the app never computes WoW stats itself.
- **Loot ↔ wishlist matching is derived at read time** (never persisted), so importing wishlists after the loot they satisfy still matches.
- Awards are attributed to a **phase by raid zone**, not date (farming Kara in P2 stays P1 loot).
- Rings/trinkets compare as **multisets**, never by slot index.

> **Note on seed data:** the roster, gear sets and awards are fictional demo data. Item IDs/names/icons are best-effort real TBC entries to make Wowhead tooltips work, but expect a few inaccuracies — they exist to exercise the UI and get replaced by your real imports.

## Roadmap

- **M1 (this)** — UI draft on realistic seed data
- **M2** — Real SixtyUpgrades/Gargul parsers + SQLite persistence (Drizzle) behind the existing repo interface; commit-enabled imports
- **M3** — LC decision support: contention ranking, fairness analytics, Gargul column mapping, winner resolution
- **M4** — Warcraft Logs integration: performance, enchant/gem/consumable audits per raid

## License

See [License.md](License.md) — all rights reserved.
