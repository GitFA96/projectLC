import { format, parseISO } from "date-fns";
import type { AwardDecision } from "@/lib/types";

/**
 * Why this person got this item, in the terms the decision was actually made in.
 *
 * The council chose to freeze the arithmetic at award time rather than
 * effective-date the whole policy, so this renders a snapshot and never
 * recomputes. That's the point: the weights have probably moved since, and a
 * recomputed score would answer a question nobody asked.
 *
 * Absent snapshots render nothing at all — an award that didn't come from the
 * ranking has no explanation to show, and inventing one ("scored 0") would be
 * worse than silence.
 */
export function AwardDecisionNote({ decision }: { decision?: AwardDecision }) {
  if (!decision) return null;

  const known = decision.factors.filter((f) => f.score !== undefined);
  return (
    <div className="space-y-1 rounded-md border bg-muted/40 px-2.5 py-2 text-xs">
      <p className="font-medium">
        {decision.rank !== undefined && (
          <>
            Ranked {decision.rank} of {decision.contenders}
            {decision.score !== undefined ? " · " : ""}
          </>
        )}
        {decision.score !== undefined && <>score {decision.score}</>}
        {decision.tierLabel && (
          <span className="font-normal text-muted-foreground"> · tier {decision.tierLabel}</span>
        )}
      </p>

      {known.length > 0 && (
        <p className="text-muted-foreground">
          {known.map((f) => `${f.label} ${f.score} (${f.weight}%)`).join(" · ")}
        </p>
      )}

      {decision.adjustments.length > 0 && (
        <p className="text-muted-foreground">
          {decision.adjustments.map((a) => `×${a.multiplier} ${a.note ?? a.label}`).join(" · ")}
        </p>
      )}

      {decision.chain && (
        <p className="text-muted-foreground">
          Sheet said <span className="font-medium text-foreground">{decision.chain}</span>
        </p>
      )}

      <p className="text-muted-foreground/80">
        As the board read on {format(parseISO(decision.capturedAt), "d MMM yyyy")} — weights{" "}
        {decision.weights.attendance}/{decision.weights.lootDebt}/{decision.weights.performance}/
        {decision.weights.preparation}. Not recomputed.
      </p>
    </div>
  );
}

/** One-line version for a table cell — the whole arithmetic as a tooltip. */
export function awardDecisionTitle(decision: AwardDecision): string {
  return [
    decision.rank !== undefined ? `Ranked ${decision.rank} of ${decision.contenders}` : undefined,
    decision.score !== undefined ? `score ${decision.score}` : undefined,
    ...decision.factors
      .filter((f) => f.score !== undefined)
      .map((f) => `${f.label} ${f.score} (${f.weight}%): ${f.detail}`),
    ...decision.adjustments.map((a) => `×${a.multiplier} — ${a.note ?? a.label}`),
    decision.chain ? `Sheet: ${decision.chain}` : undefined,
    `Captured ${decision.capturedAt.slice(0, 10)}; not recomputed`,
  ]
    .filter(Boolean)
    .join(" · ");
}
