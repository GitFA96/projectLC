import { describe, expect, it } from "vitest";
import { buildDeployableView } from "@/lib/analysis/deployables";
import { DEPLOYABLES } from "@/lib/wcl/deployables";
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
