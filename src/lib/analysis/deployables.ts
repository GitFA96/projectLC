import type { Profession, WclPlayerFight } from "@/lib/types";
import { compareText } from "@/lib/sort";
import { deployableLabelsFor } from "@/lib/wcl/deployables";

/**
 * What the raid put on the ground, pull by pull.
 *
 * Land mines, snake traps, thornlings, dog whistles and flame turrets are a
 * kit: on a fight that needs them, the question is never "how many did we own"
 * but "were they down, early enough, and did enough people lay one". So this
 * view is a timeline first and a count second — the same shape as the totem
 * drops, and for the same reason.
 *
 * Pure: rows in, view out.
 *
 * **Boss pulls only.** A deployable thrown on trash has no pull to sit on and
 * arrives as an off-pull consumable instead, where the gold table already
 * counts it. Reading that here would put a mine laid in a corridor next to one
 * laid on Mother Shahraz, which is the comparison this view exists to avoid.
 */

export interface DeployableDrop {
  name: string;
  /** ms from the pull start. */
  atMs: number;
}

export interface DeployableLane {
  name: string;
  slug?: string;
  className?: string;
  drops: DeployableDrop[];
}

export interface DeployableCount {
  name: string;
  count: number;
}

export interface DeployableFight {
  fightId: number;
  lanes: DeployableLane[];
  /** What went down on this pull, most-laid first. */
  totals: DeployableCount[];
  total: number;
  /** Distinct raiders who laid at least one. */
  raiders: number;
}

/**
 * Somebody who was on the boss and laid less than the kit asked for.
 *
 * Two different questions produce one of these, which is why `laid` is on it:
 * "laid nothing at all" is an empty list, and "an engineer who laid no
 * engineering device" is usually not — the row has to be able to say *what*
 * they laid, or an officer reading the second list can't tell a raider who sat
 * on their hands from one who threw a dog whistle instead.
 */
export interface DeployableAbstainer {
  name: string;
  slug?: string;
  className?: string;
  /** Counted pulls of this boss they were on. */
  pulls: number;
  /** What they did lay on this boss, across those pulls. */
  laid: DeployableCount[];
  /** The roster records the profession that gates a device on this list. */
  engineer?: boolean;
}

/**
 * One boss, and who didn't lay anything on it.
 *
 * **Per boss, not per pull, and that is the whole point.** A land mine and a
 * dog whistle are on fifteen-minute cooldowns; on a night that wiped twice on
 * Mother Shahraz before killing her, nobody could have laid one on all three
 * pulls, and a per-pull list would name most of the raid on two of them for no
 * reason. Across the boss, "laid nothing" means what it says.
 *
 * **And only across the pulls something went down on.** The probed night's
 * second Shahraz pull was a 26-second reset at 99.98% that not one raider laid
 * anything on; counting it would have put a fourth chance in everybody's
 * denominator that nobody could have taken. A pull the whole raid was silent on
 * is a reset, or a pull the kit wasn't wanted on, or (§1) a report imported
 * before this was tracked — never evidence about any one raider. It is the same
 * rule the boss list is scoped by, one level down, and it is also what keeps
 * this count agreeing with the timeline above it, which shows those same pulls.
 */
export interface DeployableSilence {
  encounterId: number;
  encounterName: string;
  /** Pulls of this boss something went down on — the chances being counted. */
  pulls: number;
  /** Raiders on at least one of them. */
  raiders: number;
  /** Everything laid on this boss. */
  total: number;
  /** Present on the boss and laid nothing on any pull of it. */
  silent: DeployableAbstainer[];
  /**
   * Raiders the roster records as engineers who laid neither engineering
   * device here. Overlaps `silent` on purpose — an engineer who laid nothing
   * is both, and each list is a different question an officer asks.
   */
  engineers: DeployableAbstainer[];
}

export interface RaidDeployableView {
  /** Pulls that had at least one, in pull order. */
  fights: DeployableFight[];
  /** Every raider who laid one, busiest first. */
  night: (DeployableLane & { count: number; items: DeployableCount[] })[];
  /** Every device across the night, most-laid first. */
  totals: DeployableCount[];
  /**
   * Everything laid on a counted pull. Zero is ambiguous and the page has to
   * say so — a report imported before these five were tracked holds none, and
   * so does a night nobody laid one on. Only a re-import tells them apart.
   */
  total: number;
  /**
   * Who laid nothing, boss by boss.
   *
   * **Only the pulls something went down on, and so only the bosses.** Where
   * not one raider laid anything the list is the raid roster, which says
   * nothing about any raider in it — the kit wasn't wanted, or the pull was a
   * reset, or (§1) this report predates the tracking. A pull somebody laid one
   * on is a pull where the question "and why not you" has an answer.
   */
  silence: DeployableSilence[];
}

function countsOf(map: Map<string, number>): DeployableCount[] {
  return [...map]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || compareText(a.name, b.name));
}

export interface DeployableInput {
  /** Pull rows — already filtered to the pulls that count. */
  rows: WclPlayerFight[];
  /** Lowercased actor name → roster slug, for deep-linking matched raiders. */
  slugByActor?: Map<string, string>;
  /**
   * Lowercased actor name → the professions the ROSTER records, hand-entered.
   *
   * Absent for a raider nobody has filled in, which is the normal state and
   * must read as "unknown", never as "no professions" — an unrecorded engineer
   * simply doesn't appear on the engineering list.
   */
  professionsByActor?: Map<string, readonly Profession[]>;
}

/** The devices a raider can only lay by holding the profession. */
const ENGINEERING_DEVICES = deployableLabelsFor("Engineering");

interface EncounterActor {
  name: string;
  pulls: number;
  className?: string;
  laid: Map<string, number>;
}

interface EncounterTally {
  encounterId: number;
  encounterName: string;
  /** First pull of it, so the boss list stays in the order the raid met them. */
  firstFightId: number;
  fightIds: Set<number>;
  actors: Map<string, EncounterActor>;
  total: number;
}

export function buildDeployableView(input: DeployableInput): RaidDeployableView {
  const slugOf = (name: string) => input.slugByActor?.get(name.toLowerCase());
  const professionsOf = (name: string) => input.professionsByActor?.get(name.toLowerCase()) ?? [];

  const lanesByFight = new Map<number, Map<string, DeployableLane>>();
  const perFightTotals = new Map<number, Map<string, number>>();
  const nightByActor = new Map<string, DeployableLane & { count: number; items: Map<string, number> }>();
  const nightTotals = new Map<string, number>();
  const byEncounter = new Map<number, EncounterTally>();
  let total = 0;

  // Which pulls anybody laid anything on. The silence list counts only these,
  // and it has to know before it starts counting presence — see the note on
  // `DeployableSilence`.
  const countedPulls = new Set(
    input.rows.filter((r) => r.castTimes.some((c) => c.deployable)).map((r) => r.fightId),
  );

  for (const row of input.rows) {
    if (!countedPulls.has(row.fightId)) continue;
    // Presence is read from the row itself, BEFORE anything is filtered on what
    // the raider laid — a row is a raider on a pull, and that is the only thing
    // that can tell "laid nothing" from "wasn't there".
    const enc = byEncounter.get(row.encounterId) ?? {
      encounterId: row.encounterId,
      encounterName: row.encounterName,
      firstFightId: row.fightId,
      fightIds: new Set<number>(),
      actors: new Map<string, EncounterActor>(),
      total: 0,
    };
    enc.firstFightId = Math.min(enc.firstFightId, row.fightId);
    enc.fightIds.add(row.fightId);
    const encActor = enc.actors.get(row.actorName) ?? {
      name: row.actorName,
      pulls: 0,
      ...(row.className ? { className: row.className } : {}),
      laid: new Map<string, number>(),
    };
    encActor.pulls++;
    for (const d of row.castTimes) {
      if (!d.deployable) continue;
      encActor.laid.set(d.name, (encActor.laid.get(d.name) ?? 0) + 1);
      enc.total++;
    }
    enc.actors.set(row.actorName, encActor);
    byEncounter.set(row.encounterId, enc);
  }

  for (const row of input.rows) {
    // The flag is what separates these from cooldowns and totems on the same
    // list — four of the five are also consumables, and reading them off
    // `otherCasts` instead would lose the timing this whole view is built on.
    const drops = row.castTimes.filter((c) => c.deployable);
    if (drops.length === 0) continue;

    const lanes = lanesByFight.get(row.fightId) ?? new Map<string, DeployableLane>();
    const slug = slugOf(row.actorName);
    const lane = lanes.get(row.actorName) ?? {
      name: row.actorName,
      ...(slug ? { slug } : {}),
      ...(row.className ? { className: row.className } : {}),
      drops: [],
    };
    const fightTotals = perFightTotals.get(row.fightId) ?? new Map<string, number>();
    const night =
      nightByActor.get(row.actorName) ??
      {
        name: row.actorName,
        ...(slug ? { slug } : {}),
        ...(row.className ? { className: row.className } : {}),
        drops: [],
        count: 0,
        items: new Map<string, number>(),
      };

    for (const d of drops) {
      lane.drops.push({ name: d.name, atMs: d.atMs });
      fightTotals.set(d.name, (fightTotals.get(d.name) ?? 0) + 1);
      nightTotals.set(d.name, (nightTotals.get(d.name) ?? 0) + 1);
      night.count++;
      night.items.set(d.name, (night.items.get(d.name) ?? 0) + 1);
      total++;
    }
    lane.drops.sort((a, b) => a.atMs - b.atMs || compareText(a.name, b.name));
    lanes.set(row.actorName, lane);
    lanesByFight.set(row.fightId, lanes);
    perFightTotals.set(row.fightId, fightTotals);
    nightByActor.set(row.actorName, night);
  }

  const fights: DeployableFight[] = [...lanesByFight]
    .map(([fightId, lanes]) => {
      const laneList = [...lanes.values()].sort(
        (a, b) => b.drops.length - a.drops.length || compareText(a.name, b.name),
      );
      return {
        fightId,
        lanes: laneList,
        totals: countsOf(perFightTotals.get(fightId) ?? new Map()),
        total: laneList.reduce((sum, l) => sum + l.drops.length, 0),
        raiders: laneList.length,
      };
    })
    .sort((a, b) => a.fightId - b.fightId);

  const night = [...nightByActor.values()]
    .map(({ items, ...rest }) => ({ ...rest, items: countsOf(items) }))
    .sort((a, b) => b.count - a.count || compareText(a.name, b.name));

  const silence: DeployableSilence[] = [...byEncounter.values()]
    // A boss with no counted pulls holds no entry by now; the guard stays
    // because the list it protects is the one read as an accusation.
    .filter((enc) => enc.total > 0)
    .sort((a, b) => a.firstFightId - b.firstFightId)
    .map((enc) => {
      const abstainer = (a: EncounterActor): DeployableAbstainer => {
        const slug = slugOf(a.name);
        const engineer = professionsOf(a.name).includes("Engineering");
        return {
          name: a.name,
          ...(slug ? { slug } : {}),
          ...(a.className ? { className: a.className } : {}),
          pulls: a.pulls,
          laid: countsOf(a.laid),
          ...(engineer ? { engineer: true } : {}),
        };
      };
      const actors = [...enc.actors.values()];
      const rank = (a: DeployableAbstainer, b: DeployableAbstainer) =>
        b.pulls - a.pulls || compareText(a.name, b.name);
      return {
        encounterId: enc.encounterId,
        encounterName: enc.encounterName,
        pulls: enc.fightIds.size,
        raiders: actors.length,
        total: enc.total,
        silent: actors.filter((a) => a.laid.size === 0).map(abstainer).sort(rank),
        engineers: actors
          .filter((a) => professionsOf(a.name).includes("Engineering"))
          .filter((a) => ![...a.laid.keys()].some((name) => ENGINEERING_DEVICES.has(name)))
          .map(abstainer)
          .sort(rank),
      };
    });

  return { fights, night, totals: countsOf(nightTotals), total, silence };
}
