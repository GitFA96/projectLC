"use server";

import { getWriteRepo } from "@/lib/data/repo";
import { refreshAfterWrite } from "@/lib/refresh";
import { requireCapability } from "@/lib/auth/can";
import { resolveViewer } from "@/lib/auth/viewer";
import type { Phase } from "@/lib/types";

/**
 * Facts about one item that only a person can settle.
 *
 * Wowhead answers what an item *is* — name, icon, quality, slot — and the
 * resolver takes those, overwriting whatever was guessed. Where it drops and
 * which tier that makes it are a different kind of claim: nothing outside the
 * guild knows them, so nothing can derive them and nothing overwrites them.
 *
 * They are editable here because they had to become editable. The curated list
 * the app shipped with had 44 entries written against the wrong item id, and
 * their zone, boss and phase described some other item — so the resolver drops
 * that curation rather than carry a wrong drop table forward. This is how an
 * officer puts the right one back.
 */

export interface ItemActionResult {
  ok: boolean;
  message: string;
}

export async function setItemCurationAction(
  itemId: number,
  curation: { phase: Phase | null; source: { zone: string; boss?: string } | null },
): Promise<ItemActionResult> {
  try {
    requireCapability(await resolveViewer(), "items.curate");
    const repo = await getWriteRepo();
    const result = await repo.setItemCuration(itemId, curation);
    if (!result.ok) return { ok: false, message: result.error };
    // "layout": the loot plan, phase filters and the contested-items card all
    // read this, and none of them are on this route.
    refreshAfterWrite("/", "layout");
    const said = [
      curation.phase === null ? "phase cleared" : `phase ${curation.phase}`,
      curation.source === null ? "source cleared" : curation.source.zone,
    ];
    return { ok: true, message: `Saved — ${said.join(", ")}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not save the item." };
  }
}

/**
 * "This name or icon is wrong."
 *
 * Withdraws Wowhead's confirmed stamp so the resolver asks again on the next
 * backfill; the row keeps what it has until a better answer arrives. This exists
 * because eight of the council's bug reports were exactly this, and each was
 * fixed by hand — a verified row is never asked about twice, which is what makes
 * the cache cheap and what made a wrong answer permanent.
 *
 * Gated on `items.curate`, like the curation editor beside it: both are "correct
 * what the app believes about an item".
 */
export async function reportWrongItemDataAction(itemId: number): Promise<ItemActionResult> {
  try {
    requireCapability(await resolveViewer(), "items.curate");
    const repo = await getWriteRepo();
    const result = await repo.unverifyItem(itemId);
    if (!result.ok) return { ok: false, message: result.error };
    // "layout": every list that renders this item's icon reads the same row.
    refreshAfterWrite("/", "layout");
    return {
      ok: true,
      message: "Queued for another Wowhead lookup — press Backfill item data on the import page.",
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not queue the item." };
  }
}
