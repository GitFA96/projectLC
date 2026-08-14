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
| Sunder Armor | debuff | The raid-wide armor debuff — uptime AND ≈casts landed (effort), comparable against rogues' Expose Armor. Counted from **Devastate as well as Sunder Armor**, and credited to the caster rather than to whoever the log filed the aura under; see below |
| Thunder Clap | debuff | Tank swing-speed mitigation upkeep |
| Demoralizing Shout | debuff | Tank AP-reduction upkeep |
| Battle Shout / Commanding Shout | buff (on the raid) | Group buff discipline — tracked per *recipient* too, so a raider left unshouted shows up (`/logs` → Uptime by player) |
| Rampage | selfbuff | Fury's personal upkeep — dropping it bleeds AP |
| Death Wish, Recklessness, Shield Wall, Sweeping Strikes | cooldowns | Pressed or wasted |

## Sunder is not one warrior's job, and the log pretends it is

There is one Sunder aura on a target, and Warcraft Logs files every event of it
under whoever owns the current window — so the warrior who opened it collects
everyone else's casts. On the 09 Aug Hydross kill that read as Turdlord, a fury
warrior, holding 98% Sunder uptime off two casts, while Byrd's 78 Devastates
appeared nowhere.

Two things follow for reading the `/logs` uptime view. Sunder contribution is
matched back to the **cast** that caused each aura event, so every warrior who
threw one shows on the boss with their own count and their own hold windows —
including a warrior whose uptime rounds to 0%. And **Devastate counts**: it is
how a protection warrior stacks Sunder, and a tank's whole contribution is
invisible without it.

Reports imported before this need a re-import; the casts behind it were never
fetched. See [`docs/change-chains.md`](../change-chains.md) §1.

## What we deliberately show little of

- **Deep Wounds** — passive bleed from crits; luck, not play. Visible in the
  fight graph's buff windows only.
- **Heroic Strike / Slam usage** — rage-dump quality is already priced into the
  parse; counting casts would reward spam.
- **Shield Block** — 5–6s churn; uptime on it is noise. Shield Wall (the
  decision) is tracked instead.
- **Stances** — near-100% churn auras, filtered by the ≥92% rule.
