import { describe, expect, it } from "vitest";
import { normalizeWclReport } from "@/lib/wcl/normalize";
import { classifyAura, classifyCast } from "@/lib/wcl/consumables";

/**
 * Fixture shaped like the v2 API responses: report overview (with dps/hps
 * rankings JSON) + raw event arrays. Times inside the report are relative ms.
 */

const REPORT_START = 1765000000000;

function gear(overrides: Record<number, { permanentEnchant?: number | null; temporaryEnchant?: number | null; id?: number }> = {}) {
  return Array.from({ length: 17 }, (_, i) => ({
    id: 30000 + i,
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
      { id: 1, name: "Thrainn", subType: "Warrior" },
      { id: 2, name: "Pyrelia", subType: "Mage" },
      { id: 3, name: "Lunara", subType: "Druid" },
      { id: 9, name: "Wolfie", subType: "Pet" },
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
    gear: gear({ 15: { temporaryEnchant: 2713 } }),
  },
  {
    timestamp: 100060,
    type: "combatantinfo",
    sourceID: 2,
    auras: [
      { name: "Elixir of Major Firepower", ability: 28501 },
      { name: "Elixir of Draenic Wisdom", ability: 39627 },
      { name: "Well Fed", ability: 33263 },
      { name: "Haste Potion", ability: 28507 },
    ],
    gear: gear({ 4: { permanentEnchant: null } }),
  },
  {
    timestamp: 100070,
    type: "combatantinfo",
    sourceID: 3,
    auras: [{ name: "Flask of Mighty Restoration", ability: 28519 }],
    gear: gear({ 15: { temporaryEnchant: 2629 } }),
  },
  // During trash — boss fights only, must be ignored (with a warning).
  { timestamp: 460000, type: "combatantinfo", sourceID: 1, auras: [], gear: [] },
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
];

describe("normalizeWclReport", () => {
  const result = normalizeWclReport(rawReport, { combatantInfo, deaths, casts });
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
    expect(mage.elixirs).toEqual(["Elixir of Major Firepower", "Elixir of Draenic Wisdom"]);
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
    expect(row(7, "Thrainn").potions).toEqual(["Ironshield Potion"]);
    expect(row(9, "Lunara").potions).toEqual(["Super Mana Potion"]);
  });

  it("warns about combatant info outside boss pulls", () => {
    expect(result.warnings.some((w) => w.includes("combatant-info"))).toBe(true);
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

  it("classifies casts by id with name fallback", () => {
    expect(classifyCast(28508)?.name).toBe("Destruction Potion");
    expect(classifyCast(28508)?.category).toBe("potion");
    // Unknown id but a potion-looking name still counts.
    expect(classifyCast(99999, "Fel Mana Potion")?.category).toBe("potion");
    expect(classifyCast(99999, "Drums of Speed")?.category).toBe("drums");
    expect(classifyCast(99999, "Shadow Bolt")).toBeUndefined();
    expect(classifyCast(undefined, undefined)).toBeUndefined();
  });
});
