# Rogue

## Rotation priorities (TBC guides)

**Combat (the raid spec):** Sinister Strike to 4–5 combo points, keep **Slice
and Dice** up **at all times** — it is the single highest DPS priority — then
**Rupture** when the target lives out the bleed, or Eviscerate. **Expose
Armor** instead of the finishers when assigned (the 5-warrior-sunder
alternative). Adrenaline Rush + Blade Flurry on cooldown/burn windows.

**Assassination/Subtlety:** same finisher priorities around Mutilate/backstab.

## What we track

| Metric | Kind | Why |
|---|---|---|
| Slice and Dice | selfbuff | THE rogue metric — SnD uptime is rogue play in one number |
| Rupture | debuff | Finisher discipline when the fight allows bleeds |
| Expose Armor | debuff | The armor-debuff assignment, directly comparable with warriors' Sunder in uptime-by-boss |
| Adrenaline Rush, Blade Flurry, Cold Blood | cooldowns | Pressed or wasted |
| Thistle Tea | consumable cast | Energy to fund an Expose Armor or an extra finisher |

**Thistle Tea is logged as "Restore Energy" (9512), not by its item name** — it
can only be matched by id. It is counted as an `other` consumable rather than a
`potion` on purpose: potions are audited as a rate against their two-minute
cooldown, and tea does not share that cooldown, so bucketing it with potions
would let a rogue who skipped their damage potion look fully covered.

## What we deliberately show little of

- **Poison procs / applications** (Deadly, Instant) — application spam driven by
  proc chance; running poisons at all is covered by the weapon-buff prep check.
- **Combo point efficiency** — not derivable from aura events; the parse plus
  SnD/Rupture uptime together approximate it.
- **Stealth/vanish openers** — one-off, no upkeep meaning.
