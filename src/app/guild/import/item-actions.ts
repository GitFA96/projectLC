"use server";

import { getWriteRepo } from "@/lib/data/repo";
import { refreshAfterWrite } from "@/lib/refresh";
import { requireCapability } from "@/lib/auth/can";
import { resolveViewer } from "@/lib/auth/viewer";
import {
  fetchTokenRedemptions,
  resolveItemIdsByName,
  resolveItemsFromWowhead,
  type UnmatchedName,
} from "@/lib/items/wowhead";

/**
 * Filling the item cache, in the two steps that keep it cheap:
 *
 *  1. Harvest — free. Names and icons already sitting in imported records
 *     (wishlist slots, loot pastes, the gear snapshot on every logged pull)
 *     get folded into the cache so they're reachable by item id.
 *  2. Resolve — one Wowhead request per item id Wowhead has never answered
 *     for. That is a wider net than "has a hole in it": a curated icon is a
 *     guess that renders perfectly and can still be the wrong picture, so a
 *     row stays queued until the authority itself has confirmed it. Capped
 *     per run, so a first backfill of a whole tier is a handful of trickles
 *     rather than one burst.
 *
 * Nothing here runs while a page renders: an officer presses the button, or an
 * import quietly resolves the few new ids it introduced.
 */

export interface BackfillItemsResult {
  ok: boolean;
  message: string;
  /** Items that gained data from records already imported. */
  harvested: number;
  /** Items that gained a zone, boss or phase from the shipped drop table. */
  curated: number;
  /** Items looked up on Wowhead this run. */
  resolved: number;
  /** Of those, rows whose cached name/quality/icon/slot Wowhead disagreed with. */
  corrected: number;
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
  const empty = { harvested: 0, curated: 0, resolved: 0, corrected: 0, failed: 0, remaining: 0, repaired: 0 };
  try {
    requireCapability(await resolveViewer(), "import.run");
    const repo = await getWriteRepo();

    const harvested = await repo.harvestItemCache();
    const unresolved = await repo.listUnresolvedItemIds();
    const { resolved, failed, throttled } = await resolveItemsFromWowhead(unresolved, {
      limit: RESOLVE_LIMIT,
    });
    const corrected = resolved.length > 0 ? await repo.saveResolvedItems(resolved) : 0;
    // Curation runs *after* resolution, not before, and the order is the whole
    // point: resolving is what discovers a row was curated onto the wrong item
    // and strips its zone, boss and phase. Re-applying the shipped list on the
    // way out fills that hole in the same press. Curating first would leave the
    // corrections a press behind, which reads as the button not working.
    const curated = await repo.applyCuratedItemSources();
    const repaired = await repo.repairPlaceholderAwardNames();
    const remaining = Math.max(0, unresolved.length - resolved.length - failed.length);

    refreshAfterWrite("/", "layout");
    const parts = [
      harvested > 0 ? `${harvested} filled from imports` : undefined,
      curated > 0 ? `${curated} given a drop source` : undefined,
      `${resolved.length} looked up on Wowhead`,
      corrected > 0 ? `${corrected} corrected` : undefined,
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
      message: unresolved.length === 0 && harvested === 0 && curated === 0
        ? "Every referenced item has been confirmed against Wowhead."
        : parts.join(" · "),
      harvested,
      curated,
      resolved: resolved.length,
      corrected,
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

/**
 * Mapping armor tokens to the tier pieces they buy.
 *
 * Kept apart from the item backfill above because it costs differently and
 * answers a different question. That one asks Wowhead what an item *is*, one
 * cheap XML fragment at a time. This one asks what a token *buys*, which only
 * the full item page carries — so it is asked once per token rather than once
 * per piece, and a whole expansion is tens of requests instead of hundreds.
 *
 * Two passes, because the cache cannot tell a token from anything else by
 * looking at it:
 *
 *  1. Identify — the cheap XML again, for rows Wowhead has confirmed and given
 *     no slot. A token reports no inventory slot at all, so that narrows the
 *     candidates without anyone having to recognise a name. Rows come back
 *     marked as tokens or, just as usefully, marked as not.
 *  2. Read the vendor listing — one page per known token, filtered to the
 *     pieces the token alone buys. See `parseTokenRedemptions` for why the
 *     arena sets and the Sunwell upgrades are not tier.
 *
 * Both are capped per press and resume where they left off, so a first run
 * over a full cache is a few presses and never a burst.
 */

export interface BackfillTokensResult {
  ok: boolean;
  message: string;
  /** Ids asked about this run. */
  checked: number;
  /** Of those, the ones Wowhead files as armor tokens. */
  tokens: number;
  /** Token pages read this run. */
  listingsRead: number;
  /** Piece→token edges written. */
  edges: number;
  /** Work left for the next press. */
  remaining: number;
}

/** Cheap XML lookups per press — the same shape of trickle as the item backfill. */
const IDENTIFY_LIMIT = 60;
/** Full item pages per press. Heavier responses, so a much smaller bite. */
const LISTING_LIMIT = 8;

export async function backfillTierTokens(): Promise<BackfillTokensResult> {
  const empty = { checked: 0, tokens: 0, listingsRead: 0, edges: 0, remaining: 0 };
  try {
    requireCapability(await resolveViewer(), "import.run");
    const repo = await getWriteRepo();
    const queue = await repo.listTokenBackfill();

    // Pass 1 — which of these are tokens at all?
    const { resolved, throttled: identifyThrottled } = await resolveItemsFromWowhead(
      queue.unchecked,
      { limit: IDENTIFY_LIMIT },
    );
    if (resolved.length > 0) await repo.saveResolvedItems(resolved);
    const found = resolved.filter((i) => i.armorToken).map((i) => i.id);

    // Pass 2 — what does each token buy? Tokens found just now are read in the
    // same press: an officer who pressed once should see edges, not a promise.
    const pages = [...new Set([...queue.tokensWithoutPieces, ...found])];
    const listing = identifyThrottled
      ? { edges: [], pieces: [], failed: [], throttled: true }
      : await fetchTokenRedemptions(pages, { limit: LISTING_LIMIT });

    // Pieces first: the edge writer creates a bare row for an id the cache has
    // never seen, and this is what gives that row a name to render before the
    // item resolver gets round to confirming it.
    if (listing.pieces.length > 0) await repo.addItemsIfMissing(listing.pieces);
    const edges = listing.edges.length > 0 ? await repo.saveTokenRedemptions(listing.edges) : 0;

    const after = await repo.listTokenBackfill();
    const remaining = after.unchecked.length + after.tokensWithoutPieces.length;
    const throttled = identifyThrottled || listing.throttled;

    refreshAfterWrite("/", "layout");
    const parts = [
      resolved.length > 0 ? `${resolved.length} ids checked` : undefined,
      found.length > 0 ? `${found.length} armor tokens found` : undefined,
      edges > 0
        ? `${edges} tier pieces mapped from ${pages.length - listing.failed.length} token${
            pages.length - listing.failed.length === 1 ? "" : "s"
          }`
        : undefined,
      listing.failed.length > 0
        ? `${listing.failed.length} token${listing.failed.length === 1 ? "" : "s"} listed no tier piece`
        : undefined,
      throttled
        ? `Wowhead started refusing requests — press again in a few minutes for the remaining ${remaining}`
        : remaining > 0
          ? `${remaining} left, press again to continue`
          : undefined,
    ].filter(Boolean);

    return {
      ok: true,
      message:
        parts.length === 0
          ? "Every armor token the cache knows about is already mapped to its tier pieces."
          : parts.join(" · "),
      checked: resolved.length,
      tokens: found.length,
      listingsRead: pages.length - listing.failed.length,
      edges,
      remaining,
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Could not map the tier tokens.",
      ...empty,
    };
  }
}

/* ------------------------------------------- giving the priority sheet its ids */

export interface SheetNameResult {
  ok: boolean;
  message: string;
  /** Sheet names that now have an item id, so they render like every other item. */
  matched: number;
  /**
   * The names that stayed plain text, each with why.
   *
   * The list, not a count: every one of these is a person's job and they are
   * different jobs — fix a misspelling in the sheet, or decide which of two
   * identically named items the council meant. A count alone told an officer
   * that four things needed doing and nothing about what.
   */
  unmatched: UnmatchedName[];
  /** Still unlooked-at after this run — the per-run cap left some over. */
  remaining: number;
}

/** One press's worth of name lookups. Same reasoning as RESOLVE_LIMIT. */
const NAME_LIMIT = 40;

/**
 * Give the priority sheet's rows their item ids.
 *
 * A council writes its sheet in names, and most of what a sheet lists is
 * something nobody in the guild has wishlisted or won yet — so the cache has
 * never seen an id for it and the row renders as plain text: no icon, no
 * quality colour, no Wowhead hover, on the page officers read while deciding
 * who gets a drop.
 *
 * The lookup only accepts an exact name match, and only when there is exactly
 * one — see `pickExactItem`. A near-miss is left for a person, because a
 * plausible wrong id here would put the wrong item's tooltip under an
 * officer's cursor mid-raid, which is worse in every way than a plain name.
 *
 * Rows land unverified, so the ordinary backfill picks them up next press and
 * confirms them against the item XML (which is also where the phase comes from).
 */
export async function resolveSheetItemNames(): Promise<SheetNameResult> {
  try {
    requireCapability(await resolveViewer(), "import.run");
    const repo = await getWriteRepo();
    const names = await repo.listUnmatchedSheetNames();
    if (names.length === 0) {
      return {
        ok: true,
        message: "Every item on every sheet already has an id.",
        matched: 0,
        unmatched: [],
        remaining: 0,
      };
    }
    const { resolved, unmatched, throttled } = await resolveItemIdsByName(names, {
      limit: NAME_LIMIT,
    });
    const matched = resolved.length > 0 ? await repo.addItemsIfMissing(resolved) : 0;
    const remaining = Math.max(0, names.length - resolved.length - unmatched.length);

    refreshAfterWrite("/", "layout");
    const parts = [
      `${resolved.length} of ${Math.min(names.length, NAME_LIMIT)} names identified`,
      matched > 0 ? `${matched} added to the cache` : undefined,
      throttled
        ? `Wowhead started refusing requests — press again in a few minutes for the remaining ${remaining}`
        : remaining > 0
          ? `${remaining} left, press again to continue`
          : undefined,
    ].filter(Boolean);
    return {
      ok: true,
      message: parts.join(" · "),
      matched,
      unmatched,
      remaining,
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Could not look the sheet's items up.",
      matched: 0,
      unmatched: [],
      remaining: 0,
    };
  }
}
