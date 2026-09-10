/**
 * Curated knowledge about interrupts — who stopped which cast.
 *
 * Warcraft Logs emits an `interrupt` event carrying four facts: who pressed it,
 * which enemy they pressed it on, which spell did the interrupting, and — in
 * `extraAbility` — the cast that was cut off. That last field is the whole
 * value: "Wando kicked 49 times" is a keybind, while "Wando stopped sixteen
 * Spirit Shocks in Essence of Desire" is raid work.
 *
 * **This list labels the interrupts; it filters the presses.** Like
 * `dispels.ts`, the Interrupts fetch asks Warcraft Logs for *every* interrupt
 * and stores the spell ids alongside the names the log gave them, so
 * classification happens at read time and curating a spell below re-grades
 * reports imported months ago with no refetch. What still needs a re-import is
 * the fetch itself — a report imported before it existed has no interrupt rows
 * at all, and the board says so rather than reading as a night nobody kicked on.
 *
 * The presses that stopped *nothing* are the exception, and they cost what every
 * filtered list costs. They are not in the Interrupts stream at all — see
 * `INTERRUPT_CAST_IDS` below, which puts these same ids in the **casts** filter
 * and drags the whole of change-chains §1 along with it.
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
 * The same ids as a **filter**, for the friendly casts fetch.
 *
 * This is the one export here that narrows a fetch rather than labelling what
 * came back, and it buys the other half of the board. Warcraft Logs emits an
 * `interrupt` event only when a cast actually died, so a press that stopped
 * nothing exists nowhere in that stream — it is an ordinary `cast`, and until
 * these ids reached `CASTS_FILTER` the app had never seen one.
 *
 * So it is change-chains §1 like every other filtered list: **a report imported
 * before this existed holds no presses at all**, which reads exactly like a
 * night where every press landed. `analysis/interrupts.ts` says "not recorded"
 * rather than showing a clean sheet, and only a re-import tells them apart.
 *
 * Matching a press to its interrupt is unusually safe. Probed across the boss
 * pulls of cWrNZY23Rx6V4faw: all 38 landed interrupts sit 1–13ms from a cast of
 * the same spell by the same player on the same pull, with the same target on
 * every one, while the closest two presses of one spell by one player are 4,980ms
 * apart. `normalize.ts` allows 250ms, which is twenty times the worst observed
 * gap and twenty times inside the tightest collision.
 *
 * **What an unlanded press means differs by button, and the council chose to
 * count them all.** Kick, Pummel and Counterspell do nothing else, so a press
 * that stopped nothing missed its window — 11 of 24 Pummels, 8 of 14
 * Counterspells and 2 of 13 Kicks on the probed night's boss pulls. Earth Shock
 * and Feral Charge have day jobs: 373 Earth Shock casts on those same pulls
 * against 8 interrupts, because it is also a shaman's nuke. Both kinds are
 * counted, and every tally stays split **per spell** so the shaman's 365 sit on
 * their own row instead of drowning the warriors' 11.
 */
export const INTERRUPT_CAST_IDS = new Set<number>(INTERRUPT_ABILITIES.map((a) => a.id));

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
