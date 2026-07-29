# Druid

## Rotation priorities (TBC guides)

**Feral (cat):** keep **Mangle** up (it amplifies every bleed and Shred in the
raid), Shred + Rip around powershifting; **Faerie Fire (Feral)** if the armor
debuff is the cat's assignment.

**Feral (bear tank):** **Mangle (Bear)** on cooldown, **5× Lacerate**
maintained for threat, Maul weaves, Faerie Fire (Feral) on the boss.

**Balance:** keep **Insect Swarm** and **Moonfire** rolling, Starfire/Wrath
filler by build; the moonkin aura is why the caster group wants one.

**Restoration:** **Lifebloom** rolling on tanks, Rejuvenation/Swiftmend
triage, Innervate + Rebirth are raid cooldowns with assignments.

## What we track

| Metric | Kind | Why |
|---|---|---|
| Faerie Fire / Faerie Fire (Feral) | debuff | The armor-debuff assignment |
| Mangle (Cat) / Mangle (Bear) | debuff | The bleed/Shred amplifier — a raid debuff, dropped Mangle taxes rogues and the other feral |
| Lacerate | debuff | Bear threat-stack upkeep |
| Insect Swarm / Moonfire | debuff | Balance DoT discipline |
| Innervate, Rebirth, Nature's Swiftness, Tranquility | cooldowns | Innervate/Rebirth are assigned raid CDs — unused = wasted |
| Innervate | buff (on a raider) | Also read from the receiving end: **who** got it and **when** it was cast, not just how many went out (`/logs` → Uptime by player) |

## What we deliberately show little of

- **Lifebloom rolling** — the resto skill metric, but it's an incoming-heal
  aura: we exclude it from damage-oriented views, and HPS parse covers the
  output. Candidate for a healer-focused view later.
- **Rip uptime** — legitimate cat metric; left out for now because powershift
  builds vary (some drop Rip entirely). Add it if the cat core standardizes.
- **Powershifting quality** — energy management isn't visible in aura events;
  parse territory.
- **Forms / Moonkin aura** — toggles and near-100% auras, ≥92% filter territory.
