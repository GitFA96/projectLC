import type { Item, Phase, Quality } from "@/lib/types";
import { PHASE_IDS } from "@/lib/constants/wow";
import { normalizeIcon, slotFromInventoryType } from "@/lib/items/item-data";
import { normalizeItemName } from "@/lib/loot/priority-sheet";
import {
  parseTokenRedemptions,
  type TokenRedemptionEdge,
} from "@/lib/items/tier-tokens";

/**
 * The one place the app reaches the network for item data: Wowhead's item XML
 * (name, quality, icon, slot in a single small response), fetched once per
 * item id and written straight into the cache.
 *
 * Deliberately bounded: never called while rendering, never for an id the
 * cache already knows, and capped per run. An item that can't be resolved
 * (deleted id, network down) simply stays unresolved and renders as its id —
 * the Wowhead hover tooltip works from the id alone regardless.
 */

const XML_URL = (itemId: number) => `https://www.wowhead.com/tbc/item=${itemId}&xml`;
/** The full item page — the only place the vendor listing appears. Redirects to a slug. */
const PAGE_URL = (itemId: number) => `https://www.wowhead.com/tbc/item=${itemId}`;

/** Wowhead's subclass for "Armor Tokens", under the Miscellaneous item class. */
const ARMOR_TOKEN_SUBCLASS = -2;

/** Wowhead's numeric quality scale. */
const QUALITY_BY_ID: Record<number, Quality> = {
  0: "poor",
  1: "common",
  2: "uncommon",
  3: "rare",
  4: "epic",
  5: "legendary",
};

function tag(xml: string, name: string): string | undefined {
  const match = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(xml);
  const value = match?.[1]?.replace(/^<!\[CDATA\[|\]\]>$/g, "").trim();
  return value ? value : undefined;
}

/** Armor token subclass ids are negative, so digits alone are not enough. */
function attr(
  xml: string,
  name: string,
  attribute: string,
  { signed = false }: { signed?: boolean } = {},
): number | undefined {
  const digits = signed ? "-?\\d+" : "\\d+";
  const match = new RegExp(`<${name}[^>]*\\b${attribute}="(${digits})"`).exec(xml);
  return match ? Number(match[1]) : undefined;
}

/**
 * Which content phase Wowhead files an item under.
 *
 * It rides in the tooltip HTML rather than in a field of its own — the little
 * grey "Phase 2" beside the item's name — so it is read out of the markup:
 *
 *     <th><b class="q0 whtt-extra">Phase 2</b></th>
 *
 * Nothing else in that response carries it, and the officer was otherwise
 * setting it by hand on every item. Anything that isn't a phase this app knows
 * (a number outside 1–5, or an extra tag that isn't a phase at all) is left
 * undefined rather than guessed — see PHASE_IDS.
 */
export function parseWowheadPhase(xml: string): Phase | undefined {
  const match = /whtt-extra[^>]*>\s*Phase\s+(\d+)\s*</i.exec(xml);
  if (!match) return undefined;
  const phase = Number(match[1]);
  return (PHASE_IDS as readonly number[]).includes(phase) ? (phase as Phase) : undefined;
}

/** Parse the fields we cache out of one item's XML. Exported for testing. */
export function parseWowheadItemXml(itemId: number, xml: string): Item | undefined {
  if (!/<item[\s>]/.test(xml) || /<error>/.test(xml)) return undefined;
  const name = tag(xml, "name");
  const qualityId = attr(xml, "quality", "id");
  const quality = qualityId !== undefined ? QUALITY_BY_ID[qualityId] : undefined;
  const icon = normalizeIcon(tag(xml, "icon")?.toLowerCase());
  const slot = slotFromInventoryType(attr(xml, "inventorySlot", "id"));
  // Wowhead files the raid tokens under a subclass of their own, which is the
  // only machine-readable way to tell "this thing has no slot" from "we don't
  // know its slot yet" — both of which arrive here as a missing slot.
  const subclass = attr(xml, "subclass", "id", { signed: true });
  const armorToken = subclass === undefined ? undefined : subclass === ARMOR_TOKEN_SUBCLASS;
  if (!name && !icon && !quality) return undefined;
  return { id: itemId, name, quality, icon, slot, armorToken, phase: parseWowheadPhase(xml) };
}

type FetchOutcome =
  | { kind: "item"; item: Item }
  /** Wowhead answered, but there's nothing usable for that id. */
  | { kind: "unknown" }
  /** Wowhead is turning us away (429/403) — stop asking for now. */
  | { kind: "throttled" };

async function fetchOne(itemId: number, timeoutMs: number): Promise<FetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(XML_URL(itemId), {
      signal: controller.signal,
      headers: { "User-Agent": "projectlc-guild-tracker" },
      cache: "no-store",
    });
    if (res.status === 429 || res.status === 403) return { kind: "throttled" };
    if (!res.ok) return { kind: "unknown" };
    const item = parseWowheadItemXml(itemId, await res.text());
    return item ? { kind: "item", item } : { kind: "unknown" };
  } catch {
    return { kind: "unknown" };
  } finally {
    clearTimeout(timer);
  }
}

export interface ResolveResult {
  resolved: Item[];
  /** Ids Wowhead had nothing usable for — they stay unresolved, not retried in a loop. */
  failed: number[];
  /** True when the run stopped early because Wowhead started refusing requests. */
  throttled: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Look up item ids one at a time with a short pause between them: a backfill
 * is a trickle, not a burst. `limit` caps one run and whatever is left over is
 * picked up on the next press, so a whole tier's backlog costs a few presses
 * instead of one flood — which is what gets a client turned away.
 *
 * A refusal (429/403) ends the run immediately: those ids are NOT reported as
 * "not found", because the item is fine and pressing again later will work.
 */
export async function resolveItemsFromWowhead(
  itemIds: number[],
  opts: { limit?: number; pauseMs?: number; timeoutMs?: number } = {},
): Promise<ResolveResult> {
  const { limit = 60, pauseMs = 250, timeoutMs = 8000 } = opts;
  const queue = [...new Set(itemIds)].slice(0, limit);
  const resolved: Item[] = [];
  const failed: number[] = [];

  for (const [index, itemId] of queue.entries()) {
    if (index > 0) await sleep(pauseMs);
    const outcome = await fetchOne(itemId, timeoutMs);
    if (outcome.kind === "throttled") return { resolved, failed, throttled: true };
    if (outcome.kind === "item") resolved.push(outcome.item);
    else failed.push(itemId);
  }
  return { resolved, failed, throttled: false };
}

export interface TokenRedemptionResult {
  edges: TokenRedemptionEdge[];
  /** What the vendor listing knew about each piece — gap-fill material only. */
  pieces: Item[];
  /** Tokens whose page named no piece: left unlearned rather than marked empty. */
  failed: number[];
  throttled: boolean;
}

/**
 * Which tier pieces each of these tokens buys, from Wowhead's item page.
 *
 * The heavier of the two Wowhead calls — a page rather than an XML fragment —
 * which is why it is asked once per *token*, not once per piece: one page
 * yields every edge for that token at once, so all of TBC is tens of requests
 * rather than hundreds. Same trickle and the same immediate stop on a refusal
 * as `resolveItemsFromWowhead`.
 */
export async function fetchTokenRedemptions(
  tokenIds: number[],
  opts: { limit?: number; pauseMs?: number; timeoutMs?: number } = {},
): Promise<TokenRedemptionResult> {
  const { limit = 8, pauseMs = 400, timeoutMs = 15000 } = opts;
  const queue = [...new Set(tokenIds)].slice(0, limit);
  const edges: TokenRedemptionEdge[] = [];
  const pieces: Item[] = [];
  const failed: number[] = [];

  for (const [index, tokenId] of queue.entries()) {
    if (index > 0) await sleep(pauseMs);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(PAGE_URL(tokenId), {
        signal: controller.signal,
        headers: { "User-Agent": "projectlc-guild-tracker" },
        cache: "no-store",
        redirect: "follow",
      });
      if (res.status === 429 || res.status === 403) {
        return { edges, pieces, failed, throttled: true };
      }
      if (!res.ok) {
        failed.push(tokenId);
        continue;
      }
      const listing = parseTokenRedemptions(tokenId, await res.text());
      if (listing.edges.length === 0) failed.push(tokenId);
      edges.push(...listing.edges);
      pieces.push(...listing.pieces);
    } catch {
      failed.push(tokenId);
    } finally {
      clearTimeout(timer);
    }
  }
  return { edges, pieces, failed, throttled: false };
}

/* ------------------------------------------------------ resolving by name */

/** Wowhead's type id for an item, in the search index's mixed result list. */
const SEARCH_TYPE_ITEM = 3;

const SEARCH_URL = (name: string) =>
  `https://www.wowhead.com/tbc/search/suggestions-template?q=${encodeURIComponent(name)}`;

interface SearchHit {
  type?: number;
  id?: number;
  name?: string;
  icon?: string;
  quality?: number;
}

/**
 * The one hit that *is* this name, or nothing.
 *
 * The rule is exact equality under the same normalization the app matches
 * cached names with — not "the best result", not "the first result". Wowhead's
 * search is a search: it answers a misspelling with something plausible, and a
 * plausible answer is the worst possible outcome here, because the id ends up
 * on a loot sheet and an officer hovers it to decide who gets a drop.
 *
 * Two exact matches is also nothing. TBC has a handful of names shared by
 * items of different item levels, and picking one would be a coin flip an
 * officer never saw us make.
 */
export function pickExactItem(queryName: string, results: unknown): SearchHit | undefined {
  const hits = Array.isArray((results as { results?: unknown[] })?.results)
    ? ((results as { results: SearchHit[] }).results)
    : [];
  const wanted = normalizeItemName(queryName);
  const exact = hits.filter(
    (h) =>
      h?.type === SEARCH_TYPE_ITEM &&
      typeof h.id === "number" &&
      typeof h.name === "string" &&
      normalizeItemName(h.name) === wanted,
  );
  return exact.length === 1 ? exact[0] : undefined;
}

export interface NameResolveResult {
  /** Names Wowhead identified exactly, as cache rows. */
  resolved: Item[];
  /** Names with no single exact match. Left for a person — never guessed at. */
  unmatched: string[];
  throttled: boolean;
}

/**
 * Turn item names into cache rows.
 *
 * The priority sheet is written in names, because a council writes down what it
 * calls a thing; everything else in the app is keyed by id. Most sheet rows
 * therefore render as plain text — no icon, no Wowhead hover — until somebody
 * wishlists or wins the item and an id arrives by another route.
 *
 * These rows are written **unverified**: the search index gives a name, an icon
 * and a quality, which is enough to render, but the item XML is what this app
 * treats as Wowhead having answered. The ordinary resolver picks them up
 * afterwards and fills in slot and phase. Same trickle and the same immediate
 * stop on a refusal as the rest of this module.
 */
export async function resolveItemIdsByName(
  names: string[],
  opts: { limit?: number; pauseMs?: number; timeoutMs?: number } = {},
): Promise<NameResolveResult> {
  const { limit = 40, pauseMs = 300, timeoutMs = 8000 } = opts;
  const queue = [...new Set(names.map((n) => n.trim()).filter(Boolean))].slice(0, limit);
  const resolved: Item[] = [];
  const unmatched: string[] = [];

  for (const [index, name] of queue.entries()) {
    if (index > 0) await sleep(pauseMs);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(SEARCH_URL(name), {
        signal: controller.signal,
        headers: { "User-Agent": "projectlc-guild-tracker" },
        cache: "no-store",
      });
      if (res.status === 429 || res.status === 403) {
        return { resolved, unmatched, throttled: true };
      }
      if (!res.ok) {
        unmatched.push(name);
        continue;
      }
      const hit = pickExactItem(name, await res.json());
      if (!hit || hit.id === undefined) {
        unmatched.push(name);
        continue;
      }
      resolved.push({
        id: hit.id,
        name: hit.name,
        quality: hit.quality !== undefined ? QUALITY_BY_ID[hit.quality] : undefined,
        icon: normalizeIcon(hit.icon?.toLowerCase()),
      });
    } catch {
      unmatched.push(name);
    } finally {
      clearTimeout(timer);
    }
  }
  return { resolved, unmatched, throttled: false };
}
