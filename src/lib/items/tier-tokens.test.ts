import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  NO_TOKEN_REDEMPTIONS,
  parseTokenRedemptions,
  tokenRedemptions,
} from "@/lib/items/tier-tokens";
import type { Item } from "@/lib/types";

/** The real "Currency for" table off Helm of the Vanquished Champion (30242). */
const tokenPage = readFileSync(
  path.join(import.meta.dirname, "__fixtures__/token-page.html"),
  "utf8",
);

/** Wowhead's shape, so a synthetic row is checkable against the fixture above. */
const listview = (rows: unknown[]): string =>
  `new Listview({ template: 'item', id: 'currency-for', data: ${JSON.stringify(rows)} });`;

const tokenOnly = (tokenId: number) => [[0, [], [[tokenId, 1]]]];

describe("reading a token's vendor listing", () => {
  it("takes the tier pieces off a real page", () => {
    const { edges, pieces } = parseTokenRedemptions(30242, tokenPage);

    expect(pieces.map((p) => p.name)).toEqual([
      "Crystalforge Faceguard",
      "Crystalforge War-Helm",
      "Crystalforge Greathelm",
      "Deathmantle Helm",
      "Cataclysm Headguard",
      "Cataclysm Headpiece",
      "Cataclysm Helm",
    ]);
    expect(edges.every((e) => e.tokenId === 30242)).toBe(true);
    expect(edges.map((e) => e.pieceId)).toEqual(pieces.map((p) => p.id));
  });

  it("leaves the arena set alone — a token is one of its prices, not its price", () => {
    // Every Merciless Gladiator helm on that page also costs the token. What
    // makes them not tier is that arena points buy them too.
    const { pieces } = parseTokenRedemptions(30242, tokenPage);
    expect(pieces.some((p) => p.name?.includes("Merciless Gladiator"))).toBe(false);
  });

  it("carries what the listing knows about each piece", () => {
    const { pieces } = parseTokenRedemptions(30242, tokenPage);
    expect(pieces.find((p) => p.id === 30166)).toEqual({
      id: 30166,
      name: "Cataclysm Headguard",
      quality: "epic",
      slot: "head",
    });
  });

  it("rejects a price that needs the token AND something else", () => {
    // The Sunwell upgrade's shape: a Sunmote plus the piece you already own.
    const html = listview([
      { id: 34333, name: "Upgraded", cost: [[0, [], [[34664, 1], [30166, 1]]]] },
      { id: 30166, name: "Cataclysm Headguard", cost: tokenOnly(30242) },
    ]);
    expect(parseTokenRedemptions(30242, html).edges).toEqual([
      { pieceId: 30166, tokenId: 30242 },
    ]);
  });

  it("rejects a price with money or a currency attached", () => {
    const html = listview([
      { id: 1, name: "Costs gold too", cost: [[5000, [], [[30242, 1]]]] },
      { id: 2, name: "Costs honor too", cost: [[0, [[1901, 20]], [[30242, 1]]]] },
      { id: 3, name: "Costs a different token", cost: tokenOnly(30243) },
    ]);
    expect(parseTokenRedemptions(30242, html).edges).toEqual([]);
  });

  it("survives a bracket inside an item name", () => {
    const html = listview([{ id: 7, name: "Odd ] Name", cost: tokenOnly(30242) }]);
    expect(parseTokenRedemptions(30242, html).edges).toEqual([{ pieceId: 7, tokenId: 30242 }]);
  });

  it("learns nothing rather than throwing when the page isn't shaped as expected", () => {
    expect(parseTokenRedemptions(30242, "<html>a redesign</html>").edges).toEqual([]);
    expect(parseTokenRedemptions(30242, "id: 'currency-for'\ndata: [{oops]").edges).toEqual([]);
  });
});

describe("the redemption lookup", () => {
  const items: Item[] = [
    { id: 30242 },
    { id: 30166, name: "Cataclysm Headguard", redeemsFrom: 30242 },
    { id: 30171, name: "Cataclysm Headpiece", redeemsFrom: 30242 },
    { id: 30146, name: "Deathmantle Helm", redeemsFrom: 30242 },
    { id: 28749, name: "King's Defender" },
  ];
  const redemptions = tokenRedemptions(items);

  it("says a token delivers the piece it buys, and an item delivers itself", () => {
    expect(redemptions.delivers(30242, 30166)).toBe(true);
    expect(redemptions.delivers(28749, 28749)).toBe(true);
  });

  it("does not run backwards — winning the piece is not winning the token", () => {
    expect(redemptions.delivers(30166, 30242)).toBe(false);
  });

  it("does not make two pieces of the same token interchangeable", () => {
    expect(redemptions.delivers(30166, 30171)).toBe(false);
  });

  it("narrows a token to the pieces that are actually on a list", () => {
    // The whole point of storing the edge on the piece: the raider's own list
    // picks the spec variant, so nothing here has to guess it.
    expect(redemptions.piecesAmong(30242, [30171, 28749])).toEqual([30171]);
    expect(redemptions.piecesAmong(30242, [28749])).toEqual([]);
    expect(redemptions.piecesAmong(28749, [30166])).toEqual([]);
  });

  it("knows which ids buy something", () => {
    expect(redemptions.buysAnything(30242)).toBe(true);
    expect(redemptions.buysAnything(30166)).toBe(false);
  });

  it("makes every item deliver only itself when nothing has been backfilled", () => {
    expect(NO_TOKEN_REDEMPTIONS.delivers(30242, 30166)).toBe(false);
    expect(NO_TOKEN_REDEMPTIONS.delivers(30166, 30166)).toBe(true);
    expect(NO_TOKEN_REDEMPTIONS.tokenFor(30166)).toBeUndefined();
  });
});
