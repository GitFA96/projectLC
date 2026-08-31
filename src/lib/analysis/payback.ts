import { DEFAULT_POLICY, type GuildPolicy } from "@/lib/analysis/policy";
import { compareText } from "@/lib/sort";

/**
 * How a night's Marks of Illidari get shared back out.
 *
 * The raid banks marks off Black Temple bosses and turns them into potions and
 * flasks. That is a real pot with a real size — 30 marks at roughly 100g each
 * on the night this was built against — so the question is not "how much should
 * we refund" but "how do we split what we actually have".
 *
 * Which makes this a **fixed-pot apportionment, never a rebate rate**: every
 * raider's recommendation is a share of the pot, and the shares sum to the pot
 * exactly. A percentage-of-spend model would produce a number the guild might
 * not own.
 *
 * **Nobody is paid back more than they spent.** That is a hard ceiling, not a
 * weighting, which is why it lives here rather than in policy: a refund larger
 * than the outlay is not a generous split, it is a payment for nothing, and no
 * setting should be able to produce one. It is also the one rule that cannot
 * be applied by clamping — a truncated share has to go back into the pot for
 * everybody else, or the column silently stops adding up to what was banked.
 * See `apportionCapped`.
 *
 * Pure. The pot and the weighting are both the council's, not this module's:
 * the pot is recorded per raid night and the weighting lives in
 * `policy.payback`. **Nothing here is scored.** A raider being owed marks is
 * not a merit or a demerit, and it must never reach the loot score or the
 * standing board — the same rule loot debt follows on the standing side.
 */

export interface PaybackPot {
  /** Marks of Illidari the raid banked that night. */
  marks: number;
  /**
   * What one mark is worth in gold, as the officers price it today.
   *
   * Recorded per night rather than fixed, because it moves — the council put it
   * at 100g when this was built and said plainly that it would drop.
   */
  markGold: number;
}

/** No pot recorded: the honest zero, and what an unset night reads as. */
export const NO_POT: PaybackPot = { marks: 0, markGold: 0 };

export interface PaybackSpender {
  name: string;
  slug?: string;
  className?: string;
  /**
   * Gold spent, **after** the officers' corrections — the number the gold table
   * shows on the same row. Splitting the pot against the uncorrected figure
   * would pay people for what the log got wrong.
   */
  gold: number;
}

export interface PaybackRow extends PaybackSpender {
  /** 1-based, by spend. Ties broken by name so the order is stable. */
  rank: number;
  /** In the boosted tier — `policy.payback.topTier` deep. */
  top: boolean;
  /** Share of the pot, 0–1. */
  share: number;
  /** Recommended payback, in gold — never more than `gold`. */
  recommended: number;
  /**
   * True when this raider's share hit the ceiling and the remainder went back
   * into the pot for everyone else. Worth showing: a capped row is the one
   * place the split stops tracking the weighting, and an officer reading the
   * column deserves to know why.
   */
  capped: boolean;
  /**
   * Whole marks, apportioned so the column sums to exactly the marks banked.
   *
   * Gold is divisible and a mark is not — you cannot hand somebody 2.7 of one —
   * so the gold figure alone would never be actionable. See `apportionMarks`.
   */
  marks: number;
  /** What the officers have recorded as actually handed over, in gold. */
  paid: number;
}

export interface PaybackView {
  rows: PaybackRow[];
  pot: PaybackPot & { gold: number };
  /** Sum of `recommended` — equals the pot's gold whenever anybody spent. */
  recommendedTotal: number;
  /** Sum of `paid`, as recorded by officers. */
  paidTotal: number;
  /** Sum of `marks` — equals `pot.marks` whenever anybody spent. */
  marksAllocated: number;
  /** Total spend the split was computed against. */
  spendTotal: number;
  /**
   * Pot that could not be handed out without paying somebody more than they
   * spent — normally 0, and only ever positive when the pot is large against
   * the night's spend.
   *
   * Surfaced rather than absorbed. Silently shrinking the pot would leave the
   * marks column disagreeing with the number of marks the raid actually banked,
   * with nothing on screen to say which one to believe.
   */
  undistributed: number;
  /**
   * Marks still in the bank once everyone has taken what the ceiling allows.
   *
   * **Not `undistributed` divided by the mark price.** Marks are lumpy and gold
   * is not: a raider owed 683g takes six marks and leaves 83g of their
   * entitlement behind, because a seventh would be worth more than they spent.
   * So the gold left over and the marks left over are genuinely different
   * figures, and the physical one — how many tokens are still sitting in the
   * bank — is the one an officer acts on.
   */
  marksUndistributed: number;
  /**
   * False when no pot has been recorded for this night. The page must say so
   * rather than showing a table of zeros, which reads as "nobody is owed
   * anything" when the truth is "nobody has entered what we banked".
   */
  potRecorded: boolean;
}

/** Gold either side of this is the same gold — floating point, not a tolerance. */
const EPSILON = 1e-9;

/**
 * Split a pot by weight, with a per-row ceiling nobody may exceed.
 *
 * The naive version — work out every share, then clamp the ones that overshoot
 * — is wrong in a way that does not announce itself: the clamped remainder
 * simply vanishes, and the column quietly adds up to less than the raid banked.
 * So the overflow is handed **back to the pot** and re-split among everybody
 * still under their ceiling, which can push a second row over its own, which is
 * why this runs until it settles rather than once.
 *
 * It always terminates: each pass either caps at least one more row or
 * finishes, and there are only so many rows.
 *
 * What is left when *everybody* is capped cannot be paid to anyone under the
 * rule, and is returned rather than forced somewhere.
 */
function apportionCapped(
  weights: number[],
  caps: number[],
  pot: number,
): { amounts: number[]; capped: boolean[] } {
  const amounts = new Array<number>(weights.length).fill(0);
  const capped = new Array<boolean>(weights.length).fill(false);
  if (pot <= 0) return { amounts, capped };

  for (let pass = 0; pass <= weights.length; pass++) {
    const openWeight = weights.reduce((sum, w, i) => (capped[i] ? sum : sum + w), 0);
    const remaining = pot - amounts.reduce((sum, a) => sum + a, 0);
    if (openWeight <= 0 || remaining <= EPSILON) break;

    let hitCeiling = false;
    for (let i = 0; i < weights.length; i++) {
      if (capped[i]) continue;
      if ((remaining * weights[i]) / openWeight > caps[i] + EPSILON) {
        amounts[i] = caps[i];
        capped[i] = true;
        hitCeiling = true;
      }
    }
    if (hitCeiling) continue;

    // Nobody overshot this pass, so this split stands.
    for (let i = 0; i < weights.length; i++) {
      if (!capped[i]) amounts[i] = (remaining * weights[i]) / openWeight;
    }
    break;
  }
  return { amounts, capped };
}

/**
 * Whole marks from fractional shares, by largest remainder, under the same
 * ceiling the gold obeys.
 *
 * Every row takes its floor, and the marks left over go to the largest
 * fractional parts in turn. Rounding each share independently would either hand
 * out more marks than the raid owns or leave some unassigned, and an officer
 * reading a column that does not add up to 30 has no way to tell which.
 *
 * **The ceiling has to be applied here too, not only to the gold.** Marks are
 * lumpy: a raider who spent 150g on a 100g mark is owed at most one, and a
 * largest-remainder round-up would hand them a second worth 200g — the gold
 * column obeying a cap the mark column beside it breaks.
 */
function apportionMarks(shares: number[], marks: number, caps: number[]): number[] {
  if (marks <= 0 || shares.length === 0) return shares.map(() => 0);
  const exact = shares.map((s) => s * marks);
  const out = exact.map((e, i) => Math.min(Math.floor(e), caps[i]));
  let left = marks - out.reduce((sum, n) => sum + n, 0);
  const byRemainder = exact
    .map((e, i) => ({ i, rem: e - Math.floor(e) }))
    // Ties go to the higher-ranked spender, which is the order already given.
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  // Several passes, because a mark refused by a capped row is still the raid's
  // to give and belongs to whoever is next in line with room for it.
  for (let pass = 0; pass < shares.length && left > 0; pass++) {
    let handed = false;
    for (const { i } of byRemainder) {
      if (left <= 0) break;
      if (out[i] >= caps[i]) continue;
      out[i]++;
      left--;
      handed = true;
    }
    if (!handed) break;
  }
  return out;
}

export interface PaybackInput {
  /** Everyone with spend this night. Order is irrelevant — this ranks them. */
  spenders: PaybackSpender[];
  pot: PaybackPot;
  /** Gold already handed over, by logged raider name. */
  paid?: Record<string, number>;
  policy?: GuildPolicy;
}

export function buildPayback(input: PaybackInput): PaybackView {
  const policy = input.policy ?? DEFAULT_POLICY;
  const { topTier, topWeight } = policy.payback;
  const paid = input.paid ?? {};
  const potGold = Math.max(0, input.pot.marks) * Math.max(0, input.pot.markGold);
  const potRecorded = input.pot.marks > 0 && input.pot.markGold > 0;

  const ranked = [...input.spenders]
    .filter((s) => s.gold > 0)
    .sort((a, b) => b.gold - a.gold || compareText(a.name, b.name));

  const spendTotal = ranked.reduce((sum, s) => sum + s.gold, 0);

  /*
   * The weight is the whole policy in one line: spend, with the top tier's
   * counted `topWeight` times over. Set `topWeight` to 1 and this is a plain
   * proportional split, which is the shape to reach for if the tier ever reads
   * as unfair — a hard boundary means two raiders a few gold apart in spend can
   * land a long way apart in payback, and only the council can say whether that
   * is the intent.
   */
  const weights = ranked.map((s, i) => s.gold * (i < topTier ? topWeight : 1));

  /*
   * The ceiling: what this raider spent. Applied to the split rather than to
   * the result, so the gold a capped row gives up is paid to somebody else
   * instead of leaving the pot.
   */
  const { amounts, capped } = apportionCapped(
    weights,
    ranked.map((s) => s.gold),
    potGold,
  );
  const handedOut = amounts.reduce((sum, a) => sum + a, 0);
  // Share is reported against what was actually apportioned, so a capped
  // raider's percentage matches the gold printed beside it rather than the
  // weighting it no longer follows.
  const shares = amounts.map((a) => (handedOut > 0 ? a / handedOut : 0));
  const marks = apportionMarks(
    shares,
    Math.max(0, Math.floor(input.pot.marks)),
    // A mark's worth of ceiling, rounded down: a raider owed less than one
    // mark's value in gold cannot be handed a whole one.
    ranked.map((s) => (input.pot.markGold > 0 ? Math.floor(s.gold / input.pot.markGold) : 0)),
  );

  const rows: PaybackRow[] = ranked.map((s, i) => ({
    ...s,
    rank: i + 1,
    top: i < topTier,
    share: shares[i],
    recommended: amounts[i],
    capped: capped[i],
    marks: marks[i],
    paid: Math.max(0, paid[s.name] ?? 0),
  }));

  return {
    rows,
    pot: { ...input.pot, gold: potGold },
    recommendedTotal: rows.reduce((sum, r) => sum + r.recommended, 0),
    undistributed: Math.max(0, potGold - handedOut),
    marksUndistributed: Math.max(
      0,
      Math.floor(Math.max(0, input.pot.marks)) - marks.reduce((sum, m) => sum + m, 0),
    ),
    paidTotal: rows.reduce((sum, r) => sum + r.paid, 0),
    marksAllocated: rows.reduce((sum, r) => sum + r.marks, 0),
    spendTotal,
    potRecorded,
  };
}
