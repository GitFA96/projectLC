import { interruptAbilityOf, isHealingCast } from "@/lib/wcl/interrupts";
import type { WclEnemyCast, WclPlayerFight, WclPlayerOffPull } from "@/lib/types";
import { compareText } from "@/lib/sort";

/**
 * Who stopped which cast — per boss pull, per phase inside it, and per instance
 * for the trash.
 *
 * Pure: rows in, view out. Three shapes, because the council asks three
 * different questions and one number answers none of them:
 *
 *  - **On a pull**, the answer is a timeline plus a phase split. "Nineteen
 *    interrupts on Reliquary of Souls" says nothing; the same nineteen filed
 *    under "P2: Essence of Desire" say the rotation held for the phase that has
 *    one.
 *  - **On trash**, the answer is a count per instance. A night is over a
 *    hundred segments, and a night that clears Hyjal and Black Temple is two
 *    different jobs — 173 interrupts against 28 on the probed night.
 *  - **For the night**, the answer is per raider: who was actually on kick duty.
 *
 * Nothing here is scored, and the heal flag is a **label, not a verdict**. What
 * a raid should interrupt is an assignment the council makes, so this view
 * reports and stays quiet — AGENTS.md invariant 5.
 *
 * On a boss pull it also answers the other half — **what got through**. The
 * denominator is the enemy's own cast stream, fetched unfiltered for boss pulls
 * (`NormalizedEnemyCast`), so it is not narrowed to the casts we happened to
 * interrupt. That distinction is the whole reason it can be trusted: narrowing
 * it would have reported a clean sheet for exactly the caster nobody ever
 * kicked, which is the case an officer is looking for.
 *
 * Two honesty rules travel with that number.
 *
 * The arithmetic is **three-way, never two**: `started = landed + stopped +
 * unresolved`. The residual is a cast that neither finished nor was interrupted
 * by us — the mob died mid-cast, or it was cancelled. Folding it into "landed"
 * overstates what got through; folding it into "stopped" credits the raid for
 * something it did not do.
 *
 * And an ability is only called **interruptible** when this report shows it
 * being interrupted at least once. Otherwise the board says so instead of
 * implying a miss: most of what a boss casts cannot be interrupted at all, and
 * a column reading "0 stopped" against Archimonde's Fear would invent twenty
 * failures the log never claimed. This is the same epistemics as a dispel's
 * `removes` list — what was *observed*, never what a tooltip says.
 */

/** A raider, with the roster deep-link when their name matched somebody. */
export interface InterruptActor {
  name: string;
  slug?: string;
  className?: string;
}

/** One interrupt inside a pull, ready to draw on a lane. */
export interface InterruptMoment {
  /** ms from the pull start. */
  atMs: number;
  /** The interrupt as the log named it. */
  spell: string;
  /** The mob it was pressed on. */
  target: string;
  /** The cast that died, as the log named it. */
  stopped: string;
  /** The stopped cast was a heal. A label from the curated list, never a score. */
  healing: boolean;
  /** Warcraft Logs' own name for the phase — "P2: Essence of Desire". */
  phase?: string;
}

export interface InterruptLane extends InterruptActor {
  moments: InterruptMoment[];
}

export interface InterruptCount {
  name: string;
  count: number;
  /** This cast is a curated heal. */
  healing?: boolean;
}

/**
 * One phase of a pull, with what was stopped in it.
 *
 * Only phases that saw an interrupt appear. A phase with none is not evidence
 * of a miss — most phases have nothing interruptible in them — so listing every
 * phase at zero would read as a scoreboard of failures the log never claimed.
 */
export interface InterruptPhase {
  /** WCL's name, which already carries the guild's numbering: "P2: Essence of Desire". */
  name: string;
  total: number;
  /** What was stopped in this phase, most-stopped first. */
  stopped: InterruptCount[];
  /** Who pressed, most first. */
  interrupters: InterruptTally[];
}

/** One boss pull's interrupting. Pulls where nobody interrupted are left out. */
export interface InterruptFight {
  fightId: number;
  lanes: InterruptLane[];
  /** Who pressed on this pull, most first — the same table the phases carry. */
  interrupters: InterruptTally[];
  /**
   * What the enemy tried on this pull, biggest leak first.
   *
   * Empty on a report fetched before enemy casts were, which is not the same
   * statement as a boss that cast nothing — the board has to say which.
   */
  casts: EnemyCastRow[];
  /** Casts stopped on this pull, most-stopped first. */
  stopped: InterruptCount[];
  /**
   * The pull broken down by phase, in phase order — empty for an encounter with
   * no phases, which is most of them.
   */
  phases: InterruptPhase[];
  total: number;
  /** How many of them landed on a curated healing cast. */
  onHeals: number;
}

/** One interrupter's tally, split by the spell they pressed. */
export interface InterruptTally extends InterruptActor {
  count: number;
  /** Interrupts that landed on a curated healing cast. */
  onHeals: number;
  spells: InterruptSpellCount[];
}

/** One interrupt spell a raider pressed, counted. */
export interface InterruptSpellCount {
  name: string;
  /** WCL class for the spell, absent for one nobody has curated. */
  wowClass?: string;
  count: number;
}

/**
 * One enemy ability on one pull: what it tried, what landed, what we stopped.
 *
 * Only abilities with a cast bar appear — an instant had nothing to interrupt.
 */
export interface EnemyCastRow {
  /** The enemy, as the log named it. Several adds of one name are merged. */
  caster: string;
  ability: string;
  /** Cast bars started. */
  started: number;
  /** Cast bars that finished — what got through. */
  landed: number;
  /** Cast bars this raid interrupted. */
  stopped: number;
  /**
   * Started, but neither finished nor interrupted by us — the mob died in the
   * middle of it, or it was cancelled. Kept as its own number rather than
   * folded into either of the two above, both of which it would misstate.
   */
  unresolved: number;
  /** A curated healing cast. */
  healing?: boolean;
  /**
   * This raid interrupted this ability at least once **somewhere in this
   * report**, so it is provably interruptible and "landed" reads as a miss.
   *
   * Report-wide rather than per-pull on purpose: an ability kicked on the
   * second Illidari Council pull is just as interruptible on the third, and
   * scoping this per pull would let the pull where nobody pressed anything
   * excuse itself.
   */
  interruptible?: boolean;
}

/** Trash in one instance the raid pulled a boss in. */
export interface InterruptZone {
  /** "Hyjal Summit", "Black Temple" — the instance, as Warcraft Logs names it. */
  zone: string;
  total: number;
  onHeals: number;
  interrupters: InterruptTally[];
  /** Casts stopped on this zone's trash, most-stopped first. */
  stopped: InterruptCount[];
}

export interface RaidInterruptView {
  /** Boss pulls that had at least one interrupt, in pull order. */
  fights: InterruptFight[];
  /** Trash, per instance, biggest first. */
  zones: InterruptZone[];
  /** Everyone who interrupted tonight, pulls and trash together. */
  night: (InterruptTally & { onPulls: number; onTrash: number })[];
  /**
   * Interrupt spells the curated list doesn't name, most frequent first — the
   * curation queue. They are **counted** all the same: the log named the spell,
   * so the only thing missing is a class. Same bargain as an unplaced elixir.
   */
  uncurated: InterruptCount[];
  /**
   * Every interrupt in the night, pulls and trash. Zero is the ambiguous case
   * and the board has to say so: a report imported before interrupts were
   * fetched holds none, and so does a night nobody interrupted on. Only a
   * re-import tells them apart.
   */
  total: number;
  /** Of those, how many stopped a curated healing cast. */
  onHeals: number;
}

interface TallyAcc {
  actor: InterruptActor;
  count: number;
  onHeals: number;
  spells: Map<string, InterruptSpellCount>;
}

/** What one phase accumulates while the moments are walked in time order. */
interface PhaseAcc {
  total: number;
  stopped: Map<string, StoppedAcc>;
  tallies: Map<string, TallyAcc>;
}

/** A stopped cast's running count, carrying the heal label through. */
interface StoppedAcc {
  count: number;
  healing: boolean;
}

function tallyFor(into: Map<string, TallyAcc>, actor: InterruptActor): TallyAcc {
  const existing = into.get(actor.name);
  if (existing) {
    existing.actor.className ??= actor.className;
    existing.actor.slug ??= actor.slug;
    return existing;
  }
  const fresh: TallyAcc = { actor: { ...actor }, count: 0, onHeals: 0, spells: new Map() };
  into.set(actor.name, fresh);
  return fresh;
}

function addToTally(
  acc: TallyAcc,
  spellId: number | undefined,
  spell: string,
  healing: boolean,
  count: number,
): void {
  acc.count += count;
  if (healing) acc.onHeals += count;
  /*
   * Keyed on the curated NAME rather than the id, which is the opposite of what
   * the dispel board does and is deliberate. Earth Shock arrived under two ids
   * in a single night — rank 8042 once and rank 25454 ninety times — and they
   * are the same button. Keying on the id shows a shaman a mystery "Earth Shock
   * ×1" beside their real total. The curated entry is what collapses ranks; an
   * uncurated spell falls back to the log's own name, which is all there is.
   */
  const curated = interruptAbilityOf(spellId);
  const name = curated?.name ?? spell;
  const entry =
    acc.spells.get(name) ?? { name, ...(curated ? { wowClass: curated.wowClass } : {}), count: 0 };
  entry.count += count;
  acc.spells.set(name, entry);
}

function finishTally(acc: TallyAcc): InterruptTally {
  return {
    ...acc.actor,
    count: acc.count,
    onHeals: acc.onHeals,
    spells: [...acc.spells.values()].sort(
      (a, b) => b.count - a.count || compareText(a.name, b.name),
    ),
  };
}

/** Stopped-cast counts, carrying the heal label so the board can mark them. */
function countsOf(map: Map<string, StoppedAcc>): InterruptCount[] {
  return [...map]
    .map(([name, v]) => ({ name, count: v.count, ...(v.healing ? { healing: true } : {}) }))
    .sort((a, b) => b.count - a.count || compareText(a.name, b.name));
}

function bumpStopped(map: Map<string, StoppedAcc>, name: string, healing: boolean, by = 1): void {
  const entry = map.get(name) ?? { count: 0, healing };
  entry.count += by;
  entry.healing ||= healing;
  map.set(name, entry);
}

function bump(map: Map<string, number>, key: string, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

export interface InterruptInput {
  /** Pull rows — already filtered to the pulls that count. */
  rows: WclPlayerFight[];
  /**
   * Off-pull records, which carry the trash.
   *
   * Deliberately NOT filtered by the excluded-pull switch, the same rule the
   * dispel and gold views follow (change-chains §5): excusing a farm wipe must
   * not excuse the hour of kicking that came before it.
   */
  offPull?: WclPlayerOffPull[];
  /** Lowercased actor name → roster slug, for deep-linking matched raiders. */
  slugByActor?: Map<string, string>;
  /**
   * Per-pull enemy cast tallies — the denominator.
   *
   * Boss pulls only, because only boss pulls were fetched. Trash interrupts
   * stay bare counts and the board must not imply otherwise.
   */
  enemyCasts?: WclEnemyCast[];
}

export function buildInterruptView(input: InterruptInput): RaidInterruptView {
  const { rows, offPull = [], enemyCasts = [] } = input;
  const slugOf = (name: string) => input.slugByActor?.get(name.toLowerCase());
  const classByActor = new Map<string, string | undefined>();
  for (const r of rows) if (r.className) classByActor.set(r.actorName, r.className);

  const actorOf = (name: string): InterruptActor => {
    const slug = slugOf(name);
    const className = classByActor.get(name);
    return { name, ...(slug ? { slug } : {}), ...(className ? { className } : {}) };
  };

  /**
   * (fightId, caster, stopped-ability) → how many we stopped, for joining onto
   * the enemy cast tallies below.
   *
   * Keyed on the ability NAME rather than its id, because that is the key both
   * sides are guaranteed to share: an interrupt row carries `stoppedId` only
   * when the log gave one, while an enemy cast row carries `abilityId` on the
   * same terms. The name is present on both, always.
   */
  const stoppedByCast = new Map<string, number>();
  /** Abilities this report shows being interrupted at least once, anywhere. */
  const everStopped = new Set<string>();
  const castKey = (fightId: number, caster: string, ability: string) =>
    `${fightId}|${caster}|${ability}`;

  const uncurated = new Map<string, number>();
  const nightTallies = new Map<string, TallyAcc>();
  const onPulls = new Map<string, number>();
  const onTrash = new Map<string, number>();
  let total = 0;
  let onHeals = 0;

  /* ---- Boss pulls: a lane per interrupter, plus the phase split ---- */
  const laneByFight = new Map<number, Map<string, InterruptLane>>();
  const stoppedByFight = new Map<number, Map<string, StoppedAcc>>();
  const healsByFight = new Map<number, number>();
  const phaseByFight = new Map<number, Map<string, PhaseAcc>>();

  for (const row of rows) {
    if (row.interrupts.length === 0) continue;
    const lanes = laneByFight.get(row.fightId) ?? new Map<string, InterruptLane>();
    const lane = lanes.get(row.actorName) ?? { ...actorOf(row.actorName), moments: [] };
    const stopped = stoppedByFight.get(row.fightId) ?? new Map<string, StoppedAcc>();
    for (const i of row.interrupts) {
      if (!interruptAbilityOf(i.spellId)) bump(uncurated, i.spell);
      const healing = isHealingCast(i.stoppedId);
      lane.moments.push({
        atMs: i.atMs,
        spell: i.spell,
        target: i.target,
        stopped: i.stopped,
        healing,
        ...(i.phase ? { phase: i.phase } : {}),
      });
      bumpStopped(stopped, i.stopped, healing);
      bump(stoppedByCast, castKey(row.fightId, i.target, i.stopped));
      everStopped.add(i.stopped);
      addToTally(tallyFor(nightTallies, actorOf(row.actorName)), i.spellId, i.spell, healing, 1);
      bump(onPulls, row.actorName);
      total++;
      if (healing) {
        onHeals++;
        healsByFight.set(row.fightId, (healsByFight.get(row.fightId) ?? 0) + 1);
      }
    }
    lane.moments.sort((a, b) => a.atMs - b.atMs || compareText(a.target, b.target));
    lanes.set(row.actorName, lane);
    laneByFight.set(row.fightId, lanes);
    stoppedByFight.set(row.fightId, stopped);
  }

  /*
   * The phase split needs a second pass, because a lane belongs to one raider
   * while a phase belongs to the pull. Walking every moment of a pull in TIME
   * order is the only order the phases come out right in — and it is also why
   * the Map below is left insertion-ordered rather than sorted: sorting on the
   * name would file "Intermission One" ahead of "P1" and silently reorder every
   * phased encounter.
   */
  for (const [fightId, lanes] of laneByFight) {
    const inTimeOrder = [...lanes.values()]
      .flatMap((lane) => lane.moments.map((m) => ({ m, actor: lane as InterruptActor })))
      .sort((a, b) => a.m.atMs - b.m.atMs || compareText(a.actor.name, b.actor.name));
    const phases = new Map<string, PhaseAcc>();
    for (const { m, actor } of inTimeOrder) {
      /*
       * A moment before the encounter's first phase transition belongs to no
       * phase. The log gave no boundary there, and inventing one would file a
       * pull's opening seconds under P1 on the strength of nothing.
       */
      if (!m.phase) continue;
      const acc = phases.get(m.phase) ?? { total: 0, stopped: new Map(), tallies: new Map() };
      acc.total++;
      bumpStopped(acc.stopped, m.stopped, m.healing);
      /*
       * No spell id here — the lane keeps the log's name and drops the id — so
       * ranks are not collapsed inside a phase table. That is the right trade:
       * a phase table answers "who was covering this phase", while the night
       * table above is where a shaman's two Earth Shock ranks are already added
       * up on the id.
       */
      addToTally(tallyFor(acc.tallies, actor), undefined, m.spell, m.healing, 1);
      phases.set(m.phase, acc);
    }
    if (phases.size > 0) phaseByFight.set(fightId, phases);
  }

  /*
   * The denominator, joined per pull.
   *
   * `unresolved` is clamped at zero rather than trusted blindly. Across all 41
   * (pull, caster, ability) rows of the probed night it never went negative, but
   * a negative would mean the two streams disagree — and a table showing "-2
   * unresolved" teaches an officer to distrust the whole board, while a zero
   * quietly understates one row.
   */
  const castsByFight = new Map<number, EnemyCastRow[]>();
  for (const c of enemyCasts) {
    const stopped = stoppedByCast.get(castKey(c.fightId, c.caster, c.ability)) ?? 0;
    const row: EnemyCastRow = {
      caster: c.caster,
      ability: c.ability,
      started: c.started,
      landed: c.landed,
      stopped,
      unresolved: Math.max(0, c.started - c.landed - stopped),
      ...(isHealingCast(c.abilityId) ? { healing: true } : {}),
      ...(everStopped.has(c.ability) ? { interruptible: true } : {}),
    };
    const list = castsByFight.get(c.fightId) ?? [];
    list.push(row);
    castsByFight.set(c.fightId, list);
  }
  for (const list of castsByFight.values()) {
    /*
     * Biggest leak first: this table is read to find what got through, so
     * `landed` leads and the abilities we know are interruptible break ties
     * ahead of the ones that may not be.
     */
    list.sort(
      (x, y) =>
        y.landed - x.landed ||
        Number(y.interruptible ?? false) - Number(x.interruptible ?? false) ||
        y.started - x.started ||
        compareText(x.caster, y.caster) ||
        compareText(x.ability, y.ability),
    );
  }

  const fights: InterruptFight[] = [...laneByFight]
    .map(([fightId, lanes]) => {
      const laneList = [...lanes.values()].sort(
        (a, b) => b.moments.length - a.moments.length || compareText(a.name, b.name),
      );
      /*
       * The pull's own interrupter table, built from the lanes rather than a
       * fourth accumulator. An unphased encounter has no phase table to carry
       * this, and the Illidari Council — four casters, no WCL phases — is
       * exactly the pull an officer wants it on.
       */
      const pullTallies = new Map<string, TallyAcc>();
      for (const lane of laneList) {
        for (const m of lane.moments) {
          addToTally(tallyFor(pullTallies, lane), undefined, m.spell, m.healing, 1);
        }
      }
      return {
        fightId,
        lanes: laneList,
        interrupters: [...pullTallies.values()]
          .map(finishTally)
          .sort((x, y) => y.count - x.count || compareText(x.name, y.name)),
        casts: castsByFight.get(fightId) ?? [],
        stopped: countsOf(stoppedByFight.get(fightId) ?? new Map()),
        phases: [...(phaseByFight.get(fightId) ?? new Map<string, PhaseAcc>())].map(
          ([name, acc]) => ({
            name,
            total: acc.total,
            stopped: countsOf(acc.stopped),
            interrupters: [...acc.tallies.values()]
              .map(finishTally)
              .sort((a, b) => b.count - a.count || compareText(a.name, b.name)),
          }),
        ),
        total: laneList.reduce((sum, l) => sum + l.moments.length, 0),
        onHeals: healsByFight.get(fightId) ?? 0,
      };
    })
    .sort((a, b) => a.fightId - b.fightId);

  /* ---- Trash, per instance ---- */
  const zoneTallies = new Map<string, Map<string, TallyAcc>>();
  const zoneStopped = new Map<string, Map<string, StoppedAcc>>();
  const zoneTotal = new Map<string, number>();
  const zoneHeals = new Map<string, number>();
  for (const off of offPull) {
    for (const i of off.trashInterrupts) {
      if (!interruptAbilityOf(i.spellId)) bump(uncurated, i.spell, i.count);
      const healing = isHealingCast(i.stoppedId);
      const tallies = zoneTallies.get(i.zone) ?? new Map<string, TallyAcc>();
      addToTally(tallyFor(tallies, actorOf(off.actorName)), i.spellId, i.spell, healing, i.count);
      zoneTallies.set(i.zone, tallies);
      const stopped = zoneStopped.get(i.zone) ?? new Map<string, StoppedAcc>();
      bumpStopped(stopped, i.stopped, healing, i.count);
      zoneStopped.set(i.zone, stopped);
      bump(zoneTotal, i.zone, i.count);
      if (healing) {
        bump(zoneHeals, i.zone, i.count);
        onHeals += i.count;
      }
      addToTally(tallyFor(nightTallies, actorOf(off.actorName)), i.spellId, i.spell, healing, i.count);
      bump(onTrash, off.actorName, i.count);
      total += i.count;
    }
  }
  const zones: InterruptZone[] = [...zoneTallies]
    .map(([zone, tallies]) => ({
      zone,
      total: zoneTotal.get(zone) ?? 0,
      onHeals: zoneHeals.get(zone) ?? 0,
      interrupters: [...tallies.values()]
        .map(finishTally)
        .sort((a, b) => b.count - a.count || compareText(a.name, b.name)),
      stopped: countsOf(zoneStopped.get(zone) ?? new Map()),
    }))
    .sort((a, b) => b.total - a.total || compareText(a.zone, b.zone));

  const night = [...nightTallies.values()]
    .map((acc) => ({
      ...finishTally(acc),
      onPulls: onPulls.get(acc.actor.name) ?? 0,
      onTrash: onTrash.get(acc.actor.name) ?? 0,
    }))
    .sort((a, b) => b.count - a.count || compareText(a.name, b.name));

  return {
    fights,
    zones,
    night,
    uncurated: [...uncurated]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || compareText(a.name, b.name)),
    total,
    onHeals,
  };
}
