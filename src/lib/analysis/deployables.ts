import type { WclPlayerFight } from "@/lib/types";
import { compareText } from "@/lib/sort";

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
}

export function buildDeployableView(input: DeployableInput): RaidDeployableView {
  const slugOf = (name: string) => input.slugByActor?.get(name.toLowerCase());

  const lanesByFight = new Map<number, Map<string, DeployableLane>>();
  const perFightTotals = new Map<number, Map<string, number>>();
  const nightByActor = new Map<string, DeployableLane & { count: number; items: Map<string, number> }>();
  const nightTotals = new Map<string, number>();
  let total = 0;

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

  return { fights, night, totals: countsOf(nightTotals), total };
}
