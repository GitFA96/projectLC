import { describe, expect, it } from "vitest";
import { buildLootPlan, type LootPlanEntry } from "@/lib/analysis/loot-plan";
import type { Character, ContentionWisher, Item, ItemContention } from "@/lib/types";

function character(name: string): Character {
  return {
    id: `c-${name.toLowerCase()}`,
    guildId: "g1",
    name,
    class: "Warrior",
    spec: "Fury",
    role: "Melee DPS",
    status: "main",
    mainCharacterId: null,
  };
}

function wisher(name: string, over: Partial<ContentionWisher> = {}): ContentionWisher {
  return {
    character: character(name),
    phases: [2],
    listRank: 0,
    currentInSlot: [],
    satisfied: false,
    onSpecAwardsActivePhase: 0,
    awardsThisPhase: [],
    totalOnSpecAwards: 0,
    ...over,
  };
}

function entry(
  itemId: number,
  name: string,
  boss: string | undefined,
  wishers: ContentionWisher[],
  over: Partial<ItemContention> = {},
): LootPlanEntry {
  const item: Item = {
    id: itemId,
    name,
    quality: "epic",
    source: boss ? { zone: "Serpentshrine Cavern", boss } : undefined,
  } as Item;
  return {
    item,
    contention: {
      item,
      itemId,
      itemName: name,
      wishers,
      awards: [],
      openCount: wishers.filter((w) => !w.satisfied).length,
      altWishers: [],
      manualTiers: [],
      ...over,
    } as ItemContention,
  };
}

describe("buildLootPlan", () => {
  it("separates contested, served and unwanted", () => {
    const plan = buildLootPlan("Serpentshrine Cavern", [
      entry(1, "Contested", "Hydross the Unstable", [wisher("Are"), wisher("Melige")]),
      entry(2, "Served", "Hydross the Unstable", [wisher("Are", { satisfied: true })]),
      entry(3, "Unwanted", "Hydross the Unstable", []),
    ]);
    expect(plan.contestedCount).toBe(1);
    expect(plan.servedCount).toBe(1);
    expect(plan.unwantedCount).toBe(1);
    const statuses = plan.bosses[0].items.map((i) => i.status);
    // Contested first — that's the order it gets read out in.
    expect(statuses).toEqual(["contested", "served", "unwanted"]);
  });

  it("orders bosses the way the raid will meet them", () => {
    const plan = buildLootPlan("Serpentshrine Cavern", [
      entry(1, "Late", "Leotheras the Blind", [wisher("Are")]),
      entry(2, "Early", "Hydross the Unstable", [wisher("Are")]),
    ]);
    expect(plan.bosses.map((b) => b.boss)).toEqual([
      "Hydross the Unstable",
      "Leotheras the Blind",
    ]);
  });

  it("keeps drops the cache can't attribute, at the end", () => {
    // An incomplete import is not a reason to hide loot the raid will see.
    const plan = buildLootPlan("Serpentshrine Cavern", [
      entry(1, "Mystery", undefined, [wisher("Are")]),
      entry(2, "Known", "Hydross the Unstable", [wisher("Are")]),
    ]);
    expect(plan.bosses.map((b) => b.boss)).toEqual(["Hydross the Unstable", ""]);
    expect(plan.bosses[1].items[0].name).toBe("Mystery");
  });

  it("lists the open contenders in contention's own order", () => {
    // Never re-scored here: a plan that disagreed with the item page would be
    // worse than no plan.
    const plan = buildLootPlan("Serpentshrine Cavern", [
      entry(1, "Belt", "Hydross the Unstable", [
        wisher("Second", { rank: 2 }),
        wisher("First", { rank: 1, priorityTierLabel: "DPS Warrior" }),
        wisher("Done", { satisfied: true, rank: undefined }),
      ]),
    ]);
    const item = plan.bosses[0].items[0];
    expect(item.contenders.map((c) => c.name)).toEqual(["First", "Second"]);
    expect(item.contenders[0].tierLabel).toBe("DPS Warrior");
    expect(item.openCount).toBe(2);
    // The satisfied wisher still counts as wanting it.
    expect(item.wisherCount).toBe(3);
  });

  it("puts the most contested item at the top of its boss", () => {
    const plan = buildLootPlan("Serpentshrine Cavern", [
      entry(1, "One wisher", "Hydross the Unstable", [wisher("Are")]),
      entry(2, "Three wishers", "Hydross the Unstable", [
        wisher("Are"),
        wisher("Melige"),
        wisher("Scomb"),
      ]),
    ]);
    expect(plan.bosses[0].items.map((i) => i.name)).toEqual(["Three wishers", "One wisher"]);
    expect(plan.bosses[0].contestedCount).toBe(2);
  });

  it("carries the sheet's chain and the alts who don't contend", () => {
    const plan = buildLootPlan("Serpentshrine Cavern", [
      entry(1, "Belt", "Hydross the Unstable", [wisher("Are")], {
        priorityRule: { itemName: "Belt", chain: "DPS Warrior > Hunter" },
        altWishers: ["Aresmall"],
      } as Partial<ItemContention>),
    ]);
    const item = plan.bosses[0].items[0];
    expect(item.chain).toBe("DPS Warrior > Hunter");
    expect(item.altWishers).toEqual(["Aresmall"]);
  });

  it("passes a fallback wisher's rank through, so the badge survives", () => {
    const plan = buildLootPlan("Serpentshrine Cavern", [
      entry(1, "Belt", "Hydross the Unstable", [wisher("Are", { rank: 1, listRank: 2 })]),
    ]);
    expect(plan.bosses[0].items[0].contenders[0].listRank).toBe(2);
  });

  it("is empty for a zone with nothing cached", () => {
    const plan = buildLootPlan("Serpentshrine Cavern", []);
    expect(plan.bosses).toEqual([]);
    expect(plan.contestedCount).toBe(0);
  });
});
