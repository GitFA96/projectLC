/**
 * Boss mechanics that pick several raiders at once and link them together.
 *
 * One entry so far — Mother Shahraz's Fatal Attraction — and the shape exists
 * because the mechanic is **two spell ids that share one name**, which is the
 * whole trap. Reading the picks off the wrong one invents pairings that never
 * happened.
 *
 * Everything below was read off this guild's own reports: all thirteen Mother
 * Shahraz pulls across five nights (`3GbMaFhAmjTVZ8Xy`, `JYyaWqR9N7QpfCtL`,
 * `za1nKRFjHwNQBZ4y`, `yZh1NVvLnMfKaAH2`, `cWrNZY23Rx6V4faw`). Nothing here is
 * remembered — see root AGENTS.md invariant 4.
 *
 * ## What the log actually says
 *
 * **The debuff names who was picked.** 126 `applydebuff` and 126 `removedebuff`
 * events across those pulls, sourced from Mother Shahraz. There is no cast
 * event to anchor to: her cast stream on those pulls carries only Interrupting
 * Shriek and the five Prismatic Auras, so the application *is* the record that
 * a pairing happened.
 *
 * **The damage is a different id, and it is not a list of who was picked.** All
 * 1,782 damage events are `isAoE` and self-sourced (`sourceID === targetID`),
 * and they hit far more people than the debuff does: on the 30 Aug kill pull
 * the 113.2s pairing was Strixz, Wando and Huntigo, and one second later *nine*
 * players took damage from it. Melige died in that second without ever being
 * picked. Across all thirteen pulls the split is 990,266 damage to raiders
 * holding the debuff against **1,039,671 to raiders who were not** — more than
 * half of it lands on bystanders, which is the number this whole view exists to
 * show.
 *
 * **Only players are ever picked — but the damage hits pets too, and the first
 * reading of that was wrong.** Every one of the 252 debuff events named an
 * actor WCL types as `Player`; not one pet, NPC or deployable has ever been
 * picked, and this is not the log hiding pets — on one probed kill Shahraz's
 * Interrupting Shriek lands on pets 51 times. So an engineer's kit cannot take
 * a pick or be paired into one.
 *
 * The **damage** is the opposite, and it was missed because `DamageTaken` is a
 * players-only stream: the same ability filter returns 109 events there and 160
 * under `All`. The extra 51 are thornlings, goblin land mines, flame turrets,
 * snakes and hunter pets — 80,178 damage across six reports, killing 60 of
 * them. Hostility is not the lever; unset and `Friendlies` both return the same
 * players-only 109. See `PAIRING_DAMAGE_FILTER` and the `All` fetch it feeds.
 *
 * **It does not always pick three, and the log says why: tanks are never
 * picked.** Across sixteen reports from four guilds — 26 pulls, 101 casts, 254
 * picks — not one pick landed on a current Saber Lash target, where uniform
 * picking would put about 30. Model the boss as rolling three targets over the
 * whole raid and losing any roll that lands on a tank (or on a name already
 * rolled), and the 1 / 2 / 3 split comes out 6.3 / 37.5 / 57.2 against an
 * observed 6 / 37 / 58. A two-name cast is a roll that landed on a tank, not a
 * name that went missing — so nothing downstream may pad a cast, and a tank on
 * the timeline is correctly never in a pairing.
 *
 * **Pets, snakes, thornlings and engineering do not soak rolls.** The same 101
 * casts had between 0 and 47 friendly non-player units alive at the moment of
 * the cast, and the count has no bearing on how many players were picked
 * (r = −0.002; the two casts with the most alive, 47 and 40, both picked three).
 * If units were in the pool, about thirteen of those casts would have picked
 * nobody and shown as a 45–80 s hole in the cast rhythm; every gap between
 * casts is 21–42 s. Deaths, raid size and shadow resistance were tested too and
 * explain nothing.
 */

/** A debuff that lands on several raiders at once and links them. */
export interface PairingDebuff {
  /** WCL spell id of the debuff — the match key, and the only record of a pick. */
  id: number;
  /** The log's own spelling, so an officer reading this beside WCL sees one name. */
  name: string;
  /** The boss that applied it in every event probed. A label, not a filter. */
  boss: string;
  /**
   * Ids of the damage the mechanic deals, which for Fatal Attraction is a
   * **different id under the same name**. Kept separate from `id` because the
   * two answer different questions: this one says who got hurt, including the
   * bystanders, and never who was picked.
   */
  damageIds: number[];
}

export const PAIRING_DEBUFFS: PairingDebuff[] = [
  { id: 41001, name: "Fatal Attraction", boss: "Mother Shahraz", damageIds: [40871] },
];

export const PAIRING_DEBUFF_BY_ID = new Map<number, PairingDebuff>(
  PAIRING_DEBUFFS.map((p) => [p.id, p]),
);

/** The debuff ids, as the filter for the friendly-side Debuffs fetch. */
export const PAIRING_DEBUFF_IDS = new Set<number>(PAIRING_DEBUFFS.map((p) => p.id));

/** The damage ids, as the filter for the DamageTaken fetch. */
export const PAIRING_DAMAGE_IDS = new Set<number>(PAIRING_DEBUFFS.flatMap((p) => p.damageIds));

/** The pairing a damage id belongs to, for attributing a hit to its mechanic. */
export const PAIRING_BY_DAMAGE_ID = new Map<number, PairingDebuff>(
  PAIRING_DEBUFFS.flatMap((p) => p.damageIds.map((id) => [id, p] as const)),
);

/** The curated pairing for a debuff id, or undefined for one nobody has named. */
export function pairingOf(spellId: number | undefined): PairingDebuff | undefined {
  return spellId === undefined ? undefined : PAIRING_DEBUFF_BY_ID.get(spellId);
}
