import type { Item, Quality, SlotId } from "@/lib/types";
import { normalizeIcon } from "@/lib/items/item-data";

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

/** Wowhead's numeric quality scale. */
const QUALITY_BY_ID: Record<number, Quality> = {
  0: "poor",
  1: "common",
  2: "uncommon",
  3: "rare",
  4: "epic",
  5: "legendary",
};

/**
 * Wowhead inventory-slot ids → our slot ids. Paired slots resolve to the first
 * of the pair (SLOT_FAMILIES treats ring1/ring2 and the trinkets as one), and
 * slots the tracker doesn't model (shirt, tabard, bags) stay undefined.
 * Relics sit in the ranged slot in TBC.
 */
const SLOT_BY_INVENTORY_TYPE: Record<number, SlotId> = {
  1: "head",
  2: "neck",
  3: "shoulder",
  5: "chest",
  6: "waist",
  7: "legs",
  8: "feet",
  9: "wrist",
  10: "hands",
  11: "ring1",
  12: "trinket1",
  13: "mainHand",
  14: "offHand",
  15: "ranged",
  16: "back",
  17: "mainHand",
  20: "chest",
  21: "mainHand",
  22: "offHand",
  23: "offHand",
  25: "ranged",
  26: "ranged",
  28: "ranged",
};

function tag(xml: string, name: string): string | undefined {
  const match = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(xml);
  const value = match?.[1]?.replace(/^<!\[CDATA\[|\]\]>$/g, "").trim();
  return value ? value : undefined;
}

function attr(xml: string, name: string, attribute: string): number | undefined {
  const match = new RegExp(`<${name}[^>]*\\b${attribute}="(\\d+)"`).exec(xml);
  return match ? Number(match[1]) : undefined;
}

/** Parse the fields we cache out of one item's XML. Exported for testing. */
export function parseWowheadItemXml(itemId: number, xml: string): Item | undefined {
  if (!/<item[\s>]/.test(xml) || /<error>/.test(xml)) return undefined;
  const name = tag(xml, "name");
  const qualityId = attr(xml, "quality", "id");
  const quality = qualityId !== undefined ? QUALITY_BY_ID[qualityId] : undefined;
  const icon = normalizeIcon(tag(xml, "icon")?.toLowerCase());
  const inventorySlot = attr(xml, "inventorySlot", "id");
  const slot = inventorySlot !== undefined ? SLOT_BY_INVENTORY_TYPE[inventorySlot] : undefined;
  if (!name && !icon && !quality) return undefined;
  return { id: itemId, name, quality, icon, slot };
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
