import type { Item } from "@/lib/types";
import { qualityFromId, slotFromInventoryType } from "@/lib/items/item-data";

/**
 * Armor tokens and the tier pieces they buy.
 *
 * A tier token is the only drop in the game that isn't the thing anyone wants.
 * Gargul records what fell off the boss — "Helm of the Vanquished Champion" —
 * and a SixtyUpgrades list names what the raider walks out of Shattrath with,
 * "Cataclysm Helm". Nothing in the app made those the same event, so a quarter
 * of this guild's loot ledger sat outside every wishlist, every contention
 * board and every "loot owed" sum.
 *
 * **The edge is stored on the piece, not the token**, because that is the
 * direction the domain is one-to-one. One token buys nine pieces — three
 * classes, and three spec variants for most of them — so token→piece needs a
 * judgement about which variant a raider meant. Piece→token needs none, and
 * "which of the pieces this token buys is on their list" then answers the
 * judgement out of the raider's own words instead of ours.
 *
 * Where the mapping comes from is `parseTokenRedemptions` below: Wowhead's
 * vendor listing, read once per token by the backfill. It is not written from
 * anyone's memory of which set is which.
 */

/** What one token buys, and what buys one piece. Empty until the backfill runs. */
export interface TokenRedemptions {
  /** Does an award of `awardedItemId` put `wantedItemId` in their hands? */
  delivers(awardedItemId: number, wantedItemId: number): boolean;
  /** The armor token that buys this piece, if the cache knows of one. */
  tokenFor(pieceId: number): number | undefined;
  /** Which of `itemIds` this token buys — empty for anything that isn't a token. */
  piecesAmong(tokenId: number, itemIds: Iterable<number>): number[];
  /** Is this id known to buy something? */
  buysAnything(itemId: number): boolean;
}

function makeRedemptions(tokenByPiece: ReadonlyMap<number, number>): TokenRedemptions {
  const tokens = new Set(tokenByPiece.values());
  return {
    delivers: (awardedItemId, wantedItemId) =>
      awardedItemId === wantedItemId || tokenByPiece.get(wantedItemId) === awardedItemId,
    tokenFor: (pieceId) => tokenByPiece.get(pieceId),
    piecesAmong: (tokenId, itemIds) => {
      const pieces: number[] = [];
      for (const id of itemIds) if (tokenByPiece.get(id) === tokenId) pieces.push(id);
      return pieces;
    },
    buysAnything: (itemId) => tokens.has(itemId),
  };
}

/**
 * The lookup every reader takes. Callers that have no item cache — most tests,
 * and the seed backend before a backfill — get this, and every item then only
 * ever delivers itself, which is exactly how the app behaved before tokens
 * were modelled at all.
 */
export const NO_TOKEN_REDEMPTIONS: TokenRedemptions = makeRedemptions(new Map());

/** Read the piece→token edges out of the item cache. */
export function tokenRedemptions(items: Iterable<Item>): TokenRedemptions {
  const tokenByPiece = new Map<number, number>();
  for (const item of items) {
    if (item.redeemsFrom !== undefined) tokenByPiece.set(item.id, item.redeemsFrom);
  }
  return makeRedemptions(tokenByPiece);
}

/* ------------------------------------------------------------------ *
 * Reading the vendor listing
 * ------------------------------------------------------------------ */

/** One tier piece and the armor token that buys it. */
export interface TokenRedemptionEdge {
  pieceId: number;
  tokenId: number;
}

export interface TokenRedemptionListing {
  edges: TokenRedemptionEdge[];
  /** What the listing knew about each piece, for the cache to fill gaps from. */
  pieces: Item[];
}

/**
 * One way to buy something: money, then currencies, then items — each pair an
 * id and a quantity. Wowhead's own shape, kept verbatim rather than named into
 * something tidier, because the point is to be checkable against the page.
 */
type CostOption = [number, [number, number][], [number, number][]];

interface CurrencyForRow {
  id?: number;
  name?: string;
  quality?: number;
  slot?: number;
  cost?: CostOption[];
}

/**
 * Scan a balanced `[...]` starting at `open`, ignoring brackets inside JSON
 * strings. Item names are quoted and can hold anything, so counting brackets
 * blind is the kind of parser that works until one item is named oddly.
 */
function balancedArray(text: string, open: number): string | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "[") depth++;
    else if (c === "]" && --depth === 0) return text.slice(open, i + 1);
  }
  return undefined;
}

/**
 * The pieces one armor token buys, read off that token's Wowhead page.
 *
 * The page carries its "Currency for" table inline as JSON — no script has to
 * run — and every row states which class may wear it, which slot it fills and
 * every way it can be bought.
 *
 * **A row counts only when the token is the whole price.** The same table
 * lists the arena sets, which take a token *or* a pile of arena points, and in
 * Sunwell it lists the upgraded T6, which takes a Sunmote *and* the old piece.
 * Requiring exactly one way to buy it, costing exactly one item and no money,
 * is what separates "this token is how you get this" from "this token is one
 * of the things you could spend". Checked against T4, T5 and T6.
 *
 * Returns nothing rather than throwing if the page isn't shaped as expected:
 * a Wowhead redesign should leave the mapping unlearned, not break the import.
 */
export function parseTokenRedemptions(tokenId: number, html: string): TokenRedemptionListing {
  const empty: TokenRedemptionListing = { edges: [], pieces: [] };
  const listview = html.indexOf("id: 'currency-for'");
  if (listview < 0) return empty;
  const open = html.indexOf("data: [", listview);
  if (open < 0) return empty;
  const array = balancedArray(html, open + "data: ".length);
  if (array === undefined) return empty;

  let rows: CurrencyForRow[];
  try {
    rows = JSON.parse(array) as CurrencyForRow[];
  } catch {
    return empty;
  }

  const edges: TokenRedemptionEdge[] = [];
  const pieces: Item[] = [];
  for (const row of rows) {
    if (!Number.isInteger(row.id) || (row.id ?? 0) <= 0 || row.id === tokenId) continue;
    const cost = row.cost;
    if (!Array.isArray(cost) || cost.length !== 1) continue;
    const [money, currencies, items] = cost[0] ?? [];
    if (money !== 0 || !Array.isArray(currencies) || currencies.length !== 0) continue;
    if (!Array.isArray(items) || items.length !== 1 || items[0]?.[0] !== tokenId) continue;

    const pieceId = row.id!;
    edges.push({ pieceId, tokenId });
    pieces.push({
      id: pieceId,
      name: row.name?.trim() || undefined,
      quality: qualityFromId(row.quality),
      slot: slotFromInventoryType(row.slot),
    });
  }
  return { edges, pieces };
}
