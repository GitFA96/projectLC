import { buildOf, type BuildInfo } from "@/lib/analysis/builds";

import { compareText } from "@/lib/sort";

/**
 * A rotation as a comparable profile — what was pressed, how often, and when.
 *
 * Deliberately class-agnostic and source-agnostic: a profile comes from a
 * logged pull or from a simulation, and every comparison lens works on both.
 * That's what makes "you vs the sim" and "you vs your teammate on this exact
 * pull" the same code path rather than two features.
 *
 * What this file does NOT do is decide what good looks like. It reports what
 * happened; naming a gap as a mistake needs class knowledge that lives in
 * curated tables, and often needs the sim (which knows the talent rules) to
 * say whether an ability was even available.
 */

export type ProfileSource = "log" | "sim";

/** One ability, as used across a whole fight. */
export interface RotationAbility {
  name: string;
  /** Times cast. Fractional for a sim, which averages over its iterations. */
  casts: number;
  /**
   * Damage this ability did over the whole fight, when the source knows.
   *
   * Casts alone rank a rotation by button presses, which flatters whatever is
   * spammed: 27 Heroic Strikes and 8 Bloodthirsts read as the Heroic Strike
   * being the bigger deal, and the damage says otherwise. Absent for abilities
   * that do none, and for a source that doesn't report it.
   */
  damage?: number;
  /**
   * True when the cast count is a stand-in rather than a count of cast events.
   *
   * Warcraft Logs doesn't emit a cast event for every ability — Execute did 35k
   * damage over 17 hits on a real pull and produced none at all — so an
   * ability's rate is sometimes its hit count. Marked, because "you pressed
   * this 17 times" and "this landed 17 times" are different claims.
   */
  estimated?: boolean;
}

/** One cast, placed in the fight. Negative for a sim's pre-pull actions. */
export interface RotationCast {
  tMs: number;
  name: string;
}

export interface RotationProfile {
  source: ProfileSource;
  /** Who/what this is — "Katzewarr · Void Reaver" or "Sim · 134s". */
  label: string;
  durationMs: number;
  abilities: RotationAbility[];
  /** Present when a cast-level timeline was available. */
  timeline?: RotationCast[];
  /** The talent split, when known — drives the comparability note. */
  build: BuildInfo;
  /** Damage per second over the fight, when the source reports it. */
  dps?: number;
}

/** A raw cast, before it becomes a profile. */
export interface CastEvent {
  tMs: number;
  name: string;
  /** Spell id when the source carried one — the bridge to a sim's vocabulary. */
  abilityId?: number;
}

function tally(casts: CastEvent[]): RotationAbility[] {
  const byName = new Map<string, number>();
  for (const c of casts) byName.set(c.name, (byName.get(c.name) ?? 0) + 1);
  return [...byName]
    .map(([name, n]) => ({ name, casts: n }))
    .sort((a, b) => b.casts - a.casts || compareText(a.name, b.name));
}

export function profileFromCasts(input: {
  label: string;
  durationMs: number;
  casts: CastEvent[];
  talents?: number[];
  dps?: number;
  /**
   * Damage per ability name, when the caller fetched it. Keyed by name rather
   * than id on purpose: Warcraft Logs reports a different Execute rank in its
   * damage table (20647) than the cast stream carries, and the name is the one
   * thing both sides agree on.
   */
  damageByName?: Record<string, number>;
  /** Landed hits per ability — the fallback rate for abilities with no casts. */
  hitsByName?: Record<string, number>;
  /**
   * When each ability landed, for the ones the cast stream has nothing for.
   * Same rule as the rate: casts win where they exist, because a Bloodthirst
   * that hits three targets is one decision and three marks would be a lie.
   */
  damageTimesByName?: Record<string, number[]>;
}): RotationProfile {
  const casts = [...input.casts].sort((a, b) => a.tMs - b.tMs);
  const damage = input.damageByName ?? {};
  const abilities = tally(casts).map((x) =>
    damage[x.name] === undefined ? x : { ...x, damage: damage[x.name] },
  );
  /*
   * Damage from something with no cast event of its own — a bleed ticking, a
   * proc, or an ability WCL simply doesn't log casts for. It did damage on this
   * pull, and leaving it out both loses the row and makes the column not add up.
   *
   * Its rate comes from landed hits, marked as an estimate: reporting 0 casts
   * for an Execute that hit seventeen times reads as "never pressed", which is
   * the opposite of what happened.
   */
  const hits = input.hitsByName ?? {};
  const extra = Object.entries(damage)
    .filter(([name, total]) => total > 0 && !abilities.some((x) => x.name === name))
    .map(([name, total]) => ({
      name,
      casts: hits[name] ?? 0,
      damage: total,
      ...(hits[name] ? { estimated: true } : {}),
    }));

  /*
   * Marks for abilities with no cast events. Without these the timeline was
   * quietly incomplete in exactly the places the table had just started showing
   * data: Execute, the bleeds, and every white swing had a row above and an
   * empty lane below.
   */
  const cast = new Set(casts.map((c) => c.name));
  const extraCasts: CastEvent[] = Object.entries(input.damageTimesByName ?? {})
    .filter(([name]) => !cast.has(name))
    .flatMap(([name, times]) => times.map((tMs) => ({ tMs, name })));

  return {
    source: "log",
    label: input.label,
    durationMs: input.durationMs,
    abilities: [...abilities, ...extra],
    timeline: [...casts, ...extraCasts].sort((x, y) => x.tMs - y.tMs),
    build: buildOf(input.talents),
    dps: input.dps,
  };
}

/** How much of a fight was spent actually pressing buttons. */
export interface Activity {
  durationMs: number;
  /** Time inside gaps long enough to count as not attacking. */
  idleMs: number;
  /** 0–100, one decimal. */
  activePct: number;
  /** The gaps themselves, longest first — where the downtime went. */
  gaps: { fromMs: number; toMs: number; ms: number }[];
}

/**
 * Downtime from the cast timeline.
 *
 * A simulation never stops attacking, so raw DPS against it is unfair on any
 * fight with a phase, a knockback or a target swap. Splitting "did you press
 * the right buttons" from "were you able to press anything at all" makes both
 * answerable: a rotation can be perfect and the DPS still low because a third
 * of the pull was spent running.
 *
 * A gap counts as idle only past `idleGapMs` — a global cooldown plus latency
 * is normal spacing, not downtime. The default is deliberately generous so
 * ordinary play never reads as slacking. Time before the first cast and after
 * the last counts too: an opener that starts eight seconds late is real lost
 * time, not an absence of data.
 */
export function activity(casts: CastEvent[], durationMs: number, idleGapMs = 3000): Activity {
  if (durationMs <= 0) return { durationMs: 0, idleMs: 0, activePct: 0, gaps: [] };
  const times = casts.map((c) => c.tMs).sort((a, b) => a - b);
  const gaps: Activity["gaps"] = [];

  const consider = (fromMs: number, toMs: number) => {
    const ms = toMs - fromMs;
    if (ms > idleGapMs) gaps.push({ fromMs, toMs, ms });
  };

  if (times.length === 0) {
    consider(0, durationMs);
  } else {
    consider(0, times[0]);
    for (let i = 1; i < times.length; i++) consider(times[i - 1], times[i]);
    consider(times[times.length - 1], durationMs);
  }

  const idleMs = gaps.reduce((sum, g) => sum + g.ms, 0);
  return {
    durationMs,
    idleMs,
    activePct: Math.round(Math.max(0, 1 - idleMs / durationMs) * 1000) / 10,
    gaps: gaps.sort((a, b) => b.ms - a.ms),
  };
}

/** Casts per minute — the only honest way to line up fights of different lengths. */
export function perMinute(casts: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return Math.round((casts / (durationMs / 60000)) * 10) / 10;
}

/** One ability across two profiles. */
export interface AbilityDelta {
  name: string;
  aCasts: number;
  bCasts: number;
  aPerMin: number;
  bPerMin: number;
  /** b − a, per minute. Positive means the second profile pressed it more. */
  perMinDelta: number;
  /** Share of all casts, each side, as percentages. */
  aShare: number;
  bShare: number;
  /** Damage over the fight, each side; undefined when that side has none. */
  aDamage?: number;
  bDamage?: number;
  /** Share of the side's total damage, as percentages. */
  aDamageShare: number;
  bDamageShare: number;
  /** The logged rate is a hit count, not a count of cast events. */
  aEstimated?: boolean;
}

export interface OpenerStep {
  index: number;
  a?: RotationCast;
  b?: RotationCast;
  /** True when both sides pressed the same thing at this position. */
  match: boolean;
}

export interface RotationComparison {
  a: RotationProfile;
  b: RotationProfile;
  abilities: AbilityDelta[];
  /** First N casts side by side — the part of a timeline that IS comparable. */
  opener: OpenerStep[];
  /** How far into the opener the two agreed, before the first divergence. */
  openerMatchedSteps: number;
}

function share(casts: number, total: number): number {
  return total <= 0 ? 0 : Math.round((casts / total) * 1000) / 10;
}

/**
 * Line two profiles up. Rate-normalised, because fight lengths differ and
 * comparing raw counts across a 134s and a 156s pull invents a gap.
 *
 * Ordered by the size of the per-minute difference: the abilities that actually
 * separate the two runs float to the top, which is the whole question.
 */
export function compareRotations(a: RotationProfile, b: RotationProfile, openerSteps = 12): RotationComparison {
  const names = new Set([...a.abilities.map((x) => x.name), ...b.abilities.map((x) => x.name)]);
  const aBy = new Map(a.abilities.map((x) => [x.name, x.casts]));
  const bBy = new Map(b.abilities.map((x) => [x.name, x.casts]));
  const aEst = new Set(a.abilities.filter((x) => x.estimated).map((x) => x.name));
  const aDmg = new Map(a.abilities.flatMap((x) => (x.damage ? [[x.name, x.damage] as const] : [])));
  const bDmg = new Map(b.abilities.flatMap((x) => (x.damage ? [[x.name, x.damage] as const] : [])));
  const aTotal = a.abilities.reduce((s, x) => s + x.casts, 0);
  const bTotal = b.abilities.reduce((s, x) => s + x.casts, 0);
  const aDmgTotal = a.abilities.reduce((s, x) => s + (x.damage ?? 0), 0);
  const bDmgTotal = b.abilities.reduce((s, x) => s + (x.damage ?? 0), 0);

  const abilities: AbilityDelta[] = [...names]
    .map((name) => {
      const aCasts = aBy.get(name) ?? 0;
      const bCasts = bBy.get(name) ?? 0;
      const aPerMin = perMinute(aCasts, a.durationMs);
      const bPerMin = perMinute(bCasts, b.durationMs);
      return {
        name,
        aCasts,
        bCasts,
        aPerMin,
        bPerMin,
        perMinDelta: Math.round((bPerMin - aPerMin) * 10) / 10,
        aShare: share(aCasts, aTotal),
        bShare: share(bCasts, bTotal),
        ...(aDmg.has(name) ? { aDamage: aDmg.get(name) } : {}),
        ...(bDmg.has(name) ? { bDamage: bDmg.get(name) } : {}),
        aDamageShare: share(aDmg.get(name) ?? 0, aDmgTotal),
        bDamageShare: share(bDmg.get(name) ?? 0, bDmgTotal),
        ...(aEst.has(name) ? { aEstimated: true } : {}),
      };
    })
    .sort((x, y) => Math.abs(y.perMinDelta) - Math.abs(x.perMinDelta) || compareText(x.name, y.name));

  const aOpen = a.timeline ?? [];
  const bOpen = b.timeline ?? [];
  const steps = Math.min(openerSteps, Math.max(aOpen.length, bOpen.length));
  const opener: OpenerStep[] = [];
  for (let i = 0; i < steps; i++) {
    const x = aOpen[i];
    const y = bOpen[i];
    opener.push({ index: i, a: x, b: y, match: x !== undefined && y !== undefined && x.name === y.name });
  }
  let matched = 0;
  for (const step of opener) {
    if (!step.match) break;
    matched++;
  }

  return { a, b, abilities, opener, openerMatchedSteps: matched };
}
