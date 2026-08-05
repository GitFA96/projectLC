import type { AbilityDelta } from "@/lib/analysis/rotation";
import type { Activity } from "@/lib/analysis/rotation";
import type { ContextRow } from "@/lib/sim/context";

/**
 * Reading the comparison back in sentences.
 *
 * The panel above this states facts; nobody disputes that Heroic Strike was
 * 23.3/min against the sim's 20.5. What an officer actually needs is which of
 * those facts moved the fight, and a table doesn't say that — so this ranks the
 * differences by how much damage sits behind them and writes each one out.
 *
 * Two rules keep it honest:
 *
 *  - **Nothing here is a score.** Every finding names a measurement and what it
 *    implies, and stops. Whether a raider should have played differently is a
 *    judgement about the fight the officer was in and this app wasn't.
 *  - **Context before rotation.** A gap explained by a missing raid buff is not
 *    a rotation problem, so those findings lead. Telling someone to press more
 *    buttons when the real answer is that nobody drummed is worse than silence.
 *
 * Pure.
 */

export type FindingKind =
  /** Something outside the raider's control moved the number. */
  | "context"
  /** Something about the rotation itself. */
  | "rotation"
  /** Time not spent attacking. */
  | "uptime";

export interface Finding {
  kind: FindingKind;
  /** One line, stating the measurement. */
  text: string;
  /**
   * Rough damage this is worth over the pull, when it can be attributed.
   * Used for ordering, and shown so a reader can weigh it against the gap.
   */
  damage?: number;
  /** True when the pull was AHEAD of the sim here. */
  good?: boolean;
}

export interface FindingsInput {
  abilities: AbilityDelta[];
  audit: ContextRow[];
  activity: Activity;
  durationMs: number;
  loggedDps?: number;
  simDps?: number;
}

/** Ignore rate differences this small — they're rounding, not decisions. */
const RATE_NOISE = 0.5;
/** Damage worth a sentence: below this it's a rounding error on a raid night. */
const DAMAGE_FLOOR = 5_000;

const pretty = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}m` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n));

export function findings(input: FindingsInput): Finding[] {
  const out: Finding[] = [];
  const { abilities, audit, activity, durationMs } = input;

  /* 1. What the sim was handed that the raid didn't have. */
  const missing = audit.filter((r) => r.verdict === "sim-only" && r.favours === "sim");
  for (const row of missing) {
    out.push({
      kind: "context",
      text: `${row.name}: ${row.logged}. The sim's number includes it, so part of the gap isn't the rotation.`,
    });
  }
  const partial = audit.filter((r) => r.verdict === "differs" && r.favours === "sim");
  for (const row of partial) {
    out.push({
      kind: "context",
      // Deliberately not "was only partly up": the same branch carries potions
      // and fight length, where that phrasing would be nonsense.
      text: `${row.name}: ${row.logged}. The sim assumes the full benefit for the whole pull.`,
    });
  }

  /* 2. Time not spent attacking, which no rotation change can recover. */
  if (activity.activePct < 95) {
    const lost = Math.round((1 - activity.activePct / 100) * (input.simDps ?? 0) * (durationMs / 1000));
    out.push({
      kind: "uptime",
      text: `Attacking ${activity.activePct}% of the pull — ${Math.round(activity.idleMs / 1000)}s idle. The sim never stops moving to a mechanic.`,
      damage: lost > DAMAGE_FLOOR ? lost : undefined,
    });
  }

  /*
   * 3. Abilities where the two sides disagree, ranked by the damage behind
   * them rather than by the rate. A rate gap on something that does no damage
   * (a shout, a stance) is noise; a small gap on the hardest-hitting ability
   * is not.
   */
  const byImpact = abilities
    .filter((a) => Math.abs(a.perMinDelta) >= RATE_NOISE)
    .map((a) => {
      const gap = (a.bDamage ?? 0) - (a.aDamage ?? 0);
      return { a, gap };
    })
    .filter((x) => Math.abs(x.gap) >= DAMAGE_FLOOR)
    .sort((x, y) => Math.abs(y.gap) - Math.abs(x.gap));

  for (const { a, gap } of byImpact.slice(0, 6)) {
    const behind = gap > 0;
    const rate = `${a.aPerMin.toFixed(1)} vs ${a.bPerMin.toFixed(1)} per minute`;
    out.push({
      kind: "rotation",
      good: !behind,
      damage: Math.abs(gap),
      text: behind
        ? `${a.name}: ${rate}. That's ${pretty(Math.abs(gap))} less damage than the sim got from it.`
        : `${a.name}: ${rate} — ${pretty(Math.abs(gap))} MORE damage than the sim. Ahead of the model here.`,
    });
  }

  /*
   * 4. Something the sim used and the pull never did at all. Worth its own
   * sentence: a zero is a different conversation from a shortfall.
   */
  for (const a of abilities) {
    if (a.aCasts > 0 || a.bCasts <= 0 || (a.bDamage ?? 0) < DAMAGE_FLOOR) continue;
    if (out.some((f) => f.text.startsWith(`${a.name}:`))) continue;
    out.push({
      kind: "rotation",
      damage: a.bDamage,
      text: `${a.name} was never used — the sim got ${pretty(a.bDamage ?? 0)} out of it.`,
    });
  }

  /* Context first, then by damage: see the note at the top. */
  const rank = { context: 0, uptime: 1, rotation: 2 } as const;
  return out.sort((x, y) => rank[x.kind] - rank[y.kind] || (y.damage ?? 0) - (x.damage ?? 0));
}

/** One sentence for the top: how much of the gap the findings actually explain. */
export function findingsHeadline(input: FindingsInput, list: Finding[]): string {
  const { loggedDps, simDps, durationMs } = input;
  if (loggedDps === undefined || simDps === undefined) {
    return "No DPS figure on one side, so there's no gap to explain.";
  }
  const gap = simDps - loggedDps;
  if (gap <= 0) {
    return `This pull beat the sim by ${Math.abs(gap)} dps. The model is a floor here, not a ceiling.`;
  }
  const gapDamage = gap * (durationMs / 1000);
  const explained = list.reduce((sum, f) => sum + (f.good ? 0 : (f.damage ?? 0)), 0);
  const share = Math.round((explained / Math.max(1, gapDamage)) * 100);
  if (explained === 0) {
    return `${gap} dps behind the sim (${pretty(gapDamage)} over the pull). Nothing below is big enough to explain it — look at the fight itself.`;
  }
  return `${gap} dps behind the sim — ${pretty(gapDamage)} over the pull. The findings below account for roughly ${Math.min(100, share)}% of it.`;
}
