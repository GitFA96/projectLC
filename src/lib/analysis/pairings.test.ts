import { describe, expect, it } from "vitest";
import { PAIRING_CLUSTER_MS, buildPairingView } from "@/lib/analysis/pairings";
import { PAIRING_DEBUFFS } from "@/lib/wcl/pairings";
import type { WclPlayerFight } from "@/lib/types";

const row = (over: Partial<WclPlayerFight> = {}): WclPlayerFight => ({
  id: "r|139|x",
  reportCode: "r",
  fightId: 139,
  encounterId: 607,
  encounterName: "Mother Shahraz",
  kill: true,
  durationMs: 158_000,
  actorName: "Scomb",
  characterId: null,
  className: "Warrior",
  role: "dps",
  deaths: 0,
  deathTimes: [],
  elixirs: [],
  lateConsumables: [],
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
  unlandedInterrupts: [],
  pairings: [],
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

/** A raider the boss picked, holding it for `heldMs` and eating `damage`. */
const picked = (atMs: number, heldMs: number, damage: number) => ({
  atMs,
  spellId: 41001,
  spell: "Fatal Attraction",
  picked: true,
  heldMs,
  damage,
  petDamage: 0,
  petsKilled: [] as string[],
});

/** A raider who was only standing in it. */
const caught = (atMs: number, damage: number) => ({
  atMs,
  spellId: 41001,
  spell: "Fatal Attraction",
  picked: false,
  damage,
  petDamage: 0,
  petsKilled: [] as string[],
});

/** Nothing happened to the raider — the mechanic killed their kit. */
const kit = (atMs: number, petDamage: number, petsKilled: string[]) => ({
  atMs,
  spellId: 41001,
  spell: "Fatal Attraction",
  picked: false,
  damage: 0,
  petDamage,
  petsKilled,
});

describe("rebuilding a cast from per-raider rows", () => {
  it("links raiders whose rows share the moment", () => {
    // The 0:29 pairing on the 30 Aug kill pull, as two rows that never mention
    // each other. Reconstructing the pair is the whole job of this module.
    const view = buildPairingView({
      rows: [
        row({ actorName: "Scomb", pairings: [picked(29_000, 4_000, 11_116)] }),
        row({ actorName: "Zavodchanyn", className: "Druid", pairings: [picked(29_001, 3_000, 8_394)] }),
      ],
    });

    expect(view.total).toBe(1);
    expect(view.fights[0].casts[0].picked.map((p) => p.name)).toEqual(["Scomb", "Zavodchanyn"]);
    expect(view.picks).toBe(2);
  });

  it("keeps two casts on one pull apart", () => {
    // 25.9 seconds is the closest two casts ever came on a probed pull. The
    // window is a second, so there is no arithmetic here that can merge them.
    const view = buildPairingView({
      rows: [
        row({ actorName: "Scomb", pairings: [picked(29_000, 4_000, 0)] }),
        row({ actorName: "Melige", pairings: [picked(56_500, 2_000, 0)] }),
      ],
    });

    expect(view.total).toBe(2);
    expect(view.fights[0].casts.map((c) => c.atMs)).toEqual([29_000, 56_500]);
    for (const cast of view.fights[0].casts) expect(cast.picked).toHaveLength(1);
  });

  it("clusters up to the window and cuts past it", () => {
    const view = buildPairingView({
      rows: [
        row({ actorName: "A", pairings: [picked(10_000, 3_000, 0)] }),
        row({ actorName: "B", pairings: [picked(10_000 + PAIRING_CLUSTER_MS, 3_000, 0)] }),
        row({ actorName: "C", pairings: [picked(10_000 + PAIRING_CLUSTER_MS * 2 + 1, 3_000, 0)] }),
      ],
    });

    expect(view.fights[0].casts).toHaveLength(2);
    expect(view.fights[0].casts[0].picked.map((p) => p.name)).toEqual(["A", "B"]);
    expect(view.fights[0].casts[1].picked.map((p) => p.name)).toEqual(["C"]);
  });

  it("shows a cast with as many names as the log gave it", () => {
    // 18 of the 50 probed casts picked two and 3 picked one, with nothing in
    // the deaths to explain it. Nothing here may pad a cast up to three or
    // present a short one as incomplete.
    const view = buildPairingView({
      rows: [row({ actorName: "Wando", pairings: [picked(38_600, 2_000, 1_500)] })],
    });

    expect(view.fights[0].casts[0].picked).toHaveLength(1);
    expect(view.total).toBe(1);
  });
});

describe("who was picked and who was merely standing there", () => {
  it("separates the picked from the caught in one cast", () => {
    // The 1:53 pairing on the kill pull: three picked, and six more who took
    // the damage a second later without ever holding the debuff.
    const view = buildPairingView({
      rows: [
        row({ actorName: "Strixz", className: "Warlock", pairings: [picked(113_200, 3_000, 2_500)] }),
        row({ actorName: "Wando", className: "Rogue", pairings: [picked(113_200, 3_000, 7_500)] }),
        row({ actorName: "Huntigo", className: "Hunter", pairings: [picked(113_200, 2_500, 6_000)] }),
        row({ actorName: "Melige", className: "Mage", pairings: [caught(113_200, 3_000)] }),
        row({ actorName: "Goku", className: "Mage", pairings: [caught(113_200, 1_750)] }),
      ],
    });

    const cast = view.fights[0].casts[0];
    expect(cast.picked.map((p) => p.name)).toEqual(["Huntigo", "Strixz", "Wando"]);
    expect(cast.caught.map((p) => p.name)).toEqual(["Melige", "Goku"]);
    expect(cast.pickedDamage).toBe(16_000);
    expect(cast.caughtDamage).toBe(4_750);
    // `picks` counts names the boss chose, never everyone the cast reached.
    expect(view.picks).toBe(3);
  });

  it("reports the bystander damage as its own total", () => {
    // The finding this view exists for: on the probed nights MORE of the damage
    // landed on raiders who were never picked (1,039,671 against 990,266). A
    // total that folded the two together would hide it.
    const view = buildPairingView({
      rows: [
        row({ actorName: "Strixz", pairings: [picked(113_200, 3_000, 2_500)] }),
        row({ actorName: "Melige", pairings: [caught(113_200, 3_000)] }),
      ],
    });

    expect(view.pickedDamage).toBe(2_500);
    expect(view.caughtDamage).toBe(3_000);
  });

  it("counts a raider's two roles separately across the night", () => {
    // Zerohits was picked three times on one night and stood in others. The two
    // are different facts about the same raider and never add up.
    const view = buildPairingView({
      rows: [
        row({
          actorName: "Zerohits",
          className: "Hunter",
          pairings: [picked(84_000, 4_000, 9_250), caught(113_200, 500), picked(139_000, 6_000, 12_000)],
        }),
      ],
    });

    expect(view.night).toEqual([
      {
        name: "Zerohits",
        className: "Hunter",
        picks: 2,
        pickedDamage: 21_250,
        caught: 1,
        caughtDamage: 500,
        petDamage: 0,
        petsKilled: 0,
      },
    ]);
  });
});

describe("the kit the mechanic kills", () => {
  it("counts what died without calling its owner caught in it", () => {
    /*
     * The distinction the whole field exists for. Aizaizbaby stood clear and
     * took nothing; the AoE killed two of their thornlings. Filing them under
     * "caught in it" would read as a positioning mistake the log never claimed.
     */
    const view = buildPairingView({
      rows: [
        row({ actorName: "Strixz", pairings: [picked(113_200, 3_000, 2_500)] }),
        row({
          actorName: "Aizaizbaby",
          className: "Hunter",
          pairings: [kit(113_200, 1_800, ["Thornling", "Thornling"])],
        }),
      ],
    });

    const cast = view.fights[0].casts[0];
    expect(cast.caught).toEqual([]);
    expect(cast.kitKilled).toEqual([{ name: "Thornling", count: 2 }]);
    expect(cast.petDamage).toBe(1_800);
    expect(view.night.find((n) => n.name === "Aizaizbaby")).toMatchObject({
      caught: 0,
      caughtDamage: 0,
      petsKilled: 2,
      petDamage: 1_800,
    });
  });

  it("keeps kit damage out of every raider-damage total", () => {
    // 80,178 of this exists across six probed reports. None of it is damage a
    // raider took, and a total that folded it in would overstate every one.
    const view = buildPairingView({
      rows: [
        row({ actorName: "Strixz", pairings: [picked(113_200, 3_000, 2_500)] }),
        row({ actorName: "Huntigo", pairings: [kit(113_200, 9_000, ["Gnomish Flame Turret"])] }),
      ],
    });

    expect(view.pickedDamage).toBe(2_500);
    expect(view.caughtDamage).toBe(0);
    expect(view.petDamage).toBe(9_000);
    expect(view.fights[0].lanes.find((l) => l.name === "Huntigo")).toMatchObject({
      damage: 0,
      petDamage: 9_000,
      kitKilled: [{ name: "Gnomish Flame Turret", count: 1 }],
    });
  });

  it("adds the night's casualties up across casts, most-killed first", () => {
    const view = buildPairingView({
      rows: [
        row({
          actorName: "Aizaizbaby",
          pairings: [
            kit(29_000, 500, ["Goblin Land Mine", "Thornling"]),
            kit(56_500, 500, ["Goblin Land Mine"]),
          ],
        }),
        row({ actorName: "Huntigo", pairings: [kit(29_000, 250, ["Goblin Land Mine"])] }),
      ],
    });

    expect(view.kitKilled).toEqual([
      { name: "Goblin Land Mine", count: 3 },
      { name: "Thornling", count: 1 },
    ]);
    // A cast nobody was picked on is still a cast — it killed something.
    expect(view.total).toBe(2);
    expect(view.picks).toBe(0);
  });
});

describe("lanes and ordering", () => {
  it("gives each raider a lane with their picks in time order", () => {
    const view = buildPairingView({
      rows: [
        row({
          actorName: "Zerohits",
          pairings: [picked(139_000, 6_000, 12_000), picked(84_000, 4_000, 9_250)],
        }),
        row({ actorName: "Pabel", pairings: [picked(84_000, 4_000, 7_750)] }),
      ],
    });

    const [first, second] = view.fights[0].lanes;
    expect(first.name).toBe("Zerohits");
    expect(first.picks.map((p) => p.atMs)).toEqual([84_000, 139_000]);
    expect(first.damage).toBe(21_250);
    expect(second.name).toBe("Pabel");
  });

  it("carries the roster slug and the curated boss through", () => {
    const view = buildPairingView({
      rows: [row({ actorName: "Scomb", pairings: [picked(29_000, 4_000, 0)] })],
      slugByActor: new Map([["scomb", "scomb-warrior"]]),
    });

    expect(view.fights[0].casts[0].boss).toBe("Mother Shahraz");
    expect(view.fights[0].lanes[0].slug).toBe("scomb-warrior");
    expect(view.mechanics).toEqual([{ spell: "Fatal Attraction", boss: "Mother Shahraz", casts: 1 }]);
  });

  it("orders pulls by fight id and leaves untouched pulls out", () => {
    const view = buildPairingView({
      rows: [
        row({ fightId: 139, actorName: "Scomb", pairings: [picked(29_000, 4_000, 0)] }),
        row({ fightId: 136, actorName: "Melige", pairings: [picked(32_300, 3_000, 0)] }),
        row({ fightId: 137, actorName: "Shampilt", pairings: [] }),
      ],
    });

    expect(view.fights.map((f) => f.fightId)).toEqual([136, 139]);
  });
});

describe("the empty case the board has to be able to describe", () => {
  it("reports zero rather than inventing a quiet night", () => {
    // A report imported before either pairing fetch existed looks exactly like
    // a night the raid never met one of these bosses. The view reports zero and
    // the board says which it cannot tell.
    const view = buildPairingView({ rows: [row(), row({ actorName: "Melige" })] });

    expect(view).toMatchObject({ total: 0, picks: 0, pickedDamage: 0, caughtDamage: 0 });
    expect(view.fights).toEqual([]);
    expect(view.night).toEqual([]);
    expect(view.mechanics).toEqual([]);
  });
});

describe("the curated list this view labels from", () => {
  it("never lets a mechanic's damage id double as its debuff id", () => {
    // The trap the whole feature is built around: Fatal Attraction's debuff
    // (41001) and its damage (40871) share a name. Reading the picks off the
    // damage would invent pairings out of bystanders, who outnumber them.
    const debuffIds = new Set(PAIRING_DEBUFFS.map((p) => p.id));
    for (const pairing of PAIRING_DEBUFFS) {
      expect(pairing.damageIds.length, `${pairing.name} has no damage id`).toBeGreaterThan(0);
      for (const id of pairing.damageIds) {
        expect(debuffIds.has(id), `${pairing.name} uses ${id} as both debuff and damage`).toBe(false);
      }
    }
  });
});
