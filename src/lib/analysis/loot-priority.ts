import type {
  Character,
  ContentionWisher,
  LootPriority,
  LootPriorityAdjustment,
  LootPriorityFactor,
  LootPriorityWeights,
  RaiderMetrics,
} from "@/lib/types";
import type { CharacterStatus } from "@/lib/constants/wow";
import { DEFAULT_POLICY, type GuildPolicy } from "@/lib/analysis/policy";

import { compareText } from "@/lib/sort";

/**
 * "Who should get it?" — the council's shortlist, argued rather than decreed.
 *
 * A loot council's real problem isn't picking a winner, it's justifying one at
 * 22:40 with eight people listening. So this produces a number AND the four
 * facts behind it, each of which an officer can read off and defend:
 *
 *   Attendance   — they turned up for the raids that made the item drop.
 *   Loot owed    — relative to the best-fed contender this phase. Everyone at
 *                  zero scores full: nobody is punished for a quiet phase.
 *   Performance  — median parse percentile, the gear-earns-gear argument.
 *   Preparation  — flask and food up, the cheapest respect a raider can show.
 *
 * Two deliberate rules keep it honest:
 *
 *   A factor with no data DROPS OUT of the average instead of scoring zero. A
 *   raider with no parses yet is not thereby a bad raider, and the tool must
 *   not launder missing data into a verdict.
 *
 *   The score never decides. It orders a list and shows its work; the officer
 *   awards the item. Satisfied contenders are ranked out entirely — they
 *   already have it, so no score could be meaningful.
 *
 * The weights below are this guild's loot policy expressed as numbers. They're
 * the one thing here worth arguing about, and they're meant to be edited.
 */

export const LOOT_PRIORITY_WEIGHTS: LootPriorityWeights = DEFAULT_POLICY.weights;

/**
 * Roster standing as a multiplier rather than a fifth factor: it's a category,
 * not a percentage, and a main with mediocre metrics should still outrank an
 * alt with perfect ones.
 */
const STANDING_NOTE: Record<CharacterStatus, string | undefined> = {
  main: undefined,
  // No note by default, because the default multiplier is 1: the app has no
  // opinion on whether a trial should rank behind a main, and inventing one
  // would decide a council's trial policy for it. The note appears as soon as
  // they set the number — see GuildPolicy.standing.
  trial: undefined,
  alt: "alt — behind mains on equal metrics",
  inactive: "inactive — off the raiding roster",
  pug: "pug — not a guild raider",
};

/**
 * "They already got a belt this phase."
 *
 * A wishlist wants one item per slot, but a slot keeps dropping — two belts in
 * a tier, a better ring next raid. Loot owed can't see that: six items spread
 * over six slots reads the same as six belts. So a contender who has already
 * been handed something for THIS slot is multiplied down, hard.
 *
 * Down, not out. If nobody else wants the item they should still get it — a
 * multiplier drops them below anyone with a bare slot while leaving them
 * rankable, which is what a council does with an uncontested drop.
 *
 * It scales with how FULL the slot family is, not with a raw count, so rings
 * and trinkets add up the same way everything else does. One belt fills the
 * one belt slot, so it costs the whole drop; one ring fills half of two ring
 * slots, so it costs half. A raider on their second ring has then filled the
 * family once and lands exactly where the belt winner did — which is the
 * property that makes the sheet and the metrics agree instead of arguing.
 */
export function slotServedAdjustment(
  /**
   * What served the slot, split by what it was to the raider.
   *
   *   `bis`     — the item they asked for.
   *   `filler`  — a fallback they ranked. They settled for it.
   *   `offList` — checked their list; it wasn't on it. They were handed it.
   *   `unknown` — no list on record, so we can't say. Costed like `bis`,
   *               because the alternative is a discount for not importing one.
   *               `computeItemContention` never produces this — you reach the
   *               board through a list, so there is always one to check. It is
   *               the safe default for a `ContenderAward` built without list
   *               context, where `notListed` is simply absent.
   */
  served: { bis: number; filler: number; offList: number; unknown: number },
  /** How many items the slot family holds — 2 for rings and trinkets, else 1. */
  familySize: number,
  slotServed: GuildPolicy["slotServed"] = DEFAULT_POLICY.slotServed,
): LootPriorityAdjustment | undefined {
  const capacity = Math.max(1, familySize);
  const cost =
    ((served.bis + served.unknown) * slotServed.drop +
      served.filler * slotServed.fillerDrop +
      served.offList * slotServed.offListDrop) /
    capacity;
  // Nothing that costs anything. With `offListDrop` at zero — the council's
  // decision — a raider handed three drops they never asked for lands here,
  // and a "×1" adjustment in the breakdown would be noise. What they were
  // given is still on the contender row for an officer to read.
  if (cost <= 0) return undefined;

  const counted = served.bis + served.filler + served.unknown;
  const items = `${counted} item${counted === 1 ? "" : "s"}`;
  const filler =
    served.filler > 0
      ? served.bis > 0
        ? ` (${served.filler} of them a fallback, not what they asked for)`
        : counted === 1
          ? " — a fallback, not what they asked for"
          : " — fallbacks, not what they asked for"
      : "";
  const offList =
    served.offList > 0
      ? `; ${served.offList} more they never listed, which doesn't count`
      : "";
  const unknown =
    served.unknown > 0 && served.bis + served.filler === 0
      ? " — no wishlist on record, so counted in full"
      : "";
  const multiplier = Math.max(slotServed.floor, Math.round((1 - cost) * 100) / 100);
  return {
    key: "slotServed",
    label: "Slot already served",
    multiplier,
    note:
      capacity > 1
        ? `already won ${items} for this slot this phase, which holds ${capacity}${filler}${unknown}${offList}`
        : `already won ${items} for this slot this phase${filler}${unknown}${offList}`,
  };
}

function attendanceFactor(metrics: RaiderMetrics | undefined, w: LootPriorityWeights): LootPriorityFactor {
  const attendance = metrics?.attendance;
  const counted = attendance && attendance.raidsTracked > 0;
  return {
    key: "attendance",
    label: "Attendance",
    weight: w.attendance,
    score: counted ? attendance.raidPct : undefined,
    detail: counted
      ? `${attendance.raidsAttended} of ${attendance.raidsTracked} logged raids`
      : "no logged raids yet",
  };
}

/**
 * How overdue they are, measured against whoever in this contest has taken the
 * most this phase. With everyone on zero the factor stops discriminating —
 * which is the right answer, not a bug.
 */
function lootDebtFactor(mine: number, peak: number, w: LootPriorityWeights): LootPriorityFactor {
  return {
    key: "lootDebt",
    label: "Loot owed",
    weight: w.lootDebt,
    score: peak === 0 ? 100 : Math.round(((peak - mine) / peak) * 100),
    detail:
      mine === 0
        ? "no on-spec loot this phase"
        : `${mine} on-spec item${mine === 1 ? "" : "s"} this phase`,
  };
}

function performanceFactor(
  metrics: RaiderMetrics | undefined,
  w: LootPriorityWeights,
  metric: GuildPolicy["performance"]["parseMetric"],
): LootPriorityFactor {
  const bracket = metric === "bracket";
  const parse = bracket ? metrics?.career?.medianBracket : metrics?.career?.medianParse;
  const label = bracket ? "median bracket parse" : "median parse";
  return {
    key: "performance",
    label: "Performance",
    weight: w.performance,
    score: parse,
    // Name which percentile this is. The two differ by a lot for a raider in
    // strong gear, and an officer reading the tooltip has to know which one
    // they are defending.
    detail: parse === undefined ? `no ${bracket ? "bracket parses" : "parses"} logged` : `${label} ${parse}`,
  };
}

function preparationFactor(metrics: RaiderMetrics | undefined, w: LootPriorityWeights): LootPriorityFactor {
  // No logged pulls at all means no opinion; a raider who pulled and brought
  // nothing genuinely scores zero, which summarizePerformance already says.
  const prepared = metrics?.career?.preparedPct;
  return {
    key: "preparation",
    label: "Preparation",
    weight: w.preparation,
    score: prepared,
    detail:
      prepared === undefined ? "no logged pulls" : `flask + food on ${prepared}% of pulls`,
  };
}

export function computeLootPriority(
  character: Character,
  metrics: RaiderMetrics | undefined,
  onSpecAwardsActivePhase: number,
  peakAwardsActivePhase: number,
  slotServed?: LootPriorityAdjustment,
  policy: GuildPolicy = DEFAULT_POLICY,
): LootPriority {
  const w = policy.weights;
  const factors = [
    attendanceFactor(metrics, w),
    lootDebtFactor(onSpecAwardsActivePhase, peakAwardsActivePhase, w),
    performanceFactor(metrics, w, policy.performance.parseMetric),
    preparationFactor(metrics, w),
  ];

  const multiplier = policy.standing[character.status];
  const note = STANDING_NOTE[character.status];
  const adjustments: LootPriorityAdjustment[] = [];
  // A multiplier of 1 changes nothing, so it earns no line in the arithmetic —
  // which is also what happens when a council decides alts rank like mains.
  if (note && multiplier !== 1) {
    adjustments.push({
      key: "standing",
      label: "Roster standing",
      multiplier,
      note,
    });
  }
  if (slotServed) adjustments.push(slotServed);

  // Only factors that actually know something get a vote — and a say in the
  // denominator, so missing data neither helps nor hurts.
  const known = factors.filter((f) => f.score !== undefined);
  const totalWeight = known.reduce((sum, f) => sum + f.weight, 0);
  const base =
    totalWeight === 0
      ? undefined
      : known.reduce((sum, f) => sum + f.score! * f.weight, 0) / totalWeight;
  const scaled = adjustments.reduce((n, a) => n * a.multiplier, base ?? 0);

  return {
    score: base === undefined ? undefined : Math.round(scaled),
    factors,
    adjustments,
  };
}

export interface RankOptions {
  /** How many items the contested slot's family holds (2 for rings/trinkets). */
  familySize?: number;
  /** The council's policy; omitted means the defaults are in force. */
  policy?: GuildPolicy;
}

/**
 * Score every contender and order them: the unsatisfied first, then the ones
 * who already have the item.
 *
 * The council's sheet leads. A contender's tier on the priority chain decides
 * the ordering outright and the metric score only ever breaks ties INSIDE a
 * tier — that's the order a council actually works in, deciding who's eligible
 * before anyone argues about attendance. Contenders the chain doesn't name at
 * all sit below everyone it does, which is what "MS > OS" means in practice.
 *
 * Remaining ties break toward whoever has taken less this phase, then
 * alphabetically — never randomly, so the same contest always produces the
 * same list.
 */
export function rankLootContenders(
  wishers: ContentionWisher[],
  metricsOf: (characterId: string) => RaiderMetrics | undefined,
  opts: RankOptions = {},
): ContentionWisher[] {
  const open = wishers.filter((w) => !w.satisfied);
  const peak = Math.max(0, ...open.map((w) => w.onSpecAwardsActivePhase));
  /** Untiered contenders sort after every named tier. */
  const tier = (w: ContentionWisher) => w.priorityTier ?? Number.MAX_SAFE_INTEGER;

  const ranked = open
    .map((wisher) => {
      const metrics = metricsOf(wisher.character.id);
      // A raider who took a fallback in this slot is not the same as one who
      // got what they asked for, and "already served" used to read them alike.
      const sameSlot = wisher.awardsThisPhase.filter((a) => a.sameSlot && !a.offspec);
      const served = {
        bis: sameSlot.filter((a) => a.listRank === 0).length,
        filler: sameSlot.filter((a) => a.listRank !== undefined && a.listRank > 0).length,
        offList: sameSlot.filter((a) => a.listRank === undefined && a.notListed === true).length,
        unknown: sameSlot.filter((a) => a.listRank === undefined && a.notListed !== true).length,
      };
      return {
        ...wisher,
        metrics,
        priority: computeLootPriority(
          wisher.character,
          metrics,
          wisher.onSpecAwardsActivePhase,
          peak,
          slotServedAdjustment(served, opts.familySize ?? 1, opts.policy?.slotServed),
          opts.policy,
        ),
      };
    })
    .sort(
      (a, b) =>
        tier(a) - tier(b) ||
        (b.priority.score ?? -1) - (a.priority.score ?? -1) ||
        a.onSpecAwardsActivePhase - b.onSpecAwardsActivePhase ||
        compareText(a.character.name, b.character.name),
    )
    .map((wisher, i) => ({ ...wisher, rank: i + 1 }));

  const satisfied = wishers
    .filter((w) => w.satisfied)
    .map((wisher) => ({ ...wisher, metrics: metricsOf(wisher.character.id) }))
    .sort((a, b) => compareText(a.character.name, b.character.name));

  return [...ranked, ...satisfied];
}

/** "Attendance 86 (35%) · Loot owed 100 (30%) · …" — the full arithmetic, for a tooltip. */
export function lootPriorityTitle(priority: LootPriority): string {
  return [
    ...priority.factors.map((f) => `${f.label} ${f.score ?? "—"} (${f.weight}%): ${f.detail}`),
    ...priority.adjustments.map((a) => `×${a.multiplier} — ${a.note}`),
  ].join(" · ");
}
