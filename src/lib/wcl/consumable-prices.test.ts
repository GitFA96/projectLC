import { describe, expect, it } from "vitest";
import {
  costPerUse,
  costPerUseMap,
  defaultPriceFor,
  effectivePrice,
} from "@/lib/wcl/consumable-prices";
import { SCROLL_LABELS } from "@/lib/wcl/consumables";

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

  it("prices every scroll rank the curated list knows", () => {
    /*
     * The coupling that goes wrong quietly: a scroll curated by id reaches the
     * gold view under its own label, and a label with no catalog entry falls
     * through to the family default. That is a real number being wrong on a
     * page officers read, with nothing to notice it — so the catalog is checked
     * against the curated list rather than trusted to keep up with it.
     */
    for (const label of SCROLL_LABELS) {
      const rank = /\s(II|III|IV|V)$/.exec(label)?.[1] ?? "I";
      const price = defaultPriceFor(label);
      expect(price.charges, `${label} has no price`).toBe(1);
      expect(price.gold, `${label} is priced at nothing`).toBeGreaterThan(0);
      // A listed rank must not be landing on the family fallback, which is what
      // "priced by rank" looks like when the catalog entry is simply missing.
      const fallback = { I: 1, II: 2, III: 3, IV: 6, V: 20 }[rank];
      if (price.gold === fallback && rank !== "I") {
        expect.unreachable(`${label} looks like it fell through to the rank fallback`);
      }
    }
  });

  it("prices explicit prep staples and falls back by family for the rest", () => {
    // Explicit catalog entries.
    expect(defaultPriceFor("Flask of Relentless Assault").gold).toBe(82);
    expect(defaultPriceFor("Elixir of Major Shadow Power").gold).toBe(6);
    // Keyed by the item name ingest now stores. The name-pattern fallback only
    // catches "elixir of…" or "…elixir", so a mana-regen elixir under its buff
    // name reached no entry and priced at 0 — free, and silently so.
    expect(defaultPriceFor("Elixir of Major Mageblood")).toEqual({ gold: 3, charges: 1 });
    expect(defaultPriceFor("Mageblood Potion")).toEqual({ gold: 3, charges: 1 });
    expect(defaultPriceFor("Scroll of Agility V").gold).toBe(8);
    expect(defaultPriceFor("Flame Cap").gold).toBe(3);
    expect(defaultPriceFor("Food").gold).toBe(0.5);
    expect(defaultPriceFor("Weapon oil/stone").gold).toBe(4);
    // Family fallbacks for anything not listed.
    expect(defaultPriceFor("Flask of Fortification").gold).toBe(25);
    expect(defaultPriceFor("Elixir of the Mongoose").gold).toBe(12);
    expect(defaultPriceFor("Adept's Elixir").gold).toBe(12);
    // Every real scroll rank is now listed outright, and the ranks differ —
    // rank was lost entirely before, so 202 uses of Agility IV were priced as
    // rank I.
    expect(defaultPriceFor("Scroll of Agility").gold).toBe(1);
    expect(defaultPriceFor("Scroll of Agility IV").gold).toBe(3);
    expect(defaultPriceFor("Scroll of Agility V").gold).toBe(8);
    // The rank-scaling fallback still covers a scroll nobody has listed.
    expect(defaultPriceFor("Scroll of Cunning V").gold).toBe(20);
    expect(defaultPriceFor("Scroll of Cunning").gold).toBe(3);
    // "Scroll of Intellect I" is nobody's item name — the rank I scroll is just
    // "Scroll of Intellect" — so this stays on the rank fallback.
    expect(defaultPriceFor("Scroll of Intellect I").gold).toBe(1);
    /*
     * The rankless label now means rank I, because that IS the rank I item's
     * name. It used to be the catch-all for ranks I–IV at a blended 3g.
     *
     * So an id-less row — only a report imported before the ranks were curated
     * — prices as rank I rather than as a guess at the middle. That is the
     * cheapest reading of an unknown, and a re-import is what removes the
     * ambiguity rather than repricing it: every rank has an id now.
     */
    expect(defaultPriceFor("Scroll of Intellect").gold).toBe(0.5);
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
