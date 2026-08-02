import { describe, expect, it } from "vitest";
import { gradeGem, gradeWornGems, isCurrentTierItem, summarizeGems } from "@/lib/analysis/gems";
import type { Item, Quality } from "@/lib/types";

const gem = (id: number, quality?: Quality): Item => ({ id, name: `Gem ${id}`, quality });

/** Rare cut, epic cut, green cut — the three grades of the same stat. */
const RARE = 24028;
const EPIC = 32196;
const GREEN = 23097;
const UNCACHED = 99999;

const cache = new Map<number, Item>([
  [RARE, gem(RARE, "rare")],
  [EPIC, gem(EPIC, "epic")],
  [GREEN, gem(GREEN, "uncommon")],
]);

const grade = (gemId: number, item: { ilvl?: number; phase?: 1 | 2 | 3 } = {}, phase: 3 | 2 = 3) =>
  gradeGem({ gemId, cached: cache.get(gemId), item, activePhase: phase });

describe("isCurrentTierItem", () => {
  it("believes a phase the item cache actually knows, over any item level", () => {
    expect(isCurrentTierItem({ phase: 3, ilvl: 100 }, 3)).toBe(true);
    expect(isCurrentTierItem({ phase: 2, ilvl: 200 }, 3)).toBe(false);
    // Gear from a later phase is current too — it isn't getting replaced.
    expect(isCurrentTierItem({ phase: 4 }, 3)).toBe(true);
  });

  it("falls back to an item level the previous tier cannot reach", () => {
    // SSC/TK top out at 141; Black Temple tier starts at 146.
    expect(isCurrentTierItem({ ilvl: 141 }, 3)).toBe(false);
    expect(isCurrentTierItem({ ilvl: 146 }, 3)).toBe(true);
  });

  it("claims nothing when neither phase nor item level is known", () => {
    expect(isCurrentTierItem({}, 3)).toBe(false);
  });
});

describe("gradeGem", () => {
  it("always flags an uncommon cut, whatever it is socketed into", () => {
    for (const item of [{ ilvl: 100 }, { ilvl: 151 }, { phase: 1 as const }, {}]) {
      expect(grade(GREEN, item).verdict).toBe("upgrade");
    }
  });

  it("flags a rare cut only in current-tier gear", () => {
    expect(grade(RARE, { ilvl: 151 }).verdict).toBe("upgrade");
    expect(grade(RARE, { phase: 3 }).verdict).toBe("upgrade");
    // The piece they're about to replace is left alone.
    expect(grade(RARE, { ilvl: 133 }).verdict).toBe("current");
    expect(grade(RARE, { phase: 2 }).verdict).toBe("current");
  });

  it("leaves an epic cut alone — there is nothing to move to", () => {
    expect(grade(EPIC, { ilvl: 151 }).verdict).toBe("current");
  });

  it("refuses to judge a gem the item cache has never seen", () => {
    const ungraded = grade(UNCACHED, { ilvl: 151 });
    expect(ungraded.verdict).toBe("unknown");
    expect(ungraded.reason).toBeUndefined();
  });

  it("says nothing about rare cuts before epic ones exist to buy", () => {
    // Phase 2, best gear in the game at the time: a rare cut IS the answer,
    // and flagging it would point at a purchase nobody can make yet.
    for (const item of [{ ilvl: 141 }, { ilvl: 133 }, { phase: 2 as const }]) {
      expect(gradeGem({ gemId: RARE, cached: cache.get(RARE), item, activePhase: 2 }).verdict).toBe(
        "current",
      );
    }
    // A green is still a green, though — rare cuts have existed since phase 1.
    expect(gradeGem({ gemId: GREEN, cached: cache.get(GREEN), item: { ilvl: 141 }, activePhase: 2 }).verdict).toBe(
      "upgrade",
    );
  });
});

describe("gradeWornGems + summarizeGems", () => {
  const worn = [
    // Current-tier helm: one rare (flagged), one epic (fine).
    { id: 1, ilvl: 146, gems: [{ id: RARE }, { id: EPIC }] },
    // Last tier's belt: the same rare cut is left alone here...
    { id: 2, ilvl: 133, gems: [{ id: RARE }] },
    // ...but a green is flagged wherever it sits.
    { id: 3, ilvl: 133, gems: [{ id: GREEN }] },
    // Nothing cached for this one — counted, never judged.
    { id: 4, ilvl: 146, gems: [{ id: UNCACHED }] },
  ];

  it("counts the two rules separately and keeps the ungradable visible", () => {
    expect(summarizeGems(gradeWornGems(worn, cache, 3))).toEqual({
      graded: 4,
      uncommon: 1,
      rareInCurrentTier: 1,
      unknown: 1,
    });
  });

  it("reads the socketed item's phase from the cache, not just its level", () => {
    // A 133 item the cache knows is phase 3 counts as current tier after all.
    const cacheWithPhase = new Map(cache).set(2, { id: 2, phase: 3 });
    const summary = summarizeGems(gradeWornGems(worn, cacheWithPhase, 3));
    expect(summary.rareInCurrentTier).toBe(2);
  });
});
