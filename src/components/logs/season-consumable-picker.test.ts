import { describe, expect, it } from "vitest";
import type { SeasonConsumableStat, SeasonConsumableUser } from "@/lib/types";
import {
  buildOptions,
  keyOf,
  matches,
  parseKey,
  usersOf,
} from "@/components/logs/season-consumable-picker";

function user(over: Partial<SeasonConsumableUser> & { name: string }): SeasonConsumableUser {
  return { slug: over.name.toLowerCase(), raids: 10, uses: 0, gold: 0, ...over };
}

const stats: SeasonConsumableStat[] = [
  {
    name: "Haste Potion",
    uses: 30,
    gold: 450,
    raids: 10,
    users: [
      user({ name: "Kaz", status: "main", raids: 10, uses: 20, gold: 300 }),
      user({ name: "Pug", status: "pug", raids: 2, uses: 10, gold: 150 }),
    ],
  },
  {
    name: "Super Mana Potion",
    uses: 12,
    gold: 24,
    raids: 8,
    users: [user({ name: "Kaz", status: "main", raids: 10, uses: 12, gold: 24 })],
  },
  {
    name: "Bottled Nethergon Energy",
    uses: 40,
    gold: 40,
    raids: 9,
    users: [user({ name: "Morg", status: "alt", raids: 5, uses: 40, gold: 40 })],
  },
  {
    name: "Flask of Relentless Assault",
    uses: 6,
    gold: 492,
    raids: 6,
    users: [user({ name: "Kaz", status: "main", raids: 10, uses: 6, gold: 492 })],
  },
];

describe("matches", () => {
  it("points at one consumable, a family, or everything", () => {
    expect(matches({ kind: "name", name: "Haste Potion" }, "Haste Potion")).toBe(true);
    expect(matches({ kind: "name", name: "Haste Potion" }, "Super Mana Potion")).toBe(false);
    expect(matches({ kind: "group", group: "potion" }, "Super Mana Potion")).toBe(true);
    expect(matches({ kind: "group", group: "potion" }, "Flask of Relentless Assault")).toBe(false);
    expect(matches({ kind: "all" }, "Anything At All")).toBe(true);
  });

  it("points at a potion sub-family and at the vendor restores across it", () => {
    const mana = { kind: "purpose", purpose: "mana" } as const;
    expect(matches(mana, "Super Mana Potion")).toBe(true);
    expect(matches(mana, "Bottled Nethergon Energy")).toBe(true);
    expect(matches(mana, "Haste Potion")).toBe(false);
    // Restricted cuts across mana and healing rather than sitting inside one.
    expect(matches({ kind: "restricted" }, "Bottled Nethergon Energy")).toBe(true);
    expect(matches({ kind: "restricted" }, "Super Mana Potion")).toBe(false);
  });

  it("round-trips through the key the picker stores", () => {
    const cases = [
      { kind: "all" },
      { kind: "group", group: "flask" },
      { kind: "purpose", purpose: "healing" },
      { kind: "restricted" },
      // A name with the separator in it — the parser must not split on it.
      { kind: "name", name: "Kreeg's Stout Beatdown: the II" },
    ] as const;
    for (const sel of cases) expect(parseKey(keyOf(sel))).toEqual(sel);
  });
});

describe("usersOf", () => {
  it("lists one consumable's users as they were recorded", () => {
    const rows = usersOf(stats, { kind: "name", name: "Haste Potion" }, false);
    expect(rows.map((r) => [r.name, r.uses, r.perRaid])).toEqual([
      ["Kaz", 20, 2],
      // Ten uses over the two raids he showed up for, not over all ten.
      ["Pug", 10, 5],
    ]);
  });

  it("merges a roll-up per player rather than once per consumable", () => {
    const rows = usersOf(stats, { kind: "group", group: "potion" }, false);
    const kaz = rows.find((r) => r.name === "Kaz")!;
    // 20 haste + 12 mana on one row, not two rows of one raider.
    expect(rows.filter((r) => r.name === "Kaz")).toHaveLength(1);
    expect(kaz.uses).toBe(32);
    expect(kaz.gold).toBe(324);
    expect(kaz.perRaid).toBe(3.2);
    expect(rows.map((r) => r.name).sort()).toEqual(["Kaz", "Morg", "Pug"]);
  });

  it("keeps the player's own raid count when merging", () => {
    // Every row of a player carries the same number; merging must not add them
    // up, or a raider who used four things would read as four seasons.
    const rows = usersOf(stats, { kind: "all" }, false);
    expect(rows.find((r) => r.name === "Kaz")!.raids).toBe(10);
    expect(rows.find((r) => r.name === "Morg")!.raids).toBe(5);
  });

  it("drops the visitors when asked for the guild only", () => {
    const rows = usersOf(stats, { kind: "group", group: "potion" }, true);
    expect(rows.map((r) => r.name).sort()).toEqual(["Kaz", "Morg"]);
    // And the totals go with them: the pug's ten haste potions leave too.
    expect(rows.reduce((s, r) => s + r.uses, 0)).toBe(72);
  });

  it("returns nobody rather than a zero row when nothing matches", () => {
    expect(usersOf(stats, { kind: "name", name: "Nothing Anyone Drank" }, false)).toEqual([]);
  });
});

describe("buildOptions", () => {
  const options = buildOptions(stats);
  const group = (label: string) => options.find((g) => g.label === label);
  const labels = (label: string) => group(label)?.items.map((i) => i.label) ?? [];

  it("offers everything, then a group per family that was used", () => {
    expect(options[0].items).toEqual([{ key: "all", label: "All consumables" }]);
    expect(options.map((g) => g.label)).toEqual(["Everything", "Flasks", "Potions"]);
    // Nobody drummed in these raids, so there is no Drums group to pick.
    expect(group("Drums")).toBeUndefined();
  });

  it("puts the family roll-up first and the sub-families before the items", () => {
    expect(labels("Potions")).toEqual([
      "All potions",
      "Damage potions",
      "Mana potions",
      "Vendor & rep restores",
      // Then each potion, most-used first.
      "Bottled Nethergon Energy",
      "Haste Potion",
      "Super Mana Potion",
    ]);
  });

  it("leaves out a sub-family nothing in these raids belongs to", () => {
    // No healing, protection or utility potion was used, so none is offered —
    // an empty pick reads as a broken filter.
    expect(labels("Potions")).not.toContain("Healing potions");
    expect(labels("Potions")).not.toContain("Protection potions");
  });

  it("gives a family with no sub-families just its roll-up and its items", () => {
    expect(labels("Flasks")).toEqual(["All flasks", "Flask of Relentless Assault"]);
  });
});
