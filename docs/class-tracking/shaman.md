# Shaman

## Rotation priorities (TBC guides)

**Enhancement:** **Stormstrike on cooldown**, keep **Flame Shock** rolling
between Stormstrikes (shocks share a cooldown — Earth Shock only when Flame
Shock wouldn't run its duration), keep **Water Shield** up for mana, stagger
weapon swings for Flurry/Windfury, **Shamanistic Rage** on cooldown for mana.
The melee group's Windfury / Strength of Earth / Grace of Air totems are the
enhancement shaman's group service.

**Elemental:** Lightning Bolt spam with Chain Lightning on cooldown, Totem of
Wrath down, Elemental Mastery on cooldown.

**Restoration:** Chain Heal ranking, **Earth Shield** rolling on the tank,
Mana Tide + Nature's Swiftness on cooldown/emergency.

**Everyone:** Bloodlust/Heroism is a raid cooldown with an assignment.

## What we track

| Metric | Kind | Why |
|---|---|---|
| Flame Shock | debuff | Enhancement's DoT upkeep between Stormstrikes — the "fire shock" discipline |
| Stormstrike | debuff | The nature-damage window; uptime ≈ pressed on cooldown |
| Water Shield | selfbuff | The mana engine — dropping it starves the rotation |
| Earth Shield | buff (on friendly) | Resto's tank service, attributed to the caster |
| Shamanistic Rage, Bloodlust, Heroism, Mana Tide Totem, Nature's Swiftness, Elemental Mastery | cooldowns | Bloodlust timing especially — a raid CD with an owner |
| Every totem | drop timeline | Which totem went down, when, per shaman per pull (`/logs` → Totem drops) |

## Totems: drops, not uptime

**TBC does not log the buff a totem gives out.** Verified against a live report:
the buff-event stream and the pull's aura snapshot contain no Strength of Earth,
Grace of Air, Wrath of Air, Mana Spring, Totem of Wrath or Mana Tide on anyone —
those auras simply never reach the combat log. The one `Windfury Totem` buff the
log *does* carry is **self-sourced and short**: it's the attacker's own proc
window, not a record of who stood in the totem, so reading it as coverage would
name two melee and miss the rest of the group.

What the log *does* carry is the **cast**: source, timestamp and totem name
(rank-independent), plus the totem itself as a pet actor of its shaman. So the
honest measure is a drop timeline — what was put down, when, and what was
re-dropped after a move — and that is what the logs page shows. Totem coverage
per raider stays out of the app rather than being inferred.

## What we deliberately show little of

- **Windfury procs** — luck; fight-graph buff windows only.
- **Lightning Shield** — elemental filler churn, no upkeep meaning in raids.
- **Totem of Wrath** — group-wide near-100% when down; prep-level.
