import { dispelAbilityOf, type DispelKind } from "@/lib/wcl/dispels";
import type { WclPlayerFight, WclPlayerOffPull } from "@/lib/types";
import { compareText } from "@/lib/sort";

/**
 * Who cleansed what off whom — per boss pull, and per instance for the trash.
 *
 * Pure: rows in, view out. Two questions the council actually asks, and they
 * want different shapes:
 *
 *  - **On a pull**, the answer is a timeline. "Ten decurses on Archimonde" says
 *    nothing; the same ten with names and timestamps say which mage was
 *    covering and whether anybody sat under Grip of the Legion for twenty
 *    seconds. Same shape as the totem lanes, for the same reason.
 *  - **On trash**, the answer is a count, per instance. A raid night is over a
 *    hundred trash segments, so a timeline of them is unreadable — and a night
 *    that clears Mount Hyjal and Black Temple is two different jobs, which one
 *    number for the night hides completely.
 *
 * Nothing here is scored. What a raid *should* dispel is a judgement about
 * assignments, not a fact in a log, so this view reports and stays quiet — see
 * AGENTS.md invariant 5.
 */

/** A raider, with the roster deep-link when their name matched somebody. */
export interface DispelActor {
  name: string;
  slug?: string;
  className?: string;
}

/** One removal inside a pull, ready to draw on a lane. */
export interface DispelMoment {
  /** ms from the pull start. */
  atMs: number;
  spell: string;
  /** Curated school, absent for a dispel nobody has named yet. */
  kind?: DispelKind;
  /** Who it came off — a raider, a pet, or an enemy for an offensive strip. */
  target: string;
  targetSlug?: string;
  /** The aura removed, as the log named it. */
  removed: string;
  /** A buff stripped off an enemy rather than a debuff off a friendly. */
  offensive: boolean;
}

export interface DispelLane extends DispelActor {
  moments: DispelMoment[];
}

export interface DispelCount {
  name: string;
  count: number;
}

/** One boss pull's dispelling. Pulls where nobody dispelled are left out. */
export interface DispelFight {
  fightId: number;
  lanes: DispelLane[];
  /** Auras removed on this pull, most-removed first. */
  removed: DispelCount[];
  total: number;
}

/** One dispeller's tally, split by the spell they pressed. */
export interface DispelTally extends DispelActor {
  count: number;
  /** Defensive removals — cleanses off our own raiders and pets. */
  cleanses: number;
  /** Buffs stripped off enemies (Purge, Spellsteal, Tranquilizing Shot). */
  strips: number;
  spells: DispelSpellCount[];
}

/** One spell a raider pressed, counted. */
export interface DispelSpellCount {
  /**
   * Stable identity, because `name` is **not** unique in this list.
   *
   * Mass Dispel has a friendly id and an enemy id and the log spells them
   * identically, so a raider who did both has two entries under one name. A
   * renderer keying on the name alone silently collapses them — which is
   * exactly what happened the first time this shipped.
   */
  id: string;
  name: string;
  /** Curated school; absent for an offensive strip and for a multi-school spell. */
  kind?: DispelKind;
  /** A buff stripped off an enemy rather than a debuff off a friendly. */
  offensive?: boolean;
  count: number;
}

/** Trash in one instance the raid pulled a boss in. */
export interface DispelZone {
  /** "Hyjal Summit", "Black Temple" — the instance, as Warcraft Logs names it. */
  zone: string;
  total: number;
  dispellers: DispelTally[];
  /** Auras removed on this zone's trash, most-removed first. */
  removed: DispelCount[];
}

export interface RaidDispelView {
  /** Boss pulls that had at least one dispel, in pull order. */
  fights: DispelFight[];
  /** Trash, per instance, biggest first. */
  zones: DispelZone[];
  /** Everyone who dispelled tonight, pulls and trash together. */
  night: (DispelTally & { onPulls: number; onTrash: number })[];
  /**
   * Dispels the curated list doesn't name, most frequent first — the curation
   * queue. They are **counted** all the same: the log named the spell, so the
   * only thing missing is a school and a class. Same bargain as an unplaced
   * elixir.
   */
  uncurated: DispelCount[];
  /**
   * Every dispel in the night, pulls and trash. Zero is the ambiguous case and
   * the page has to say so: a report imported before dispels were fetched holds
   * none, and so does a night nobody dispelled on. Only a re-import tells them
   * apart.
   */
  total: number;
}

interface TallyAcc {
  actor: DispelActor;
  count: number;
  cleanses: number;
  strips: number;
  spells: Map<string, DispelSpellCount>;
}

function tallyFor(into: Map<string, TallyAcc>, actor: DispelActor): TallyAcc {
  const existing = into.get(actor.name);
  if (existing) {
    existing.actor.className ??= actor.className;
    existing.actor.slug ??= actor.slug;
    return existing;
  }
  const fresh: TallyAcc = { actor: { ...actor }, count: 0, cleanses: 0, strips: 0, spells: new Map() };
  into.set(actor.name, fresh);
  return fresh;
}

function addToTally(
  acc: TallyAcc,
  spell: string,
  kind: DispelKind | undefined,
  offensive: boolean,
  count: number,
): void {
  acc.count += count;
  if (offensive) acc.strips += count;
  else acc.cleanses += count;
  /*
   * Keyed by name AND direction, because one name covers both: Mass Dispel has
   * a friendly id and an enemy id and the log spells them identically. Merged
   * on the name alone, a priest's three Enrage strips joined their twenty-six
   * cleanses under one "magic" chip that contradicted the columns beside it.
   */
  const key = `${spell}|${offensive}`;
  const entry =
    acc.spells.get(key) ??
    {
      id: key,
      name: spell,
      ...(kind ? { kind } : {}),
      ...(offensive ? { offensive: true } : {}),
      count: 0,
    };
  entry.count += count;
  acc.spells.set(key, entry);
}

function finishTally(acc: TallyAcc): DispelTally {
  return {
    ...acc.actor,
    count: acc.count,
    cleanses: acc.cleanses,
    strips: acc.strips,
    spells: [...acc.spells.values()].sort((a, b) => b.count - a.count || compareText(a.name, b.name)),
  };
}

function countsOf(map: Map<string, number>): DispelCount[] {
  return [...map]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || compareText(a.name, b.name));
}

function bump(map: Map<string, number>, key: string, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

/**
 * The school shown against a press.
 *
 * A curated dispel lists what it was *observed* removing, and one spell can
 * have removed two things (Cleanse took off both magic and poison here). The
 * board names the first rather than pretending to know which of the two this
 * press caught — the log does not say, and guessing would put a poison count
 * on a magic removal. An offensive strip has no school at all.
 */
function kindOf(spellId: number | undefined, offensive: boolean): DispelKind | undefined {
  if (offensive) return undefined;
  const removes = dispelAbilityOf(spellId)?.removes ?? [];
  return removes.length === 1 ? removes[0] : undefined;
}

export interface DispelInput {
  /** Pull rows — already filtered to the pulls that count. */
  rows: WclPlayerFight[];
  /**
   * Off-pull records, which carry the trash.
   *
   * Deliberately NOT filtered by the excluded-pull switch: trash belongs to no
   * pull, so excusing a farm wipe must not excuse the hour of decursing before
   * it. Same rule the gold table follows (change-chains §5).
   */
  offPull?: WclPlayerOffPull[];
  /** Lowercased actor name → roster slug, for deep-linking matched raiders. */
  slugByActor?: Map<string, string>;
}

export function buildDispelView(input: DispelInput): RaidDispelView {
  const { rows, offPull = [] } = input;
  const slugOf = (name: string) => input.slugByActor?.get(name.toLowerCase());
  const classByActor = new Map<string, string | undefined>();
  for (const r of rows) if (r.className) classByActor.set(r.actorName, r.className);

  const actorOf = (name: string): DispelActor => {
    const slug = slugOf(name);
    const className = classByActor.get(name);
    return { name, ...(slug ? { slug } : {}), ...(className ? { className } : {}) };
  };

  const uncurated = new Map<string, number>();
  const nightTallies = new Map<string, TallyAcc>();
  const onPulls = new Map<string, number>();
  const onTrash = new Map<string, number>();
  let total = 0;

  /* ---- Boss pulls: a lane per dispeller, in cast order ---- */
  const laneByFight = new Map<number, Map<string, DispelLane>>();
  const removedByFight = new Map<number, Map<string, number>>();
  for (const row of rows) {
    if (row.dispels.length === 0) continue;
    const lanes = laneByFight.get(row.fightId) ?? new Map<string, DispelLane>();
    const lane = lanes.get(row.actorName) ?? { ...actorOf(row.actorName), moments: [] };
    const removed = removedByFight.get(row.fightId) ?? new Map<string, number>();
    for (const d of row.dispels) {
      if (!dispelAbilityOf(d.spellId)) bump(uncurated, d.spell);
      const offensive = d.offensive === true;
      const kind = kindOf(d.spellId, offensive);
      const targetSlug = slugOf(d.target);
      lane.moments.push({
        atMs: d.atMs,
        spell: d.spell,
        ...(kind ? { kind } : {}),
        target: d.target,
        ...(targetSlug ? { targetSlug } : {}),
        removed: d.removed,
        offensive,
      });
      bump(removed, d.removed);
      addToTally(tallyFor(nightTallies, actorOf(row.actorName)), d.spell, kind, offensive, 1);
      bump(onPulls, row.actorName);
      total++;
    }
    lane.moments.sort((a, b) => a.atMs - b.atMs || compareText(a.target, b.target));
    lanes.set(row.actorName, lane);
    laneByFight.set(row.fightId, lanes);
    removedByFight.set(row.fightId, removed);
  }
  const fights: DispelFight[] = [...laneByFight]
    .map(([fightId, lanes]) => {
      const laneList = [...lanes.values()].sort(
        (a, b) => b.moments.length - a.moments.length || compareText(a.name, b.name),
      );
      return {
        fightId,
        lanes: laneList,
        removed: countsOf(removedByFight.get(fightId) ?? new Map()),
        total: laneList.reduce((sum, l) => sum + l.moments.length, 0),
      };
    })
    .sort((a, b) => a.fightId - b.fightId);

  /* ---- Trash, per instance ---- */
  const zoneTallies = new Map<string, Map<string, TallyAcc>>();
  const zoneRemoved = new Map<string, Map<string, number>>();
  const zoneTotal = new Map<string, number>();
  for (const off of offPull) {
    for (const d of off.trashDispels) {
      if (!dispelAbilityOf(d.spellId)) bump(uncurated, d.spell, d.count);
      const offensive = d.offensive === true;
      const kind = kindOf(d.spellId, offensive);
      const tallies = zoneTallies.get(d.zone) ?? new Map<string, TallyAcc>();
      addToTally(tallyFor(tallies, actorOf(off.actorName)), d.spell, kind, offensive, d.count);
      zoneTallies.set(d.zone, tallies);
      const removed = zoneRemoved.get(d.zone) ?? new Map<string, number>();
      bump(removed, d.removed, d.count);
      zoneRemoved.set(d.zone, removed);
      bump(zoneTotal, d.zone, d.count);
      addToTally(tallyFor(nightTallies, actorOf(off.actorName)), d.spell, kind, offensive, d.count);
      bump(onTrash, off.actorName, d.count);
      total += d.count;
    }
  }
  const zones: DispelZone[] = [...zoneTallies]
    .map(([zone, tallies]) => ({
      zone,
      total: zoneTotal.get(zone) ?? 0,
      dispellers: [...tallies.values()]
        .map(finishTally)
        .sort((a, b) => b.count - a.count || compareText(a.name, b.name)),
      removed: countsOf(zoneRemoved.get(zone) ?? new Map()),
    }))
    .sort((a, b) => b.total - a.total || compareText(a.zone, b.zone));

  const night = [...nightTallies.values()]
    .map((acc) => ({
      ...finishTally(acc),
      onPulls: onPulls.get(acc.actor.name) ?? 0,
      onTrash: onTrash.get(acc.actor.name) ?? 0,
    }))
    .sort((a, b) => b.count - a.count || compareText(a.name, b.name));

  return { fights, zones, night, uncurated: countsOf(uncurated), total };
}
