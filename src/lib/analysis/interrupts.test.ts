import { describe, expect, it } from "vitest";
import { buildInterruptView } from "@/lib/analysis/interrupts";
import type { WclPlayerFight, WclPlayerOffPull } from "@/lib/types";

/*
 * The numbers and spell ids in this file are the ones this guild's MH+BT report
 * (cWrNZY23Rx6V4faw, 30 Aug) actually produced, so a fixture that stops
 * matching reality is a fixture somebody has to look at.
 */

const row = (over: Partial<WclPlayerFight> = {}): WclPlayerFight => ({
  id: "r|113|x",
  reportCode: "r",
  fightId: 113,
  encounterId: 50606,
  encounterName: "Reliquary of Souls",
  kill: true,
  durationMs: 312_849,
  actorName: "Wando",
  characterId: null,
  className: "Rogue",
  role: "dps",
  deaths: 0,
  deathTimes: [],
  elixirs: [],
  scrolls: [],
  food: false,
  weaponBuff: false,
  prepot: false,
  potions: [],
  otherCasts: [],
  extras: [],
  cooldowns: [],
  castTimes: [],
  dispels: [],
  interrupts: [],
  upkeep: [],
  gear: [],
  talents: [],
  drums: 0,
  runes: 0,
  healthstones: 0,
  sappers: 0,
  missingEnchants: [],
  ...over,
});

const offPull = (over: Partial<WclPlayerOffPull> = {}): WclPlayerOffPull => ({
  id: "r|x",
  reportCode: "r",
  actorName: "Wando",
  characterId: null,
  potions: [],
  otherCasts: [],
  drums: 0,
  runes: 0,
  healthstones: 0,
  sappers: 0,
  petConsumables: [],
  petBuffsSeen: [],
  trashDispels: [],
  trashInterrupts: [],
  ...over,
});

/** A kick on Essence of Desire, the shape the Reliquary pull produced 19 of. */
const kick = (atMs: number, stopped = "Spirit Shock", stoppedId = 41426, phase?: string) => ({
  atMs,
  spellId: 38768,
  spell: "Kick",
  target: "Essence of Desire",
  stopped,
  stoppedId,
  ...(phase ? { phase } : {}),
});

const DESIRE = "P2: Essence of Desire";

describe("buildInterruptView — boss pulls", () => {
  it("gives each interrupter a lane, ordered by when they pressed it", () => {
    const view = buildInterruptView({
      rows: [
        row({ interrupts: [kick(155_000), kick(118_200)] }),
        row({
          id: "r|113|y",
          actorName: "Scomb",
          className: "Warrior",
          interrupts: [{ ...kick(125_900), spellId: 6554, spell: "Pummel" }],
        }),
      ],
    });

    expect(view.fights).toHaveLength(1);
    const pull = view.fights[0];
    expect(pull.total).toBe(3);
    // Busiest lane first, and each lane in press order regardless of input order.
    expect(pull.lanes.map((l) => l.name)).toEqual(["Wando", "Scomb"]);
    expect(pull.lanes[0].moments.map((m) => m.atMs)).toEqual([118_200, 155_000]);
  });

  it("leaves out pulls nobody interrupted on rather than listing them at zero", () => {
    // A boss with nothing interruptible is not a boss the raid failed to kick.
    const view = buildInterruptView({
      rows: [row({ fightId: 77, encounterName: "Supremus", interrupts: [] }), row({ interrupts: [kick(1_000)] })],
    });

    expect(view.fights.map((f) => f.fightId)).toEqual([113]);
  });

  it("counts what was stopped, and marks the heals among them", () => {
    const view = buildInterruptView({
      rows: [
        row({
          fightId: 145,
          encounterId: 50608,
          encounterName: "The Illidari Council",
          interrupts: [
            // Circle of Healing is curated as a heal; Divine Wrath is not, and
            // must not become one just by sharing a pull with it.
            kick(10_000, "Circle of Healing", 41455),
            kick(20_000, "Circle of Healing", 41455),
            kick(30_000, "Divine Wrath", 41472),
          ],
        }),
      ],
    });

    const pull = view.fights[0];
    expect(pull.onHeals).toBe(2);
    expect(pull.stopped).toEqual([
      { name: "Circle of Healing", count: 2, healing: true },
      { name: "Divine Wrath", count: 1 },
    ]);
    expect(view.onHeals).toBe(2);
  });
});

describe("buildInterruptView — phases", () => {
  it("splits a phased pull under Warcraft Logs' own phase name", () => {
    const view = buildInterruptView({
      rows: [
        row({ interrupts: [kick(118_200, "Spirit Shock", 41426, DESIRE), kick(138_600, "Deaden", 41410, DESIRE)] }),
        row({
          id: "r|113|y",
          actorName: "Noturds",
          className: "Mage",
          interrupts: [
            { ...kick(131_900, "Spirit Shock", 41426, DESIRE), spellId: 2139, spell: "Counterspell" },
          ],
        }),
      ],
    });

    const phases = view.fights[0].phases;
    expect(phases).toHaveLength(1);
    /*
     * The name, never the number. WCL counts intermissions as phases, so the
     * phase the raid calls "phase 2" arrives as id 3 — anything keyed on the
     * number reads the intermission and reports a clean zero.
     */
    expect(phases[0].name).toBe(DESIRE);
    expect(phases[0].total).toBe(3);
    expect(phases[0].stopped).toEqual([
      { name: "Spirit Shock", count: 2 },
      { name: "Deaden", count: 1 },
    ]);
    expect(phases[0].interrupters.map((i) => [i.name, i.count])).toEqual([
      ["Wando", 2],
      ["Noturds", 1],
    ]);
  });

  it("keeps phases in the order they happened, not alphabetically", () => {
    // "Intermission One" sorts ahead of "P1" on the name, which would reorder
    // every phased encounter. Insertion order is what the walk guarantees.
    const view = buildInterruptView({
      rows: [
        row({
          interrupts: [
            kick(10_000, "Spirit Shock", 41426, "P1: Essence of Suffering"),
            kick(20_000, "Spirit Shock", 41426, "Intermission One"),
            kick(30_000, "Spirit Shock", 41426, DESIRE),
          ],
        }),
      ],
    });

    expect(view.fights[0].phases.map((p) => p.name)).toEqual([
      "P1: Essence of Suffering",
      "Intermission One",
      DESIRE,
    ]);
  });

  it("files an interrupt with no phase under none, rather than inventing phase one", () => {
    const view = buildInterruptView({
      rows: [row({ interrupts: [kick(5_000), kick(118_200, "Spirit Shock", 41426, DESIRE)] })],
    });

    const pull = view.fights[0];
    expect(pull.total).toBe(2);
    // The unphased press still counts for the pull; it just belongs to no phase.
    expect(pull.phases).toHaveLength(1);
    expect(pull.phases[0].total).toBe(1);
  });

  it("leaves an unphased encounter with no phase breakdown at all", () => {
    const view = buildInterruptView({
      rows: [row({ fightId: 68, encounterName: "High Warlord Naj'entus", interrupts: [kick(9_000)] })],
    });

    expect(view.fights[0].phases).toEqual([]);
  });
});

describe("buildInterruptView — the denominator", () => {
  /* Lady Malande's real line from Illidari Council pull 146. */
  const malande = (over: Partial<{ ability: string; abilityId: number; started: number; landed: number }> = {}) => ({
    fightId: 146,
    caster: "Lady Malande",
    ability: "Circle of Healing",
    abilityId: 41455,
    started: 10,
    landed: 3,
    ...over,
  });

  const councilRow = (interrupts: ReturnType<typeof kick>[]) =>
    row({ fightId: 146, encounterId: 50608, encounterName: "The Illidari Council", interrupts });

  const coh = (atMs: number) => ({
    atMs,
    spellId: 38768,
    spell: "Kick",
    target: "Lady Malande",
    stopped: "Circle of Healing",
    stoppedId: 41455,
  });

  it("joins our interrupts onto what the enemy started, three ways", () => {
    const view = buildInterruptView({
      rows: [councilRow([coh(10_000), coh(20_000)])],
      enemyCasts: [malande({ started: 10, landed: 3 })],
    });

    expect(view.fights[0].casts).toEqual([
      {
        caster: "Lady Malande",
        ability: "Circle of Healing",
        started: 10,
        landed: 3,
        stopped: 2,
        // 10 started, 3 finished, 2 we stopped — the other 5 did neither, and
        // must not be folded into either column.
        unresolved: 5,
        healing: true,
        interruptible: true,
      },
    ]);
  });

  it("never reports a negative residual when the two streams disagree", () => {
    // A table showing "-2 unresolved" teaches an officer to distrust the whole
    // board; a zero understates one row. Neither is good, one is worse.
    const view = buildInterruptView({
      rows: [councilRow([coh(1), coh(2), coh(3), coh(4)])],
      enemyCasts: [malande({ started: 4, landed: 3 })],
    });

    expect(view.fights[0].casts[0].unresolved).toBe(0);
    expect(view.fights[0].casts[0].stopped).toBe(4);
  });

  it("marks an ability interruptible from ANY pull, not just this one", () => {
    /*
     * The real case: Lady Malande's Empowered Smite was interrupted on pull 146
     * and not touched on 147. Scoped per pull, 147 would have excused itself by
     * the very fact that nobody pressed anything.
     */
    const smiteOn146 = {
      atMs: 5_000,
      spellId: 6554,
      spell: "Pummel",
      target: "Lady Malande",
      stopped: "Empowered Smite",
      stoppedId: 41471,
    };
    const view = buildInterruptView({
      rows: [
        councilRow([smiteOn146]),
        row({
          fightId: 147,
          encounterId: 50608,
          encounterName: "The Illidari Council",
          interrupts: [{ ...coh(9_000) }],
        }),
      ],
      enemyCasts: [
        { fightId: 146, caster: "Lady Malande", ability: "Empowered Smite", abilityId: 41471, started: 29, landed: 21 },
        { fightId: 147, caster: "Lady Malande", ability: "Empowered Smite", abilityId: 41471, started: 11, landed: 11 },
      ],
    });

    const on147 = view.fights.find((f) => f.fightId === 147)!.casts[0];
    expect(on147).toMatchObject({ ability: "Empowered Smite", started: 11, landed: 11, stopped: 0 });
    expect(on147.interruptible).toBe(true);
  });

  it("leaves an ability nobody ever interrupted unmarked", () => {
    // Archimonde's Fear is not a miss. Marking it would invent one per cast.
    const view = buildInterruptView({
      rows: [councilRow([coh(10_000)])],
      enemyCasts: [
        malande(),
        { fightId: 146, caster: "High Nethermancer Zerevor", ability: "Arcane Bolt", abilityId: 41483, started: 40, landed: 36 },
      ],
    });

    const bolt = view.fights[0].casts.find((c) => c.ability === "Arcane Bolt")!;
    expect(bolt.interruptible).toBeUndefined();
    expect(bolt.landed).toBe(36);
  });

  it("puts the biggest leak first", () => {
    const view = buildInterruptView({
      rows: [councilRow([coh(10_000)])],
      enemyCasts: [
        malande({ started: 10, landed: 3 }),
        { fightId: 146, caster: "High Nethermancer Zerevor", ability: "Arcane Bolt", abilityId: 41483, started: 40, landed: 36 },
        { fightId: 146, caster: "Gathios the Shatterer", ability: "Judgment", abilityId: 41467, started: 12, landed: 12 },
      ],
    });

    expect(view.fights[0].casts.map((c) => c.ability)).toEqual([
      "Arcane Bolt",
      "Judgment",
      "Circle of Healing",
    ]);
  });

  it("has no casts at all on a report fetched before the denominator existed", () => {
    // Which is not the same as a boss that cast nothing — the board says so.
    const view = buildInterruptView({ rows: [councilRow([coh(10_000)])] });
    expect(view.fights[0].casts).toEqual([]);
  });
});

describe("buildInterruptView — the per-pull table", () => {
  it("gives every boss pull its own interrupter table, phases or not", () => {
    /*
     * The Illidari Council has four casters and no WCL phases, so without this
     * it had only a timeline and no table to read.
     */
    const view = buildInterruptView({
      rows: [
        row({
          fightId: 146,
          encounterId: 50608,
          encounterName: "The Illidari Council",
          interrupts: [kick(10_000, "Circle of Healing", 41455), kick(20_000, "Divine Wrath", 41472)],
        }),
        row({
          id: "r|146|y",
          fightId: 146,
          encounterId: 50608,
          encounterName: "The Illidari Council",
          actorName: "Scomb",
          className: "Warrior",
          interrupts: [{ ...kick(15_000, "Empowered Smite", 41471), spellId: 6554, spell: "Pummel" }],
        }),
      ],
    });

    const pull = view.fights[0];
    expect(pull.phases).toEqual([]);
    expect(pull.interrupters.map((i) => [i.name, i.count])).toEqual([
      ["Wando", 2],
      ["Scomb", 1],
    ]);
    // The heal label rides along, so the table can drop the column when it is
    // all zeroes — as it is on Essence of Desire.
    expect(pull.interrupters[0].onHeals).toBe(1);
    expect(pull.interrupters[1].onHeals).toBe(0);
  });
});

describe("buildInterruptView — trash", () => {
  it("counts trash per instance, because a night that runs two is two jobs", () => {
    const view = buildInterruptView({
      rows: [],
      offPull: [
        offPull({
          trashInterrupts: [
            {
              zone: "Hyjal Summit",
              spellId: 38768,
              spell: "Kick",
              target: "Shadowy Necromancer",
              stopped: "Shadow Bolt",
              stoppedId: 31627,
              count: 32,
            },
            {
              zone: "Black Temple",
              spellId: 38768,
              spell: "Kick",
              target: "Priestess of Delight",
              stopped: "Greater Heal",
              stoppedId: 41378,
              count: 3,
            },
          ],
        }),
      ],
    });

    expect(view.zones.map((z) => [z.zone, z.total])).toEqual([
      ["Hyjal Summit", 32],
      ["Black Temple", 3],
    ]);
    // Greater Heal is curated, so the Black Temple trash reads as heal work.
    expect(view.zones[1].onHeals).toBe(3);
    expect(view.zones[0].onHeals).toBe(0);
  });

  it("splits a raider's night into pulls and trash without double counting", () => {
    const view = buildInterruptView({
      rows: [row({ interrupts: [kick(118_200), kick(155_000)] })],
      offPull: [
        offPull({
          trashInterrupts: [
            {
              zone: "Hyjal Summit",
              spellId: 38768,
              spell: "Kick",
              target: "Gargoyle",
              stopped: "Gargoyle Strike",
              stoppedId: 31664,
              count: 5,
            },
          ],
        }),
      ],
    });

    expect(view.total).toBe(7);
    expect(view.night).toHaveLength(1);
    expect(view.night[0]).toMatchObject({ name: "Wando", count: 7, onPulls: 2, onTrash: 5 });
  });
});

describe("buildInterruptView — curation", () => {
  it("adds a spell's ranks together under one name", () => {
    /*
     * The reason the tally is keyed on the curated name and not the id: five
     * shamans pressed Earth Shock 91 times under two ids on the probed night,
     * 90 on rank 25454 and one on rank 8042. Keyed on the id, that one press
     * shows up as a second mystery row beside the real total.
     */
    const view = buildInterruptView({
      rows: [
        row({
          actorName: "Emmzor",
          className: "Shaman",
          interrupts: [
            { ...kick(10_000), spellId: 25454, spell: "Earth Shock" },
            { ...kick(20_000), spellId: 8042, spell: "Earth Shock" },
          ],
        }),
      ],
    });

    expect(view.night[0].spells).toEqual([{ name: "Earth Shock", wowClass: "Shaman", count: 2 }]);
  });

  it("counts an uncurated interrupt and queues it, rather than dropping it", () => {
    // Same bargain as an unplaced elixir: the log named the spell, so the only
    // thing missing is a class.
    const view = buildInterruptView({
      rows: [row({ interrupts: [{ ...kick(10_000), spellId: 999_999, spell: "Mystery Bash" }] })],
    });

    expect(view.total).toBe(1);
    expect(view.uncurated).toEqual([{ name: "Mystery Bash", count: 1 }]);
    expect(view.night[0].spells).toEqual([{ name: "Mystery Bash", count: 1 }]);
  });

  it("reports an empty night as zero, which the board has to disambiguate", () => {
    // A report imported before interrupts were fetched looks exactly like a
    // night nobody interrupted on. Only the board's copy can tell them apart.
    const view = buildInterruptView({ rows: [row()], offPull: [offPull()] });

    expect(view.total).toBe(0);
    expect(view.fights).toEqual([]);
    expect(view.zones).toEqual([]);
  });
});
