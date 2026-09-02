import { describe, expect, it } from "vitest";
import { buildDeployableView } from "@/lib/analysis/deployables";
import { DEPLOYABLES, deployableLabelsFor } from "@/lib/wcl/deployables";
import { TRACKED_CAST_IDS, classifyCast } from "@/lib/wcl/consumables";
import { defaultPriceFor } from "@/lib/wcl/consumable-prices";
import { COOLDOWN_CAST_IDS } from "@/lib/wcl/class-tracks";
import type { WclPlayerFight } from "@/lib/types";

const row = (over: Partial<WclPlayerFight> = {}): WclPlayerFight => ({
  id: "r|1|x",
  reportCode: "r",
  fightId: 139,
  encounterId: 604,
  encounterName: "Mother Shahraz",
  kill: true,
  durationMs: 158_000,
  actorName: "Aizaizbaby",
  characterId: null,
  className: "Hunter",
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

const laid = (name: string, atMs: number) => ({ name, atMs, deployable: true });

/**
 * The coupling that fails in total silence: this list decides what gets a cast
 * *moment*, but not what gets fetched. An id missing from both server-side
 * filters is curated, reviewed, merged, and never seen again.
 */
describe("every deployable is actually fetched", () => {
  it("has each id in the tracked-cast or cooldown filter", () => {
    const fetched = new Set([...TRACKED_CAST_IDS, ...COOLDOWN_CAST_IDS]);
    for (const d of DEPLOYABLES) {
      expect(
        fetched.has(d.id),
        `${d.label} (${d.id}) is in no server-side casts filter — it will never arrive`,
      ).toBe(true);
    }
  });

  it("keeps an item priced as a consumable and an ability not", () => {
    // The split is the reason these live in two curated lists: an item is spend
    // and an ability is not, and folding them together would charge a hunter
    // gold for pressing a trap. An ability never becomes a consumable, so it
    // never reaches the gold path at all — the catalog is not even consulted.
    for (const d of DEPLOYABLES) {
      if (d.kind === "item") {
        expect(TRACKED_CAST_IDS).toContain(d.id);
        expect(classifyCast(d.id)?.name).toBe(d.label);
      } else {
        expect(COOLDOWN_CAST_IDS).toContain(d.id);
        expect(TRACKED_CAST_IDS).not.toContain(d.id);
        expect(classifyCast(d.id)).toBeUndefined();
      }
    }
  });

  it("gates exactly the engineering devices on the profession", () => {
    // The "engineer who laid nothing of theirs" list is only as honest as this
    // marker: a device gated here that anybody can use would name raiders for a
    // profession they don't need, and one left ungated silently drops out of
    // the question. The two are the ones this codebase already prices as
    // engineering, and they are the two an engineering skill actually sets off.
    expect([...deployableLabelsFor("Engineering")].sort()).toEqual([
      "Gnomish Flame Turret",
      "Goblin Land Mine",
    ]);
    // Nothing else claims a profession - a thornling seed and a dog whistle are
    // bought and used by anyone, and a snake trap is a hunter's button.
    expect(DEPLOYABLES.filter((d) => d.profession !== undefined && d.profession !== "Engineering")).toEqual([]);
  });

  it("carries the council's baseline for the two engineering devices", () => {
    // 5g each, the council's own figure. The seed and the whistle stay at 0
    // because nobody has quoted one — a plausible guess there would move a real
    // gold ranking, and the per-raid price panel is the place to correct it.
    expect(defaultPriceFor("Goblin Land Mine")).toEqual({ gold: 5, charges: 1 });
    expect(defaultPriceFor("Gnomish Flame Turret")).toEqual({ gold: 5, charges: 1 });
    expect(defaultPriceFor("Thornling Seed")).toEqual({ gold: 0, charges: 1 });
    expect(defaultPriceFor("Dog Whistle")).toEqual({ gold: 0, charges: 1 });
  });
});

describe("buildDeployableView", () => {
  it("puts each raider on a lane, in the order they laid them", () => {
    const view = buildDeployableView({
      rows: [
        row({
          actorName: "Aizaizbaby",
          castTimes: [laid("Snake Trap", 11_500), laid("Goblin Land Mine", 4_600)],
        }),
        row({ actorName: "Huntigo", castTimes: [laid("Gnomish Flame Turret", 11_400)] }),
      ],
    });
    expect(view.fights).toHaveLength(1);
    const [pull] = view.fights;
    expect(pull.total).toBe(3);
    expect(pull.raiders).toBe(2);
    expect(pull.lanes.map((l) => l.name)).toEqual(["Aizaizbaby", "Huntigo"]);
    expect(pull.lanes[0].drops.map((d) => d.atMs)).toEqual([4_600, 11_500]);
    expect(pull.totals).toEqual([
      { name: "Gnomish Flame Turret", count: 1 },
      { name: "Goblin Land Mine", count: 1 },
      { name: "Snake Trap", count: 1 },
    ]);
  });

  it("ignores cooldowns and totems sharing the same list", () => {
    // castTimes carries three kinds of moment. Reading it unfiltered would put
    // every Bloodlust and Windfury drop in this view.
    const view = buildDeployableView({
      rows: [
        row({
          castTimes: [
            { name: "Bestial Wrath", atMs: 1_000 },
            { name: "Windfury Totem", atMs: 2_000, totem: true },
            laid("Snake Trap", 3_000),
          ],
        }),
      ],
    });
    expect(view.total).toBe(1);
    expect(view.fights[0].lanes[0].drops).toEqual([{ name: "Snake Trap", atMs: 3_000 }]);
  });

  it("sums a raider across pulls for the night view", () => {
    const view = buildDeployableView({
      rows: [
        row({ fightId: 138, castTimes: [laid("Snake Trap", 17_500)] }),
        row({ fightId: 139, castTimes: [laid("Snake Trap", 11_500), laid("Goblin Land Mine", 4_600)] }),
      ],
    });
    expect(view.fights.map((f) => f.fightId)).toEqual([138, 139]);
    expect(view.night[0]).toMatchObject({ name: "Aizaizbaby", className: "Hunter", count: 3 });
    expect(view.night[0].items).toEqual([
      { name: "Snake Trap", count: 2 },
      { name: "Goblin Land Mine", count: 1 },
    ]);
    expect(view.totals).toEqual([
      { name: "Snake Trap", count: 2 },
      { name: "Goblin Land Mine", count: 1 },
    ]);
  });

  it("leaves pulls where nothing went down out entirely", () => {
    const view = buildDeployableView({
      rows: [row({ fightId: 136, castTimes: [laid("Snake Trap", 3_700)] }), row({ fightId: 137 })],
    });
    expect(view.fights.map((f) => f.fightId)).toEqual([136]);
  });

  it("reports zero for a report imported before these were tracked", () => {
    // The page has to say it cannot tell this from a night nobody laid one on.
    const view = buildDeployableView({ rows: [row({ castTimes: [{ name: "Rapid Fire", atMs: 1 }] })] });
    expect(view.total).toBe(0);
    expect(view.fights).toEqual([]);
    expect(view.night).toEqual([]);
  });
});

/**
 * The list an officer actually asks for after a night on Mother Shahraz. Every
 * case here is about NOT accusing somebody: of being absent, of a cooldown they
 * could not have had up, or of a profession nobody recorded.
 */
describe("who laid nothing", () => {
  const shahraz = (fightId: number, actorName: string, over: Partial<WclPlayerFight> = {}) =>
    row({ fightId, actorName, encounterId: 604, encounterName: "Mother Shahraz", ...over });

  it("counts a raider silent across the boss, not per pull", () => {
    // Two wipes and a kill. The mine's fifteen-minute cooldown means one lay on
    // one of the three is the most anyone could do, so Aizaizbaby's two empty
    // pulls must not read as two pulls of laying nothing — and Huntigo's three
    // must.
    const view = buildDeployableView({
      rows: [
        shahraz(137, "Aizaizbaby", { castTimes: [laid("Goblin Land Mine", 4_600)] }),
        shahraz(138, "Aizaizbaby"),
        shahraz(139, "Aizaizbaby"),
        shahraz(137, "Huntigo"),
        shahraz(138, "Huntigo", { castTimes: [laid("Snake Trap", 2_000)] }),
        shahraz(139, "Huntigo"),
        shahraz(137, "Melige"),
        shahraz(138, "Melige"),
        shahraz(139, "Melige", { castTimes: [laid("Dog Whistle", 8_000)] }),
        shahraz(137, "Nenad"),
        shahraz(138, "Nenad"),
        shahraz(139, "Nenad"),
      ],
    });
    expect(view.silence).toHaveLength(1);
    const [boss] = view.silence;
    expect(boss).toMatchObject({ encounterName: "Mother Shahraz", pulls: 3, raiders: 4, total: 3 });
    expect(boss.silent.map((s) => s.name)).toEqual(["Nenad"]);
    expect(boss.silent[0].pulls).toBe(3);
    expect(boss.silent[0].laid).toEqual([]);
  });

  it("leaves out a pull the whole raid was silent on", () => {
    // The probed night's second Shahraz pull was a 26-second reset at 99.98%
    // nobody laid anything on. Counting it would give everybody a fourth pull
    // in their denominator that nobody could have used — and would put the
    // count out of step with the timeline above, which doesn't draw that pull.
    const view = buildDeployableView({
      rows: [
        shahraz(136, "Aizaizbaby", { castTimes: [laid("Goblin Land Mine", 4_600)] }),
        shahraz(136, "Nenad"),
        shahraz(137, "Aizaizbaby"),
        shahraz(137, "Nenad"),
        shahraz(138, "Aizaizbaby", { castTimes: [laid("Snake Trap", 2_000)] }),
        shahraz(138, "Nenad"),
      ],
    });
    expect(view.silence[0].pulls).toBe(2);
    expect(view.silence[0].silent).toEqual([
      { name: "Nenad", className: "Hunter", pulls: 2, laid: [] },
    ]);
  });

  it("does not call a raider silent on a pull they were not on", () => {
    // Presence is the row. Somebody who came in for the kill has one chance,
    // not three, and the list has to say so or the officer reads it as worse.
    const view = buildDeployableView({
      rows: [
        shahraz(137, "Aizaizbaby", { castTimes: [laid("Snake Trap", 4_600)] }),
        shahraz(138, "Aizaizbaby", { castTimes: [laid("Snake Trap", 4_600)] }),
        shahraz(139, "Aizaizbaby", { castTimes: [laid("Snake Trap", 4_600)] }),
        shahraz(139, "Latecomer"),
      ],
    });
    expect(view.silence[0].pulls).toBe(3);
    expect(view.silence[0].silent).toEqual([
      { name: "Latecomer", className: "Hunter", pulls: 1, laid: [] },
    ]);
  });

  it("names an engineer who laid no engineering device, and what they laid instead", () => {
    const view = buildDeployableView({
      rows: [
        shahraz(139, "Engie", { castTimes: [laid("Dog Whistle", 9_000)] }),
        shahraz(139, "Sparky", { castTimes: [laid("Goblin Land Mine", 4_600)] }),
      ],
      professionsByActor: new Map([
        ["engie", ["Engineering"]],
        ["sparky", ["Engineering", "Mining"]],
      ]),
    });
    const [boss] = view.silence;
    // Sparky laid a mine, so the question does not arise for him.
    expect(boss.engineers.map((e) => e.name)).toEqual(["Engie"]);
    expect(boss.engineers[0].laid).toEqual([{ name: "Dog Whistle", count: 1 }]);
    // ...and he laid something, so he is not on the silent list at all.
    expect(boss.silent).toEqual([]);
  });

  it("puts an engineer who laid nothing on both lists", () => {
    const view = buildDeployableView({
      rows: [
        shahraz(139, "Engie"),
        shahraz(139, "Aizaizbaby", { castTimes: [laid("Snake Trap", 4_600)] }),
      ],
      professionsByActor: new Map([["engie", ["Engineering"]]]),
    });
    const [boss] = view.silence;
    expect(boss.silent.map((s) => s.name)).toEqual(["Engie"]);
    expect(boss.engineers.map((e) => e.name)).toEqual(["Engie"]);
    expect(boss.silent[0].engineer).toBe(true);
  });

  it("never names a raider whose professions nobody recorded", () => {
    // The roster is hand-entered and usually blank. An unrecorded engineer is
    // unknown, not innocent and not guilty - the same one-directional rule
    // `analysis/professions.ts` holds to.
    const view = buildDeployableView({
      rows: [
        shahraz(139, "Unrecorded"),
        shahraz(139, "Aizaizbaby", { castTimes: [laid("Snake Trap", 4_600)] }),
      ],
    });
    expect(view.silence[0].engineers).toEqual([]);
    expect(view.silence[0].silent.map((s) => s.name)).toEqual(["Unrecorded"]);
  });

  it("leaves out a boss nobody laid anything on", () => {
    // Otherwise the list is the raid roster, on every farm boss the kit was
    // never wanted on - and on every report imported before these were tracked.
    const view = buildDeployableView({
      rows: [
        shahraz(139, "Aizaizbaby", { castTimes: [laid("Snake Trap", 4_600)] }),
        row({ fightId: 150, encounterId: 601, encounterName: "Illidan Stormrage", actorName: "Aizaizbaby" }),
        row({ fightId: 150, encounterId: 601, encounterName: "Illidan Stormrage", actorName: "Huntigo" }),
      ],
    });
    expect(view.silence.map((s) => s.encounterName)).toEqual(["Mother Shahraz"]);
  });

  it("keeps the bosses in the order the raid met them", () => {
    const view = buildDeployableView({
      rows: [
        row({ fightId: 150, encounterId: 601, encounterName: "Illidan Stormrage", castTimes: [laid("Snake Trap", 1)] }),
        shahraz(139, "Aizaizbaby", { castTimes: [laid("Snake Trap", 1)] }),
      ],
    });
    expect(view.silence.map((s) => s.encounterName)).toEqual([
      "Mother Shahraz",
      "Illidan Stormrage",
    ]);
  });
});
