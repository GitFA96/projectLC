# Class tracking — what we measure and why

This directory is the reference for **what "playing your class well" means in TBC
raids**, compiled from the standard guides (Wowhead, Icy Veins, Warcraft Tavern),
and how each of those expectations maps onto projectLC's tracking system. One file
per class; each lists the PvE rotation priorities, the metrics we track, and —
just as deliberately — what we **don't** surface and why.

## How the tracking system works

All tracking is driven by two curated lists in
[`src/lib/wcl/class-tracks.ts`](../../src/lib/wcl/class-tracks.ts):

| List | What it captures | How |
|---|---|---|
| `UPTIME_TRACKS` | Maintained debuffs/buffs (uptime %) | Matched **by aura name** (covers all spell ranks) from WCL apply/refresh/remove events |
| `CLASS_COOLDOWNS` | Major cooldown presses (counts **and timings**) | Matched **by spell id** (every rank listed) from cast events |
| `SHAMAN_TOTEM_CASTS` | Totem drops (which totem, dropped when) | Matched **by cast name** (rank-independent) — see the shaman file for why drops, not uptime |

Each uptime track has a `kind`:

- **`debuff`** — maintained on enemies. Tracked per target (boss vs adds, with
  instance numbers), with within-fight time segments and ≈landed-cast counts.
- **`selfbuff`** — maintained on yourself (Rampage, Slice and Dice, Water
  Shield). Only counts when source = target; auras already up at the pull are
  credited from its start.
- **`buff`** — put on other raiders (shouts, Innervate, Earth Shield). Tracked
  in **both directions**: attributed to the caster, and read back per recipient
  for the logs page's "uptime by player" view. A buff already running at the
  pull is credited to whoever the pull's aura snapshot names as its caster, and
  a totem-sourced buff resolves through the totem to the shaman who dropped it.

Tracked cooldowns also record **when** they were pressed (and at whom, for
targeted ones like Innervate), which is what turns "Innervate ×3" into a
timeline.

Pre-cast debuffs are handled: a refresh (or removal) as the first in-fight event
means the aura was up before the pull, so it's credited from the pull start.

**Where it shows up:** the logs page (uptime by boss timelines, **uptime by
player**, **totem drops**, night averages, uptime leaders), each player's
performance page (per-class expectations, fight graph), and the compare page
(uptime %, boss-only %, casts per pull).

**Adding a track requires a re-import** of existing reports — the events fetch
is filtered server-side to the tracked names, so old imports don't contain
events for names added later.

## The exclusion philosophy — "what we show little of"

A metric earns a lane only if the player **chooses** it pull by pull. We
deliberately do not surface:

- **Passive procs** (Ignite, Deep Wounds, Windfury procs, Quick Shots) — they
  measure crit luck and gear, not decisions. The fight graph's buff-window view
  shows them per pull for deep dives, but they never become an uptime grade.
- **Churn auras** (seal twisting, stances, Life Tap, Heroic Strike spam) — high
  event volume, no upkeep meaning; "uptime" on these misleads.
- **Whole-fight prep auras** (flasks, food, blessings, Inner Fire) — those are
  preparation, measured by the consumables/prep coverage system instead, and the
  fight graph filters ≥92%-uptime auras out of its buff windows for the same reason.
- **Incoming heals on the fight graph** (Renew, Lifebloom, PW:S…) — real buffs,
  wrong story on a damage timeline.

## Class files

- [Warrior](warrior.md) · [Paladin](paladin.md) · [Hunter](hunter.md) ·
  [Rogue](rogue.md) · [Priest](priest.md) · [Shaman](shaman.md) ·
  [Mage](mage.md) · [Warlock](warlock.md) · [Druid](druid.md)

Aura names in these files were verified against this guild's own Warcraft Logs
reports (July 2026) — WCL matches by exact name, so never add a track from
memory; probe a real log first.
