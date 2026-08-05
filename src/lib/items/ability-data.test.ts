import { describe, expect, it } from "vitest";
import {
  describeFromTooltip,
  itemUseSpellId,
  parseRefKey,
  parseWowheadTooltip,
  refKey,
  refLabel,
  wowheadUrl,
} from "@/lib/items/ability-data";

/** Wowhead's real response for Execute (spell 25236), trimmed. */
const EXECUTE = JSON.stringify({
  name: "Execute",
  icon: "inv_sword_48",
  tooltip:
    '<table><tr><td><a class="whtt-name" href="/tbc/spell=25236/execute"><b class="whtt-name">Execute</b></a>' +
    '<table width="100%"><tr><td>15 Rage</td><th>Melee Range</th></tr></table>Instant cast' +
    '<div class="wowhead-tooltip-requirements">Requires Warrior</div></td></tr></table>' +
    // The effect lives in a SECOND table, in a div of its own.
    '<table><tr><td><span class="wowhead-tooltip-requirements">Requires Melee Weapon</span>' +
    '<div class="q">Attempt to finish off a wounded foe, causing 925 damage.</div></td></tr></table>',
});

/** Wowhead's real response for Goblin Sapper Charge (item 10646), trimmed. */
const SAPPER = JSON.stringify({
  name: "Goblin Sapper Charge",
  quality: 1,
  icon: "spell_fire_selfdestruct",
  tooltip:
    '<table><tr><td><b class="q1">Goblin Sapper Charge</b><span class="q whtt-extra whtt-ilvl"><br>Item Level 41</span></td></tr></table>' +
    '<table><tr><td>Requires <a href="/tbc/skill=202/engineering" class="q1">Engineering</a> (205)<br>' +
    '<span id="useText1" class="q2">Use: <a href="/tbc/spell=13241/goblin-sapper-charge" class="q2">Explodes when triggered dealing 450 to 750 Fire damage to all enemies nearby and 375 to 625 damage to you.</a> (5 Min Cooldown)</span>' +
    '<div class="whtt-extra whtt-maxstack">Max Stack: 10</div><div class="whtt-sellprice">Sell Price: 5</div></td></tr></table>',
});

describe("refs carry their id space", () => {
  it("keys and labels a spell and an item apart at the same id", () => {
    // 23827 is Super Sapper Charge as an item and Master Demonologist as a
    // spell. Collapsing them is how a sapper came back named after a warlock
    // talent — this is the whole reason the kind travels with the id.
    expect(refKey({ kind: "spell", id: 23827 })).not.toBe(refKey({ kind: "item", id: 23827 }));
    expect(refLabel({ kind: "item", id: 10646 })).toBe("Item 10646");
    expect(refLabel({ kind: "spell", id: 25236 })).toBe("Spell 25236");
  });

  it("links each kind at its own Wowhead page", () => {
    expect(wowheadUrl({ kind: "spell", id: 25236 })).toBe("https://www.wowhead.com/tbc/spell=25236");
    expect(wowheadUrl({ kind: "item", id: 10646 })).toBe("https://www.wowhead.com/tbc/item=10646");
  });

  it("round-trips a key so the panel can hand one back", () => {
    expect(parseRefKey("item:10646")).toEqual({ kind: "item", id: 10646 });
    expect(parseRefKey("spell:25236")).toEqual({ kind: "spell", id: 25236 });
  });

  it("rejects anything that isn't a ref rather than guessing a kind", () => {
    expect(parseRefKey("10646")).toBeUndefined();
    expect(parseRefKey("enchant:33")).toBeUndefined();
    expect(parseRefKey("")).toBeUndefined();
  });
});

describe("parseWowheadTooltip", () => {
  it("reads a spell's name and icon", () => {
    const info = parseWowheadTooltip({ kind: "spell", id: 25236 }, EXECUTE)!;
    expect(info).toMatchObject({ kind: "spell", id: 25236, name: "Execute", icon: "inv_sword_48" });
  });

  it("reads an item, which the spell endpoint has nothing for", () => {
    const info = parseWowheadTooltip({ kind: "item", id: 10646 }, SAPPER)!;
    expect(info.name).toBe("Goblin Sapper Charge");
    expect(info.kind).toBe("item");
  });

  it("returns nothing for a response with no name rather than a blank entry", () => {
    expect(parseWowheadTooltip({ kind: "spell", id: 1 }, JSON.stringify({ tooltip: "x" }))).toBeUndefined();
    expect(parseWowheadTooltip({ kind: "spell", id: 1 }, JSON.stringify({ name: "  " }))).toBeUndefined();
  });

  it("returns nothing for Wowhead's not-found body", () => {
    expect(
      parseWowheadTooltip({ kind: "spell", id: 10646 }, JSON.stringify({ error: "Entity not found" })),
    ).toBeUndefined();
  });

  it("survives a non-JSON body instead of throwing", () => {
    expect(parseWowheadTooltip({ kind: "spell", id: 1 }, "<!DOCTYPE html>")).toBeUndefined();
  });
});

describe("describeFromTooltip", () => {
  it("keeps a spell's effect text and drops the cost and requirements", () => {
    // The effect is in a table of its own — stripping tables the way an item
    // needs leaves "Instant cast Requires Warrior", which describes nothing.
    const info = parseWowheadTooltip({ kind: "spell", id: 25236 }, EXECUTE)!;
    expect(info.description).toContain("finish off a wounded foe");
    expect(info.description).not.toContain("15 Rage");
    expect(info.description).not.toContain("Requires");
  });

  it("keeps an item's Use line, which lives inside the tables", () => {
    // An item tooltip is ALL tables — stripping them the way a spell needs
    // leaves nothing at all, which is how items ended up with no description.
    const info = parseWowheadTooltip({ kind: "item", id: 10646 }, SAPPER)!;
    expect(info.description).toContain("Explodes when triggered");
    expect(info.description).not.toContain("Sell Price");
    expect(info.description).not.toContain("Item Level");
  });

  it("strips markup and collapses whitespace", () => {
    expect(describeFromTooltip("<b>Hits</b>   the\n\ntarget")).toBe("Hits the target");
  });

  it("decodes the entities Wowhead emits", () => {
    expect(describeFromTooltip("Kael&#39;thas &amp; friends")).toBe("Kael'thas & friends");
  });

  it("truncates something long enough to break a tooltip", () => {
    const out = describeFromTooltip("word ".repeat(200))!;
    expect(out.length).toBeLessThanOrEqual(240);
    expect(out.endsWith("…")).toBe(true);
  });

  it("returns nothing when only markup remains", () => {
    expect(describeFromTooltip("<table><tr><td>15 Rage</td></tr></table>")).toBeUndefined();
  });
});

describe("itemUseSpellId", () => {
  it("finds the spell an item's Use effect casts", () => {
    // This is what collapses "Item 10646" (sim) and "Goblin Sapper Charge"
    // (log) into one row instead of one sim-only and one pull-only.
    expect(parseWowheadTooltip({ kind: "item", id: 10646 }, SAPPER)!.useSpellId).toBe(13241);
  });

  it("reads it out of the markup rather than a list of our own", () => {
    expect(itemUseSpellId('Use: <a href="/tbc/spell=28507/haste">Haste</a>')).toBe(28507);
  });

  it("ignores a spell link that isn't the Use effect", () => {
    // A requirement or set-bonus link is not what the player pressed.
    expect(itemUseSpellId('Requires <a href="/tbc/spell=202/engineering">Engineering</a>')).toBeUndefined();
  });

  it("leaves a spell alone — only items have a Use effect", () => {
    expect(parseWowheadTooltip({ kind: "spell", id: 25236 }, EXECUTE)!.useSpellId).toBeUndefined();
  });
});
