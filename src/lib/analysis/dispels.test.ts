import { describe, expect, it } from "vitest";
import { buildDispelView } from "@/lib/analysis/dispels";
import type { WclPlayerFight, WclPlayerOffPull } from "@/lib/types";

const row = (over: Partial<WclPlayerFight> = {}): WclPlayerFight => ({
  id: "r|1|x",
  reportCode: "r",
  fightId: 1,
  encounterId: 618,
  encounterName: "Archimonde",
  kill: true,
  durationMs: 134_000,
  actorName: "Melige",
  characterId: null,
  className: "Mage",
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
  actorName: "Melige",
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
  ...over,
});

const decurse = (atMs: number, target: string) => ({
  atMs,
  spellId: 475,
  spell: "Remove Curse",
  target,
  removed: "Grip of the Legion",
  removedId: 31972,
});

describe("buildDispelView — boss pulls", () => {
  it("gives each dispeller a lane, ordered by when they pressed it", () => {
    const view = buildDispelView({
      rows: [
        row({ actorName: "Melige", dispels: [decurse(7200, "Greektotems"), decurse(59800, "Melige")] }),
        row({ actorName: "Noturds", dispels: [decurse(12700, "Wando")] }),
      ],
    });
    expect(view.fights).toHaveLength(1);
    const [fight] = view.fights;
    expect(fight.total).toBe(3);
    // Busiest lane first, and within a lane the presses are in time order.
    expect(fight.lanes.map((l) => l.name)).toEqual(["Melige", "Noturds"]);
    expect(fight.lanes[0].moments.map((m) => m.atMs)).toEqual([7200, 59800]);
    expect(fight.lanes[0].moments[0]).toMatchObject({
      target: "Greektotems",
      removed: "Grip of the Legion",
      kind: "curse",
      offensive: false,
    });
  });

  it("names what came off the raid, most-removed first", () => {
    const view = buildDispelView({
      rows: [
        row({
          dispels: [
            decurse(1000, "A"),
            decurse(2000, "B"),
            { atMs: 3000, spellId: 988, spell: "Dispel Magic", target: "C", removed: "Flame Buffet" },
          ],
        }),
      ],
    });
    expect(view.fights[0].removed).toEqual([
      { name: "Grip of the Legion", count: 2 },
      { name: "Flame Buffet", count: 1 },
    ]);
  });

  it("leaves pulls nobody dispelled on out entirely", () => {
    const view = buildDispelView({
      rows: [row({ fightId: 1, dispels: [decurse(1000, "A")] }), row({ fightId: 2 })],
    });
    expect(view.fights.map((f) => f.fightId)).toEqual([1]);
  });

  it("counts a buff stripped off an enemy apart from a cleanse", () => {
    // Purge and Spellsteal share the event type with a decurse and answer a
    // different question — "did somebody strip the Enrage", never "was the
    // raid cleansed". One column would make a hunter's Tranquilizing Shots
    // read as healing work.
    const view = buildDispelView({
      rows: [
        row({
          dispels: [
            decurse(1000, "A"),
            { atMs: 2000, spellId: 30449, spell: "Spellsteal", target: "Archimonde", removed: "Rune Shield", offensive: true },
          ],
        }),
      ],
    });
    expect(view.night[0]).toMatchObject({ count: 2, cleanses: 1, strips: 1 });
    // An offensive strip carries no school: it took a buff, not a curse.
    expect(view.fights[0].lanes[0].moments[1].kind).toBeUndefined();
  });

  it("keeps a spell's two directions apart under one name", () => {
    // Mass Dispel has a friendly id and an enemy id and the log spells them
    // identically. Merged on the name alone, a priest's Enrage strips joined
    // their cleanses under one chip that contradicted the columns beside it.
    const view = buildDispelView({
      rows: [
        row({
          dispels: [
            { atMs: 1000, spellId: 32375, spell: "Mass Dispel", target: "A", removed: "Ice Trap" },
            { atMs: 2000, spellId: 39897, spell: "Mass Dispel", target: "Naj'entus", removed: "Enrage", offensive: true },
          ],
        }),
      ],
    });
    expect(view.night[0].spells).toEqual([
      { id: "Mass Dispel|false", name: "Mass Dispel", kind: "magic", count: 1 },
      { id: "Mass Dispel|true", name: "Mass Dispel", offensive: true, count: 1 },
    ]);
    expect(view.night[0]).toMatchObject({ cleanses: 1, strips: 1 });
  });

  it("gives every spell entry an id the name cannot supply", () => {
    /*
     * The list is rendered, and React keys on identity. Two Mass Dispel entries
     * under one name collapsed into one row the first time this shipped — the
     * console said so and the board quietly showed a priest doing half their
     * work. The id is what a renderer keys on; this pins that it is unique
     * everywhere a name is not.
     */
    const view = buildDispelView({
      rows: [
        row({
          dispels: [
            { atMs: 1000, spellId: 32375, spell: "Mass Dispel", target: "A", removed: "Ice Trap" },
            { atMs: 2000, spellId: 39897, spell: "Mass Dispel", target: "Naj'entus", removed: "Enrage", offensive: true },
            { atMs: 3000, spellId: 988, spell: "Dispel Magic", target: "B", removed: "Polymorph" },
          ],
        }),
      ],
      offPull: [
        offPull({
          trashDispels: [
            { zone: "Black Temple", spellId: 32375, spell: "Mass Dispel", target: "A", removed: "Ice Trap", count: 5 },
            { zone: "Black Temple", spellId: 39897, spell: "Mass Dispel", target: "Gurtogg", removed: "Enrage", offensive: true, count: 2 },
          ],
        }),
      ],
    });
    for (const tally of [...view.night, ...view.zones.flatMap((z) => z.dispellers)]) {
      const ids = tally.spells.map((s) => s.id);
      expect(new Set(ids).size, `duplicate spell id for ${tally.name}`).toBe(ids.length);
      // And the names genuinely are NOT unique, which is the whole point.
      expect(new Set(tally.spells.map((s) => s.name)).size).toBeLessThan(ids.length);
    }
  });

  it("shows no school for a spell that removed more than one", () => {
    // Cleanse took off both magic and poison in this guild's logs, and the
    // event does not say which this press caught. Naming one would put a
    // poison count on a magic removal.
    const view = buildDispelView({
      rows: [row({ dispels: [{ atMs: 1000, spellId: 4987, spell: "Cleanse", target: "A", removed: "Wound Poison" }] })],
    });
    expect(view.fights[0].lanes[0].moments[0].kind).toBeUndefined();
  });
});

describe("buildDispelView — trash", () => {
  it("keeps each instance apart, biggest first", () => {
    const view = buildDispelView({
      rows: [],
      offPull: [
        offPull({
          actorName: "Noctaly",
          trashDispels: [
            { zone: "Black Temple", spellId: 4987, spell: "Cleanse", target: "Wando", removed: "Ice Trap", count: 26 },
            { zone: "Hyjal Summit", spellId: 4987, spell: "Cleanse", target: "Wando", removed: "Flame Buffet", count: 23 },
          ],
        }),
      ],
    });
    expect(view.zones.map((z) => [z.zone, z.total])).toEqual([
      ["Black Temple", 26],
      ["Hyjal Summit", 23],
    ]);
    expect(view.zones[1].dispellers[0]).toMatchObject({ name: "Noctaly", count: 23, cleanses: 23 });
    expect(view.zones[1].removed).toEqual([{ name: "Flame Buffet", count: 23 }]);
  });

  it("sums the counted rows rather than the rows themselves", () => {
    // Trash arrives collapsed — one row can stand for eighty removals — so a
    // view that counted rows would report a decurser's night as single digits.
    const view = buildDispelView({
      rows: [],
      offPull: [
        offPull({
          actorName: "Melige",
          trashDispels: [
            { zone: "Hyjal Summit", spellId: 475, spell: "Remove Curse", target: "A", removed: "Banshee Curse", count: 30 },
            { zone: "Hyjal Summit", spellId: 475, spell: "Remove Curse", target: "B", removed: "Banshee Curse", count: 4 },
          ],
        }),
      ],
    });
    expect(view.total).toBe(34);
    expect(view.zones[0].dispellers[0].spells).toEqual([
      { id: "Remove Curse|false", name: "Remove Curse", kind: "curse", count: 34 },
    ]);
  });

  it("adds trash to the night totals beside the pulls", () => {
    const view = buildDispelView({
      rows: [row({ actorName: "Melige", dispels: [decurse(1000, "A")] })],
      offPull: [
        offPull({
          actorName: "Melige",
          trashDispels: [{ zone: "Hyjal Summit", spellId: 475, spell: "Remove Curse", target: "A", removed: "Banshee Curse", count: 30 }],
        }),
      ],
    });
    expect(view.night[0]).toMatchObject({ name: "Melige", onPulls: 1, onTrash: 30, count: 31 });
    // The class comes off the pull rows; a trash-only dispeller simply has none.
    expect(view.night[0].className).toBe("Mage");
  });
});

describe("buildDispelView — curation", () => {
  it("counts a dispel nobody has named, and queues it", () => {
    const view = buildDispelView({
      rows: [row({ dispels: [{ atMs: 1000, spellId: 99999, spell: "Unnamed Cure", target: "A", removed: "Something" }] })],
    });
    expect(view.total).toBe(1);
    expect(view.uncurated).toEqual([{ name: "Unnamed Cure", count: 1 }]);
    expect(view.fights[0].lanes[0].moments[0].kind).toBeUndefined();
  });

  it("reports a total of zero for a report imported before dispels were fetched", () => {
    // The page has to say it cannot tell this from a night nobody dispelled on.
    const view = buildDispelView({ rows: [row()], offPull: [offPull()] });
    expect(view.total).toBe(0);
    expect(view.fights).toEqual([]);
    expect(view.zones).toEqual([]);
  });
});
