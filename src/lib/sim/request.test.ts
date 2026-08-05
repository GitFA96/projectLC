import { describe, expect, it } from "vitest";
import {
  SIM_SLOT_TO_WCL_SLOT,
  buildRaidSimRequest,
  simEquipmentFromGear,
  talentWarning,
  talentsToTreePoints,
  type IndividualSimSettings,
} from "@/lib/sim/request";
import type { WclGearItem } from "@/lib/types";

function gear(over: Partial<WclGearItem>[]): WclGearItem[] {
  return over.map((g) => ({ slot: 0, id: 1, gems: [], ...g }) as WclGearItem);
}

/** A minimal export with a real APL, as a link exported on "APL" carries. */
const settings: IndividualSimSettings = {
  player: {
    talentsString: "3400502130201-55000005505012050115",
    equipment: { items: [] },
    rotation: { type: "TypeAPL", priorityList: [{}, {}] },
  },
  encounter: { duration: 120, durationVariation: 5 },
  raidBuffs: { bloodlust: true },
  debuffs: { misery: true },
  partyBuffs: { drums: "LesserDrumsOfBattle" },
};

describe("gear mapping", () => {
  it("covers the 17 sim slots and skips shirt and tabard", () => {
    expect(SIM_SLOT_TO_WCL_SLOT).toHaveLength(17);
    expect(SIM_SLOT_TO_WCL_SLOT).not.toContain(3); // shirt
    expect(SIM_SLOT_TO_WCL_SLOT).not.toContain(18); // tabard
  });

  it("places back, waist and weapons on the slots wowsims expects", () => {
    // Verified by matching item ids between a real export and a real pull.
    const items = simEquipmentFromGear(
      gear([
        { slot: 0, id: 30120 }, // head
        { slot: 14, id: 24259 }, // back → sim index 3
        { slot: 5, id: 30032 }, // waist → sim index 7
        { slot: 15, id: 28439 }, // main hand → sim index 14
        { slot: 17, id: 30279 }, // ranged → sim index 16
      ]),
    );
    expect(items[0].id).toBe(30120);
    expect(items[3].id).toBe(24259);
    expect(items[7].id).toBe(30032);
    expect(items[14].id).toBe(28439);
    expect(items[16].id).toBe(30279);
  });

  it("keeps empty slots in place so later items don't shift onto the wrong body part", () => {
    const items = simEquipmentFromGear(gear([{ slot: 15, id: 28439 }]));
    expect(items).toHaveLength(17);
    expect(items[0].id).toBeUndefined();
    expect(items[14].id).toBe(28439);
  });

  it("carries the enchant and the gem ids the pull was worn with", () => {
    const items = simEquipmentFromGear(
      gear([{ slot: 0, id: 30120, enchant: 3003, gems: [{ id: 32409 }, { id: 31118 }] }]),
    );
    expect(items[0]).toEqual({ id: 30120, enchant: 3003, gems: [32409, 31118] });
  });

  it("drops empty sockets rather than sending zeroes to the sim", () => {
    const items = simEquipmentFromGear(gear([{ slot: 0, id: 30120, gems: [{ id: 0 }] }]));
    expect(items[0].gems).toBeUndefined();
  });
});

describe("talentsToTreePoints", () => {
  it("sums each tree, matching what the logs report per tree", () => {
    expect(talentsToTreePoints("3400502130201-55000005505012050115")).toEqual([21, 40]);
  });
});

describe("buildRaidSimRequest", () => {
  it("wraps an individual export into a one-player raid", () => {
    const { request } = buildRaidSimRequest(settings);
    expect(request.raid.numActiveParties).toBe(1);
    expect(request.raid.parties[0].players).toHaveLength(1);
    expect(request.raid.buffs).toEqual({ bloodlust: true });
    expect(request.raid.debuffs).toEqual({ misery: true });
    expect(request.raid.parties[0].buffs).toEqual({ drums: "LesserDrumsOfBattle" });
  });

  it("runs the pull's real length with no variance", () => {
    // Variance would compare a known 134s kill against runs of 129–139s.
    const { request } = buildRaidSimRequest(settings, { durationMs: 134_000 });
    const encounter = request.encounter as { duration: number; durationVariation: number };
    expect(encounter.duration).toBe(134);
    expect(encounter.durationVariation).toBe(0);
  });

  it("warns when the export has no APL — the silent-zero-DPS trap", () => {
    // The web UI converts a "Simple" rotation to an APL before sending; the Go
    // sim only reads priorityList. Exported on Simple, the sim auto-attacks and
    // reports a plausible low number with no error at all.
    const simple: IndividualSimSettings = {
      ...settings,
      player: { ...settings.player, rotation: { type: "TypeSimple", priorityList: [] } },
    };
    const { warnings } = buildRaidSimRequest(simple);
    expect(warnings.map((w) => w.code)).toContain("no-rotation");
  });

  it("does not warn when a real priority list is present", () => {
    expect(buildRaidSimRequest(settings).warnings).toEqual([]);
  });

  it("keeps the saved gear and says so when a pull has no snapshot", () => {
    const { request, warnings } = buildRaidSimRequest(settings, { gear: [] });
    expect(warnings.map((w) => w.code)).toContain("no-gear");
    expect((request.raid.parties[0].players[0] as { equipment?: unknown }).equipment).toEqual({ items: [] });
  });

  it("asks for a timeline only when the caller wants one", () => {
    expect(buildRaidSimRequest(settings).request.simOptions.debugFirstIteration).toBe(false);
    expect(buildRaidSimRequest(settings, { withTimeline: true }).request.simOptions.debugFirstIteration).toBe(true);
  });

  it("uses a fixed seed so the same question gives the same answer", () => {
    expect(buildRaidSimRequest(settings).request.simOptions.randomSeed).toBe(1);
  });
});

describe("talentWarning", () => {
  it("flags a sim configured as a different build from the pull", () => {
    // Sim is 21/40 pure Fury; the pull was played 33/28 hybrid.
    const w = talentWarning(settings, [33, 28, 0])!;
    expect(w.code).toBe("talent-mismatch");
    expect(w.message).toContain("21/40");
    expect(w.message).toContain("33/28/0");
  });

  it("stays quiet when the builds agree", () => {
    expect(talentWarning(settings, [21, 40])).toBeUndefined();
  });

  it("treats a dropped trailing tree as the same build, not a mismatch", () => {
    // wowsims writes "21/40" and the logs write "21/40/0" for one identical
    // build. Warning here would fire on every correctly-configured sim.
    expect(talentWarning(settings, [21, 40, 0])).toBeUndefined();
  });

  it("still catches a real difference in a trailing tree", () => {
    expect(talentWarning(settings, [21, 35, 5])?.code).toBe("talent-mismatch");
  });

  it("stays quiet rather than guessing when the pull has no talents", () => {
    expect(talentWarning(settings, [])).toBeUndefined();
    expect(talentWarning(settings, undefined)).toBeUndefined();
  });
});
