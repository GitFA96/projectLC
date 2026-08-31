/**
 * Curated knowledge about interrupts — who stopped which cast.
 *
 * Warcraft Logs emits an `interrupt` event carrying four facts: who pressed it,
 * which enemy they pressed it on, which spell did the interrupting, and — in
 * `extraAbility` — the cast that was cut off. That last field is the whole
 * value: "Wando kicked 49 times" is a keybind, while "Wando stopped sixteen
 * Spirit Shocks in Essence of Desire" is raid work.
 *
 * **This list labels; it does not filter.** Like `dispels.ts` and unlike every
 * other curated list here, the Interrupts fetch asks Warcraft Logs for *every*
 * interrupt and stores the spell ids alongside the names the log gave them.
 * Classification happens at read time, so curating a spell below re-grades
 * reports imported months ago with no refetch. What still needs a re-import is
 * the fetch itself — a report imported before it existed has no interrupt rows
 * at all, and the board says so rather than reading as a night nobody kicked on.
 *
 * Every id below was read off this guild's own MH+BT report (cWrNZY23Rx6V4faw,
 * 30 Aug), not remembered.
 */

/**
 * An interrupt as pressed, keyed by the id because the name is not the key —
 * Earth Shock alone arrived under two ids in one night (rank 8042 and rank
 * 25454), and a board keyed on names would have merged ranks it cannot tell
 * apart while splitting nothing it should.
 *
 * `wowClass` is what the log's own actor carried, not a tooltip claim. An
 * interrupt nobody has curated is still counted; it simply shows no class.
 */
export interface InterruptAbility {
  /** WCL spell id — the match key. */
  id: number;
  /** The log's own spelling, so an officer reading this beside WCL sees one name. */
  name: string;
  /** WCL class string, as the source actor was typed in this guild's logs. */
  wowClass: string;
}

export const INTERRUPT_ABILITIES: InterruptAbility[] = [
  /* Rogue. One rogue, 49 presses, every one of them this id. */
  { id: 38768, name: "Kick", wowClass: "Rogue" },
  /* Warrior. Katzewarr and Scomb, 52 presses between them. */
  { id: 6554, name: "Pummel", wowClass: "Warrior" },
  /*
   * Shaman, and the reason this list is keyed on ids. Five shamans pressed
   * Earth Shock 91 times under TWO ids: 90 on 25454 and a single 8042. Both are
   * Earth Shock, both are real, and neither is a different spell — so both are
   * curated under one name and the board adds them up by name rather than
   * showing a raider a mystery "×1" they cannot place.
   */
  { id: 25454, name: "Earth Shock", wowClass: "Shaman" },
  { id: 8042, name: "Earth Shock", wowClass: "Shaman" },
  /* Mage. Melige, Goku and Noturds, 41 presses. */
  { id: 2139, name: "Counterspell", wowClass: "Mage" },
  /*
   * Druid, and the log names the *effect* rather than the button: a feral
   * pressing Feral Charge produces "Feral Charge Effect" here, the same trap as
   * the Dog Whistle logging as Summon Tracking Hound. The label keeps the log's
   * spelling so a probe finds it.
   */
  { id: 19675, name: "Feral Charge Effect", wowClass: "Druid" },
];

export const INTERRUPT_ABILITY_BY_ID = new Map<number, InterruptAbility>(
  INTERRUPT_ABILITIES.map((a) => [a.id, a]),
);

/**
 * The curated entry for a logged interrupt, or undefined for one nobody has
 * named yet. An uncurated interrupt is still **counted** — it arrived with its
 * own name from the log — it just carries no class, and the board lists it so
 * somebody can curate it. Same bargain as an unplaced elixir.
 */
export function interruptAbilityOf(spellId: number | undefined): InterruptAbility | undefined {
  return spellId === undefined ? undefined : INTERRUPT_ABILITY_BY_ID.get(spellId);
}

/**
 * Casts that heal, among the ones this raid has actually interrupted.
 *
 * This is the officers' question — "did we stop the healer" — and it is a
 * **label, never a score.** What a raid *should* interrupt is an assignment the
 * council makes and not a fact in a log, so nothing here ranks anybody or
 * grades a pull. See AGENTS.md invariant 5.
 *
 * The bar for an entry is evidence in a log, and the two entries below did not
 * clear it the same way — which is recorded rather than smoothed over:
 *
 *  - **Circle of Healing** was seen healing: 12 healing events for 1,087,737
 *    across the four casts Lady Malande got through, against 11 she started.
 *  - **Greater Heal** healed for nothing all night, because none of the four
 *    the Priestess of Delight started ever finished — three were interrupted
 *    and the fourth died mid-cast. It is labelled a heal on the strength of the
 *    log's own name for it, which is a weaker claim than the one above, and the
 *    honest reading of a spell whose every attempt was stopped.
 *
 * Deliberately absent, and the reason this list is short: Spirit Shock, Deaden,
 * Shared Bonds, Divine Wrath, Empowered Smite, Sludge Nova, Soul Blast, Shadow
 * Bolt, Gargoyle Strike, Banshee Wail, Mana Burn and Frostbolt were all
 * interrupted on the probed night and **none of them healed anything**. They
 * are still counted and still named on the board; they are simply not called
 * heals, because the log does not say they are and this file does not guess.
 */
export const HEALING_CAST_IDS = new Map<number, string>([
  [41455, "Circle of Healing"],
  [41378, "Greater Heal"],
]);

/**
 * Whether the cut-off cast was a heal.
 *
 * Read on the **id**, because that is the stable half: WCL resolves some TBC
 * ids against a modern spell database, so the name in an old report and the
 * name in a new one can differ for one spell.
 */
export function isHealingCast(castId: number | undefined): boolean {
  return castId === undefined ? false : HEALING_CAST_IDS.has(castId);
}
