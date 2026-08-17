import { describe, expect, it } from "vitest";
import {
  costPerUse,
  costPerUseMap,
  defaultPriceFor,
  effectivePrice,
} from "@/lib/wcl/consumable-prices";

describe("consumable pricing", () => {
  it("prices known consumables from the default catalog", () => {
    expect(defaultPriceFor("Super Sapper Charge")).toEqual({ gold: 15, charges: 1 });
    expect(defaultPriceFor("Destruction Potion").gold).toBe(17);
  });

  it("spreads a charged item's price across its charges", () => {
    // Drums: 12g for 50 charges → 0.24g per use, not 12g.
    expect(costPerUse(defaultPriceFor("Drums of Battle"))).toBeCloseTo(0.24);
    expect(costPerUse({ gold: 12, charges: 1 })).toBe(12);
  });

  it("treats conjured/self-made items as free and unknowns sensibly", () => {
    expect(defaultPriceFor("Master Healthstone").gold).toBe(0);
    expect(defaultPriceFor("Brand New Potion").gold).toBe(8); // unlisted potion fallback
    expect(defaultPriceFor("Some Trinket").gold).toBe(0);
  });

  it("prices explicit prep staples and falls back by family for the rest", () => {
    // Explicit catalog entries.
    expect(defaultPriceFor("Flask of Relentless Assault").gold).toBe(82);
    expect(defaultPriceFor("Elixir of Major Shadow Power").gold).toBe(6);
    // Labelled by its buff, so no name-pattern fallback reaches it — without an
    // explicit entry this elixir is free, which is the quiet kind of wrong.
    expect(defaultPriceFor("Greater Mana Regeneration")).toEqual({ gold: 3, charges: 1 });
    expect(defaultPriceFor("Scroll of Agility V").gold).toBe(8);
    expect(defaultPriceFor("Flame Cap").gold).toBe(3);
    expect(defaultPriceFor("Food").gold).toBe(0.5);
    expect(defaultPriceFor("Weapon oil/stone").gold).toBe(4);
    // Family fallbacks for anything not listed.
    expect(defaultPriceFor("Flask of Fortification").gold).toBe(25);
    expect(defaultPriceFor("Elixir of the Mongoose").gold).toBe(12);
    expect(defaultPriceFor("Adept's Elixir").gold).toBe(12);
    // Scrolls scale by rank — an unlisted V is far dearer than I.
    expect(defaultPriceFor("Scroll of Intellect V").gold).toBe(20);
    expect(defaultPriceFor("Scroll of Intellect I").gold).toBe(1);
    expect(defaultPriceFor("Scroll of Intellect").gold).toBe(3); // rank unknown → generic
  });

  it("prefers a raid's logged override over the default", () => {
    const overrides = { "Haste Potion": { gold: 40, charges: 1 } };
    expect(effectivePrice("Haste Potion", overrides).gold).toBe(40);
    expect(effectivePrice("Destruction Potion", overrides).gold).toBe(17); // untouched → default
    const map = costPerUseMap(["Haste Potion", "Drums of Battle"], overrides);
    expect(map["Haste Potion"]).toBe(40);
    expect(map["Drums of Battle"]).toBeCloseTo(0.24);
  });
});
