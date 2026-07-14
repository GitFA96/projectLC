import { describe, expect, it } from "vitest";
import { normalizeWclReport } from "@/lib/wcl/normalize";
import { classifyAura, classifyCast, isNonConsumableAura, SAPPER_CAST_NAMES } from "@/lib/wcl/consumables";

/**
 * Fixture shaped like the v2 API responses: report overview (with dps/hps
 * rankings JSON) + raw event arrays. Times inside the report are relative ms.
 */

const REPORT_START = 1765000000000;

function gear(
  overrides: Record<
    number,
    { permanentEnchant?: number | null; temporaryEnchant?: number | null; id?: number; gems?: { id?: number }[] }
  > = {},
) {
  return Array.from({ length: 17 }, (_, i) => ({
    id: 30000 + i,
    itemLevel: 120 + i,
    permanentEnchant: 3001 as number | null,
    temporaryEnchant: null as number | null,
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
    gear: gear({ 15: { temporaryEnchant: 2713 }, 0: { gems: [{ id: 24027 }, {}] } }),
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
  { timestamp: 700000, type: "death", targetID: 2 },
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
    // Gem ids come through; gem entries without an id are dropped.
    expect(tank.gear.find((g) => g.slot === 0)!.gems).toEqual([24027]);
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

  it("credits a remove-without-apply from the pull start", () => {
    expect(row(9, "Thrainn").upkeep).toContainEqual({
      name: "Demoralizing Shout",
      pct: 36,
      targets: [{ target: "Moroes", boss: true, pct: 36, segments: [[0, 90000]], applications: 0 }],
    });
  });

  it("tracks shout upkeep from self-applications only", () => {
    expect(row(9, "Thrainn").upkeep).toContainEqual({
      name: "Battle Shout",
      pct: 80,
      targets: [{ target: "Thrainn", boss: false, pct: 80, segments: [[50000, 250000]], applications: 1 }],
    });
    // The shout landing on Lunara is not her upkeep…
    expect(row(9, "Lunara").upkeep.some((u) => u.name === "Battle Shout")).toBe(false);
    // …but the Earth Shield she SOURCED is, wherever it sits.
    expect(row(9, "Lunara").upkeep).toContainEqual({
      name: "Earth Shield",
      pct: 40,
      targets: [{ target: "Thrainn", boss: false, pct: 40, segments: [[20000, 120000]], applications: 1 }],
    });
  });

  it("opens self-buff upkeep at the pull when the aura is already up", () => {
    // Commanding Shout sat in Thrainn's pull auras with zero buff events in
    // the fight — that's 100% uptime, not 0%.
    expect(row(7, "Thrainn").upkeep).toContainEqual({
      name: "Commanding Shout",
      pct: 100,
      targets: [{ target: "Thrainn", boss: false, pct: 100, segments: [[0, 300000]], applications: 0 }],
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
    expect(classifyAura("Enlightened")?.category).toBe("misc");
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
