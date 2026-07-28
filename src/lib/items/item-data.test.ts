import { describe, expect, it } from "vitest";
import {
  harvestItemFacts,
  isPlaceholderName,
  itemDisplayName,
  mergeItemFacts,
  normalizeIcon,
  qualityFromId,
} from "@/lib/items/item-data";
import { parseWowheadItemXml } from "@/lib/items/wowhead";
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
});
