"use server";

import { getWriteRepo } from "@/lib/data/repo";
import { refreshAfterWrite } from "@/lib/refresh";
import { requireCapability } from "@/lib/auth/can";
import { resolveViewer } from "@/lib/auth/viewer";

/**
 * Recording what a raider will take when their BiS doesn't drop.
 *
 * The whole list is sent in order and replaces what was stored: ranks are
 * derived from position, so two items can never both claim second place and a
 * removal can't leave a gap that makes "3rd choice" a lie.
 */
export async function saveWishlistAlternativesAction(input: {
  characterId: string;
  phase: number;
  slot: string;
  items: { itemId: number; itemName?: string; note?: string }[];
}): Promise<{ ok: boolean; message: string }> {
  try {
    requireCapability(await resolveViewer(), "roster.edit");
    const repo = await getWriteRepo();
    const result = await repo.setWishlistAlternatives(input);
    if (!result.ok) return { ok: false, message: result.error };
    refreshAfterWrite("/", "layout");
    return { ok: true, message: "Saved." };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Saving the alternatives failed.",
    };
  }
}
