import type { RotationAbility, RotationCast, RotationProfile } from "@/lib/analysis/rotation";
import { buildOf } from "@/lib/analysis/builds";
import { refKey, refLabel, type AbilityRef } from "@/lib/items/ability-data";

/**
 * Reading a wowsims RaidSimResult back into the same shape a logged pull
 * produces, so one comparison engine serves both.
 *
 * The sim speaks in ids; Warcraft Logs speaks in ability names. Rather than
 * curate a spell table (a list that rots and that we'd be guessing at), names
 * are supplied by the caller from the very pull being compared — its cast
 * events carry both the id and the name. Same trick the app already uses for
 * enchant names: learn the dictionary from the guild's own data, and where it
 * doesn't reach, show the id rather than invent a label.
 *
 * Ids carry their kind everywhere below. wowsims reports both `{spellId}` and
 * `{itemId}` actions — sappers, Bloodlust Brooch — and the two spaces overlap,
 * so an id on its own names the wrong thing about as often as the right one.
 */

/** wowsims ActionID — exactly one of these is meaningful. */
interface ActionId {
  spellId?: number;
  itemId?: number;
  otherId?: string | number;
}

/** Ability names keyed by `refKey` ("spell:30335"), never by bare id. */
export type NameBook = Record<string, string>;

/** A labelled sim action, with what to look up when the label is just an id. */
export interface SimAction {
  label: string;
  /** Absent for wowsims' own bookkeeping actions, which have nothing to look up. */
  ref?: AbilityRef;
}

interface TargetedActionMetrics {
  casts?: number;
  damage?: number;
}

interface ActionMetrics {
  id?: ActionId;
  targets?: TargetedActionMetrics[];
}

interface UnitMetrics {
  name?: string;
  dps?: { avg?: number; stdev?: number };
  actions?: ActionMetrics[];
}

export interface RaidSimResult {
  raidMetrics?: { parties?: { players?: UnitMetrics[] }[] };
  logs?: string;
  iterationsDone?: number;
  avgIterationDuration?: number;
  error?: unknown;
}

/**
 * Actions the sim reports that aren't rotation decisions: the bookkeeping
 * entries for resource generation, and movement. Keeping them would drown the
 * comparison in rows a player never chose to press.
 *
 * White swings are NOT in here. Nobody chooses them, but they're a third of a
 * warrior's damage — dropping them left the damage column adding up to two
 * thirds of the fight with nothing saying why. Their cast count is a real
 * signal too: swings per minute is uptime and haste, and the sim's is the
 * ceiling.
 */
const NON_ROTATION_OTHER_IDS = new Set([
  "OtherActionMove",
  "OtherActionWait",
  "OtherActionRageGain",
  "OtherActionEnergyGain",
  "OtherActionManaGain",
  "OtherActionComboPoints",
  "OtherActionNone",
  "OtherActionPendingAction",
]);

/**
 * Things the sim counts that a player never decided to press.
 *
 * The house rule (docs/class-tracking) is that a metric earns a lane only if
 * the player chooses it pull by pull. Passive procs measure crit luck, and
 * stance toggles are churn — both would otherwise dominate this comparison,
 * because the sim emits them as casts while Warcraft Logs' cast events don't
 * carry them at all. Left in, Deep Wounds alone reads as ~50 casts/minute the
 * player "missed".
 *
 * Curated per class, like the tracking tables — extend it when adding a spec.
 */
const PASSIVE_PROC_SPELL_IDS = new Set([
  12867, // Deep Wounds, as wowsims ranks it
  12721, // Deep Wounds, as this guild's logs rank it
]);

/**
 * The same passive under any rank. Matching ids alone is fragile — wowsims and
 * Warcraft Logs pick different ranks of Deep Wounds (12867 vs 12721), so an id
 * list silently stops working the moment either side moves. Names are
 * rank-independent, which is why the uptime tracks match on them too.
 */
const PASSIVE_PROC_NAME = /^(deep wounds|ignite|holy shock heal)$/i;

/** Stance/aura/presence toggles: high volume, no upkeep meaning. */
const TOGGLE_NAME = /\b(stance|aura|presence|seal of the crusader)\b/i;

export function actionLabel(id: ActionId | undefined, names: NameBook): SimAction | undefined {
  if (!id) return undefined;
  if (id.otherId !== undefined) {
    const key = String(id.otherId);
    if (NON_ROTATION_OTHER_IDS.has(key)) return undefined;
    // Warcraft Logs calls the white swing "Melee"; match it so the two sides
    // land on one row instead of "Attack" beside "Melee".
    if (key === "OtherActionAttack") return { label: "Melee" };
    return { label: key.replace(/^OtherAction/, "") };
  }
  const ref: AbilityRef | undefined =
    id.spellId ? { kind: "spell", id: id.spellId } : id.itemId ? { kind: "item", id: id.itemId } : undefined;
  if (!ref) return undefined;
  if (ref.kind === "spell" && PASSIVE_PROC_SPELL_IDS.has(ref.id)) return undefined;
  const name = names[refKey(ref)];
  if (name && (TOGGLE_NAME.test(name) || PASSIVE_PROC_NAME.test(name))) return undefined;
  return { label: name ?? refLabel(ref), ref };
}

/** The player the individual sim ran — the only one in the raid. */
function soloPlayer(result: RaidSimResult): UnitMetrics | undefined {
  return result.raidMetrics?.parties?.[0]?.players?.[0];
}

/**
 * Parse the debug combat log into a timeline.
 *
 * Format, verified against a real run:
 *   [12.34] [Player (#1)] Casting {SpellID: 30335} (Cost = …)
 * Pre-pull actions carry negative timestamps, which we keep — the opener is
 * exactly where a timeline comparison is meaningful, and it starts before zero.
 */
export function parseSimTimeline(logs: string | undefined, names: NameBook): RotationCast[] {
  if (!logs) return [];
  const out: RotationCast[] = [];
  const line = /^\[(-?\d+(?:\.\d+)?)\]\s+\[Player[^\]]*\]\s+Casting\s+\{([^}]*)\}/;
  for (const raw of logs.split("\n")) {
    const m = line.exec(raw.trim());
    if (!m) continue;
    const tMs = Math.round(Number.parseFloat(m[1]) * 1000);
    const body = m[2];
    const spell = /SpellID:\s*(\d+)/.exec(body);
    const item = /ItemID:\s*(\d+)/.exec(body);
    const other = /OtherID:\s*(\d+)/.exec(body);
    let name: string | undefined;
    if (spell) name = actionLabel({ spellId: Number(spell[1]) }, names)?.label;
    // Item use-effects are cast lines too — sappers, Bloodlust Brooch. Without
    // this they had a row in the cast table and no mark on the timeline.
    else if (item) name = actionLabel({ itemId: Number(item[1]) }, names)?.label;
    else if (other) {
      /*
       * Numeric OtherIDs, read off a real debug log rather than guessed:
       * 3 is the auto-attack swing, and 20 is the distance tracker — it "casts"
       * at the instant movement speed jumps to 224% and its stacks fall 25 → 4,
       * i.e. yards left to the boss while intercepting. The swing is a real
       * event and earns its lane (it's a third of the damage); the tracker
       * isn't an action at all.
       */
      if (other[1] === "20") continue;
      name = other[1] === "3" ? "Melee" : `Other ${other[1]}`;
    }
    if (name) out.push({ tMs, name });
  }
  return collapseRepeats(out.sort((a, b) => a.tMs - b.tMs));
}

/**
 * One decision, one mark.
 *
 * wowsims writes a `Casting` line per weapon and per stage, so a single press
 * produces several: on a real pull Heroic Strike had 100 lines against the 48
 * casts the same run reported, appearing as pairs 0.0–0.1s apart (queued, then
 * consumed by the swing) and Whirlwind had exactly double (main hand and off
 * hand). Drawn raw, the timeline shows a rotation twice as busy as it was.
 *
 * Collapsing repeats of the same ability inside a window well under the global
 * cooldown keeps every real press and drops the echoes. Nothing in TBC can be
 * cast twice this fast, so nothing real is lost.
 */
const REPEAT_MS = 300;

function collapseRepeats(casts: RotationCast[]): RotationCast[] {
  const lastAt = new Map<string, number>();
  const out: RotationCast[] = [];
  for (const c of casts) {
    const previous = lastAt.get(c.name);
    if (previous !== undefined && c.tMs - previous < REPEAT_MS) continue;
    lastAt.set(c.name, c.tMs);
    out.push(c);
  }
  return out;
}

/**
 * Every action the sim actually used, with what to look it up as.
 *
 * The comparison shows names; naming them needs the id AND its kind, and the
 * kind is thrown away the moment a row becomes a label. Collected here so the
 * panel can offer a Wowhead lookup for every ability on screen, not only the
 * ones no log has ever named.
 */
export function simActionRefs(result: RaidSimResult, names: NameBook): { name: string; ref: AbilityRef }[] {
  const out = new Map<string, { name: string; ref: AbilityRef }>();
  for (const action of soloPlayer(result)?.actions ?? []) {
    const hit = actionLabel(action.id, names);
    if (!hit?.ref) continue;
    const casts = (action.targets ?? []).reduce((sum, t) => sum + (t.casts ?? 0), 0);
    if (casts <= 0) continue;
    out.set(refKey(hit.ref), { name: hit.label, ref: hit.ref });
  }
  return [...out.values()];
}

/** One line of a fight, either side: what happened and when. */
export interface TimedEvent {
  /** ms from the pull start; negative before it. */
  tMs: number;
  name: string;
  kind: "cast" | "damage";
  /** Damage dealt, for a damage line. */
  amount?: number;
}

/** Resolve "{SpellID: 29707, Tag: 1}" to an ability name. */
function labelOfBody(body: string, names: NameBook): string | undefined {
  const spell = /SpellID:\s*(\d+)/.exec(body);
  if (spell) return actionLabel({ spellId: Number(spell[1]) }, names)?.label;
  const item = /ItemID:\s*(\d+)/.exec(body);
  if (item) return actionLabel({ itemId: Number(item[1]) }, names)?.label;
  const other = /OtherID:\s*(\d+)/.exec(body);
  if (!other) return undefined;
  // 20 is the distance tracker, 3 the white swing — see parseSimTimeline.
  if (other[1] === "20") return undefined;
  return other[1] === "3" ? "Melee" : `Other ${other[1]}`;
}

/**
 * The sim's combat log as events, not just casts.
 *
 * Verified format, from a real run:
 *   [0.00] [Player (#1)] [Target 1] {ItemID: 23827} Hit for 1499.733 damage (…)
 *   [2.08] [Player (#1)] Casting {SpellID: 29707} (Cost = …)
 *
 * This is what makes the two sides comparable line by line. Warcraft Logs gives
 * a timestamped stream of casts and hits; until now the sim side of the panel
 * could only offer counts, so "what did the sim do at 40 seconds" had no answer.
 */
export function parseSimEvents(logs: string | undefined, names: NameBook): TimedEvent[] {
  if (!logs) return [];
  const out: TimedEvent[] = [];
  const castLine = /^\[(-?\d+(?:\.\d+)?)\]\s+\[Player[^\]]*\]\s+Casting\s+\{([^}]*)\}/;
  const hitLine =
    /^\[(-?\d+(?:\.\d+)?)\]\s+\[Player[^\]]*\]\s+\[[^\]]*\]\s+\{([^}]*)\}\s+\w+ for ([\d.]+) damage/;

  for (const raw of logs.split("\n")) {
    const line = raw.trim();
    const hit = hitLine.exec(line);
    if (hit) {
      const amount = Number.parseFloat(hit[3]);
      const name = labelOfBody(hit[2], names);
      // A zero-damage "hit" is a buff application the log phrases the same way.
      if (name && amount > 0) {
        out.push({ tMs: Math.round(Number.parseFloat(hit[1]) * 1000), name, kind: "damage", amount });
      }
      continue;
    }
    const cast = castLine.exec(line);
    if (!cast) continue;
    const name = labelOfBody(cast[2], names);
    if (name) out.push({ tMs: Math.round(Number.parseFloat(cast[1]) * 1000), name, kind: "cast" });
  }
  return out.sort((a, b) => a.tMs - b.tMs || a.kind.localeCompare(b.kind));
}

/**
 * Of several single-iteration runs, the one that best represents the average.
 *
 * A timeline has to be ONE pull — several drawn on top of each other is not a
 * rotation — but iteration one is whichever pull the seed happened to produce,
 * and on a 3,000-run spread that can be a lucky or an unlucky outlier. Running
 * a handful of seeds and keeping the one whose DPS lands closest to the mean
 * gives a pull that is both real and representative.
 */
export function representativeRun<T extends RaidSimResult>(
  runs: (T | undefined)[],
  targetDps: number,
): T | undefined {
  let best: T | undefined;
  let bestGap = Infinity;
  for (const run of runs) {
    const dps = simDpsOf(run);
    if (run === undefined || dps === undefined) continue;
    const gap = Math.abs(dps - targetDps);
    if (gap < bestGap) {
      bestGap = gap;
      best = run;
    }
  }
  return best;
}

/** The DPS a run reported — the mean over its iterations. */
export function simDpsOf(result: RaidSimResult | undefined): number | undefined {
  return result?.raidMetrics?.parties?.[0]?.players?.[0]?.dps?.avg;
}

export interface SimProfileOptions {
  label: string;
  /** refKey → ability name, learned from the pull being compared against. */
  names?: NameBook;
  /** Talents the sim ran with, for the comparability note. */
  talents?: number[];
  /** Falls back to the sim's own average iteration length. */
  durationMs?: number;
  /**
   * Combat log from the separate single-iteration run. Kept apart from the
   * averaged result on purpose — see SimOverrides.withTimeline.
   */
  timelineLogs?: string;
}

/**
 * A sim result as a RotationProfile. Cast counts are divided by the iteration
 * count, so they read as "per fight" exactly like a logged pull — the sim's raw
 * totals are summed across every iteration it ran.
 */
export function simProfile(result: RaidSimResult, opts: SimProfileOptions): RotationProfile {
  const names = opts.names ?? {};
  const player = soloPlayer(result);
  const iterations = Math.max(1, result.iterationsDone ?? 1);
  const durationMs =
    opts.durationMs ?? Math.round((result.avgIterationDuration ?? 0) * 1000) ?? 0;

  const byName = new Map<string, { casts: number; damage: number }>();
  for (const action of player?.actions ?? []) {
    const hit = actionLabel(action.id, names);
    if (!hit) continue;
    const targets = action.targets ?? [];
    const casts = targets.reduce((sum, t) => sum + (t.casts ?? 0), 0);
    // Damage summed over every target the action hit, then over iterations —
    // a cleave that lands on three mobs did all of it.
    const damage = targets.reduce((sum, t) => sum + (t.damage ?? 0), 0);
    if (casts <= 0 && damage <= 0) continue;
    const acc = byName.get(hit.label) ?? { casts: 0, damage: 0 };
    acc.casts += casts / iterations;
    acc.damage += damage / iterations;
    byName.set(hit.label, acc);
  }

  const abilities: RotationAbility[] = [...byName]
    .map(([name, x]) => ({
      name,
      casts: Math.round(x.casts * 10) / 10,
      ...(x.damage > 0 ? { damage: Math.round(x.damage) } : {}),
    }))
    .sort((a, b) => b.casts - a.casts || a.name.localeCompare(b.name));

  const timeline = parseSimTimeline(opts.timelineLogs ?? result.logs, names);

  return {
    source: "sim",
    label: opts.label,
    durationMs: durationMs > 0 ? durationMs : 1,
    abilities,
    timeline: timeline.length > 0 ? timeline : undefined,
    build: buildOf(opts.talents),
    dps: player?.dps?.avg === undefined ? undefined : Math.round(player.dps.avg),
  };
}
