"use server";

import { getWriteRepo } from "@/lib/data/repo";
import { refreshAfterWrite } from "@/lib/refresh";
import type { Phase } from "@/lib/types";

/**
 * Guild-wide settings that are facts about the guild rather than judgements
 * about loot — the loot judgements live in `loot-policy-actions.ts`, and the
 * split is worth keeping: one of these is "where are we", the other is "what
 * do we believe".
 */

export interface GuildActionResult {
  ok: boolean;
  message: string;
}

/**
 * Move the guild to a different phase.
 *
 * Wider than it looks. The active phase decides whether a rare gem reads as
 * acceptable or as behind the tier, which phase the priority sheet and the
 * fairness panel open on, and what "current tier" means to gear grading. That
 * is exactly why it is a control rather than a constant: an officer comparing
 * how the loot would fall under P2 and P3 rules can now do it and put it back.
 */
export async function setActivePhaseAction(phase: Phase): Promise<GuildActionResult> {
  try {
    const repo = await getWriteRepo();
    const result = await repo.setActivePhase(phase);
    if (!result.ok) return { ok: false, message: result.error };
    // "layout" — the phase is in the header on every page, not just this one.
    refreshAfterWrite("/", "layout");
    return { ok: true, message: `Phase ${phase} is active. Gem grading and every phase-scoped view follow it.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not change the active phase." };
  }
}
