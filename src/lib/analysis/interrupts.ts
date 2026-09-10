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
 * On a boss pull it answers a third question, and this one is not read off the
 * interrupt stream at all: **what did we press that stopped nothing**. Warcraft
 * Logs emits an interrupt event only when a cast dies, so an unlanded press is
 * an ordinary cast that `normalize.ts` failed to pair with one. Three rules
 * travel with it.
 *
 * It is **boss pulls only**, because that is where the casts are fetched, so
 * the night and per-instance tables carry no press counts at all rather than
 * counts that silently omit the trash. It is **added to nothing that was here
 * before** — not `total`, not `onHeals`, not a stopped-cast tally — so every
 * existing number still counts a cast that actually died. And it is **not a
 * mistake the view names**: a press that cut nothing may have missed, or may
 * have been aimed at a window that had already closed, and the log cannot say
 * which. Whether it should have landed is the council's assignment to make.
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

/**
 * A press that stopped nothing, ready to draw beside the ones that did.
 *
 * No `stopped` and no heal flag, because there was no cast to name — and no
 * reason either. Warcraft Logs cannot say whether a press missed or connected
 * with nothing to interrupt (see `NormalizedUnlandedInterrupt`), so "pressed,
 * nothing stopped" is the entire claim this carries and the board must not
 * dress it up as a mistake. Whether a window was there to be hit is the same
 * assignment question invariant 5 keeps out of here.
 */
export interface InterruptAttempt {
  /** ms from the pull start. */
  atMs: number;
  /** The interrupt as the log named it. */
  spell: string;
  /** The mob it was pressed on, absent when the log named none. */
  target?: string;
  /** Warcraft Logs' own name for the phase. */
  phase?: string;
}

export interface InterruptLane extends InterruptActor {
  moments: InterruptMoment[];
  /**
   * Presses on this pull that cut no cast, in press order.
   *
   * Always empty on a report imported before presses were fetched, which is not
   * the same statement as a pull where every press landed — `RaidInterruptView.unlanded`
   * is what the board reads to tell those apart, and it can only do it for the
   * night as a whole.
   */
  unlanded: InterruptAttempt[];
}

export interface InterruptCount {
  name: string;
  count: number;
  /** This cast is a curated heal. */
  healing?: boolean;
}

/** Presses and landings, summed over whatever the caller is counting. */
export interface InterruptPresses {
  /**
   * Presses that cut no cast.
   *
   * Present only where presses are actually recorded — boss pulls and their
   * phases. **Absent is not zero:** the night and per-instance tables leave it
   * off because trash presses are not fetched at all, and a 0 there would claim
   * a clean sheet nothing measured.
   */
  unlanded?: number;
}

/**
 * One phase of a pull, with what was stopped in it.
 *
 * Only phases that saw an interrupt appear. A phase with none is not evidence
 * of a miss — most phases have nothing interruptible in them — so listing every
 * phase at zero would read as a scoreboard of failures the log never claimed.
 */
export interface InterruptPhase extends InterruptPresses {
  /** WCL's name, which already carries the guild's numbering: "P2: Essence of Desire". */
  name: string;
  total: number;
  /** What was stopped in this phase, most-stopped first. */
  stopped: InterruptCount[];
  /** Who pressed, most first. */
  interrupters: InterruptTally[];
}

/**
 * One boss pull's interrupting. Pulls where nobody pressed anything are left
 * out — but a pull where somebody pressed and stopped nothing is kept, because
 * that is the case an officer is looking for.
 */
export interface InterruptFight extends InterruptPresses {
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
export interface InterruptTally extends InterruptActor, InterruptPresses {
  count: number;
  /** Interrupts that landed on a curated healing cast. */
  onHeals: number;
  spells: InterruptSpellCount[];
}

/** One interrupt spell a raider pressed, counted. */
export interface InterruptSpellCount extends InterruptPresses {
  name: string;
  /** WCL class for the spell, absent for one nobody has curated. */
  wowClass?: string;
  /** Presses of it that cut a cast. */
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
  /** Boss pulls that saw a press, in pull order. */
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
  /**
   * Presses on boss pulls that stopped nothing, across the night.
   *
   * Zero is the ambiguous case again and the board has to say so: a report
   * imported before `INTERRUPT_CAST_IDS` reached the casts filter holds no
   * presses at all, and so does a night where every press landed. Only a
   * re-import tells them apart — and unlike the interrupts themselves this
   * cannot be recovered by curating anything, because the press is not in the
   * interrupt stream to begin with.
   *
   * Boss pulls only. Trash presses are not fetched, so the night and per-zone
   * tables carry no press counts at all rather than counts that quietly omit
   * most of the night.
   */
  unlanded: number;
}

interface TallyAcc {
  actor: InterruptActor;
  count: number;
  onHeals: number;
  unlanded: number;
  spells: Map<string, InterruptSpellCount>;
}

/** What one phase accumulates while the moments are walked in time order. */
interface PhaseAcc {
  total: number;
  unlanded: number;
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
  const fresh: TallyAcc = { actor: { ...actor }, count: 0, onHeals: 0, unlanded: 0, spells: new Map() };
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

/**
 * A press that stopped nothing, onto the same tally its landings are on.
 *
 * Keyed on the log's own name rather than the curated one, because this is only
 * ever called for a pull or a phase table — where `addToTally` is called with
 * no spell id and keys the landings the same way. Keying the two halves
 * differently would split one button into two rows on the same table.
 */
function addPressToTally(acc: TallyAcc, spell: string): void {
  acc.unlanded++;
  const entry = acc.spells.get(spell) ?? { name: spell, count: 0 };
  entry.unlanded = (entry.unlanded ?? 0) + 1;
  acc.spells.set(spell, entry);
}

/**
 * `presses` says whether this table is one where an unlanded press would have
 * been recorded. It is not the same question as whether there were any: a boss
 * pull where every press landed reports 0, while the night table — which
 * includes trash, where presses are not fetched — reports nothing at all rather
 * than a zero it cannot stand behind.
 */
function finishTally(acc: TallyAcc, presses = false): InterruptTally {
  return {
    ...acc.actor,
    count: acc.count,
    onHeals: acc.onHeals,
    ...(presses ? { unlanded: acc.unlanded } : {}),
    /*
     * Ordered by what LANDED, not by what was pressed — deliberately, because
     * the presses are a view the reader turns on and off. Ordering on them
     * would reshuffle the chips under the toggle and put a shaman's Earth Shock
     * above a rogue's Kick on the strength of 365 nukes.
     */
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
  let unlanded = 0;

  /* ---- Boss pulls: a lane per interrupter, plus the phase split ---- */
  const laneByFight = new Map<number, Map<string, InterruptLane>>();
  const stoppedByFight = new Map<number, Map<string, StoppedAcc>>();
  const healsByFight = new Map<number, number>();
  const phaseByFight = new Map<number, Map<string, PhaseAcc>>();

  for (const row of rows) {
    if (row.interrupts.length === 0) continue;
    const lanes = laneByFight.get(row.fightId) ?? new Map<string, InterruptLane>();
    const lane = lanes.get(row.actorName) ?? { ...actorOf(row.actorName), moments: [], unlanded: [] };
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
   * The presses that stopped nothing, onto the same lanes.
   *
   * A second pass rather than a branch inside the one above, because a raider
   * can appear here who appears nowhere in it: somebody who pressed nine
   * Pummels on the Illidari Council and stopped four is on both lists, and
   * somebody who pressed one and stopped none is on this one alone. Skipping
   * the second case would hide exactly the raider the toggle exists to show.
   *
   * They are NOT added to `total`, `onHeals` or any stopped-cast tally. Every
   * one of those counts a cast that died, and a press that cut nothing did not
   * kill one — the board's existing sentence "these are presses that landed"
   * stays true of every number that was there before this.
   */
  const unlandedByFight = new Map<number, number>();
  for (const row of rows) {
    if (row.unlandedInterrupts.length === 0) continue;
    const lanes = laneByFight.get(row.fightId) ?? new Map<string, InterruptLane>();
    const lane = lanes.get(row.actorName) ?? { ...actorOf(row.actorName), moments: [], unlanded: [] };
    for (const press of row.unlandedInterrupts) {
      lane.unlanded.push({
        atMs: press.atMs,
        spell: press.spell,
        ...(press.target ? { target: press.target } : {}),
        ...(press.phase ? { phase: press.phase } : {}),
      });
      unlanded++;
      unlandedByFight.set(row.fightId, (unlandedByFight.get(row.fightId) ?? 0) + 1);
    }
    lane.unlanded.sort((a, b) => a.atMs - b.atMs || compareText(a.spell, b.spell));
    lanes.set(row.actorName, lane);
    laneByFight.set(row.fightId, lanes);
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
      .flatMap((lane) => [
        ...lane.moments.map((m) => ({
          atMs: m.atMs,
          phase: m.phase,
          landed: m as InterruptMoment | undefined,
          spell: m.spell,
          actor: lane as InterruptActor,
        })),
        ...lane.unlanded.map((press) => ({
          atMs: press.atMs,
          phase: press.phase,
          landed: undefined,
          spell: press.spell,
          actor: lane as InterruptActor,
        })),
      ])
      .sort((a, b) => a.atMs - b.atMs || compareText(a.actor.name, b.actor.name));
    const phases = new Map<string, PhaseAcc>();
    for (const { phase, landed, spell, actor } of inTimeOrder) {
      /*
       * A moment before the encounter's first phase transition belongs to no
       * phase. The log gave no boundary there, and inventing one would file a
       * pull's opening seconds under P1 on the strength of nothing.
       */
      if (!phase) continue;
      const acc =
        phases.get(phase) ?? { total: 0, unlanded: 0, stopped: new Map(), tallies: new Map() };
      phases.set(phase, acc);
      /* A press that cut nothing raises the press count and nothing else. */
      if (!landed) {
        acc.unlanded++;
        addPressToTally(tallyFor(acc.tallies, actor), spell);
        continue;
      }
      acc.total++;
      bumpStopped(acc.stopped, landed.stopped, landed.healing);
      /*
       * No spell id here — the lane keeps the log's name and drops the id — so
       * ranks are not collapsed inside a phase table. That is the right trade:
       * a phase table answers "who was covering this phase", while the night
       * table above is where a shaman's two Earth Shock ranks are already added
       * up on the id.
       */
      addToTally(tallyFor(acc.tallies, actor), undefined, spell, landed.healing, 1);
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
        (a, b) =>
          b.moments.length - a.moments.length ||
          b.unlanded.length - a.unlanded.length ||
          compareText(a.name, b.name),
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
        for (const press of lane.unlanded) {
          addPressToTally(tallyFor(pullTallies, lane), press.spell);
        }
      }
      return {
        fightId,
        lanes: laneList,
        interrupters: [...pullTallies.values()]
          .map((acc) => finishTally(acc, true))
          .sort((x, y) => y.count - x.count || compareText(x.name, y.name)),
        casts: castsByFight.get(fightId) ?? [],
        stopped: countsOf(stoppedByFight.get(fightId) ?? new Map()),
        phases: [...(phaseByFight.get(fightId) ?? new Map<string, PhaseAcc>())].map(
          ([name, acc]) => ({
            name,
            total: acc.total,
            unlanded: acc.unlanded,
            stopped: countsOf(acc.stopped),
            interrupters: [...acc.tallies.values()]
              .map((tally) => finishTally(tally, true))
              .sort((a, b) => b.count - a.count || compareText(a.name, b.name)),
          }),
        ),
        total: laneList.reduce((sum, l) => sum + l.moments.length, 0),
        unlanded: unlandedByFight.get(fightId) ?? 0,
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
      /*
       * No press counts on trash: the casts are not fetched outside a boss
       * pull, so a zero here would be a clean sheet nothing measured.
       */
      interrupters: [...tallies.values()]
        .map((acc) => finishTally(acc))
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
    unlanded,
  };
}
