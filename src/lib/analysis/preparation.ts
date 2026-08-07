/**
 * What "prepared" means — in one place, because it is about to become policy.
 *
 * Two different questions were being asked with one word, and the naming had
 * drifted far enough to be actively misleading: a helper called `isPrepared`
 * tested flask-or-elixir and never looked at food, while `preparedPct` two
 * modules away meant flask-or-elixir AND food. Both were then written out
 * inline in a third and a fourth place. Four copies of two rules is how the
 * raid page and the career page end up disagreeing about the same night — the
 * trap AGENTS.md already documents for consumable gold.
 *
 * So the name now sits on the rule it describes:
 *
 *   hasFlaskOrElixir — consumable coverage, one half of the answer.
 *   isPrepared       — coverage AND food. This is the one that feeds the
 *                      loot-priority score, and the one the council will get
 *                      to redefine.
 *
 * Pure, and structurally typed rather than taking a `WclPlayerFight`, so a
 * component holding a partial row can ask the same question the analysis does
 * instead of re-deriving it.
 */

import { DEFAULT_POLICY, type GuildPolicy } from "@/lib/analysis/policy";

/** The consumable facts a preparation check reads. Any row carrying them works. */
export interface PreparationRow {
  flask?: string;
  elixirs: string[];
  food: boolean;
}

/**
 * A flask or any elixir counts.
 *
 * Many raiders — hunters especially — run a single battle elixir rather than a
 * full flask, and that should register as coverage rather than read as "used
 * nothing". Whether it *should* count is the council's call, not this
 * function's; see the policy decision list.
 */
export function hasFlaskOrElixir(
  row: PreparationRow,
  rule: GuildPolicy["preparation"] = DEFAULT_POLICY.preparation,
): boolean {
  if (row.flask !== undefined) return true;
  return rule.elixirCounts && row.elixirs.length >= 1;
}

/** Coverage and food both up — the composite the loot-priority score reads. */
export function isPrepared(
  row: PreparationRow,
  rule: GuildPolicy["preparation"] = DEFAULT_POLICY.preparation,
): boolean {
  return hasFlaskOrElixir(row, rule) && row.food;
}
