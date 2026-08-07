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

/** The council's weighting with any unset factor falling back to the default. */
export function resolveWeights(overrides?: Partial<LootPriorityWeights>): LootPriorityWeights {
  return { ...LOOT_PRIORITY_WEIGHTS, ...overrides };
}

/**
 * Roster standing as a multiplier rather than a fifth factor: it's a category,
 * not a percentage, and a main with mediocre metrics should still outrank an
 * alt with perfect ones.
 */
const STANDING_NOTE: Record<CharacterStatus, string | undefined> = {
  main: undefined,
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
  sameSlotOnSpecAwards: number,
  /** How many items the slot family holds — 2 for rings and trinkets, else 1. */
  familySize: number,
  slotServed: GuildPolicy["slotServed"] = DEFAULT_POLICY.slotServed,
): LootPriorityAdjustment | undefined {
  if (sameSlotOnSpecAwards <= 0) return undefined;
  const capacity = Math.max(1, familySize);
  const filled = sameSlotOnSpecAwards / capacity;
  const multiplier = Math.max(
    slotServed.floor,
    Math.round((1 - slotServed.drop * filled) * 100) / 100,
  );
  const items = `${sameSlotOnSpecAwards} item${sameSlotOnSpecAwards === 1 ? "" : "s"}`;
  return {
    key: "slotServed",
    label: "Slot already served",
    multiplier,
    note:
      capacity > 1
        ? `already won ${items} for this slot this phase, which holds ${capacity}`
        : `already won ${items} for this slot this phase`,
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
      const sameSlot = wisher.awardsThisPhase.filter((a) => a.sameSlot && !a.offspec).length;
      return {
        ...wisher,
        metrics,
        priority: computeLootPriority(
          wisher.character,
          metrics,
          wisher.onSpecAwardsActivePhase,
          peak,
          slotServedAdjustment(sameSlot, opts.familySize ?? 1, opts.policy?.slotServed),
          opts.policy,
        ),
      };
    })
    .sort(
      (a, b) =>
        tier(a) - tier(b) ||
        (b.priority.score ?? -1) - (a.priority.score ?? -1) ||
        a.onSpecAwardsActivePhase - b.onSpecAwardsActivePhase ||
        a.character.name.localeCompare(b.character.name),
    )
    .map((wisher, i) => ({ ...wisher, rank: i + 1 }));

  const satisfied = wishers
    .filter((w) => w.satisfied)
    .map((wisher) => ({ ...wisher, metrics: metricsOf(wisher.character.id) }))
    .sort((a, b) => a.character.name.localeCompare(b.character.name));

  return [...ranked, ...satisfied];
}

/** "Attendance 86 (35%) · Loot owed 100 (30%) · …" — the full arithmetic, for a tooltip. */
export function lootPriorityTitle(priority: LootPriority): string {
  return [
    ...priority.factors.map((f) => `${f.label} ${f.score ?? "—"} (${f.weight}%): ${f.detail}`),
    ...priority.adjustments.map((a) => `×${a.multiplier} — ${a.note}`),
  ].join(" · ");
}
