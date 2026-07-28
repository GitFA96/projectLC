"use server";

import { getWriteRepo } from "@/lib/data/repo";
import { refreshAfterWrite } from "@/lib/refresh";
import { resolveItemsFromWowhead } from "@/lib/items/wowhead";

/**
 * Filling the item cache, in the two steps that keep it cheap:
 *
 *  1. Harvest — free. Names and icons already sitting in imported records
 *     (wishlist slots, loot pastes, the gear snapshot on every logged pull)
 *     get folded into the cache so they're reachable by item id.
 *  2. Resolve — one Wowhead request per item id that nothing local knows,
 *     ever. Capped per run, so a first backfill of a whole tier is a handful
 *     of trickles rather than one burst.
 *
 * Nothing here runs while a page renders: an officer presses the button, or an
 * import quietly resolves the few new ids it introduced.
 */

export interface BackfillItemsResult {
  ok: boolean;
  message: string;
  /** Items that gained data from records already imported. */
  harvested: number;
  /** Items looked up on Wowhead this run. */
  resolved: number;
  /** Ids Wowhead had nothing for — they stay as ids. */
  failed: number;
  /** Still unresolved after this run (the per-run cap left some over). */
  remaining: number;
  /** Old loot rows whose invented "Item #30048" name was replaced. */
  repaired: number;
}

/**
 * How many unknown ids one press looks up. Wowhead starts refusing a client
 * that asks for hundreds in a row, so a big backlog is meant to take several
 * presses — each one is instant progress, and nothing is ever re-fetched.
 */
const RESOLVE_LIMIT = 60;

export async function backfillItemData(): Promise<BackfillItemsResult> {
  const empty = { harvested: 0, resolved: 0, failed: 0, remaining: 0, repaired: 0 };
  try {
    const repo = await getWriteRepo();

    const harvested = await repo.harvestItemCache();
    const unresolved = await repo.listUnresolvedItemIds();
    const { resolved, failed, throttled } = await resolveItemsFromWowhead(unresolved, {
      limit: RESOLVE_LIMIT,
    });
    if (resolved.length > 0) await repo.addItemsIfMissing(resolved);
    const repaired = await repo.repairPlaceholderAwardNames();
    const remaining = Math.max(0, unresolved.length - resolved.length - failed.length);

    refreshAfterWrite("/", "layout");
    const parts = [
      harvested > 0 ? `${harvested} filled from imports` : undefined,
      `${resolved.length} looked up on Wowhead`,
      repaired > 0 ? `${repaired} loot rows renamed` : undefined,
      failed.length > 0 ? `${failed.length} not found` : undefined,
      throttled
        ? `Wowhead started refusing requests — press again in a few minutes for the remaining ${remaining}`
        : remaining > 0
          ? `${remaining} left, press again to continue`
          : undefined,
    ].filter(Boolean);
    return {
      ok: true,
      message: unresolved.length === 0 && harvested === 0
        ? "Every referenced item already has a name and an icon."
        : parts.join(" · "),
      harvested,
      resolved: resolved.length,
      failed: failed.length,
      remaining,
      repaired,
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Could not backfill item data.",
      ...empty,
    };
  }
}
