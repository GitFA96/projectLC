import { describe, expect, it } from "vitest";
import { normalizeWclReport } from "@/lib/wcl/normalize";
import {
  classifyAura,
  classifyCast,
  CURATED_ELIXIR_LABELS,
  elixirCategoryOf,
  isFoodLabel,
  isNonConsumableAura,
  SAPPER_CAST_NAMES,
  TRACKED_CAST_IDS,
} from "@/lib/wcl/consumables";
import { defaultPriceFor } from "@/lib/wcl/consumable-prices";

/**
 * Fixture shaped like the v2 API responses: report overview (with dps/hps
 * rankings JSON) + raw event arrays. Times inside the report are relative ms.
 */

const REPORT_START = 1765000000000;

function gear(
  overrides: Record<
    number,
    {
      permanentEnchant?: number | null;
      temporaryEnchant?: number | null;
      id?: number;
      quality?: number;
      gems?: { id?: number; icon?: string }[];
    }
  > = {},
) {
  return Array.from({ length: 17 }, (_, i) => ({
    id: 30000 + i,
    itemLevel: 120 + i,
    permanentEnchant: 3001 as number | null,
    temporaryEnchant: null as number | null,
    quality: 4,
    ...overrides[i],
  }));
}

const rawReport = {
  title: "Kara test night",
  startTime: REPORT_START,
  endTime: REPORT_START + 3_600_000,
  zone: { name: "Karazhan" },
  masterData: {
    actors: [
      { id: 1, name: "Thrainn", type: "Player", subType: "Warrior" },
      { id: 2, name: "Pyrelia", type: "Player", subType: "Mage" },
      { id: 3, name: "Lunara", type: "Player", subType: "Druid" },
      { id: 9, name: "Wolfie", type: "Pet", subType: "Pet" },
      // Enemy NPCs — upkeep targets resolve against these (boss vs add).
      { id: 50, name: "Attumen the Huntsman", type: "NPC", subType: "Boss" },
      { id: 51, name: "Midnight", type: "NPC", subType: "NPC" },
      { id: 60, name: "Moroes", type: "NPC", subType: "Boss" },
    ],
  },
  fights: [
    { id: 7, encounterID: 653, name: "Attumen the Huntsman", kill: true, fightPercentage: null, startTime: 100000, endTime: 400000 },
    { id: 8, encounterID: 0, name: "Trash", kill: null, startTime: 450000, endTime: 500000 },
    { id: 9, encounterID: 654, name: "Moroes", kill: false, fightPercentage: 38.6, startTime: 600000, endTime: 850000 },
  ],
  dps: {
    data: [
      {
        fightID: 7,
        roles: {
          tanks: { characters: [{ name: "Thrainn", class: "Warrior", spec: "Protection", amount: 512.3, rankPercent: 61, bracketPercent: 66 }] },
          dps: { characters: [{ name: "Pyrelia", class: "Mage", spec: "Fire", amount: 845.9, rankPercent: 97.4, bracketPercent: 91 }] },
          // Healers also show up in dps rankings — must be ignored in favor of hps.
          healers: { characters: [{ name: "Lunara", class: "Druid", spec: "Restoration", amount: 95.1, rankPercent: 4, bracketPercent: 6 }] },
        },
      },
      {
        fightID: 9,
        roles: {
          tanks: { characters: [{ name: "Thrainn", class: "Warrior", spec: "Protection", amount: 478 }] },
          dps: { characters: [{ name: "Pyrelia", class: "Mage", spec: "Fire", amount: 802.2 }] },
        },
      },
    ],
  },
  bossdps: {
    data: [
      {
        fightID: 7,
        roles: {
          tanks: { characters: [{ name: "Thrainn", class: "Warrior", spec: "Protection", amount: 302.1, rankPercent: 55 }] },
          dps: { characters: [{ name: "Pyrelia", class: "Mage", spec: "Fire", amount: 610.4, rankPercent: 88 }] },
          // WCL ranks healers here too, at ~0 damage — never worth recording.
          healers: { characters: [{ name: "Lunara", class: "Druid", spec: "Restoration", amount: 0, rankPercent: 12 }] },
          // A name that never showed up in the dps/hps rankings isn't in the raid.
          ghost: { characters: [{ name: "Nobody", class: "Rogue", spec: "Combat", amount: 700, rankPercent: 99 }] },
        },
      },
    ],
  },
  hps: {
    data: [
      {
        fightID: 7,
        roles: { healers: { characters: [{ name: "Lunara", class: "Druid", spec: "Restoration", amount: 1011.5, rankPercent: 84, bracketPercent: 79 }] } },
      },
      {
        fightID: 9,
        roles: { healers: { characters: [{ name: "Lunara", class: "Druid", spec: "Restoration", amount: 988 }] } },
      },
    ],
  },
};

const combatantInfo = [
  {
    timestamp: 100050,
    type: "combatantinfo",
    sourceID: 1,
    auras: [
      { name: "Flask of Fortification", ability: 28518 },
      { name: "Well Fed", ability: 33257 },
      { name: "Commanding Shout", ability: 469 },
    ],
    gear: gear({ 15: { temporaryEnchant: 2713 }, 0: { gems: [{ id: 24027, icon: "inv_jewelcrafting_livingruby_03.jpg" }, {}] } }),
    // Points per tree, with the class icon repeated in every entry (as WCL sends it).
    talents: [
      { id: 33, icon: "inv_axe_02.jpg" },
      { id: 28, icon: "inv_axe_02.jpg" },
      { id: 0, icon: "inv_axe_02.jpg" },
    ],
  },
  {
    timestamp: 100060,
    type: "combatantinfo",
    sourceID: 2,
    auras: [
      // Buff-style name (the log drops "Elixir of"), unknown id.
      { name: "Major Firepower", ability: 999001 },
      { name: "Elixir of Draenic Wisdom", ability: 39627 },
      { name: "Well Fed", ability: 33263 },
      // Pre-pot recognized by spell id even under a buff-style name.
      { name: "Haste", ability: 28507 },
      // Scroll buffs are bare stat names in logs: rank from the id when known.
      { name: "Agility", ability: 33077 },
      { name: "Strength", ability: 999002 },
      // Class buffs are filtered from the dump; genuine unknowns stay in it.
      { name: "Greater Blessing of Kings", ability: 25898 },
      { name: "Mystery Brew", ability: 424242 },
    ],
    gear: gear({ 4: { permanentEnchant: null } }),
  },
  {
    timestamp: 100070,
    type: "combatantinfo",
    sourceID: 3,
    auras: [
      { name: "Flask of Mighty Restoration", ability: 28519 },
      // Off-slot consumable → extras.
      { name: "Kreeg's Stout Beatdown", ability: 22790 },
    ],
    gear: gear({ 15: { temporaryEnchant: 2629 } }),
  },
  // During trash — boss fights only, must be ignored (with a warning).
  { timestamp: 460000, type: "combatantinfo", sourceID: 1, auras: [], gear: [] },
  // Trash by WCL's own fight index, even though the timestamp sits inside
  // Attumen's window — the fight field is authoritative.
  {
    timestamp: 150000,
    type: "combatantinfo",
    fight: 8,
    sourceID: 2,
    auras: [{ name: "Flask of Pure Death", ability: 28540 }],
    gear: [],
  },
  { timestamp: 600100, type: "combatantinfo", sourceID: 1, auras: [{ name: "Flask of Fortification", ability: 28518 }, { name: "Well Fed", ability: 33257 }], gear: gear({ 15: { temporaryEnchant: 2713 } }) },
  { timestamp: 600110, type: "combatantinfo", sourceID: 2, auras: [{ name: "Well Fed", ability: 33263 }], gear: gear({ 4: { permanentEnchant: null } }) },
  { timestamp: 600120, type: "combatantinfo", sourceID: 3, auras: [], gear: gear() },
];

const deaths = [
  // Killed by a named add with a named ability — both are in the payload and
  // both used to be dropped on the floor.
  { timestamp: 700000, type: "death", targetID: 2, killerID: 60, killingAbility: { name: "Vanish", guid: 29448 } },
  // A pet death — no player row, silently ignored.
  { timestamp: 710000, type: "death", targetID: 9 },
];

const casts = [
  { timestamp: 150000, type: "cast", sourceID: 2, ability: { name: "Haste Potion", guid: 28507 } },
  // begincast must not count.
  { timestamp: 200000, type: "begincast", sourceID: 2, ability: { name: "Haste Potion", guid: 28507 } },
  // Bare ability id (useAbilityIDs: true shape) resolves via the curated map.
  { timestamp: 160000, type: "cast", sourceID: 1, abilityGameID: 28515 },
  { timestamp: 170000, type: "cast", sourceID: 2, ability: { name: "Drums of Battle", guid: 35476 } },
  { timestamp: 650000, type: "cast", sourceID: 3, ability: { name: "Super Mana Potion", guid: 28499 } },
  // Outside any boss pull.
  { timestamp: 50000, type: "cast", sourceID: 2, ability: { name: "Haste Potion", guid: 28507 } },
  // Timestamp outside every window, but the fight field routes it to Moroes.
  { timestamp: 50, type: "cast", fight: 9, sourceID: 2, ability: { name: "Haste Potion", guid: 28507 } },
  // Mana gems share the "Replenish Mana" use spell — the id names the gem.
  { timestamp: 650500, type: "cast", sourceID: 3, ability: { name: "Replenish Mana", guid: 27103 } },
  { timestamp: 651000, type: "cast", sourceID: 1, ability: { name: "Nightmare Seed", guid: 28726 } },
  // Class cooldowns ride the same cast stream (server-filtered by id).
  { timestamp: 175000, type: "cast", sourceID: 1, ability: { name: "Death Wish", guid: 12292 } },
];

const debuffs = [
  // Thunder Clap on the boss (target 50) by Thrainn during Attumen
  // (100000–400000): 110000→200000 (90s) + 230000→fight end (170s) = 260s of
  // 300s ⇒ 87%.
  { timestamp: 110000, type: "applydebuff", sourceID: 1, targetID: 50, ability: { name: "Thunder Clap", guid: 25264 } },
  { timestamp: 200000, type: "removedebuff", sourceID: 1, targetID: 50, ability: { name: "Thunder Clap", guid: 25264 } },
  { timestamp: 230000, type: "applydebuff", sourceID: 1, targetID: 50, ability: { name: "Thunder Clap", guid: 25264 } },
  // A brief Thunder Clap on an add (target 51) must not win best-target.
  { timestamp: 120000, type: "applydebuff", sourceID: 1, targetID: 51, ability: { name: "Thunder Clap" } },
  { timestamp: 130000, type: "removedebuff", sourceID: 1, targetID: 51, ability: { name: "Thunder Clap" } },
  // Sunder Armor spam on the boss: one landed cast emits an applydebuffstack
  // AND a refreshdebuff at the same ms — count each timestamp once (3 casts).
  { timestamp: 105000, type: "applydebuff", sourceID: 1, targetID: 50, ability: { name: "Sunder Armor", guid: 25225 } },
  { timestamp: 106000, type: "applydebuffstack", sourceID: 1, targetID: 50, ability: { name: "Sunder Armor", guid: 25225 } },
  { timestamp: 106000, type: "refreshdebuff", sourceID: 1, targetID: 50, ability: { name: "Sunder Armor", guid: 25225 } },
  { timestamp: 107000, type: "refreshdebuff", sourceID: 1, targetID: 50, ability: { name: "Sunder Armor", guid: 25225 } },
  // First sighting is a removal — credited from the pull start
  // (Moroes 600000–850000): 600000→690000 = 90s of 250s ⇒ 36%.
  { timestamp: 690000, type: "removedebuff", sourceID: 1, targetID: 60, ability: { name: "Demoralizing Shout" } },
  // Pre-cast before the pull: the first sighting is a REFRESH (Hunter's Mark
  // applied pre-fight) — credited from the pull start, not the refresh.
  { timestamp: 650000, type: "refreshdebuff", sourceID: 2, targetID: 60, ability: { name: "Hunter's Mark" } },
  // Untracked debuffs are ignored.
  { timestamp: 615000, type: "applydebuff", sourceID: 2, targetID: 60, ability: { name: "Mystery Hex" } },
];

const buffs = [
  // Battle Shout on SELF during Moroes: 650000→fight end = 200s of 250s ⇒ 80%.
  { timestamp: 650000, type: "applybuff", sourceID: 1, targetID: 1, ability: { name: "Battle Shout", guid: 2048 } },
  // The same shout landing on someone else never counts as self-upkeep.
  { timestamp: 650000, type: "applybuff", sourceID: 1, targetID: 3, ability: { name: "Battle Shout", guid: 2048 } },
  // Earth Shield is friendly-target upkeep, attributed to the SOURCE:
  // 620000→720000 = 100s of 250s ⇒ 40% for Lunara.
  { timestamp: 620000, type: "applybuff", sourceID: 3, targetID: 1, ability: { name: "Earth Shield", guid: 32594 } },
  { timestamp: 720000, type: "removebuff", sourceID: 3, targetID: 1, ability: { name: "Earth Shield", guid: 32594 } },
];

describe("normalizeWclReport", () => {
  const result = normalizeWclReport(rawReport, { combatantInfo, deaths, casts, debuffs, buffs });
  const row = (fightId: number, name: string) =>
    result.rows.find((r) => r.fightId === fightId && r.actorName === name)!;

  it("keeps report meta and converts times to ISO", () => {
    expect(result.title).toBe("Kara test night");
    expect(result.zone).toBe("Karazhan");
    expect(result.startTime).toBe(new Date(REPORT_START).toISOString());
  });

  it("creates one row per player per boss pull — no trash, no pets", () => {
    expect(result.rows).toHaveLength(6);
    expect(result.rows.every((r) => r.encounterId !== 0)).toBe(true);
    expect(result.rows.some((r) => r.actorName === "Wolfie")).toBe(false);
  });

  it("records the talent split as played, dropping the repeated class icon", () => {
    expect(row(7, "Thrainn").talents).toEqual([33, 28, 0]);
  });

  it("leaves talents empty when the log didn't carry them", () => {
    // Older reports have no talents field — that must read as "unknown build",
    // not as an all-zero build that would compare equal to another unknown.
    expect(row(7, "Pyrelia").talents).toEqual([]);
  });

  it("assigns roles and parses from the right rankings (healers on hps)", () => {
    const tank = row(7, "Thrainn");
    expect(tank.role).toBe("tank");
    expect(tank.parsePercent).toBe(61);
    expect(tank.kill).toBe(true);
    expect(tank.durationMs).toBe(300000);

    const mage = row(7, "Pyrelia");
    expect(mage.role).toBe("dps");
    expect(mage.parsePercent).toBeCloseTo(97.4);
    expect(mage.bracketPercent).toBe(91);

    const healer = row(7, "Lunara");
    expect(healer.role).toBe("healer");
    expect(healer.parsePercent).toBe(84);
    expect(healer.amount).toBeCloseTo(1011.5);
  });

  it("records boss-damage parses alongside the all-damage ones", () => {
    // Same players, ranked on damage to the boss alone — a separate number
    // that must not overwrite the all-damage parse or the role.
    expect(row(7, "Pyrelia")).toMatchObject({
      role: "dps",
      parsePercent: 97.4,
      bossParsePercent: 88,
      bossAmount: 610.4,
    });
    expect(row(7, "Thrainn")).toMatchObject({ role: "tank", parsePercent: 61, bossParsePercent: 55 });
  });

  it("keeps boss damage off healers, and invents no rows from it", () => {
    // A healer's boss damage is ~0 and meaningless; a name only the boss-damage
    // rankings mention was never in the raid to begin with.
    expect(row(7, "Lunara").bossParsePercent).toBeUndefined();
    expect(result.rows.some((r) => r.actorName === "Nobody")).toBe(false);
  });

  it("marks wipes with boss percentage and no parse", () => {
    const wipe = row(9, "Thrainn");
    expect(wipe.kill).toBe(false);
    expect(wipe.fightPercentage).toBeCloseTo(38.6);
    expect(wipe.parsePercent).toBeUndefined();
  });

  it("reads consumables and the gear audit from combatant info at pull", () => {
    const tank = row(7, "Thrainn");
    expect(tank.flask).toBe("Flask of Fortification");
    expect(tank.food).toBe(true);
    expect(tank.weaponBuff).toBe(true);
    expect(tank.missingEnchants).toEqual([]);

    const mage = row(7, "Pyrelia");
    expect(mage.flask).toBeUndefined();
    // Buff-style aura names resolve to the canonical item names.
    expect(mage.elixirs).toEqual(["Elixir of Major Firepower", "Elixir of Draenic Wisdom"]);
    expect(mage.scrolls).toEqual(["Scroll of Agility V", "Scroll of Strength"]);
    expect(mage.prepot).toBe(true);
    expect(mage.weaponBuff).toBe(false);
    expect(mage.missingEnchants).toEqual(["Chest"]);

    const healer = row(7, "Lunara");
    expect(healer.food).toBe(false);
  });

  it("keeps the killing blow the log named", () => {
    // Both fields were in every death event all along and neither was read, so
    // the deaths section could only say when somebody died. Moroes is actor 60.
    expect(row(9, "Pyrelia").deathTimes).toEqual([
      { atMs: 100_000, killer: "Moroes", ability: "Vanish" },
    ]);
  });

  it("buckets deaths and consumable casts into the right pulls", () => {
    expect(row(9, "Pyrelia").deaths).toBe(1);
    expect(row(7, "Pyrelia").deaths).toBe(0);
    expect(row(7, "Pyrelia").potions).toEqual(["Haste Potion"]);
    expect(row(7, "Pyrelia").drums).toBe(1);
    expect(row(7, "Pyrelia").otherCasts).toEqual(["Drums of Battle"]);
    expect(row(7, "Thrainn").potions).toEqual(["Ironshield Potion"]);
    expect(row(9, "Lunara").potions).toEqual(["Super Mana Potion"]);
  });

  it("labels non-potion in-fight items by spell id (gems, seeds)", () => {
    expect(row(9, "Lunara").otherCasts).toEqual(["Mana Emerald"]);
    expect(row(9, "Thrainn").otherCasts).toEqual(["Nightmare Seed"]);
  });

  it("dumps unrecognized aura names for curation, minus known class buffs", () => {
    const brew = result.unclassifiedAuras.find((a) => a.name === "Mystery Brew");
    expect(brew).toMatchObject({ abilityId: 424242, count: 1 });
    // Recognized consumables never land in the dump…
    expect(result.unclassifiedAuras.some((a) => a.name === "Agility")).toBe(false);
    // …and neither do curated class buffs or tracked upkeep auras.
    expect(result.unclassifiedAuras.some((a) => a.name === "Greater Blessing of Kings")).toBe(false);
    expect(result.unclassifiedAuras.some((a) => a.name === "Commanding Shout")).toBe(false);
  });

  it("captures the worn-gear snapshot per pull", () => {
    const tank = row(7, "Thrainn");
    expect(tank.gear).toHaveLength(17);
    const weapon = tank.gear.find((g) => g.slot === 15)!;
    expect(weapon).toMatchObject({ id: 30015, ilvl: 135, enchant: 3001, temp: 2713 });
    // Gems keep the icon the log gives them (extension stripped); entries
    // without an id are dropped. Their names come from the item cache later.
    expect(tank.gear.find((g) => g.slot === 0)!.gems).toEqual([
      { id: 24027, icon: "inv_jewelcrafting_livingruby_03" },
    ]);
    // Quality rides along, so gear renders coloured with no lookup at all.
    expect(weapon.quality).toBe("epic");
    // The mage's unenchanted chest carries no enchant id.
    expect(row(7, "Pyrelia").gear.find((g) => g.slot === 4)!.enchant).toBeUndefined();
  });

  it("collects off-slot consumable buffs as extras", () => {
    expect(row(7, "Lunara").extras).toEqual(["Kreeg's Stout Beatdown"]);
    expect(row(7, "Thrainn").extras).toEqual([]);
  });

  it("counts class cooldown casts per pull", () => {
    expect(row(7, "Thrainn").cooldowns).toEqual(["Death Wish"]);
    expect(row(9, "Thrainn").cooldowns).toEqual([]);
  });

  it("computes maintained-debuff uptime on the player's best target", () => {
    const upkeep = row(7, "Thrainn").upkeep;
    // 260s of 300s on the boss — the add's brief 10s never wins best-target,
    // but both victims land in the per-target timeline (boss first).
    expect(upkeep).toContainEqual({
      name: "Thunder Clap",
      pct: 87,
      targets: [
        {
          target: "Attumen the Huntsman",
          boss: true,
          pct: 87,
          segments: [
            [10000, 100000],
            [130000, 300000],
          ],
          applications: 2,
        },
        { target: "Midnight", boss: false, pct: 3, segments: [[20000, 30000]], applications: 1 },
      ],
    });
  });

  it("tracks Sunder Armor with landed-cast counts (same-ms event pairs count once)", () => {
    // Up from 105000 to the fight end (400000): 295s of 300s ⇒ 98%.
    expect(row(7, "Thrainn").upkeep).toContainEqual({
      name: "Sunder Armor",
      pct: 98,
      targets: [
        {
          target: "Attumen the Huntsman",
          boss: true,
          pct: 98,
          segments: [[5000, 300000]],
          applications: 3,
        },
      ],
    });
  });

  it("credits a pre-cast debuff (refresh-first) from the pull start", () => {
    // Hunter's Mark was applied before the pull — the only in-fight event is a
    // refresh at 650000, but the debuff was on the boss the whole fight.
    expect(row(9, "Pyrelia").upkeep).toContainEqual({
      name: "Hunter's Mark",
      pct: 100,
      targets: [{ target: "Moroes", boss: true, pct: 100, segments: [[0, 250000]], applications: 1 }],
    });
  });

  it("credits a remove-without-apply from the pull start", () => {
    expect(row(9, "Thrainn").upkeep).toContainEqual({
      name: "Demoralizing Shout",
      pct: 36,
      targets: [{ target: "Moroes", boss: true, pct: 36, segments: [[0, 90000]], applications: 0 }],
    });
  });

  it("tracks a raid buff on every player it landed on, credited to its caster", () => {
    // The shout is Thrainn's upkeep wherever it sits — on himself and on
    // Lunara — which is what the by-player view reads back.
    expect(row(9, "Thrainn").upkeep).toContainEqual({
      name: "Battle Shout",
      pct: 80,
      targets: [
        { target: "Lunara", boss: false, player: true, pct: 80, segments: [[50000, 250000]], applications: 1 },
        { target: "Thrainn", boss: false, player: true, pct: 80, segments: [[50000, 250000]], applications: 1 },
      ],
    });
    // Receiving it is never the recipient's own upkeep.
    expect(row(9, "Lunara").upkeep.some((u) => u.name === "Battle Shout")).toBe(false);
    // Earth Shield is the same shape: attributed to the shaman who cast it.
    expect(row(9, "Lunara").upkeep).toContainEqual({
      name: "Earth Shield",
      pct: 40,
      targets: [
        { target: "Thrainn", boss: false, player: true, pct: 40, segments: [[20000, 120000]], applications: 1 },
      ],
    });
  });

  it("opens buff upkeep at the pull when the aura is already up", () => {
    // Commanding Shout sat in Thrainn's pull auras with zero buff events in
    // the fight — that's 100% uptime, not 0%.
    expect(row(7, "Thrainn").upkeep).toContainEqual({
      name: "Commanding Shout",
      pct: 100,
      targets: [{ target: "Thrainn", boss: false, player: true, pct: 100, segments: [[0, 300000]], applications: 0 }],
    });
  });

  it("stamps rows with the fight start offset for wall-clock times", () => {
    expect(row(7, "Thrainn").fightStartMs).toBe(100000);
    expect(row(9, "Thrainn").fightStartMs).toBe(600000);
  });

  it("warns about combatant info outside boss pulls", () => {
    expect(result.warnings.some((w) => w.includes("combatant-info"))).toBe(true);
  });

  it("prefers WCL's fight field over timestamps and exposes ignored events", () => {
    // Two ignored combatant-infos: timestamp-orphan (Thrainn) + trash-field (Pyrelia).
    expect(result.ignoredCombatantInfo.total).toBe(2);
    expect(result.ignoredCombatantInfo.players).toBe(2);
    expect(
      result.ignoredCombatantInfo.sample.some(
        (e) => e.player === "Pyrelia" && e.auras.includes("Flask of Pure Death"),
      ),
    ).toBe(true);
    // The trash event did NOT leak its flask into the Attumen pull…
    expect(row(7, "Pyrelia").flask).toBeUndefined();
    // …and a cast stamped outside every window still lands via its fight field.
    expect(row(9, "Pyrelia").potions).toEqual(["Haste Potion"]);
  });
});

/**
 * Raid buffs put on OTHER players (the caster is named in the pull's aura
 * snapshot) and the totem drops that carry no aura at all.
 */
describe("normalizeWclReport — raid buffs and totem drops", () => {
  const buffReport = {
    title: "Totem night",
    startTime: REPORT_START,
    endTime: REPORT_START + 600_000,
    masterData: {
      actors: [
        { id: 1, name: "Tidemar", type: "Player", subType: "Shaman" },
        { id: 2, name: "Kazrak", type: "Player", subType: "Warrior" },
        // The totem is a pet of the shaman who dropped it.
        { id: 20, name: "Windfury Totem", type: "Pet", subType: "Pet", petOwner: 1 },
        { id: 50, name: "Attumen the Huntsman", type: "NPC", subType: "Boss" },
      ],
    },
    fights: [
      { id: 1, encounterID: 653, name: "Attumen the Huntsman", kill: true, startTime: 0, endTime: 200_000 },
    ],
    dps: {
      data: [
        {
          fightID: 1,
          roles: {
            dps: {
              characters: [
                { name: "Tidemar", class: "Shaman", spec: "Enhancement" },
                { name: "Kazrak", class: "Warrior", spec: "Fury" },
              ],
            },
          },
        },
      ],
    },
  };

  const result = normalizeWclReport(buffReport, {
    combatantInfo: [
      // Kazrak pulled with Battle Shout already up — the aura names its caster,
      // so it counts from the pull start even with no buff events inside it.
      {
        timestamp: 10,
        type: "combatantinfo",
        sourceID: 2,
        auras: [{ name: "Battle Shout", ability: 2048, source: 2 }],
        gear: [],
      },
      { timestamp: 20, type: "combatantinfo", sourceID: 1, auras: [], gear: [] },
    ],
    deaths: [],
    casts: [
      // Totem drops: no aura ever reaches the raid, so the cast IS the record.
      { timestamp: 20_000, type: "cast", sourceID: 1, ability: { name: "Windfury Totem", guid: 25587 } },
      { timestamp: 21_000, type: "cast", sourceID: 1, ability: { name: "Strength of Earth Totem", guid: 25528 } },
      { timestamp: 150_000, type: "cast", sourceID: 1, ability: { name: "Windfury Totem", guid: 8512 } },
      // Mana Tide is a cooldown AND a totem — it belongs to both views.
      { timestamp: 90_000, type: "cast", sourceID: 1, ability: { name: "Mana Tide Totem", guid: 16190 } },
      // A targeted cooldown records who it was aimed at.
      { timestamp: 60_000, type: "cast", sourceID: 1, targetID: 2, ability: { name: "Heroism", guid: 32182 } },
    ],
    debuffs: [],
    buffs: [],
  });
  const row = (name: string) => result.rows.find((r) => r.actorName === name)!;

  it("records totem drops with their moment in the pull", () => {
    expect(row("Tidemar").castTimes.filter((c) => c.totem)).toEqual([
      { name: "Windfury Totem", atMs: 20_000, totem: true },
      { name: "Strength of Earth Totem", atMs: 21_000, totem: true },
      { name: "Mana Tide Totem", atMs: 90_000, totem: true },
      { name: "Windfury Totem", atMs: 150_000, totem: true },
    ]);
    // Only Mana Tide is a tracked cooldown — plain totems never inflate that count.
    expect([...row("Tidemar").cooldowns].sort()).toEqual(["Heroism", "Mana Tide Totem"]);
  });

  it("stamps a targeted cooldown with its recipient", () => {
    expect(row("Tidemar").castTimes).toContainEqual({ name: "Heroism", atMs: 60_000, target: "Kazrak" });
  });

  it("credits a buff already up at the pull to the caster the aura names", () => {
    expect(row("Kazrak").upkeep).toContainEqual({
      name: "Battle Shout",
      pct: 100,
      targets: [
        { target: "Kazrak", boss: false, player: true, pct: 100, segments: [[0, 200_000]], applications: 0 },
      ],
    });
  });
});

/**
 * A raid night is mostly not boss pulls. These cover the casts that land
 * between them, and the ones a hunter aims at their pet.
 */
describe("normalizeWclReport — off-pull consumables and pets", () => {
  const offPullReport = {
    title: "Trash night",
    startTime: REPORT_START,
    endTime: REPORT_START + 900_000,
    zone: { name: "Serpentshrine Cavern" },
    masterData: {
      actors: [
        { id: 1, name: "Sylvaria", type: "Player", subType: "Hunter" },
        { id: 2, name: "Kazrak", type: "Player", subType: "Warrior" },
        { id: 9, name: "Wolfie", type: "Pet", subType: "Pet", petOwner: 1 },
        { id: 10, name: "Someone Else's Pet", type: "Pet", subType: "Pet", petOwner: 2 },
      ],
    },
    // One boss pull, 300s–600s. Everything outside that is trash.
    fights: [{ id: 1, encounterID: 623, name: "Hydross", kill: true, startTime: 300_000, endTime: 600_000 }],
    dps: {
      data: [
        {
          fightID: 1,
          roles: {
            dps: {
              characters: [
                { name: "Sylvaria", class: "Hunter", spec: "Beast Mastery", amount: 800, rankPercent: 70 },
                { name: "Kazrak", class: "Warrior", spec: "Fury", amount: 700, rankPercent: 60 },
              ],
            },
          },
        },
      ],
    },
  };

  const result = normalizeWclReport(offPullReport, {
    combatantInfo: [
      { timestamp: 299_000, type: "combatantinfo", sourceID: 1, auras: [], gear: [] },
      { timestamp: 299_000, type: "combatantinfo", sourceID: 2, auras: [], gear: [] },
    ],
    deaths: [],
    casts: [
      // Before the pull — clearing trash.
      { timestamp: 100_000, type: "cast", sourceID: 1, ability: { name: "Restore Mana", guid: 28499 } },
      { timestamp: 120_000, type: "cast", sourceID: 2, ability: { name: "Super Healing Potion", guid: 28495 } },
      { timestamp: 130_000, type: "cast", sourceID: 2, ability: { name: "Drums of Battle", guid: 35476 } },
      // During the pull — belongs to the fight row, not the off-pull tally.
      { timestamp: 450_000, type: "cast", sourceID: 1, ability: { name: "Haste Potion", guid: 28507 } },
      // After the pull — running back.
      { timestamp: 700_000, type: "cast", sourceID: 2, ability: { name: "Dark Rune", guid: 27869 } },
      // Pet food, fed between pulls.
      { timestamp: 90_000, type: "cast", sourceID: 1, targetID: 9, ability: { name: "Well Fed", guid: 43771 } },
      // A scroll read onto their own pet.
      { timestamp: 95_000, type: "cast", sourceID: 1, targetID: 9, ability: { name: "Agility", guid: 33077 } },
      // A scroll the hunter read on THEMSELVES — already counted as a pull
      // aura, so it must not be double-counted from the cast stream.
      { timestamp: 96_000, type: "cast", sourceID: 1, targetID: 1, ability: { name: "Agility", guid: 33077 } },
      // A scroll aimed at somebody else's pet is that person's business.
      { timestamp: 97_000, type: "cast", sourceID: 2, targetID: 10, ability: { name: "Strength", guid: 33082 } },
    ],
    debuffs: [],
    buffs: [],
  });

  const off = (name: string) => result.offPull.find((o) => o.actorName === name);

  it("counts consumables used between pulls, and leaves in-pull ones on the pull", () => {
    expect(off("Kazrak")).toMatchObject({
      potions: ["Super Healing Potion"],
      otherCasts: ["Drums of Battle", "Dark Rune"],
      drums: 1,
      runes: 1,
    });
    // The trash mana potion is off-pull; the Haste Potion on Hydross is not.
    expect(off("Sylvaria")!.potions).toEqual(["Super Mana Potion"]);
    const pull = result.rows.find((r) => r.actorName === "Sylvaria")!;
    expect(pull.potions).toEqual(["Haste Potion"]);
  });

  it("records what a hunter puts on their pet, and only their own pet", () => {
    expect(off("Sylvaria")!.petConsumables).toEqual(["Kibler's Bits", "Scroll of Agility V"]);
    // Kazrak's scroll went to a pet he owns, so it's his — and his alone.
    expect(off("Kazrak")!.petConsumables).toEqual(["Scroll of Strength V"]);
  });

  it("never counts a self-cast scroll — the pull aura already has it", () => {
    // Sylvaria read two Agility scrolls: one on the pet, one on herself.
    expect(off("Sylvaria")!.petConsumables.filter((c) => c === "Scroll of Agility V")).toHaveLength(1);
  });

  it("keeps no record for a raider who used nothing off-pull", () => {
    const quiet = normalizeWclReport(offPullReport, {
      combatantInfo: [{ timestamp: 299_000, type: "combatantinfo", sourceID: 1, auras: [], gear: [] }],
      deaths: [],
      casts: [{ timestamp: 450_000, type: "cast", sourceID: 1, ability: { name: "Haste Potion", guid: 28507 } }],
      debuffs: [],
      buffs: [],
    });
    expect(quiet.offPull).toEqual([]);
  });
});

describe("named foods", () => {
  it("counts a dish that names its own buff as food", () => {
    // Skullfish Soup applies "Enlightened", not "Well Fed". Filed as an
    // off-slot curiosity it left 84 pulls on this guild's data reading as
    // unfed, three raiders' preparation among them.
    expect(classifyAura("Enlightened")?.category).toBe("food");
    expect(isFoodLabel("Enlightened")).toBe(true);
  });

  it("still recognises the generic buff, however it is spelled", () => {
    expect(isFoodLabel("Well Fed")).toBe(true);
    expect(isFoodLabel("well fed (30)")).toBe(true);
  });

  it("says no to everything else in the off-slot bucket", () => {
    expect(isFoodLabel("Flame Cap")).toBe(false);
    expect(isFoodLabel("Bogling Root")).toBe(false);
    expect(isFoodLabel("Elixir of Major Agility")).toBe(false);
  });
});

describe("elixirCategoryOf", () => {
  // Ingest stores the canonical label and throws the category away, so the
  // preparation grade reads the slot back out of this map. If the two ever
  // disagree, a raider who brought a full set reads as half a one.
  it("agrees with classifyAura on every curated elixir", () => {
    for (const label of CURATED_ELIXIR_LABELS) {
      expect(elixirCategoryOf(label), label).toBe(classifyAura(label)?.category);
    }
  });

  it("places both slots from the label ingest stores", () => {
    expect(elixirCategoryOf("Elixir of Major Agility")).toBe("battleElixir");
    expect(elixirCategoryOf("Elixir of Draenic Wisdom")).toBe("guardianElixir");
  });

  it("returns undefined for anything that isn't a curated elixir", () => {
    // classifyAura's fallback calls an unknown "elixir of ..." a battle elixir
    // so it still counts as coverage. That guess is fine for a percentage and
    // wrong for a slot, so the slot lookup declines to make it.
    expect(elixirCategoryOf("Elixir of the Uncurated")).toBeUndefined();
    expect(elixirCategoryOf("Flask of Relentless Assault")).toBeUndefined();
    expect(elixirCategoryOf("Well Fed")).toBeUndefined();
  });

  it("places the two elixirs the guild's own logs identified", () => {
    // Neither was curated; both reached storage through the name-pattern
    // fallback. The slot came from what they were logged BESIDE — a raider
    // holds one battle and one guardian at a time — not from memory.
    expect(elixirCategoryOf("Spellpower Elixir")).toBe("battleElixir");
    expect(elixirCategoryOf("Mageblood Elixir")).toBe("guardianElixir");
  });
});

describe("consumable classification", () => {
  it("classifies auras by name", () => {
    expect(classifyAura("Flask of Supreme Power")?.category).toBe("flask");
    expect(classifyAura("Shattrath Flask of Pure Death")?.category).toBe("flask");
    expect(classifyAura("Adept's Elixir")?.category).toBe("battleElixir");
    expect(classifyAura("Elixir of Major Mageblood")?.category).toBe("guardianElixir");
    expect(classifyAura("Well Fed")?.category).toBe("food");
    expect(classifyAura("Destruction Potion")?.category).toBe("potion");
    expect(classifyAura("Arcane Intellect")).toBeUndefined();
    expect(classifyAura("Power Word: Fortitude")).toBeUndefined();
  });

  it("recognizes the vanilla flasks by the bare buff name the log sends", () => {
    // From this guild's own import dump: `17628 Supreme Power ×11` and
    // `17629 Chromatic Resistance ×1`, both unrecognized. The generic
    // "…flask of…" pattern never fired because the log doesn't say "flask".
    expect(classifyAura("Supreme Power", 17628)).toEqual({
      category: "flask",
      label: "Flask of Supreme Power",
    });
    expect(classifyAura("Chromatic Resistance", 17629)).toEqual({
      category: "flask",
      label: "Flask of Chromatic Resistance",
    });
    // By name alone too, since an id can be missing or aliased.
    expect(classifyAura("Supreme Power")?.label).toBe("Flask of Supreme Power");
  });

  it("prices those flasks as flasks rather than as free", () => {
    // The label has to contain "flask": defaultPriceFor gives anything it can't
    // place a gold value of 0, so the bare buff name would have been free.
    expect(defaultPriceFor(classifyAura("Supreme Power", 17628)!.label).gold).toBeGreaterThan(0);
  });

  it("recognizes buff-style elixir names and normalizes them to item names", () => {
    // The Elixir of Major Agility buff is literally named "Major Agility".
    expect(classifyAura("Major Agility")).toEqual({
      category: "battleElixir",
      label: "Elixir of Major Agility",
    });
    expect(classifyAura("anything", 28497)?.label).toBe("Elixir of Major Agility");
    expect(classifyAura("Major Fortitude")?.category).toBe("guardianElixir");
    expect(classifyAura("Draenic Wisdom")?.label).toBe("Elixir of Draenic Wisdom");
    expect(classifyAura("Fel Strength")?.category).toBe("battleElixir");
    // Lesser caster elixirs report a bare buff name with no "elixir" in it
    // (Elixir of Shadow Power → "Shadow Power", spell 11474) — curated by id+name.
    expect(classifyAura("Shadow Power", 11474)).toEqual({
      category: "battleElixir",
      label: "Elixir of Shadow Power",
    });
    expect(classifyAura("Fire Power")?.label).toBe("Elixir of Firepower");
    expect(classifyAura("Frost Power")?.category).toBe("battleElixir");
    // Unknown elixir-looking buffs still count as elixirs.
    expect(classifyAura("Elixir of Future Patch")?.category).toBe("battleElixir");
  });

  it("classifies scrolls from bare-stat buff names and rank-V ids", () => {
    // Logs name scroll buffs after the bare stat.
    expect(classifyAura("Agility", 33077)).toEqual({ category: "scroll", label: "Scroll of Agility V" });
    expect(classifyAura("Strength")).toEqual({ category: "scroll", label: "Scroll of Strength" });
    expect(classifyAura("Armor")?.label).toBe("Scroll of Protection");
    expect(classifyAura("Spirit")?.category).toBe("scroll");
    // Scroll-style names still work, rank preserved.
    expect(classifyAura("Scroll of Agility V")?.label).toBe("Scroll of Agility V");
    expect(classifyAura("Scroll of Strength IV")?.category).toBe("scroll");
    expect(classifyAura("Scroll of Recall")).toBeUndefined();
  });

  it("labels mana gems and seeds from cast ids", () => {
    expect(classifyCast(27103, "Replenish Mana")?.name).toBe("Mana Emerald");
    expect(classifyCast(10058, "Replenish Mana")?.name).toBe("Mana Ruby");
    expect(classifyCast(28726)?.category).toBe("other");
  });

  it("detects pre-pots by buff spell id even under buff-style names", () => {
    expect(classifyAura("Haste", 28507)?.category).toBe("potion");
    expect(classifyAura("Destruction", 28508)?.category).toBe("potion");
    // The bare word without a known id is NOT assumed to be a potion.
    expect(classifyAura("Haste")).toBeUndefined();
  });

  it("classifies off-slot consumables as misc", () => {
    // The Bogling Root buff is named after the effect, not the item.
    expect(classifyAura("Fury of the Bogling", 5665)).toEqual({ category: "misc", label: "Bogling Root" });
    expect(classifyAura("Kreeg's Stout Beatdown")?.category).toBe("misc");
    // Off-slot DPS consumables — recognized by name or id so they leave the dump.
    expect(classifyAura("Flame Cap")?.category).toBe("misc");
    expect(classifyAura("anything", 28714)?.label).toBe("Flame Cap");
    expect(classifyAura("Eye of the Night")?.category).toBe("misc");
    // Enlightened moved to food — Skullfish Soup names its own buff.
    expect(classifyAura("anything", 43722)?.label).toBe("Enlightened");
  });

  it("classifies the Major Defense elixir by its real buff name 'Major Armor'", () => {
    // Elixir of Major Defense applies the buff "Major Armor" (spell 28502).
    expect(classifyAura("Major Armor", 28502)).toEqual({
      category: "guardianElixir",
      label: "Elixir of Major Defense",
    });
    expect(classifyAura("Major Armor")?.label).toBe("Elixir of Major Defense");
  });

  it("classifies Zanza buffs as guardian elixirs", () => {
    expect(classifyAura("Swiftness of Zanza", 24383)?.category).toBe("guardianElixir");
    expect(classifyAura("Spirit of Zanza")?.category).toBe("guardianElixir");
    expect(classifyAura("Sheen of Zanza")?.category).toBe("guardianElixir");
  });

  it("recognizes known non-consumable auras for dump filtering", () => {
    expect(isNonConsumableAura("Greater Blessing of Kings", 25898)).toBe(true);
    expect(isNonConsumableAura("Sanctity Aura")).toBe(true);
    expect(isNonConsumableAura("Dire Bear Form")).toBe(true);
    expect(isNonConsumableAura("Berserker Stance")).toBe(true);
    expect(isNonConsumableAura("Vanguard", 71)).toBe(true);
    // The mage self-buff the import's own auto-filer caught, once its pull
    // snapshot showed a Mage applying it to themself 14 times.
    expect(isNonConsumableAura("Greater Intellect", 11396)).toBe(true);
    // Paladin Hand of Salvation (and the Hand-of family) are class buffs.
    expect(isNonConsumableAura("Hand of Salvation", 1038)).toBe(true);
    expect(isNonConsumableAura("Hand of Protection")).toBe(true);
    // Unknowns stay dumpable — the list must never eat a real consumable.
    expect(isNonConsumableAura("Mystery Brew")).toBe(false);
    expect(isNonConsumableAura("Kreeg's Stout Beatdown")).toBe(false);
    // Confirmed consumables must never be filtered out of tracking.
    expect(isNonConsumableAura("Major Armor", 28502)).toBe(false);
    expect(isNonConsumableAura("Swiftness of Zanza", 24383)).toBe(false);
  });

  it("classifies casts by id with name fallback", () => {
    expect(classifyCast(28508)?.name).toBe("Destruction Potion");
    expect(classifyCast(28508)?.category).toBe("potion");
    // Unknown id but a potion-looking name still counts.
    expect(classifyCast(99999, "Fel Mana Potion")?.category).toBe("potion");
    expect(classifyCast(99999, "Drums of Speed")?.category).toBe("drums");
    expect(classifyCast(99999, "Shadow Bolt")).toBeUndefined();
    expect(classifyCast(undefined, undefined)).toBeUndefined();
  });

  it("labels Thistle Tea from its id, which the log calls 'Restore Energy'", () => {
    // The item name never appears in the log — only the id can catch this.
    expect(classifyCast(9512, "Restore Energy")).toMatchObject({
      name: "Thistle Tea",
      // Deliberately not "potion": tea doesn't share the potion cooldown, and
      // potions are audited as a rate against it.
      category: "other",
    });
    expect(classifyCast(undefined, "Restore Energy")).toBeUndefined();
    // It must be in the fetch filter, or the event never leaves Warcraft Logs.
    expect(TRACKED_CAST_IDS).toContain(9512);
  });

  it("counts sapper charges by their on-use spell ids and by name", () => {
    // Verified item on-use spell ids (Super 30486, Goblin 12760/13241).
    expect(classifyCast(30486)).toMatchObject({ name: "Super Sapper Charge", category: "sapper" });
    expect(classifyCast(12760)?.name).toBe("Goblin Sapper Charge");
    expect(classifyCast(13241)?.category).toBe("sapper");
    // Any other rank still counts via the name fallback.
    expect(classifyCast(99999, "Super Sapper Charge")?.category).toBe("sapper");
    expect(SAPPER_CAST_NAMES).toEqual(["Super Sapper Charge", "Goblin Sapper Charge"]);
  });
});

describe("flasks the pull snapshot cannot see", () => {
  /*
   * Warcraft Logs leaves the Unstable Flasks out of `combatantinfo`, so a
   * raider who drank one graded as unflasked on the column that feeds the loot
   * score. Shapes and timings here are taken from a real report
   * (8Y9ZFmK2jfBdHzgJ): the flask lands at 15m and Maulgar pulls at 20m, and
   * the raider's snapshot at that pull lists eight auras with no flask in it.
   */
  const MIN = 60_000;
  const base = {
    code: "RPT1",
    title: "Gruul",
    startTime: 0,
    endTime: 120 * MIN,
    fights: [
      { id: 7, name: "High King Maulgar", startTime: 20 * MIN, endTime: 21 * MIN, kill: true, encounterID: 649, difficulty: 3 },
      { id: 12, name: "Gruul the Dragonkiller", startTime: 29 * MIN, endTime: 32 * MIN, kill: true, encounterID: 650, difficulty: 3 },
    ],
    masterData: { actors: [{ id: 1, name: "Katzewarr", type: "Player", subType: "Warrior" }] },
  };
  // The snapshot, exactly as the real one arrives: no flask among the auras.
  const combatantInfo = [7, 12].map((fight) => ({
    timestamp: fight * MIN, type: "combatantinfo", fight, sourceID: 1,
    auras: [{ ability: 2458, name: "Berserker Stance" }, { ability: 33256, name: "Well Fed" }],
  }));

  const run = (buffs: unknown[]) =>
    normalizeWclReport(base, { combatantInfo, deaths: [], casts: [], debuffs: [], buffs });

  it("credits a pull that started while the flask was up", () => {
    const report = run([
      { timestamp: 15 * MIN, type: "applybuff", sourceID: 1, targetID: 1, abilityGameID: 40575 },
    ]);
    const flasks = report.rows.map((r) => r.flask);
    expect(flasks).toEqual(["Unstable Flask of the Soldier", "Unstable Flask of the Soldier"]);
  });

  it("does not credit a pull that ended before the flask was drunk", () => {
    // Most of this guild's Unstable Flasks are drunk *after* the Gruul kill,
    // duelling outside — those must not back-date onto the boss.
    const report = run([
      { timestamp: 33 * MIN, type: "applybuff", sourceID: 1, targetID: 1, abilityGameID: 40575 },
    ]);
    expect(report.rows.map((r) => r.flask)).toEqual([undefined, undefined]);
  });

  it("stops crediting once the log says the aura ended", () => {
    // The end comes from the log, never from an assumed two-hour duration.
    const report = run([
      { timestamp: 15 * MIN, type: "applybuff", sourceID: 1, targetID: 1, abilityGameID: 40575 },
      { timestamp: 25 * MIN, type: "removebuff", sourceID: 1, targetID: 1, abilityGameID: 40575 },
    ]);
    expect(report.rows.map((r) => r.flask)).toEqual([
      "Unstable Flask of the Soldier",
      undefined,
    ]);
  });

  it("never overwrites a flask the snapshot itself observed", () => {
    const withRealFlask = combatantInfo.map((e) => ({
      ...e,
      auras: [...e.auras, { ability: 28520, name: "Flask of Relentless Assault" }],
    }));
    const report = normalizeWclReport(base, {
      combatantInfo: withRealFlask, deaths: [], casts: [], debuffs: [],
      buffs: [{ timestamp: 15 * MIN, type: "applybuff", sourceID: 1, targetID: 1, abilityGameID: 40575 }],
    });
    // A direct observation at the pull beats an inference between two events.
    expect(report.rows.map((r) => r.flask)).toEqual([
      "Flask of Relentless Assault",
      "Flask of Relentless Assault",
    ]);
  });
});

/**
 * One mob, two actor ids: Warcraft Logs puts a different `targetID` on a
 * debuff's `applydebuff` than on its stacks and its removal.
 *
 * Probed on a real Lady Vashj pull — Sunder Armor on Enchanted Elemental
 * instance 24 applied against id 161, then stacked, refreshed and removed
 * against 163. Keying accumulators on the raw id split the debuff in two and
 * left the half holding the apply with no removal to close it, so it ran to the
 * end of the fight: a 71% Sunder Armor headline off ONE application on an add
 * that lived twelve seconds, because the headline is the best single target.
 */
describe("a debuff whose apply and removal name different ids for the same mob", () => {
  const report = {
    title: "Split ids",
    startTime: REPORT_START,
    endTime: REPORT_START + 500_000,
    masterData: {
      actors: [
        { id: 1, name: "Byrd", type: "Player", subType: "Warrior" },
        { id: 50, name: "Lady Vashj", type: "NPC", subType: "Boss" },
        // The same add under two ids, exactly as the report serves it.
        { id: 161, name: "Enchanted Elemental", type: "NPC", subType: "NPC" },
        { id: 163, name: "Enchanted Elemental", type: "NPC", subType: "NPC" },
      ],
    },
    fights: [
      { id: 1, encounterID: 623, name: "Lady Vashj", kill: true, startTime: 0, endTime: 400_000 },
    ],
    dps: {
      data: [
        {
          fightID: 1,
          roles: { dps: { characters: [{ name: "Byrd", class: "Warrior", spec: "Arms" }] } },
        },
      ],
    },
  };

  const result = normalizeWclReport(report, {
    combatantInfo: [{ timestamp: 10, type: "combatantinfo", sourceID: 1, auras: [], gear: [] }],
    deaths: [],
    casts: [],
    debuffs: [
      // The apply lands on 161…
      { timestamp: 124_000, type: "applydebuff", sourceID: 1, targetID: 161, targetInstance: 24, ability: { name: "Sunder Armor", guid: 25225 } },
      // …and everything after it on 163. Same mob, same instance.
      { timestamp: 125_600, type: "applydebuffstack", sourceID: 1, targetID: 163, targetInstance: 24, stack: 2, ability: { name: "Sunder Armor", guid: 25225 } },
      { timestamp: 130_200, type: "applydebuffstack", sourceID: 1, targetID: 163, targetInstance: 24, stack: 5, ability: { name: "Sunder Armor", guid: 25225 } },
      { timestamp: 134_800, type: "removedebuff", sourceID: 1, targetID: 163, targetInstance: 24, ability: { name: "Sunder Armor", guid: 25225 } },
    ],
    buffs: [],
  });

  const sunder = result.rows[0].upkeep.find((u) => u.name === "Sunder Armor");

  it("joins the halves into one window instead of one that never closes", () => {
    // 124.0s → 134.8s is 10.8s of a 400s pull: 3%. The phantom read 69%.
    expect(sunder?.targets).toHaveLength(1);
    expect(sunder?.targets?.[0]).toMatchObject({ target: "Enchanted Elemental", instance: 24 });
    expect(sunder?.targets?.[0].segments).toEqual([[124_000, 134_800]]);
    expect(sunder?.pct).toBe(3);
  });

  it("counts each landed cast once, however many events it emitted", () => {
    expect(sunder?.targets?.[0].applications).toBe(3);
  });
});

/**
 * Who actually sundered.
 *
 * Warcraft Logs credits every event of a shared debuff to the player holding
 * the window, not to the one whose cast caused it. Probed on the 09 Aug Hydross
 * kill: Byrd cast Devastate 78 times, Turdlord cast Sunder Armor twice, and all
 * 80 aura events came back under Turdlord — reading straight, a fury warrior
 * with 98% Sunder uptime and a protection warrior who never sundered. The cast
 * stream is the repair.
 */
describe("a shared debuff is credited to the caster, not the window's owner", () => {
  const report = {
    title: "Attribution",
    startTime: REPORT_START,
    endTime: REPORT_START + 500_000,
    masterData: {
      actors: [
        { id: 1, name: "Turdlord", type: "Player", subType: "Warrior" },
        { id: 2, name: "Byrd", type: "Player", subType: "Warrior" },
        { id: 50, name: "Gruul the Dragonkiller", type: "NPC", subType: "Boss" },
      ],
    },
    fights: [
      { id: 1, encounterID: 650, name: "Gruul the Dragonkiller", kill: true, startTime: 0, endTime: 100_000 },
    ],
    dps: {
      data: [
        {
          fightID: 1,
          roles: {
            dps: {
              characters: [
                { name: "Turdlord", class: "Warrior", spec: "Fury" },
                { name: "Byrd", class: "Warrior", spec: "Protection" },
              ],
            },
          },
        },
      ],
    },
  };

  /** Every aura event carries Turdlord — that is the misattribution itself. */
  const aura = (type: string, at: number, stack?: number) => ({
    timestamp: at,
    type,
    sourceID: 1,
    targetID: 50,
    ...(stack === undefined ? {} : { stack }),
    ability: { name: "Sunder Armor", guid: 25225 },
  });
  const cast = (sourceID: number, name: string, at: number) => ({
    timestamp: at,
    type: "cast",
    sourceID,
    targetID: 50,
    ability: { name, guid: name === "Devastate" ? 30022 : 25225 },
  });

  const result = normalizeWclReport(report, {
    combatantInfo: [
      { timestamp: 10, type: "combatantinfo", sourceID: 1, auras: [], gear: [] },
      { timestamp: 10, type: "combatantinfo", sourceID: 2, auras: [], gear: [] },
    ],
    deaths: [],
    casts: [
      // Turdlord opens it, then Byrd's Devastates carry the rest of the pull.
      cast(1, "Sunder Armor", 1_000),
      cast(2, "Devastate", 10_000),
      cast(2, "Devastate", 20_000),
      cast(2, "Devastate", 30_000),
    ],
    debuffs: [
      aura("applydebuff", 1_000),
      aura("applydebuffstack", 10_000, 2),
      aura("refreshdebuff", 10_000),
      aura("applydebuffstack", 20_000, 3),
      aura("refreshdebuff", 20_000),
      aura("refreshdebuff", 30_000),
      aura("removedebuff", 60_000),
    ],
    buffs: [],
  });

  const targetFor = (who: string) =>
    result.rows
      .find((r) => r.actorName === who)
      ?.upkeep.find((u) => u.name === "Sunder Armor")?.targets?.[0];

  it("hands the window to whoever cast, at the moment they cast", () => {
    // Turdlord opened it and held it until Byrd's first Devastate; Byrd held it
    // from there to the removal. Never both at once.
    expect(targetFor("Turdlord")?.segments).toEqual([[1_000, 10_000]]);
    expect(targetFor("Byrd")?.segments).toEqual([[10_000, 60_000]]);
  });

  it("counts each player's own landed casts", () => {
    expect(targetFor("Turdlord")?.applications).toBe(1);
    expect(targetFor("Byrd")?.applications).toBe(3);
  });

  it("splits stack-ups from refreshes per player", () => {
    // Byrd walked it to 3 with two casts and renewed it with the third;
    // Turdlord's single cast opened the debuff and raised no stack.
    expect(targetFor("Byrd")?.stackUps).toBe(2);
    expect(targetFor("Byrd")?.refreshes).toBe(1);
    expect(targetFor("Turdlord")?.stackUps).toBe(0);
    expect(targetFor("Turdlord")?.refreshes).toBe(1);
  });

  it("keeps the raid-level uptime the log reported", () => {
    // Re-attribution moves the credit, never the debuff: one window, 1s to 60s.
    const covered = ["Turdlord", "Byrd"]
      .flatMap((who) => targetFor(who)?.segments ?? [])
      .reduce((sum, [from, to]) => sum + (to - from), 0);
    expect(covered).toBe(59_000);
  });

  it("falls back to the log when no cast explains the aura", () => {
    // A report fetched before Devastate was asked for has no casts to match, so
    // the log's own attribution is all there is — today's answer, not none.
    const noCasts = normalizeWclReport(report, {
      combatantInfo: [{ timestamp: 10, type: "combatantinfo", sourceID: 1, auras: [], gear: [] }],
      deaths: [],
      casts: [],
      debuffs: [aura("applydebuff", 1_000), aura("refreshdebuff", 30_000), aura("removedebuff", 60_000)],
      buffs: [],
    });
    const turd = noCasts.rows
      .find((r) => r.actorName === "Turdlord")
      ?.upkeep.find((u) => u.name === "Sunder Armor")?.targets?.[0];
    expect(turd?.segments).toEqual([[1_000, 60_000]]);
    expect(noCasts.rows.find((r) => r.actorName === "Byrd")?.upkeep).toEqual([]);
  });
});

/**
 * A stacking debuff's two halves: the casts that built it and the casts that
 * held it. Probed — only `applydebuffstack` carries a stack number, and one
 * landed Sunder emits both a stack event and a refresh at the same millisecond.
 */
describe("stacking debuffs record how the stack moved", () => {
  const report = {
    title: "Stacks",
    startTime: REPORT_START,
    endTime: REPORT_START + 500_000,
    masterData: {
      actors: [
        { id: 1, name: "Byrd", type: "Player", subType: "Warrior" },
        { id: 50, name: "Gruul the Dragonkiller", type: "NPC", subType: "Boss" },
      ],
    },
    fights: [
      { id: 1, encounterID: 650, name: "Gruul the Dragonkiller", kill: true, startTime: 0, endTime: 100_000 },
    ],
    dps: {
      data: [{ fightID: 1, roles: { dps: { characters: [{ name: "Byrd", class: "Warrior", spec: "Arms" }] } } }],
    },
  };

  const sunder = (type: string, at: number, stack?: number) => ({
    timestamp: at,
    type,
    sourceID: 1,
    targetID: 50,
    ...(stack === undefined ? {} : { stack }),
    ability: { name: "Sunder Armor", guid: 25225 },
  });

  const result = normalizeWclReport(report, {
    combatantInfo: [{ timestamp: 10, type: "combatantinfo", sourceID: 1, auras: [], gear: [] }],
    deaths: [],
    casts: [],
    debuffs: [
      sunder("applydebuff", 1_000),
      // Four stack-ups to 5, each emitting a refresh at the same ms.
      sunder("applydebuffstack", 2_000, 2),
      sunder("refreshdebuff", 2_000),
      sunder("applydebuffstack", 3_000, 3),
      sunder("refreshdebuff", 3_000),
      sunder("applydebuffstack", 4_000, 4),
      sunder("refreshdebuff", 4_000),
      sunder("applydebuffstack", 5_000, 5),
      sunder("refreshdebuff", 5_000),
      // Then two casts that only renewed it.
      sunder("refreshdebuff", 20_000),
      sunder("refreshdebuff", 40_000),
    ],
    buffs: [],
  });

  const target = result.rows[0].upkeep.find((u) => u.name === "Sunder Armor")?.targets?.[0];

  it("splits landed casts into stack-ups and refreshes", () => {
    // 7 landed casts at distinct timestamps: the apply, 4 stack-ups, 2 renewals.
    expect(target?.applications).toBe(7);
    expect(target?.stackUps).toBe(4);
    expect(target?.refreshes).toBe(3);
    // The two halves always account for exactly the landed casts.
    expect((target?.stackUps ?? 0) + (target?.refreshes ?? 0)).toBe(target?.applications);
  });

  it("keeps the stack the log reported, not a count of its own", () => {
    expect(target?.stackPoints).toEqual([
      [2_000, 2],
      [3_000, 3],
      [4_000, 4],
      [5_000, 5],
    ]);
  });

  /*
   * Probed on a real Karathress pull: Byrd pushed Fathom-Guard Tidalvess to 2
   * and to 3 at the same 4628ms. Deduping on the timestamp alone read that as
   * one cast, reporting three stack-ups on a debuff the log walked to five —
   * and losing the 3 from the stack timeline with it.
   */
  it("counts two casts that landed in the same millisecond", () => {
    const same = normalizeWclReport(report, {
      combatantInfo: [{ timestamp: 10, type: "combatantinfo", sourceID: 1, auras: [], gear: [] }],
      deaths: [],
      casts: [],
      debuffs: [
        sunder("applydebuff", 1_000),
        sunder("applydebuffstack", 2_000, 2),
        sunder("refreshdebuff", 2_000),
        sunder("applydebuffstack", 2_000, 3),
        sunder("refreshdebuff", 2_000),
      ],
      buffs: [],
    });
    const stacked = same.rows[0].upkeep.find((u) => u.name === "Sunder Armor")?.targets?.[0];
    expect(stacked?.stackUps).toBe(2);
    expect(stacked?.stackPoints).toEqual([
      [2_000, 2],
      [2_000, 3],
    ]);
    // Three landed casts: the apply and the two stack-ups. The halves still
    // account for exactly the casts.
    expect(stacked?.applications).toBe(3);
    expect((stacked?.stackUps ?? 0) + (stacked?.refreshes ?? 0)).toBe(stacked?.applications);
  });
});

/**
 * D4: the run-up to a death. The killing blow alone says "Melee", which for a
 * raider already at 3% health is the least interesting fact about it.
 */
describe("death recaps", () => {
  const report = {
    title: "Recaps",
    startTime: REPORT_START,
    endTime: REPORT_START + 500_000,
    masterData: {
      actors: [
        { id: 1, name: "Byrd", type: "Player", subType: "Warrior" },
        { id: 2, name: "Elshyn", type: "Player", subType: "Priest" },
        { id: 50, name: "Lady Vashj", type: "NPC", subType: "Boss" },
      ],
    },
    fights: [{ id: 1, encounterID: 623, name: "Lady Vashj", kill: false, startTime: 0, endTime: 100_000 }],
    dps: {
      data: [
        {
          fightID: 1,
          roles: {
            dps: { characters: [{ name: "Byrd", class: "Warrior", spec: "Arms" }] },
            healers: { characters: [{ name: "Elshyn", class: "Priest", spec: "Holy" }] },
          },
        },
      ],
    },
  };

  const hit = (at: number, targetID: number, name: string | undefined, amount: number, extra = {}) => ({
    timestamp: at,
    type: "damage",
    sourceID: 50,
    targetID,
    amount,
    ...(name === undefined ? {} : { ability: { name, guid: 38280 } }),
    ...extra,
  });

  const result = normalizeWclReport(report, {
    combatantInfo: [
      { timestamp: 10, type: "combatantinfo", sourceID: 1, auras: [], gear: [] },
      { timestamp: 20, type: "combatantinfo", sourceID: 2, auras: [], gear: [] },
    ],
    deaths: [{ timestamp: 40_000, type: "death", targetID: 1, killerID: 50, killingAbility: { name: "Melee" } }],
    casts: [],
    debuffs: [],
    buffs: [],
    damageTaken: [
      // Well before the window — must not appear.
      hit(10_000, 1, "Static Charge", 1_400),
      // Inside the last 10s.
      hit(32_000, 1, "Static Charge", 1_500),
      hit(36_000, 1, "Shock Blast", 8_200, { absorbed: 300 }),
      hit(39_500, 1, "Melee", 2_100),
      // Somebody else's damage in the same window — not this death's recap.
      hit(38_000, 2, "Static Charge", 1_600),
      // No named ability: a recap padded with "Unknown" is worse than a short one.
      hit(39_800, 1, undefined, 500),
    ],
  });

  const death = result.rows.find((r) => r.actorName === "Byrd")!.deathTimes[0];

  it("keeps only the hits on that player in the seconds before", () => {
    expect(death.recap?.map((h) => [h.atMs, h.ability, h.amount])).toEqual([
      // Newest first: the last thing to land reads first.
      [39_500, "Melee", 2_100],
      [36_000, "Shock Blast", 8_200],
      [32_000, "Static Charge", 1_500],
    ]);
  });

  it("carries the absorb and the source when the log gave them", () => {
    const shock = death.recap?.find((h) => h.ability === "Shock Blast");
    expect(shock).toMatchObject({ absorbed: 300, source: "Lady Vashj" });
  });

  it("still records the killing blow itself", () => {
    expect(death).toMatchObject({ atMs: 40_000, killer: "Lady Vashj", ability: "Melee" });
  });

  it("says nothing when the fetch brought no damage", () => {
    const without = normalizeWclReport(report, {
      combatantInfo: [{ timestamp: 10, type: "combatantinfo", sourceID: 1, auras: [], gear: [] }],
      deaths: [{ timestamp: 40_000, type: "death", targetID: 1 }],
      casts: [],
      debuffs: [],
      buffs: [],
    });
    expect(without.rows.find((r) => r.actorName === "Byrd")!.deathTimes[0].recap).toBeUndefined();
  });
});
