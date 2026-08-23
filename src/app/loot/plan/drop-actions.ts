"use server";

import { getWriteRepo } from "@/lib/data/repo";
import { refreshAfterWrite } from "@/lib/refresh";
import { requireCapability } from "@/lib/auth/can";
import { resolveViewer } from "@/lib/auth/viewer";

/**
 * This guild's disagreements with the foundational drop table.
 *
 * Gated on `items.curate`, which already gates "which boss an item belongs to"
 * — the same judgement, reached from the page where an officer notices it
 * rather than from the item's own page.
 *
 * Nothing here writes to the foundational table. An officer saying "that
 * doesn't drop here" is a statement about their raid, and the operator's row
 * stays exactly as written for every other guild. If the operator is genuinely
 * wrong, that is a bug report, not an edit.
 */
export interface DropOverrideResult {
  ok: boolean;
  message: string;
}

export async function hideDropAction(input: {
  zone: string;
  boss: string;
  itemName: string;
  itemId?: number;
  author?: string;
}): Promise<DropOverrideResult> {
  try {
    requireCapability(await resolveViewer(), "items.curate");
    const repo = await getWriteRepo();
    const result = await repo.setGuildDropOverride({ ...input, action: "hide" });
    if (!result.ok) return { ok: false, message: result.error };
    refreshAfterWrite("/loot/plan", "layout");
    return { ok: true, message: `${input.itemName} taken off ${input.boss} for this guild.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not hide the drop." };
  }
}

export async function addDropAction(input: {
  zone: string;
  boss: string;
  itemName: string;
  note?: string;
  author?: string;
}): Promise<DropOverrideResult> {
  try {
    requireCapability(await resolveViewer(), "items.curate");
    if (!input.itemName.trim()) {
      return { ok: false, message: "Name the item first." };
    }
    const repo = await getWriteRepo();
    const result = await repo.setGuildDropOverride({ ...input, action: "add" });
    if (!result.ok) return { ok: false, message: result.error };
    refreshAfterWrite("/loot/plan", "layout");
    return {
      ok: true,
      // No id yet, and saying so beats a row that silently renders without an
      // icon while an officer wonders what they typed wrong.
      message: `${input.itemName.trim()} added to ${input.boss}. Its icon appears once the item backfill has looked the name up.`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not add the drop." };
  }
}

export async function restoreDropAction(input: {
  zone: string;
  boss: string;
  itemName: string;
}): Promise<DropOverrideResult> {
  try {
    requireCapability(await resolveViewer(), "items.curate");
    const repo = await getWriteRepo();
    const cleared = await repo.clearGuildDropOverride(input.zone, input.boss, input.itemName);
    if (!cleared) return { ok: false, message: "There was no override to clear." };
    refreshAfterWrite("/loot/plan", "layout");
    return { ok: true, message: `${input.itemName} restored to ${input.boss}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not restore the drop." };
  }
}
