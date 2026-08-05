import { describe, expect, it } from "vitest";
import {
  actionLabel,
  parseSimEvents,
  parseSimTimeline,
  representativeRun,
  simDpsOf,
  simActionRefs,
  simProfile,
  type RaidSimResult,
} from "@/lib/sim/result";

/**
 * Names as the log spells them — this is how the sim's ids get labelled. Keyed
 * by kind AND id, because the sim reports item actions too and the two id
 * spaces overlap.
 */
const NAMES = {
  "spell:30335": "Bloodthirst",
  "spell:1680": "Whirlwind",
  "spell:29707": "Heroic Strike",
};

function result(over: Partial<RaidSimResult> = {}): RaidSimResult {
  return {
    iterationsDone: 1000,
    avgIterationDuration: 120,
    raidMetrics: {
      parties: [
        {
          players: [
            {
              name: "Player",
              dps: { avg: 2745.4, stdev: 146 },
              actions: [
                { id: { spellId: 30335 }, targets: [{ casts: 19_400, damage: 1_940_000 }] },
                { id: { spellId: 29707 }, targets: [{ casts: 40_300 }] },
                { id: { spellId: 1680 }, targets: [{ casts: 6_250, damage: 500_000 }, { casts: 6_250, damage: 500_000 }] },
                { id: { spellId: 99999 }, targets: [{ casts: 2_000 }] },
                { id: { otherId: "OtherActionAttack" }, targets: [{ casts: 71_500 }] },
                { id: { otherId: "OtherActionRageGain" }, targets: [{ casts: 62_200 }] },
                { id: { spellId: 12345 }, targets: [{ casts: 0 }] },
                { id: { itemId: 10646 }, targets: [{ casts: 1_000 }] },
              ],
            },
          ],
        },
      ],
    },
    ...over,
  };
}

describe("actionLabel", () => {
  it("names a spell from the dictionary the log supplied", () => {
    expect(actionLabel({ spellId: 30335 }, NAMES)).toEqual({
      label: "Bloodthirst",
      ref: { kind: "spell", id: 30335 },
    });
  });

  it("shows the id rather than inventing a label for an unknown spell", () => {
    expect(actionLabel({ spellId: 44444 }, NAMES)?.label).toBe("Spell 44444");
  });

  it("keeps an item action in its own id space", () => {
    // wowsims reports sappers and on-use trinkets as {itemId}. Item 10646 has
    // no spell of that id at all, and item 23827's spell id is an unrelated
    // warlock talent — so a label that forgets the kind names the wrong thing.
    expect(actionLabel({ itemId: 10646 }, NAMES)).toEqual({
      label: "Item 10646",
      ref: { kind: "item", id: 10646 },
    });
  });

  it("does not answer an item id from the spell dictionary", () => {
    expect(actionLabel({ itemId: 30335 }, NAMES)?.label).toBe("Item 30335");
  });

  it("drops resource bookkeeping — nothing was pressed", () => {
    expect(actionLabel({ otherId: "OtherActionRageGain" }, NAMES)).toBeUndefined();
    expect(actionLabel({ otherId: "OtherActionMove" }, NAMES)).toBeUndefined();
  });

  it("keeps white swings, under the name the log uses", () => {
    // Nobody chooses them, but they're a third of a warrior's damage — leaving
    // them out made the damage column add up to two thirds of the fight. The
    // label has to match WCL's, or the two sides land on separate rows.
    expect(actionLabel({ otherId: "OtherActionAttack" }, NAMES)).toEqual({ label: "Melee" });
  });

  it("keeps other sim actions under a readable name, with nothing to look up", () => {
    expect(actionLabel({ otherId: "OtherActionPotion" }, NAMES)).toEqual({ label: "Potion" });
  });

  it("drops passive procs — the sim emits them as casts, the logs never do", () => {
    // Deep Wounds is applied by crits. Left in, it reads as ~50 casts/minute
    // the player supposedly missed, and buries every real finding under it.
    expect(actionLabel({ spellId: 12867 }, { "spell:12867": "Deep Wounds" })).toBeUndefined();
  });

  it("drops stance toggles, which are churn rather than rotation", () => {
    expect(actionLabel({ spellId: 2458 }, { "spell:2458": "Berserker Stance" })).toBeUndefined();
    expect(actionLabel({ spellId: 2457 }, { "spell:2457": "Battle Stance" })).toBeUndefined();
  });

  it("does not mistake a real ability for a toggle", () => {
    expect(actionLabel({ spellId: 1680 }, NAMES)?.label).toBe("Whirlwind");
  });
});

describe("simActionRefs", () => {
  const refs = simActionRefs(result(), NAMES);

  it("hands back what to look up for every ability the sim used", () => {
    expect(refs.find((r) => r.name === "Bloodthirst")?.ref).toEqual({ kind: "spell", id: 30335 });
    expect(refs.find((r) => r.name === "Item 10646")?.ref).toEqual({ kind: "item", id: 10646 });
  });

  it("skips actions the sim never used and ones with nothing to look up", () => {
    expect(refs.some((r) => r.ref.id === 12345)).toBe(false);
    expect(refs.some((r) => r.name.includes("Attack"))).toBe(false);
  });
});

describe("simProfile", () => {
  const p = simProfile(result(), { label: "Sim · 120s", names: NAMES, talents: [21, 40, 0] });

  it("divides by the iteration count so casts read per fight", () => {
    // 19,400 Bloodthirsts over 1000 iterations is 19.4 per fight.
    expect(p.abilities.find((a) => a.name === "Bloodthirst")!.casts).toBe(19.4);
  });

  it("sums a cleave's casts across every target it hit", () => {
    expect(p.abilities.find((a) => a.name === "Whirlwind")!.casts).toBe(12.5);
  });

  it("orders by casts and excludes the bookkeeping actions", () => {
    expect(p.abilities.some((a) => a.name.includes("RageGain"))).toBe(false);
    const pressed = p.abilities.filter((a) => a.name !== "Melee");
    expect(pressed[0].name).toBe("Heroic Strike");
  });

  it("sums damage across every target and divides by the iterations", () => {
    // A cast count ranks by button presses; 27 Heroic Strikes over 8
    // Bloodthirsts reads as the bigger deal until the damage says otherwise.
    expect(p.abilities.find((a) => a.name === "Bloodthirst")!.damage).toBe(1940);
    expect(p.abilities.find((a) => a.name === "Whirlwind")!.damage).toBe(1000);
  });

  it("keeps an unnamed spell visible as an id rather than dropping it", () => {
    expect(p.abilities.some((a) => a.name === "Spell 99999")).toBe(true);
  });

  it("drops actions the sim never used", () => {
    expect(p.abilities.some((a) => a.name === "Spell 12345")).toBe(false);
  });

  it("carries dps, duration and build so it compares like a logged pull", () => {
    expect(p.source).toBe("sim");
    expect(p.dps).toBe(2745);
    expect(p.durationMs).toBe(120_000);
    expect(p.build.label).toBe("21/40/0");
  });

  it("never divides by a zero iteration count", () => {
    const p0 = simProfile(result({ iterationsDone: 0 }), { label: "x", names: NAMES });
    expect(Number.isFinite(p0.abilities[0].casts)).toBe(true);
  });

  it("survives a result with no player at all", () => {
    const empty = simProfile({ raidMetrics: { parties: [] } }, { label: "x" });
    expect(empty.abilities).toEqual([]);
    expect(empty.dps).toBeUndefined();
  });
});

describe("parseSimTimeline", () => {
  const logs = [
    "[-4.50] [Player (#1)] Casting {SpellID: 30335} (Cost = 0.000, Cast Time = 0s)",
    "[0.00] [Player (#1)] Casting {SpellID: 29707} (Cost = 12.000)",
    "[0.10] [Player (#1)] Casting {OtherID: 3, Tag: 1} (Cost = 0.000)",
    "[1.50] [Player (#1)] Casting {SpellID: 1680} (Cost = 25.000)",
    "[1.50] [Player (#1)] Completed cast {SpellID: 1680}",
    "[2.00] [Target 1] Aura gained: {SpellID: 26993}",
  ].join("\n");

  it("keeps pre-pull casts, which is where an opener starts", () => {
    const t = parseSimTimeline(logs, NAMES);
    expect(t[0]).toEqual({ tMs: -4500, name: "Bloodthirst" });
  });

  it("reads only the cast lines, not completions or aura noise", () => {
    expect(parseSimTimeline(logs, NAMES).map((c) => c.name)).toEqual([
      "Bloodthirst",
      "Heroic Strike",
      "Melee",
      "Whirlwind",
    ]);
  });

  it("names the auto-attack swing the way the log does", () => {
    // OtherID 3 is the white swing. It earns a lane — it's a third of a
    // warrior's damage — and has to carry WCL's name to share that lane.
    expect(parseSimTimeline(logs, NAMES).filter((c) => c.name === "Melee")).toHaveLength(1);
  });

  it("drops the distance tracker, which is not an action", () => {
    // OtherID 20 "casts" as movement speed jumps and counts down yards to the
    // boss — read off a real debug log, not guessed.
    const moving = "[0.50] [Player (#1)] Casting {OtherID: 20} (Cost = 0.000)";
    expect(parseSimTimeline(moving, NAMES)).toEqual([]);
  });

  it("reads an item's use effect, which is a cast line too", () => {
    const sapper = "[1.00] [Player (#1)] Casting {ItemID: 10646} (Cost = 0.000)";
    expect(parseSimTimeline(sapper, { "item:10646": "Goblin Sapper Charge" })).toEqual([
      { tMs: 1000, name: "Goblin Sapper Charge" },
    ]);
  });

  it("returns nothing when the sim ran without debug logging", () => {
    expect(parseSimTimeline(undefined, NAMES)).toEqual([]);
    expect(parseSimTimeline("", NAMES)).toEqual([]);
  });
});

describe("parseSimEvents", () => {
  /** Real lines, format-for-format, from a wowsims debug log. */
  const logs = [
    "[-3.00] [Player (#1)] [Target 1] {SpellID: 2048} Hit for 0.000 damage (SpellSchool: 2). (Threat: 0.000)",
    "[0.00] [Player (#1)] [Target 1] {ItemID: 23827} Hit for 1499.733 damage (SpellSchool: 8). (Threat: 1049.813)",
    "[2.08] [Player (#1)] Casting {SpellID: 29707} (Cost = 12.000, Cast Time = 0s)",
    "[2.10] [Player (#1)] [Target 1] {SpellID: 29707} Crit for 1820.500 damage (SpellSchool: 1).",
    "[2.50] [Player (#1)] [Target 1] {OtherID: 3, Tag: 2} Hit for 412.250 damage (SpellSchool: 1).",
    "[3.00] [Player (#1)] Dynamic stat change: {\"Agility\": 18.000}",
  ].join("\n");

  it("reads both casts and hits, in order", () => {
    const out = parseSimEvents(logs, { "spell:29707": "Heroic Strike" });
    expect(out.map((e) => `${e.tMs} ${e.kind} ${e.name}`)).toEqual([
      "0 damage Item 23827",
      "2080 cast Heroic Strike",
      "2100 damage Heroic Strike",
      "2500 damage Melee",
    ]);
  });

  it("keeps the damage amount, whatever the hit was called", () => {
    const out = parseSimEvents(logs, { "spell:29707": "Heroic Strike" });
    // "Crit for" and "Hit for" are the same kind of line.
    expect(out.find((e) => e.kind === "damage" && e.name === "Heroic Strike")?.amount).toBe(1820.5);
  });

  it("drops a zero-damage 'hit', which is a buff being applied", () => {
    // Battle Shout lands as "Hit for 0.000 damage" — a shout is not a hit.
    expect(parseSimEvents(logs, {}).some((e) => e.tMs === -3000)).toBe(false);
  });

  it("ignores stat-change bookkeeping", () => {
    expect(parseSimEvents(logs, {}).some((e) => e.name.includes("Agility"))).toBe(false);
  });

  it("returns nothing without a log", () => {
    expect(parseSimEvents(undefined, {})).toEqual([]);
  });
});

describe("representativeRun", () => {
  const run = (dps: number): RaidSimResult => ({
    raidMetrics: { parties: [{ players: [{ dps: { avg: dps } }] }] },
  });

  it("picks the iteration closest to the average, not the first one", () => {
    // Seed 1 is whichever pull it happens to be; on a 3,000-run spread that
    // can be a lucky or an unlucky outlier, and the timeline would show it.
    const picked = representativeRun([run(2400), run(2670), run(2950)], 2673);
    expect(simDpsOf(picked)).toBe(2670);
  });

  it("skips runs that failed", () => {
    expect(simDpsOf(representativeRun([undefined, run(2500)], 2673))).toBe(2500);
  });

  it("returns nothing when every run failed", () => {
    expect(representativeRun([undefined, undefined], 2673)).toBeUndefined();
  });
});
