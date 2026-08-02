"use server";

import { getWriteRepo } from "@/lib/data/repo";
import { refreshAfterWrite } from "@/lib/refresh";
import { parsePriorityChain } from "@/lib/loot/priority-chain";
import { isSpecTag } from "@/lib/loot/spec-tags";
import type { LootPriorityWeights } from "@/lib/types";

/**
 * Editing the council's loot policy: the factor weighting behind every score,
 * and one item's spec priority chain.
 *
 * Both are seeded from something the guild already wrote down — the priority
 * sheet, and the defaults in lib/analysis/loot-priority — and both are meant
 * to be argued with. Nothing here validates the policy itself; it only checks
 * that what's stored can be read back.
 *
 * Guild-scoped rather than route-scoped: the weighting is edited on the guild
 * page and applies everywhere, while a chain is edited on the item it governs.
 * When the app grows past one guild these become the first things that need a
 * guild id — see docs/guild-and-player-profiles.md.
 */

export interface PriorityActionResult {
  ok: boolean;
  message: string;
  /** Tokens in the chain that no rule can evaluate — saved, but worth flagging. */
  manualTokens?: string[];
}

export async function saveItemPriorityAction(input: {
  itemName: string;
  /** Empty hands the item back to the seeded sheet. */
  chain: string;
  note?: string;
}): Promise<PriorityActionResult> {
  try {
    const repo = await getWriteRepo();
    const result = await repo.setItemPriorityRule(input.itemName, input.chain, input.note);
    if (!result.ok) return { ok: false, message: result.error };
    refreshAfterWrite("/", "layout");
    if (!input.chain.trim()) {
      return { ok: true, message: "Back to the guild's sheet for this item." };
    }
    // A rung of pure free text still saves — it just can't rank anyone, and an
    // officer should hear that from us rather than discover it mid-raid.
    const manualTokens = parsePriorityChain(input.chain).tiers
      .filter((t) => t.manual)
      .map((t) => t.tags.join(" = "));
    return { ok: true, message: "Priority saved.", manualTokens };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Saving the priority failed." };
  }
}

export async function saveLootWeightsAction(
  weights: Partial<LootPriorityWeights>,
): Promise<PriorityActionResult> {
  try {
    const repo = await getWriteRepo();
    const result = await repo.setLootPriorityWeights(weights);
    if (!result.ok) return { ok: false, message: result.error };
    refreshAfterWrite("/", "layout");
    return { ok: true, message: "Weighting saved — every contested item re-ranks." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Saving the weighting failed." };
  }
}

/** Which tokens of a draft chain the app can actually rank on — for live feedback. */
export async function checkPriorityChainAction(
  chain: string,
): Promise<{ tiers: { label: string; manual: boolean }[]; unknown: string[] }> {
  const parsed = parsePriorityChain(chain);
  const unknown = [...new Set(parsed.tiers.flatMap((t) => t.tags).filter((t) => !isSpecTag(t)))];
  return {
    tiers: parsed.tiers.map((t) => ({ label: t.tags.join(" = "), manual: t.manual })),
    unknown,
  };
}
