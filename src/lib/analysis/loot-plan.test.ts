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
    membershipId: null,
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

/**
 * The bosses that actually have drops.
 *
 * `buildLootPlan` renders every boss the raid table names, empty ones included
 * — that is the point of the spine, and it has its own tests below. Assertions
 * about ordering and grouping of real loot go through here so they say what
 * they mean instead of counting past empty cards.
 */
function mapped(plan: ReturnType<typeof buildLootPlan>) {
  return plan.bosses.filter((b) => b.items.length > 0);
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
    const statuses = mapped(plan)[0].items.map((i) => i.status);
    // Contested first — that's the order it gets read out in.
    expect(statuses).toEqual(["contested", "served", "unwanted"]);
  });

  it("orders bosses the way the raid will meet them", () => {
    const plan = buildLootPlan("Serpentshrine Cavern", [
      entry(1, "Late", "Leotheras the Blind", [wisher("Are")]),
      entry(2, "Early", "Hydross the Unstable", [wisher("Are")]),
    ]);
    expect(mapped(plan).map((b) => b.boss)).toEqual([
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
    expect(mapped(plan).map((b) => b.boss)).toEqual(["Hydross the Unstable", ""]);
    expect(mapped(plan)[1].items[0].name).toBe("Mystery");
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
    const item = mapped(plan)[0].items[0];
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
    expect(mapped(plan)[0].items.map((i) => i.name)).toEqual(["Three wishers", "One wisher"]);
    expect(mapped(plan)[0].contestedCount).toBe(2);
  });

  it("carries the sheet's chain and the alts who don't contend", () => {
    const plan = buildLootPlan("Serpentshrine Cavern", [
      entry(1, "Belt", "Hydross the Unstable", [wisher("Are")], {
        priorityRule: { itemName: "Belt", chain: "DPS Warrior > Hunter" },
        altWishers: ["Aresmall"],
      } as Partial<ItemContention>),
    ]);
    const item = mapped(plan)[0].items[0];
    expect(item.chain).toBe("DPS Warrior > Hunter");
    expect(item.altWishers).toEqual(["Aresmall"]);
  });

  it("passes a fallback wisher's rank through, so the badge survives", () => {
    const plan = buildLootPlan("Serpentshrine Cavern", [
      entry(1, "Belt", "Hydross the Unstable", [wisher("Are", { rank: 1, listRank: 2 })]),
    ]);
    expect(mapped(plan)[0].items[0].contenders[0].listRank).toBe(2);
  });

  it("is empty for a zone with nothing cached", () => {
    const plan = buildLootPlan("Serpentshrine Cavern", []);
    expect(plan.bosses).toEqual([]);
    expect(plan.contestedCount).toBe(0);
  });
});

/**
 * The zone here is Black Temple, because that is where the two spellings and
 * the trash section actually collide in the guild's data.
 */
function btEntry(itemId: number, name: string, boss: string): LootPlanEntry {
  const item: Item = {
    id: itemId,
    name,
    quality: "epic",
    source: { zone: "Black Temple", boss },
  } as Item;
  return {
    item,
    contention: {
      item,
      itemId,
      itemName: name,
      wishers: [],
      awards: [],
      openCount: 0,
      altWishers: [],
      manualTiers: [],
    } as unknown as ItemContention,
  };
}

describe("buildLootPlan — one boss, however his name is spelled", () => {
  it("groups two spellings of one boss into a single card", () => {
    // Wowhead files the council without the article; the raid table and the
    // council's own sheet keep it. Grouping on the raw string gave two cards
    // for one pull, each holding half his drops.
    const plan = buildLootPlan("Black Temple", [
      btEntry(1, "Madness of the Betrayer", "Illidari Council"),
      btEntry(2, "Boots of Effortless Striking", "The Illidari Council"),
    ]);
    expect(mapped(plan)).toHaveLength(1);
    expect(mapped(plan)[0].items).toHaveLength(2);
  });

  it("heads the card with the raid table's spelling, not the import's", () => {
    const plan = buildLootPlan("Black Temple", [
      btEntry(1, "Madness of the Betrayer", "Illidari Council"),
    ]);
    expect(mapped(plan)[0].boss).toBe("The Illidari Council");
  });

  it("lets a source the raid table doesn't know speak for itself", () => {
    const plan = buildLootPlan("Black Temple", [btEntry(1, "Something", "Some Rare Spawn")]);
    expect(mapped(plan)[0].boss).toBe("Some Rare Spawn");
  });
});

describe("buildLootPlan — trash", () => {
  it("puts trash first, where the raid meets it", () => {
    // TBC_RAIDS lists encounters and has no "Trash" row, so nothing in the raid
    // table can order it — before this it sorted with the unknowns, after the
    // last boss.
    const plan = buildLootPlan("Black Temple", [
      btEntry(1, "Illidan drop", "Illidan Stormrage"),
      btEntry(2, "Trash drop", "Trash"),
      btEntry(3, "Supremus drop", "Supremus"),
    ]);
    expect(mapped(plan).map((b) => b.boss)).toEqual(["Trash", "Supremus", "Illidan Stormrage"]);
  });

  it("still sorts unattributed drops last, behind trash", () => {
    const plan = buildLootPlan("Black Temple", [
      { ...btEntry(1, "Homeless", "x"), item: { id: 1, name: "Homeless", quality: "epic" } as Item },
      btEntry(2, "Trash drop", "Trash"),
    ]);
    expect(mapped(plan).map((b) => b.boss)).toEqual(["Trash", ""]);
  });
});

describe("buildLootPlan — the boss spine", () => {
  it("lists every boss the raid table names, drops or not", () => {
    // Four cached drops for a nine-boss raid used to render as four cards,
    // which reads as a complete plan. The five gaps are the point.
    const plan = buildLootPlan("Black Temple", [btEntry(1, "A drop", "Supremus")]);
    expect(plan.bosses.map((b) => b.boss)).toEqual([
      "Trash",
      "High Warlord Naj'entus",
      "Supremus",
      "Shade of Akama",
      "Teron Gorefiend",
      "Gurtogg Bloodboil",
      "Reliquary of Souls",
      "Mother Shahraz",
      "The Illidari Council",
      "Illidan Stormrage",
    ]);
    expect(plan.unmappedCount).toBe(9);
    expect(plan.bosses.find((b) => b.boss === "Supremus")!.unmapped).toBe(false);
  });

  it("shows no bosses at all for a zone with nothing", () => {
    // Not "a raid with nine gaps" — a page with nothing on it, where the only
    // useful thing to render is how to fill it. The view keys its empty state
    // on this being empty.
    const plan = buildLootPlan("Black Temple", []);
    expect(plan.bosses).toEqual([]);
    expect(plan.unmappedCount).toBe(0);
  });

  it("gives every boss a stable key that survives a respelling", () => {
    const plan = buildLootPlan("Black Temple", [
      btEntry(1, "A drop", "Illidari Council"),
    ]);
    const council = plan.bosses.find((b) => b.boss === "The Illidari Council")!;
    expect(council.key).toBe("illidaricouncil");
  });
});

describe("buildLootPlan — drops only the sheet knows", () => {
  const sheetDrop = { itemName: "Unseen Belt", boss: "Supremus", chain: "MS > OS" };

  it("adds them, flagged, with no item id to link to", () => {
    const plan = buildLootPlan("Black Temple", [btEntry(1, "Cached", "Supremus")], [sheetDrop]);
    const supremus = plan.bosses.find((b) => b.boss === "Supremus")!;
    const unseen = supremus.items.find((i) => i.name === "Unseen Belt")!;
    expect(unseen.sheetOnly).toBe(true);
    expect(unseen.itemId).toBeUndefined();
    expect(unseen.chain).toBe("MS > OS");
    expect(plan.sheetOnlyCount).toBe(1);
  });

  it("sorts them below a cached drop of the same status", () => {
    // They carry no icon and no contenders, so they are reference rather than
    // the part an officer reads out.
    const plan = buildLootPlan(
      "Black Temple",
      [btEntry(1, "Zzz cached", "Supremus")],
      [sheetDrop],
    );
    const supremus = plan.bosses.find((b) => b.boss === "Supremus")!;
    expect(supremus.items.map((i) => i.name)).toEqual(["Zzz cached", "Unseen Belt"]);
  });

  it("never duplicates a drop the cache already holds", () => {
    const plan = buildLootPlan(
      "Black Temple",
      [btEntry(1, "Unseen Belt", "Supremus")],
      [sheetDrop],
    );
    const supremus = plan.bosses.find((b) => b.boss === "Supremus")!;
    expect(supremus.items).toHaveLength(1);
    expect(supremus.items[0].sheetOnly).toBeUndefined();
  });

  it("counts chain coverage per boss, so a plan says whether it can be read", () => {
    const plan = buildLootPlan(
      "Black Temple",
      [btEntry(1, "No chain", "Supremus")],
      [sheetDrop],
    );
    const supremus = plan.bosses.find((b) => b.boss === "Supremus")!;
    expect(supremus.items).toHaveLength(2);
    expect(supremus.chainCount).toBe(1);
    expect(supremus.sheetOnlyCount).toBe(1);
  });
});

describe("buildLootPlan — what a guild hides", () => {
  const hidden = { itemName: "Vanished Belt", boss: "Supremus" };

  it("keeps a card for a boss whose only trace is a hidden drop", () => {
    // A hidden drop has no row to be un-hidden from. Without the card, the
    // action is one-way and an officer who hid the wrong thing is stuck.
    const plan = buildLootPlan("Black Temple", [], [], [hidden]);
    const supremus = plan.bosses.find((b) => b.boss === "Supremus")!;
    expect(supremus.hidden.map((h) => h.itemName)).toEqual(["Vanished Belt"]);
  });

  it("does not call that boss unmapped", () => {
    // Somebody mapped him and then took it away. That is a different state
    // from nobody having mapped him, and a different thing to say on the card.
    const plan = buildLootPlan("Black Temple", [], [], [hidden]);
    expect(plan.bosses.find((b) => b.boss === "Supremus")!.unmapped).toBe(false);
    expect(plan.bosses.find((b) => b.boss === "Illidan Stormrage")!.unmapped).toBe(true);
  });

  it("still shows nothing for a zone with neither drops nor hides", () => {
    expect(buildLootPlan("Black Temple", [], [], []).bosses).toEqual([]);
  });

  it("marks a drop the guild added as theirs", () => {
    const plan = buildLootPlan(
      "Black Temple",
      [],
      [{ itemName: "Homebrew", boss: "Supremus", guildAdded: true }],
    );
    const row = plan.bosses.find((b) => b.boss === "Supremus")!.items[0];
    expect(row.guildAdded).toBe(true);
  });
});
