# Hunter

## Rotation priorities (TBC guides)

**Beast Mastery (the raid spec):** the Steady Shot / Auto Shot weave ("one-one
macro" timing), Kill Command on cooldown, **Hunter's Mark** on the boss,
Bestial Wrath + Rapid Fire on cooldown/burn windows. Serpent Sting only when
the target lives long enough (situational for BM).

**Survival:** brings **Expose Weakness** (agility-scaling raid AP debuff via
crits) — the reason a raid slots one SV hunter.

**Marksmanship:** rare in raids; same weave discipline.

**Utility everyone owns:** Misdirection to the tank on pull.

## What we track

| Metric | Kind | Why |
|---|---|---|
| Hunter's Mark | debuff | The assignment; pre-cast before the pull is credited correctly (refresh-first rule) |
| Expose Weakness | debuff | The SV hunter's whole raid contribution |
| Serpent Sting | debuff | Situational DoT upkeep — read with spec context; low uptime for BM is normal |
| Rapid Fire, Bestial Wrath, Misdirection, Readiness | cooldowns | Pressed or wasted; Misdirection on pull is a job |
| Snake Trap | cooldown, and a deployable | The one *ability* in the Mother Shahraz kit — it shows in the cooldown counts and on the deployables timeline, and is never priced, because nobody buys it |

## What we deliberately show little of

- **Weave quality / clipped autos** — the parse prices it; we can't grade macro
  timing from aura events.
- **Quick Shots and other procs** — luck. Visible per pull in the fight graph's
  buff windows only.
- **Pet uptime / pet buffs** — pet casts are filtered out of the player's
  metrics; a dead pet shows up as a parse problem. (Candidate for future
  tracking if wanted.)
- **Aspect churn** — Hawk/Viper flips are mana management, not upkeep.
