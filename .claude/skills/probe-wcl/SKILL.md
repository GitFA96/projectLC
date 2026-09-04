---
name: probe-wcl
description: Ask Warcraft Logs what a real report actually contains, before claiming anything about a spell id, an aura name or an event stream in projectLC. Use when adding a tracked consumable, cooldown, dispel or interrupt, or when a log-derived number looks wrong.
---

# Probe a real log before you claim anything

**Never add a spell id or an aura name from memory.** Root `AGENTS.md`
invariant 4: name what a source actually says and stay silent otherwise. A
curated entry that names nothing real collects nothing, for ever, and reviews
as correct.

```bash
node scripts/probe-wcl.mjs <report-code-or-url>                     # overview
node scripts/probe-wcl.mjs <code> --events Casts --filter '...'     # one stream
node scripts/probe-wcl.mjs <code> --query my.graphql --var limit=50
```

Credentials come from `.env.local`. Output goes to `$SCRATCH`, never into the
repo — a probe dump is evidence for one question, not a fixture.

## The four traps

- **`fightIDs`, not `startTime`/`endTime` alone.** Scoping only by time silently
  includes trash: an order of magnitude more events and several more pages. The
  script defaults to boss pulls; pass `--allFights` when you mean the night.
- **Names go in double quotes** — `ability.name IN ("Battle Shout")`. Single
  quotes read as an identifier: the query errors, or quietly matches less.
- **`combatantinfo` omits auras.** The pull snapshot is not a list of everything
  a raider had up. It leaves the Unstable Flasks out entirely, and it is taken
  when the pull *starts*, so anything drunk mid-pull is in no snapshot anywhere.
  **Never call an aura absent from `combatantinfo` alone** — check the buff
  stream before saying somebody was unflasked.
- **`useAbilityIDs: false`**, which the script sets. Without it the response
  carries ids and no names, so "what is this called" comes back unanswerable.

## Then what

An id or name you confirm goes in `src/lib/wcl/consumables.ts` or
`class-tracks.ts`, reaches the server-side filter through
`src/lib/wcl/event-filters.ts`, and **needs every report re-imported** — the
fetch is filtered server-side, so old reports never contained the event. Say
that in your summary; it is operational, not cosmetic.

Read [`docs/change-chains.md`](../../../docs/change-chains.md) §1 for the whole
chain, including why a shared debuff is credited to the wrong raider without its
`appliedBy` cast.

Quote counts from the probe when you report. "239 of 262 events were real
interrupts" is a finding; "most of them" is not.
