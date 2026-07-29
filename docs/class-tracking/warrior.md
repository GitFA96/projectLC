# Warrior

## Rotation priorities (TBC guides)

**Fury (DPS):** Bloodthirst and Whirlwind on cooldown, keep **Rampage** rolling
(refresh in its last seconds), Heroic Strike as the rage dump, keep **Battle
Shout** up for the group. Death Wish + Recklessness on cooldown/burn windows.

**Arms (DPS):** Mortal Strike + Whirlwind on cooldown, Slam weaves between
swings, and the raid's **Sunder Armor** contribution when not assigned elsewhere.

**Protection (tank):** stack and **maintain 5× Sunder Armor**, hold **Thunder
Clap** and **Demoralizing Shout** on the boss, **Commanding Shout** for the
group, Shield Block on cooldown, Devastate filler, Shield Wall as the emergency
button.

## What we track

| Metric | Kind | Why |
|---|---|---|
| Sunder Armor | debuff | The raid-wide armor debuff — uptime AND ≈casts landed (effort), comparable against rogues' Expose Armor |
| Thunder Clap | debuff | Tank swing-speed mitigation upkeep |
| Demoralizing Shout | debuff | Tank AP-reduction upkeep |
| Battle Shout / Commanding Shout | buff (on the raid) | Group buff discipline — tracked per *recipient* too, so a raider left unshouted shows up (`/logs` → Uptime by player) |
| Rampage | selfbuff | Fury's personal upkeep — dropping it bleeds AP |
| Death Wish, Recklessness, Shield Wall, Sweeping Strikes | cooldowns | Pressed or wasted |

## What we deliberately show little of

- **Deep Wounds** — passive bleed from crits; luck, not play. Visible in the
  fight graph's buff windows only.
- **Heroic Strike / Slam usage** — rage-dump quality is already priced into the
  parse; counting casts would reward spam.
- **Shield Block** — 5–6s churn; uptime on it is noise. Shield Wall (the
  decision) is tracked instead.
- **Stances** — near-100% churn auras, filtered by the ≥92% rule.
