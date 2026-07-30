# projectLC

Loot Council tracker for **World of Warcraft: The Burning Crusade**. A character-based view of who has what, who wants what per phase, who got what — and how they perform — combining **SixtyUpgrades** gear sets (current gear + phase wishlists), **Gargul** loot exports and **Warcraft Logs** reports.

## What's in the app

| Page | Purpose |
| --- | --- |
| `/` Dashboard | Guild KPIs, recent raids, most contested wishlist items, loot distribution bars |
| `/roster` | Guild roster (class/spec/role, wishlist completion, **log attendance**, items won) plus **known puggers** and **untracked log names** — checkbox bulk actions move/track/delete across the lists; remove-demo-data action |
| `/characters/[name]` | **The centerpiece** — gear summarised per slot from the last raids (or the imported SixtyUpgrades set) via a source picker, P1–P5 wishlist tabs with awarded/equipped/open status, "upcoming stats" (current vs wishlist stat diff), loot history, and an **officer comment log** (categorized, timestamped notes). Loot can be **awarded by hand** from a wishlist row or the ledger — no Gargul paste needed |
| `/characters/[name]/edit` | Edit character details; manage imported sets (update via re-import, delete stale ones) |
| `/characters/[name]/performance` | **Warcraft Logs dashboard** — per-pull parses (with ilvl-bracket percentile), deaths, consumables at/in every pull, class cooldowns + debuff/shout upkeep (expand any boss row), worn gear with **named and graded enchants** and gems, per-report + career rollups |
| `/logs` | **Raid-wide logs dashboard** — one raid night at a time (or **all raids ranked**): which pulls count, preparation coverage, uptime **by boss** and **by player**, shaman **totem drops**, cooldown + potion/in-fight usage, gold spent, and a worst-first **player-improvements** list |
| `/fight-graph` | **Fight graph playground** — pick any (player, raid, pull), or two, and overlay DPS, cooldown/consumable usage, boss health and buff windows on one time axis; graph data is fetched live from WCL per instance |
| `/compare` | **Character comparison** — up to 4 characters side-by-side on the contribution that matters: median output, parses, attendance, consumable coverage, the buffs/debuffs they keep up, and each one's comment log. Leader highlighted per metric; **per-column log picker** scopes the log-derived metrics to chosen raid nights; shareable via the URL |
| `/loot` | Loot ledger: every award with wishlist-match status; filter by character, class, phase, session, off-spec, winner status; resolve unmatched winners inline; **add / edit / delete awards and delete whole imports** |
| `/items` | Item index: every known item with wishlist demand, open contention and drop history — the "something just dropped" lookup |
| `/items/[itemId]` | Item contention: who has it wishlisted (open demand first), who already won it |
| `/admin/import` | Commit SixtyUpgrades JSON sets, Gargul award pastes and Warcraft Logs reports, with preview and validation; **backfill item names & icons** for anything still showing as a bare id |

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS v4 · shadcn-style components · zod · TanStack Table · SQLite via Node's built-in `node:sqlite` (no native modules). Item icons from the Wowhead CDN and hover tooltips via the Wowhead widget (graceful fallback when blocked); item names/qualities are resolved once per id from Wowhead's item XML and cached locally. The only other network call is the Warcraft Logs API at import time — pages never fetch while rendering.

## Run it

```bash
npm install
npm run dev    # http://localhost:3000
npm test       # parsers, repository, log analysis, server actions (vitest)
```

## How data flows

Data lives in a local SQLite database at `data/projectlc.db` (override with `PROJECTLC_DB`). A fresh database is **seeded from the demo data** in `src/data/seed/` — delete the file to reset. Set `DATA_BACKEND=seed` for a read-only in-memory demo without a database.

Imports are committed through server actions: the paste is parsed and validated server-side against the same zod schemas (`src/lib/import/schemas.ts`) that gate everything entering the database. The parsers live in `src/lib/import/` and are shared by the client-side preview, the server-side commit, and the test suite.

### Updating a wishlist / current gear

Gear sets are **one per character for current gear, one per character+phase for wishlists** (enforced by the database). Re-importing is the update flow:

1. Every set on a character profile has an **Update** link that opens the import page prefilled.
2. Paste the newer SixtyUpgrades export and commit — if a set already exists, nothing is written yet; you get a **confirmation showing exactly which slots change** (rings/trinkets compared as pairs, not positions).
3. Confirm to replace. Loot history is never touched by set updates or deletions; wishlist matching is re-derived live.

### Two answers to "what are they wearing?"

A TBC raider has no single gear set: resist pieces come out for one boss, a threat trinket for another, a shield for one phase of the night. So the profile's gear card has a **source picker** rather than one paper-doll:

- **Sourced: SixtyUpgrades** — the imported `current` set. What they *built*: it drives the stat comparisons and wishlist equipped-status, and it's only as fresh as the last export.
- **Logged — last 3 raids** (`LOGGED_RAIDS` on the profile page), plus each of those nights on its own. Slot and item, nothing else: every item seen in that slot, most recently worn first, with the pulls it covers (`8/11 pulls`, bosses on hover). Anything after the first is badged **swap** — that's the resist set, the threat trinket, the one-boss shield.

Each item's **Wowhead tooltip carries the enchant and gems it was worn with** (`item=…&ench=…&gems=…`), read from the most recent pull wearing it, so hovering shows the piece exactly as it was equipped — a re-enchant or regem included — without a column per detail. The per-slot fold lives in `src/lib/analysis/logged-gear.ts` and is pure; the page only resolves names and icons against the item cache.

The full audit view — ilvl, **graded enchants**, named gems per slot — is the gear table on `/characters/[name]/performance`, shared as `src/components/gear-table.tsx`. The selected source lives in `?gear=`, so only one view renders server-side and the link is shareable.

### Gargul commits

Each paste becomes one raid session. Gargul's **standard CSV export** — the one that leads with a `dateTime,character,itemID,offspec,id` header — is pasted as-is: the header is detected and each column read by name, so the trailing award `id` is ignored and the winner/item never swap. A header-less custom format (`@DATE;@TIME;@ID;@ITEM;@WINNER;@OS`, semicolon/comma/tab) works too, and item links (`@LINK`) teach the item cache new items (name + quality from the link color). Winners are matched to roster characters by name (realm suffixes stripped); unmatched winners are kept by name and flagged. **Already-recorded awards are skipped** (same item + winner + timestamp), so re-pasting an overlapping export is safe — if everything is a duplicate, no session is created.

### Editing the ledger

The loot ledger is fully editable, no re-import needed. **Edit** any award to fix the item, the winner (assign a roster character, type a custom/pug name, or mark off-roster), the off-spec flag or a council note — wishlist matching re-derives live. **Add** a missing drop straight into a session, **delete** awards one at a time or by checkbox selection, or **delete a whole import** (the session and all its awards; a Warcraft Logs report linked to that night is kept, just unlinked). Item ids resolve their name and quality from the cache automatically.

### Resolving winners

Awards whose winner didn't auto-match the roster show up amber in the ledger (and as a dashboard banner). Each one can be **assigned to a roster character** (typo, rename, late roster add — wishlist matching re-derives instantly) or **marked off-roster** (disenchanted, banked, PUG), which settles it without inventing a character. Both are reversible; `rawWinnerName` always keeps exactly what Gargul said.

### Warcraft Logs (performance)

One-time setup: create a free API client at [warcraftlogs.com/api/clients](https://www.warcraftlogs.com/api/clients) (any name, no redirect URL) and put the pair in `.env.local`:

```
WCL_CLIENT_ID=…
WCL_CLIENT_SECRET=…
```

Then paste a report URL on the import page's **Warcraft Logs** tab (optionally linking it to the night's Gargul session). One import costs ~7 API calls (the free tier allows thousands/hour) and records, per raider per boss pull:

- **parse percentile** (DPS; HPS for healers; tanks in their bracket) plus the **ilvl-bracket percentile** — high parse + low bracket reads "carried by gear", the reverse reads "outplaying their gear" — and a **boss-damage percentile** ranked on damage to the boss alone, which is what separates real contribution from cleave padding
- **deaths**, bucketed per pull
- **preparation**: flask/elixirs/scrolls, Well Fed and weapon buff at the pull (from combatant info), pre-pots, and potions/drums/runes/healthstones/mana gems/seeds used in-fight (from cast events)
- **class toolkit**: major cooldown casts (Death Wish, Combustion, Innervate, Bloodlust…) **with the moment each was pressed**, shaman totem drops, and the **uptime of maintained debuffs/buffs** — warlock curse assignments, Thunder Clap, Demoralizing Shout, shouts, judgements, Faerie Fire, Earth Shield, Innervate. Debuff uptime is computed per player on their best enemy target (≈ the boss); raid buffs are also tracked from the receiving end (who *had* it). Everything is matched by aura *name*, so every spell rank counts, and totem-sourced buffs are credited to the shaman who dropped the totem
- **gear snapshot with named, graded enchants**: every worn item (Wowhead-linked, with ilvl, quality, permanent enchant and socketed gems by name and icon) from the latest pull, expected slots flagged when unenchanted, and the weapon's temp buff on its own line. Socket counts aren't in the log, so empty sockets are invisible — compare gems against the item tooltip
- **spec as played**: the spec from rankings shows on the report ("played as Destruction"), per pull when someone respecs mid-night, and the roster flags characters whose logged spec disagrees with their roster entry

Players are matched to tracked characters by name, exactly like Gargul winners; re-fetching a report replaces it wholesale. Everything lands on `/characters/[name]/performance` (linked from the profile), per report and as a career rollup — each boss row expands into the pull's items used, cooldowns and upkeep.

#### Naming and grading enchants

Warcraft Logs reports a permanent enchant as a bare `SpellItemEnchantment` id (2661, 3003…), and **nothing public names those**: Wowhead has no page, no tooltip endpoint and no XML for an enchantment id, and the WCL API doesn't carry the name either (its gear entries are `id, quality, icon, itemLevel, permanentEnchant, gems`).

The guild's own **SixtyUpgrades imports do**. Every set lists, per slot, the enchant it wants as `{ id, itemId, name }` — with `id` in exactly the id space the logs use. So each imported set is two things at once:

1. a **dictionary** — id → name, valid for *every* raider's logs, not just the one whose set it came from (plus the glyph/inscription/kit item, which supplies the enchant's icon);
2. a **standard** — what that character is supposed to have in that slot.

The gear panel therefore names what it can and judges it against a real reference: **BiS** when it matches the raider's own list, otherwise what their class's other lists picked (labelled `(their list)` or `(2/3 class lists)`), **list wants X** when it differs, **missing** when the slot is bare. An enchant no imported set has ever named stays an id — the app doesn't guess that an enchant is good or bad, and won't call one "mediocre" without a stat model it doesn't have. Coverage grows with every list imported; hovering the item shows Wowhead's tooltip rendered *with* that enchant and those gems applied, which is where an unnamed one can be read off.

The import result includes a **consumable-tuning dump**: every aura at a boss pull the tables didn't recognize (known class buffs pre-filtered), copy-pastable for curation when a consumable goes untracked.

### Guild roster vs known puggers

Characters have a status: `main` / `alt` / `inactive` (the guild roster) or **`pug`** — a known off-roster player (PUG, friend's alt). Pugs get full profiles, loot history and performance pages, but stay **out of roster KPIs and loot-fairness stats**. Moving someone between the lists is just a status change (edit page, or the one-click buttons on `/roster`).

An **alt can be linked to its main**: pick the main on the edit page (the picker appears when status is `alt`). The roster and profile then show “alt of \<Main\>”, and the main's profile lists its known alts — both directions link through. The link survives status changes, so moving an alt to inactive and back keeps it.

Names seen in imported logs that match nobody appear on the roster page under **“Seen in logs, not tracked”** with class/spec prefilled from the log — track them as puggers (or add to the roster) and their already-imported log history attaches instantly: log↔character matching is re-derived at read time, no re-fetch needed.

All three lists support **checkbox bulk actions** (select-all included): move roster members to puggers or inactive, promote puggers back, track many log names at once — or **delete characters outright**. Deleting never destroys history: awards reopen in the ledger under the raw Gargul name and log pulls return to the untracked list.

Imported reports also drive **attendance**, led by a **per-reset check** (EU reset, Wednesday): one dot per raid week the guild logged — filled if the character raided that week, hollow if not. Weeks where the guild didn't log don't exist, and weeks before a character's first appearance don't count against them. The classic raids-attended % and pull coverage (late joins/early leaves) stay in the tooltip and as secondary numbers. Shows as a roster column (with a one-click jump to each character's performance page), on profile headers, and on the performance page.

**Excused absences:** an officer can mark any reset week as excused for a character (the “Attendance by reset” card on the performance page). An excused week stops counting toward that character's markup — both the weekly check and the raids %, so a pre-cleared week off never reads as absence — but stays visible as a distinct dashed dot so the gap isn't hidden. Toggle it back to count again anytime.

### Raid logs (one night at a time)

`/logs` reads a single imported report — or **All raids** for the cross-raid rankings — in three tabs: **Overview**, **Rankings** and **Gold spent**.

**Which pulls count.** The raid header's pull list is also a switch: click a pull to leave it out, and everything derived from the night recomputes without it — preparation coverage, potion and in-fight item counts, cooldowns, uptime averages and the improvement list. Excluded pulls stay visible (struck through) so the filter is never invisible, the selection is saved per report and survives a re-fetch, and the cross-raid rollup inherits it. A joke pull or a two-man farm boss stops skewing the night in one click.

**Parse boards** open the Rankings tab: the whole raid as a grid, one table per role — Damage Dealers, Healers, Tanks — with a column per boss kill, in the shape Warcraft Logs' own rankings view uses. Names in class colour with their spec icon, the night's average next to them, percentiles coloured on WCL's scale, and every cell hovering to its bracket percentile and raw dps/hps.

Warcraft Logs ranks a damage dealer twice — on all damage and on **damage to the boss alone** — and the two disagree by up to ten points on a night with adds. Both are stored per pull, and the damage boards **switch metric** rather than repeating every raider in a second table; healers never get the toggle (WCL ranks them at ~0 boss damage). Sorting and the average follow whichever metric is on screen.

Wipes get no column (they have no percentile), a blank cell means "not ranked on that kill" rather than a zero, and averages are taken over the kills a raider was actually ranked on — missing a boss never reads as a bad parse. Excluded pulls drop out here too. Reports fetched before boss damage was added show all-damage only, with a note; re-import to fill it in.

**Uptime by boss** draws each picked debuff/buff across a pull as colored bands per provider — gaps are exactly the time it was down — on the boss and on every add it touched. Pick several tracks to compare them on the same targets (Sunder Armor vs Expose Armor).

**Uptime by player** is the mirror image: which raiders actually *had* Battle Shout, Commanding Shout, Innervate or Earth Shield up, for how much of each pull, and who put it on them. Bands are colored by the provider, overlapping providers count once, and diamonds mark the cast itself — so an Innervate reads as "cast at 1:12, up until 1:32", not just "×3". A night-average tab averages each raider over the pulls they were in.

**Totem drops** shows when each shaman put down which totem, pull by pull. TBC never logs the buff a totem hands out — not to the raid, not even in the pull's aura snapshot — so the drop is the only honest record; the section says so rather than inventing uptime. (The one "Windfury Totem" buff the log *does* carry is the attacker's own proc window, not who stood in it.)

**Gold spent** prices the night: in-fight potions/sappers plus prep buffs, with per-raid consumable prices you can edit, export and re-import, and a re-application model that accounts for raid length and deaths.

### Awarding loot by hand

Not every drop arrives through Gargul. On a character profile, every open wishlist row has an **Award** button, and the loot history has **Award an item** for anything not on a list. The dialog takes the item (prefilled from the row), a **raid night** — a recent session or a new manual entry with its own date and raid — plus the off-spec flag and a note. An award that satisfied a wishlist row can be **cleared** again, which deletes it and reopens the slot.

Manual awards are ordinary loot awards: same ledger, same wishlist matching, same fairness and contention numbers — there is no parallel "manually marked" state to reconcile. Leave the name blank and the item is named from the cache, or from a single Wowhead lookup that is then cached.

### Item names & icons

Items reach the tracker as bare ids: a Gargul line has an id (sometimes a name), a log's gear snapshot has an icon and no name. The **item cache** (`items`, keyed by item id) is where those fragments meet — every field is optional and each import only ever *fills a gap*, so a curated entry is never overwritten and partial knowledge beats a fabricated "Item #30048".

Two steps, in this order, both on the import page's **Item names & icons** card:

1. **Harvest** — free. Names from wishlist slots and loot pastes, icons (and quality, and each socketed gem's icon) from the gear snapshot on every logged pull. This is data the database already holds, buried in per-row JSON where nothing could look it up by id.
2. **Resolve** — one Wowhead item-XML request per id nothing local knows, ever, cached forever. Loot and wishlist items go first, a batch per press (Wowhead turns away a client that asks for hundreds at once), so a large backlog takes a few presses and reports exactly what's left. Gargul imports also resolve the handful of genuinely new ids inline, so a fresh raid's ledger reads properly straight away.

Nothing is fetched while a page renders. An unresolved item still renders — its id, and the Wowhead hover tooltip, which works from the id alone.

### Comparing characters

`/compare` lines up **two to four characters** side-by-side on the contribution that drives a council decision: median output (dps, hps for healers), parse + ilvl-bracket percentiles, attendance (reset weeks, raids %, pull coverage), consumable coverage (flask/elixirs, food, weapon buff, potions/pull), and the **uptime of every buff/debuff their spec maintains** (warlock curses, shouts, judgements, Earth Shield…). The leader is highlighted per metric. The selection lives in the URL (`?chars=a,b,c`), so a comparison is shareable; reach it from the nav or the **Compare** button on any profile.

Under each name a **log picker** scopes that column's log-derived metrics (output, parses, deaths, consumables, uptime) to chosen raid night(s) — compare everyone on the same night, or each player's best — while attendance and comments stay all-time. Consumable coverage counts a flask **or at least one elixir**: a hunter running a single battle elixir reads as covered, not as "used nothing".

### Officer comments

Beyond the one-line `note`, every character has a **comment log** on its profile: timestamped, optionally signed entries filed under a category (note / performance / attendance / conduct / loot) and shown as colored chips. It's the council's running record — "passed on the off-hand for a teammate", "third week without a weapon enchant", "cleared next reset in advance". The same comments surface in the comparison view so a side-by-side read carries its context.

### Removing the demo data

A fresh database is seeded with fictional demo content so the UI isn't empty. Once real imports are in, the roster page shows a **“Remove demo data”** banner: it deletes the demo characters, their sessions/awards/gear sets and the seed log report, keeps the item cache (real TBC entries) and everything you imported, and unlinks (never deletes) real rows that pointed at demo ones.

### Model decisions

- A **wishlist is a whole gear set** (`kind: "wishlist"` + phase), exactly like a SixtyUpgrades export. Stat comparison is a pure diff of the two sets' computed stat blocks — the app never computes WoW stats itself.
- **Loot ↔ wishlist matching is derived at read time** (never persisted), so importing wishlists after the loot they satisfy still matches.
- Awards are attributed to a **phase by raid zone**, not date (farming Kara in P2 stays P1 loot).
- Rings/trinkets compare as **multisets**, never by slot index.
- Characters are **never deleted** (set them inactive) — past loot decisions stay explainable.
- **Hand-entered loot is ordinary loot.** A manual award is a normal award in a normal (manual) session, so wishlist status, fairness and contention follow it without a second source of truth to reconcile.
- The **item cache stores partial knowledge**: every field but the id is optional and imports only fill gaps, so a Gargul name, a log's icon and a Wowhead lookup compose instead of fighting.
- **Enchant names come from the guild's own lists**, never from a guess — see above.
- A write's **cache refresh can't fail the write**: server actions revalidate outside the result path, so a completed award is never reported as failed (which would invite a duplicating retry).

> **Note on seed data:** the roster, gear sets and awards are fictional demo data. Item IDs/names/icons are best-effort real TBC entries to make Wowhead tooltips work, but expect a few inaccuracies — they exist to exercise the UI and get replaced by your real imports.

> **Note on export formats:** the SixtyUpgrades parser is **built against a real export** (checked in as a test fixture under `src/lib/import/__fixtures__/`) — `items` array, UPPER_SNAKE slot names, `gameClass`, per-set `phase`, computed stats. The Gargul parser handles the **standard CSV export** (header-detected, the award `id` column ignored) and header-less custom formats via tolerant column-shape detection plus item links — covering the common configs.

## Roadmap

- **M1** — UI draft on realistic seed data ✓
- **M2** — SQLite persistence, commit-enabled SixtyUpgrades/Gargul imports, character editing, wishlist update flow with change confirmation ✓
- **M3** — LC decision support: manual winner resolution ✓, item demand index ✓, per-phase fairness ✓, Gargul standard-CSV export parsing ✓, full ledger editing (add / edit / delete awards, delete imports) ✓
- **M4** — Warcraft Logs integration: API client + report import ✓, per-character performance dashboard ✓, class toolkit (cooldown casts + maintained uptime) ✓, raid-wide logs dashboard with player-improvements list ✓, character-vs-character comparison + officer comment log ✓, fight-graph playground ✓. Uptime, gear and buff fetches are all validated against live reports ✓
- **M5** — reading a raid night properly, and knowing what an item is: per-report **pull filter** ✓, **uptime by player** (shouts, Innervate, Earth Shield) with cast timing ✓, **totem drop timeline** ✓, per-raid consumable pricing + gold ✓, the **item cache** (harvest from imports, one-time Wowhead resolution, placeholder repair) ✓, gem names and icons ✓, **enchants named and graded** against imported lists ✓, **hand-entered loot awards** ✓

### Known limits

- **Enchant coverage tracks imported lists.** An enchantment id nobody's SixtyUpgrades set names stays an id — there is no public lookup for it (see above). Importing more lists is the only lever, and it's guild-wide.
- **Totem uptime doesn't exist in TBC logs.** Only drops do; the app shows drops rather than inferring coverage.
- **Empty gem sockets are invisible** — the log carries the gems, never the socket count.
- **Re-import after upgrades.** Gem icons, item quality and cast timing come from the import step, so reports fetched before those existed keep working but show less until re-fetched.

## License

See [License.md](License.md) — all rights reserved.
