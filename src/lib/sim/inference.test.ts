import { describe, expect, it } from "vitest";
import { bloodFrenzyEvidence } from "@/lib/sim/inference";
import type { WclPlayerFight } from "@/lib/types";
import type { DebuffUpkeep } from "@/lib/wcl/fight-upkeep";

/**
 * The real shape of a Void Reaver pull: one kebab warrior WCL calls Arms, one
 * Fury warrior. Both apply Deep Wounds — it's a tier-3 Arms talent every
 * warrior takes — which is exactly why attribution has to be per player.
 */
function warrior(over: Partial<WclPlayerFight> & { actorName: string }): WclPlayerFight {
  return {
    id: `R1:1:${over.actorName.toLowerCase()}`,
    reportCode: "R1",
    fightId: 1,
    encounterId: 624,
    encounterName: "Void Reaver",
    kill: true,
    durationMs: 134_000,
    characterId: null,
    className: "Warrior",
    role: "dps",
    deaths: 0,
    elixirs: [],
    scrolls: [],
    food: true,
    weaponBuff: true,
    prepot: false,
    potions: [],
    otherCasts: [],
    extras: [],
    cooldowns: [],
    castTimes: [],
    upkeep: [],
    gear: [],
    talents: [],
    drums: 0,
    runes: 0,
    healthstones: 0,
    sappers: 0,
    missingEnchants: [],
    ...over,
  } as WclPlayerFight;
}

const DELTA = warrior({ actorName: "Dëltâ", spec: "Arms", talents: [33, 28, 0] });
const KATZE = warrior({ actorName: "Katzewarr", spec: "Fury", talents: [21, 40, 0] });
const up = (source: string, ability: string, pct: number): DebuffUpkeep => ({ source, ability, pct });

describe("bloodFrenzyEvidence", () => {
  it("infers it from the Arms warrior's own bleed", () => {
    const e = bloodFrenzyEvidence([DELTA, KATZE], [up("Dëltâ", "Deep Wounds", 87)]);
    expect(e).toEqual({ kind: "inferred", pct: 87, by: "Dëltâ", build: "33/28/0", via: "Deep Wounds" });
  });

  it("ignores a Fury warrior's Deep Wounds, which carries nothing", () => {
    // The trap: every warrior applies Deep Wounds, so an unattributed uptime
    // would report Blood Frenzy on a raid whose only bleeder was Fury.
    const e = bloodFrenzyEvidence([DELTA, KATZE], [up("Katzewarr", "Deep Wounds", 94)]);
    expect(e).toEqual({ kind: "no-bleed", by: "Dëltâ" });
  });

  it("prefers the highest uptime when the Arms warrior has both bleeds", () => {
    const e = bloodFrenzyEvidence(
      [DELTA],
      [up("Dëltâ", "Rend", 40), up("Dëltâ", "Deep Wounds", 91)],
    );
    expect(e).toMatchObject({ kind: "inferred", pct: 91, via: "Deep Wounds" });
  });

  it("says nobody could have brought it when no Arms warrior was there", () => {
    expect(bloodFrenzyEvidence([KATZE], [up("Katzewarr", "Deep Wounds", 94)])).toEqual({
      kind: "no-arms-warrior",
    });
  });

  it("ignores a non-warrior bleeding under the same name", () => {
    const rogue = warrior({ actorName: "Stab", className: "Rogue", spec: "Combat" });
    expect(bloodFrenzyEvidence([rogue], [up("Stab", "Rend", 80)])).toEqual({ kind: "no-arms-warrior" });
  });

  it("names the Arms warrior even with no build logged", () => {
    const noTalents = warrior({ actorName: "Omii", spec: "Arms", talents: [] });
    const e = bloodFrenzyEvidence([noTalents], [up("Omii", "Rend", 55)]);
    expect(e).toMatchObject({ kind: "inferred", by: "Omii", build: undefined });
  });

  it("matches the log's casing rather than dropping the evidence", () => {
    const e = bloodFrenzyEvidence([DELTA], [up("dëltâ", "Deep Wounds", 70)]);
    expect(e).toMatchObject({ kind: "inferred", pct: 70 });
  });

  it("ignores a bleed that isn't one of the two that carry it", () => {
    expect(bloodFrenzyEvidence([DELTA], [up("Dëltâ", "Thunder Clap", 99)])).toEqual({
      kind: "no-bleed",
      by: "Dëltâ",
    });
  });
});
