import type { Profession } from "@/lib/constants/wow";
import { isEngineeringExplosive } from "@/lib/wcl/consumables";

/**
 * What the logs can say about a raider's professions.
 *
 * Almost nothing, is the answer — and saying so precisely is the whole job of
 * this module. Warcraft Logs records what people *did*, never what they knew:
 * an alchemist's flask looks the same bought as made, a leatherworker's drums
 * are handed round the raid, and mining leaves no trace at all. So there is
 * exactly one profession this app can claim from a log, and one thing that
 * claims it.
 *
 * **A thrown engineering explosive is proof of Engineering.** Sapper charges
 * and the Arcane Bomb each carry `Requires Engineering` on their own tooltip,
 * and nobody without the profession can set one off — `isEngineeringExplosive`
 * in `src/lib/wcl/consumables.ts` is the list, and the reason it is the list
 * rather than a category here. `src/lib/sim/profile.ts` already reads a throw
 * that way in the sim pre-run check; this is the same claim, made about the
 * roster instead of a sim setup.
 *
 * It reads the cast NAMES a pull recorded rather than any stored count, so an
 * explosive curated next month is proof on reports imported last month. A count
 * would have needed all of them fetched again.
 *
 * Two rules follow, and both are about what this must NOT say:
 *
 * - **Only ever positive evidence.** No explosive on a hundred pulls proves
 *   nothing whatsoever — an engineer who never needed one, or never had one, or
 *   whose reports were imported before these were tracked at all
 *   (docs/change-chains.md §1) all look identical. An absence must never
 *   contradict a recorded Engineering, and never read as "they don't have it".
 * - **There is no threshold to tune.** One throw is proof; that is a fact about
 *   the game, not a judgement about the raider, so it is a `> 0` here rather
 *   than a number in `policy.ts` (invariant 5 — nothing about this changes a
 *   loot verdict).
 *
 * The other direction — a raider recorded as an engineer who has never thrown
 * anything — is deliberately silent. It is the normal state for most engineers
 * and flagging it would train officers to ignore the flag.
 */

/**
 * A pull row or an off-pull record — anything holding the names of the
 * non-potion consumables somebody used.
 *
 * The names, not a count: which of them took Engineering is decided here, at
 * read time.
 */
export interface ExplosiveSource {
  otherCasts: readonly string[];
}

/**
 * Engineering explosives a character was logged setting off, on pulls and
 * between them.
 *
 * Both scopes count: these get thrown clearing trash as readily as on a boss,
 * and the off-pull record exists precisely because a boss-window-only count
 * missed those (see `WclPlayerOffPull`). For proof-of-profession either one
 * settles it, but the total is what the hint shows an officer, and a number
 * that silently ignored half the night would read as wrong to anyone who had
 * looked at the log.
 */
export function explosiveThrows(
  pulls: readonly ExplosiveSource[],
  offPull: readonly ExplosiveSource[] = [],
): number {
  const sum = (rows: readonly ExplosiveSource[]) =>
    rows.reduce((n, r) => n + r.otherCasts.filter(isEngineeringExplosive).length, 0);
  return sum(pulls) + sum(offPull);
}

/**
 * A profession the logs prove a character has, that the roster hasn't recorded.
 *
 * Undefined is the answer nearly always, and means "nothing to say" rather than
 * "nothing there".
 */
export interface ProfessionGap {
  /** The profession the evidence proves. Engineering is the only one it can be. */
  profession: Profession;
  /** How many throws back the claim — shown so the officer can go and check. */
  explosives: number;
}

/**
 * Does this character's log history contradict what the roster records?
 *
 * Only in one direction: evidence exists and the profession is not recorded.
 * A character whose professions are already recorded correctly, and one nothing
 * is known about, both return undefined.
 */
export function professionGap(
  recorded: readonly Profession[],
  evidence: { explosives: number },
): ProfessionGap | undefined {
  if (evidence.explosives <= 0) return undefined;
  if (recorded.includes("Engineering")) return undefined;
  return { profession: "Engineering", explosives: evidence.explosives };
}
