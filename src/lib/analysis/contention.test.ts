import { describe, expect, it } from "vitest";
import { computeItemContention } from "@/lib/analysis/contention";
import { tokenRedemptions, type TokenRedemptions } from "@/lib/items/tier-tokens";
import type { WishlistAlternative } from "@/lib/analysis/wishlist-alternatives";
import type { AwardWithContext, Character, CharacterStatus, GearSet } from "@/lib/types";

const ITEM = 30900;
const OTHER = 30901;

function character(name: string, status: CharacterStatus = "main"): Character {
  return {
    id: `c-${name.toLowerCase()}`,
    guildId: "g1",
    name,
    class: "Warrior",
    spec: "Fury",
    role: "Melee DPS",
    status,
    mainCharacterId: null,
  };
}

/** A wishlist naming one item in one slot — what SixtyUpgrades exports. */
function wishlist(characterId: string, itemId: number, slot: GearSet["slots"][number]["slot"] = "waist"): GearSet {
  return {
    id: `gs-${characterId}-${itemId}`,
    characterId,
    kind: "wishlist",
    phase: 2,
    name: "P2 list",
    source: "sixtyupgrades",
    stats: {},
    slots: [{ slot, itemId, itemName: `Item ${itemId}` }],
    importedAt: "2026-01-01T00:00:00.000Z",
  };
}

function fallback(characterId: string, itemId: number, rank: number): WishlistAlternative {
  return { characterId, phase: 2, slot: "waist", itemId, rank };
}

/** An on-spec award this phase, with the session context contention reads. */
function award(characterId: string, itemId: number): AwardWithContext {
  return {
    award: {
      id: `la-${characterId}-${itemId}`,
      raidSessionId: "rs-1",
      characterId,
      rawWinnerName: "Are",
      itemId,
      itemName: `Item ${itemId}`,
      offspec: false,
      external: false,
      awardedAt: "2026-02-01T20:00:00.000Z",
    },
    session: { id: "rs-1", guildId: "g1", date: "2026-02-01", zones: ["SSC"], source: "gargul" },
    sessionPhase: 2,
    character: undefined,
    item: undefined,
    wishlist: { matched: false, phases: [] },
  } as unknown as AwardWithContext;
}

function contention(opts: {
  characters: Character[];
  gearSets: GearSet[];
  alternatives?: WishlistAlternative[];
  awards?: AwardWithContext[];
  /** The drop being argued over. Defaults to ITEM. */
  itemId?: number;
  redemptions?: TokenRedemptions;
}) {
  const gearSetsByCharacter = new Map<string, GearSet[]>();
  for (const set of opts.gearSets) {
    gearSetsByCharacter.set(set.characterId, [...(gearSetsByCharacter.get(set.characterId) ?? []), set]);
  }
  return computeItemContention({
    itemId: opts.itemId ?? ITEM,
    characters: opts.characters,
    gearSetsByCharacter,
    awards: opts.awards ?? [],
    activePhase: 2,
    alternatives: opts.alternatives,
    redemptions: opts.redemptions,
  });
}

describe("computeItemContention — ranked fallbacks", () => {
  it("puts a raider on the board whose fallback names the item", () => {
    // Without this they are invisible: the imported set names one item per
    // slot, so a second choice never reaches the council at all.
    const are = character("Are");
    const view = contention({
      characters: [are],
      gearSets: [wishlist(are.id, OTHER)],
      alternatives: [fallback(are.id, ITEM, 1)],
    });
    expect(view.wishers.map((w) => w.character.name)).toEqual(["Are"]);
    expect(view.wishers[0].listRank).toBe(1);
  });

  it("calls the imported set's item their BiS", () => {
    const are = character("Are");
    const view = contention({ characters: [are], gearSets: [wishlist(are.id, ITEM)] });
    expect(view.wishers[0].listRank).toBe(0);
  });

  it("prefers the imported set when a raider lists the item both ways", () => {
    const are = character("Are");
    const view = contention({
      characters: [are],
      gearSets: [wishlist(are.id, ITEM)],
      alternatives: [fallback(are.id, ITEM, 3)],
    });
    expect(view.wishers[0].listRank).toBe(0);
  });

  it("takes the best rank when a raider gave it two", () => {
    // Two phases, two ranks. The stronger claim is the one to show.
    const are = character("Are");
    const view = contention({
      characters: [are],
      gearSets: [wishlist(are.id, OTHER)],
      alternatives: [fallback(are.id, ITEM, 3), { ...fallback(are.id, ITEM, 1), phase: 3 }],
    });
    expect(view.wishers[0].listRank).toBe(1);
    expect(view.wishers[0].phases).toEqual([2, 3]);
  });

  it("does not rank a fallback below a BiS wisher", () => {
    // The council's call, not the app's: whether a second choice should stand
    // aside depends on the raider's other options, so both contend and the
    // badge plus the item's notes carry the argument.
    const are = character("Are");
    const melige = character("Melige");
    const view = contention({
      characters: [are, melige],
      gearSets: [wishlist(are.id, ITEM), wishlist(melige.id, OTHER)],
      alternatives: [fallback(melige.id, ITEM, 1)],
    });
    const ranks = new Map(view.wishers.map((w) => [w.character.name, w.rank]));
    // Both are open contenders; nothing about listRank pushed either down.
    expect(view.openCount).toBe(2);
    expect(ranks.get("Are")).toBeDefined();
    expect(ranks.get("Melige")).toBeDefined();
  });

  it("leaves a raider off the board when neither list names the item", () => {
    const are = character("Are");
    const view = contention({
      characters: [are],
      gearSets: [wishlist(are.id, OTHER)],
      alternatives: [fallback(are.id, OTHER, 1)],
    });
    expect(view.wishers).toEqual([]);
  });

  it("keeps an alt off the board even when the fallback is theirs", () => {
    // Alts don't contend unless the council turns it on — a fallback is still
    // a wishlist entry, so it can't be a way around that.
    const alt = character("Aresmall", "alt");
    const view = contention({
      characters: [alt],
      gearSets: [wishlist(alt.id, OTHER)],
      alternatives: [fallback(alt.id, ITEM, 1)],
    });
    expect(view.wishers).toEqual([]);
    expect(view.altWishers).toEqual(["Aresmall"]);
  });
});

describe("computeItemContention — what served the slot", () => {
  it("marks an award they asked for as their own pick", () => {
    const are = character("Are");
    const view = contention({
      characters: [are],
      gearSets: [wishlist(are.id, ITEM), wishlist(are.id, OTHER, "waist")],
      awards: [award(are.id, OTHER)],
    });
    const served = view.wishers[0].awardsThisPhase.find((a) => a.itemId === OTHER)!;
    expect(served.listRank).toBe(0);
  });

  it("marks a ranked fallback as one", () => {
    const are = character("Are");
    const view = contention({
      characters: [are],
      gearSets: [wishlist(are.id, ITEM)],
      alternatives: [fallback(are.id, OTHER, 2)],
      awards: [award(are.id, OTHER)],
    });
    expect(view.wishers[0].awardsThisPhase[0].listRank).toBe(2);
  });

  it("leaves an off-list drop unranked rather than calling it a pick", () => {
    // They were handed something they never asked for. Saying nothing is the
    // honest answer; the slot-served penalty reads it as a filler.
    const are = character("Are");
    const view = contention({
      characters: [are],
      gearSets: [wishlist(are.id, ITEM)],
      awards: [award(are.id, 40404)],
    });
    expect(view.wishers[0].awardsThisPhase[0].listRank).toBeUndefined();
  });
});

describe("computeItemContention — was it on their list at all", () => {
  it("marks a drop they never listed, so it can be excused", () => {
    const are = character("Are");
    const view = contention({
      characters: [are],
      gearSets: [wishlist(are.id, ITEM)],
      awards: [award(are.id, 40404)],
    });
    const served = view.wishers[0].awardsThisPhase[0];
    expect(served.listRank).toBeUndefined();
    expect(served.notListed).toBe(true);
  });

  it("checks lists from every phase, not just the active one", () => {
    // This guild runs P2 with P3 lists imported. Scoping the check to the
    // active phase found nothing for anybody and read the whole roster as
    // never having asked for a single item they won.
    const are = character("Are");
    const p3 = { ...wishlist(are.id, OTHER), phase: 3 as const, id: "gs-p3" };
    const view = contention({
      characters: [are],
      gearSets: [wishlist(are.id, ITEM), p3],
      awards: [award(are.id, OTHER)],
    });
    const served = view.wishers[0].awardsThisPhase.find((a) => a.itemId === OTHER)!;
    expect(served.listRank).toBe(0);
    expect(served.notListed).toBe(false);
  });

  it("always answers, because a contender always has a list", () => {
    // You reach the board through a wishlist or through a ranked fallback, so
    // there is always something to check against — `notListed` is never left
    // undecided for anyone the council is actually looking at.
    const are = character("Are");
    const melige = character("Melige");
    const view = contention({
      characters: [are, melige],
      gearSets: [wishlist(are.id, ITEM)],
      alternatives: [fallback(melige.id, ITEM, 1)],
      awards: [award(are.id, 40404), award(melige.id, 40404)],
    });
    for (const w of view.wishers) {
      for (const a of w.awardsThisPhase) {
        expect(a.notListed, `${w.character.name} / ${a.itemName}`).toBe(true);
      }
    }
  });
});

describe("computeItemContention — armor tokens", () => {
  /** The token, and the two class pieces it buys. */
  const TOKEN = 30242;
  const HELM_A = 30146;
  const HELM_B = 30166;
  const redemptions = tokenRedemptions([
    { id: HELM_A, redeemsFrom: TOKEN },
    { id: HELM_B, redeemsFrom: TOKEN },
    { id: ITEM },
  ]);

  it("puts everyone who listed a piece on the token's board", () => {
    // Before this, a tier token's page found nobody at all: no wishlist names
    // the token, so the loot plan called the drop unwanted.
    const are = character("Are");
    const bo = character("Bo");
    const view = contention({
      itemId: TOKEN,
      redemptions,
      characters: [are, bo],
      gearSets: [wishlist(are.id, HELM_A, "head"), wishlist(bo.id, HELM_B, "head")],
    });
    expect(view.wishers.map((w) => w.character.name).sort()).toEqual(["Are", "Bo"]);
    expect(view.wishers.every((w) => w.listRank === 0)).toBe(true);
  });

  it("leaves out a raider who listed nothing the token buys", () => {
    const are = character("Are");
    const view = contention({
      itemId: TOKEN,
      redemptions,
      characters: [are],
      gearSets: [wishlist(are.id, ITEM)],
    });
    expect(view.wishers).toEqual([]);
  });

  it("shows the token award on the page of the piece it bought", () => {
    const are = character("Are");
    const view = contention({
      itemId: HELM_A,
      redemptions,
      characters: [are],
      gearSets: [wishlist(are.id, HELM_A, "head")],
      awards: [award(are.id, TOKEN)],
    });
    expect(view.awards.map((a) => a.award.itemId)).toEqual([TOKEN]);
    expect(view.wishers[0].satisfied).toBe(true);
  });

  it("counts a token win as loot they asked for, not loot they were handed", () => {
    // The fairness bug this whole feature exists for. `offListDrop` is zero by
    // council decision, so an award read as off-list costs the winner nothing
    // — and every tier token was read that way.
    const are = character("Are");
    const opts = {
      characters: [are],
      gearSets: [wishlist(are.id, ITEM), wishlist(are.id, HELM_A, "head")],
      awards: [award(are.id, TOKEN)],
    };
    const [won] = contention({ ...opts, redemptions }).wishers[0].awardsThisPhase;
    expect(won.notListed).toBe(false);
    expect(won.listRank).toBe(0);
    // And it fills a slot, which a token with no slot of its own never could.
    expect(won.slot).toBe("head");

    const unmapped = contention(opts).wishers[0].awardsThisPhase[0];
    expect(unmapped.notListed).toBe(true);
    expect(unmapped.slot).toBeUndefined();
  });

  it("settles the token for a raider already wearing the piece", () => {
    const are = character("Are");
    const worn: GearSet = {
      ...wishlist(are.id, HELM_A, "head"),
      id: "gs-current",
      kind: "current",
      phase: undefined,
    };
    const view = contention({
      itemId: TOKEN,
      redemptions,
      characters: [are],
      gearSets: [wishlist(are.id, HELM_A, "head"), worn],
    });
    expect(view.wishers[0].satisfied).toBe(true);
    expect(view.openCount).toBe(0);
  });
});
