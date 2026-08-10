import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  harvestItemFacts,
  isPlaceholderName,
  itemDisplayName,
  mergeItemFacts,
  normalizeIcon,
  qualityFromId,
} from "@/lib/items/item-data";
import { parseWowheadItemXml, parseWowheadPhase, pickExactItem } from "@/lib/items/wowhead";
import type { GearSet, LootAward, WclPlayerFight } from "@/lib/types";

describe("item names", () => {
  it("treats an invented id name as no name at all", () => {
    expect(isPlaceholderName("Item #30048")).toBe(true);
    expect(isPlaceholderName("Item 30048")).toBe(true);
    expect(isPlaceholderName("  ")).toBe(true);
    expect(isPlaceholderName(undefined)).toBe(true);
    expect(isPlaceholderName("Brighthelm of Justice")).toBe(false);
    // A real item whose name merely starts with "Item" stays a real name.
    expect(isPlaceholderName("Item of Power")).toBe(false);
  });

  it("picks the first real name and falls back to the id", () => {
    expect(itemDisplayName(30048, undefined, "Item #30048", "Brighthelm of Justice")).toBe(
      "Brighthelm of Justice",
    );
    expect(itemDisplayName(30048, "Item #30048", undefined)).toBe("Item #30048");
  });

  it("strips the extension log gear snapshots carry", () => {
    expect(normalizeIcon("inv_helmet_15.jpg")).toBe("inv_helmet_15");
    expect(normalizeIcon("inv_helmet_15")).toBe("inv_helmet_15");
    expect(normalizeIcon(" ")).toBeUndefined();
  });
});

describe("mergeItemFacts", () => {
  it("folds partial sightings into one entry, first real value winning", () => {
    expect(
      mergeItemFacts([
        { id: 30048, name: "Item #30048" }, // invented — must not stick
        { id: 30048, quality: "epic" },
        { id: 30048, name: "Brighthelm of Justice" },
        { id: 30048, icon: "inv_helmet_22.jpg" },
        { id: 30048, name: "A later, ignored name" },
      ]),
    ).toEqual([
      { id: 30048, name: "Brighthelm of Justice", quality: "epic", icon: "inv_helmet_22" },
    ]);
  });

  it("drops sightings that carry nothing but an id", () => {
    expect(mergeItemFacts([{ id: 30048 }, { id: 0, name: "Bad id" }])).toEqual([]);
  });
});

describe("harvestItemFacts", () => {
  const gearSets = [
    {
      id: "gs1",
      characterId: "c1",
      kind: "wishlist",
      phase: 1,
      name: "P1",
      source: "sixtyupgrades",
      importedAt: "2026-01-01T00:00:00.000Z",
      stats: {},
      slots: [{ slot: "head", itemId: 30048, itemName: "Brighthelm of Justice" }],
    },
  ] as unknown as GearSet[];
  const lootAwards = [
    { itemId: 30048, itemName: "Item #30048" },
    { itemId: 30051, itemName: "Boots of the Endless Moor" },
  ] as unknown as LootAward[];
  const wclPlayerFights = [
    {
      gear: [
        {
          slot: 0,
          id: 30048,
          icon: "inv_helmet_22.jpg",
          quality: "epic",
          gems: [{ id: 24030, icon: "inv_jewelcrafting_livingruby_03.jpg" }],
        },
      ],
    },
  ] as unknown as WclPlayerFight[];

  it("pulls names out of wishlists and loot, icons out of log gear", () => {
    const harvested = harvestItemFacts({ gearSets, lootAwards, wclPlayerFights });
    expect(harvested).toContainEqual({
      id: 30048,
      name: "Brighthelm of Justice",
      icon: "inv_helmet_22",
      quality: "epic",
      slot: "head",
    });
    expect(harvested).toContainEqual({ id: 30051, name: "Boots of the Endless Moor" });
  });

  it("harvests socketed gems as items of their own", () => {
    // The log names no gem, but it does carry each one's icon — enough to
    // render, and enough for the resolver to know the id is worth a lookup.
    expect(harvestItemFacts({ gearSets, lootAwards, wclPlayerFights })).toContainEqual({
      id: 24030,
      icon: "inv_jewelcrafting_livingruby_03",
    });
  });
});

describe("qualityFromId", () => {
  it("maps the shared 0–5 scale and refuses to guess outside it", () => {
    expect(qualityFromId(4)).toBe("epic");
    expect(qualityFromId(0)).toBe("poor");
    expect(qualityFromId(9)).toBeUndefined();
    expect(qualityFromId(null)).toBeUndefined();
    expect(qualityFromId(undefined)).toBeUndefined();
  });
});

/** A real Wowhead response, kept whole so the parser is tested against markup
    nobody wrote for it. */
const realXml = readFileSync(
  path.join(import.meta.dirname, "__fixtures__/item-29997.xml"),
  "utf8",
);

describe("parseWowheadItemXml", () => {
  // The real response shape for item=30048 on the TBC domain.
  const xml = `<?xml version="1.0" encoding="UTF-8"?><wowhead><item id="30048">
    <name><![CDATA[Brighthelm of Justice]]></name><level>128</level>
    <quality id="4">Epic</quality><class id="4"><![CDATA[Armor]]></class>
    <icon displayId="46078">inv_helmet_22</icon><inventorySlot id="1">Head</inventorySlot>
    </item></wowhead>`;

  it("reads the four fields the cache stores", () => {
    expect(parseWowheadItemXml(30048, xml)).toEqual({
      id: 30048,
      name: "Brighthelm of Justice",
      quality: "epic",
      icon: "inv_helmet_22",
      slot: "head",
    });
  });

  it("returns nothing for an unknown item or a non-XML body", () => {
    expect(parseWowheadItemXml(1, `<wowhead><error>Item not found!</error></wowhead>`)).toBeUndefined();
    expect(parseWowheadItemXml(1, "<!DOCTYPE html><html>404</html>")).toBeUndefined();
  });

  it("reads the phase off a real response", () => {
    // Captured from item=29997 — the item the officer was filling in by hand
    // when they asked whether this could come from Wowhead. It can: the phase
    // rides in the tooltip markup of the same XML the resolver already fetches.
    expect(parseWowheadItemXml(29997, realXml)).toMatchObject({
      name: "Band of the Ranger-General",
      phase: 2,
    });
  });
});

describe("parseWowheadPhase", () => {
  it("reads the tag beside the item name", () => {
    expect(parseWowheadPhase(realXml)).toBe(2);
    expect(
      parseWowheadPhase(`<th><b class="q0 whtt-extra">Phase 5</b></th>`),
    ).toBe(5);
  });

  it("says nothing rather than guessing", () => {
    // No tag at all — most of TBC's launch items carry none.
    expect(parseWowheadPhase("<wowhead><item id=\"1\"/></wowhead>")).toBeUndefined();
    // A phase outside the ones this app knows, and an extra tag that is not a
    // phase: both are left unset rather than coerced into the nearest number.
    expect(parseWowheadPhase(`<b class="whtt-extra">Phase 9</b>`)).toBeUndefined();
    expect(parseWowheadPhase(`<b class="whtt-extra">Heroic</b>`)).toBeUndefined();
  });
});

describe("pickExactItem", () => {
  const hit = (over: Record<string, unknown>) => ({
    type: 3, id: 1, name: "Blue Suede Shoes", icon: "inv_boots_cloth_01", quality: 4, ...over,
  });

  it("takes the one result that is this name", () => {
    // Real shape, from the suggestions endpoint.
    const body = { search: "Blue Suede Shoes", results: [hit({ id: 30894 })] };
    expect(pickExactItem("Blue Suede Shoes", body)?.id).toBe(30894);
  });

  it("matches the way the sheet is matched — punctuation and case don't count", () => {
    const body = { results: [hit({ id: 30106, name: "Belt of One-Hundred Deaths" })] };
    expect(pickExactItem("belt of one hundred deaths", body)?.id).toBe(30106);
  });

  it("refuses a near miss", () => {
    // What a search does with a name nobody has: it answers with something
    // plausible. A plausible id on a loot sheet is the failure this guards.
    const body = { results: [hit({ id: 999, name: "Blue Suede Boots" })] };
    expect(pickExactItem("Blue Suede Shoes", body)).toBeUndefined();
  });

  it("refuses a tie, and anything that isn't an item", () => {
    const twins = { results: [hit({ id: 1 }), hit({ id: 2 })] };
    expect(pickExactItem("Blue Suede Shoes", twins)).toBeUndefined();
    // type 3 is an item; a spell or an NPC of the same name is not one.
    const spell = { results: [hit({ id: 5, type: 6 })] };
    expect(pickExactItem("Blue Suede Shoes", spell)).toBeUndefined();
  });

  it("survives a body that isn't the shape we expect", () => {
    expect(pickExactItem("Anything", undefined)).toBeUndefined();
    expect(pickExactItem("Anything", { results: "nope" })).toBeUndefined();
    expect(pickExactItem("Anything", { results: [null] })).toBeUndefined();
  });
});
