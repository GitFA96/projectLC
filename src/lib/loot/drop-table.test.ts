import { describe, expect, it } from "vitest";

import { mergeDropTable, resolveDropNames } from "@/lib/loot/drop-table";
import { bossKey } from "@/lib/constants/wow";
import type { BossDrop, GuildBossDrop } from "@/lib/types";

const NOW = "2026-08-20T00:00:00.000Z";

function base(itemKey: string, itemName: string, boss = "Supremus"): BossDrop {
  return {
    zone: "Black Temple",
    // Through the real function, never a copy of it: a fixture that
    // reimplements normalization is a fixture that can pass while the writer
    // and the reader disagree in production.
    bossKey: bossKey(boss),
    boss,
    itemKey,
    itemName,
    updatedAt: NOW,
  };
}

function overlay(
  itemKey: string,
  itemName: string,
  action: "add" | "hide",
  boss = "Supremus",
): GuildBossDrop {
  return { ...base(itemKey, itemName, boss), guildId: "g1", action };
}

describe("mergeDropTable", () => {
  it("passes the foundation through when a guild says nothing", () => {
    const merged = mergeDropTable([base("belt", "Belt"), base("boots", "Boots")], []);
    expect(merged.map((d) => d.itemName)).toEqual(["Belt", "Boots"]);
    expect(merged.every((d) => d.origin === "foundation")).toBe(true);
  });

  it("removes a drop the guild hides, without touching the foundation", () => {
    const foundation = [base("belt", "Belt"), base("boots", "Boots")];
    const merged = mergeDropTable(foundation, [overlay("belt", "Belt", "hide")]);
    expect(merged.map((d) => d.itemName)).toEqual(["Boots"]);
    // The input is the operator's data and is not ours to mutate.
    expect(foundation).toHaveLength(2);
  });

  it("appends a drop the guild adds, marked as theirs", () => {
    const merged = mergeDropTable([base("belt", "Belt")], [overlay("cape", "Cape", "add")]);
    expect(merged.map((d) => [d.itemName, d.origin])).toEqual([
      ["Belt", "foundation"],
      ["Cape", "guild"],
    ]);
  });

  it("does not duplicate a drop the foundation already lists", () => {
    const merged = mergeDropTable([base("belt", "Belt")], [overlay("belt", "Belt", "add")]);
    expect(merged).toHaveLength(1);
    expect(merged[0].origin).toBe("foundation");
  });

  it("moves a drop between bosses as a hide plus an add", () => {
    // There is no 'move' action — this is what one looks like, and it has to
    // resolve predictably because it is the common case for a guild correction.
    const merged = mergeDropTable(
      [base("belt", "Belt", "Supremus")],
      [overlay("belt", "Belt", "hide", "Supremus"), overlay("belt", "Belt", "add", "Illidan Stormrage")],
    );
    expect(merged.map((d) => [d.boss, d.origin])).toEqual([["Illidan Stormrage", "guild"]]);
  });

  it("keeps an item that two different bosses both drop", () => {
    const merged = mergeDropTable(
      [base("token", "Token", "Supremus"), base("token", "Token", "Mother Shahraz")],
      [overlay("token", "Token", "hide", "Supremus")],
    );
    // Hiding it under one boss must not hide it under the other: the key is the
    // pair, not the item.
    expect(merged.map((d) => d.boss)).toEqual(["Mother Shahraz"]);
  });

  it("matches a hide across a spelling of the boss", () => {
    // Both rows go through `bossKey` when written, so the article drops out and
    // the two spellings land on one key.
    const merged = mergeDropTable(
      [base("madness", "Madness of the Betrayer", "The Illidari Council")],
      [overlay("madness", "Madness of the Betrayer", "hide", "Illidari Council")],
    );
    expect(merged).toEqual([]);
  });
});

describe("resolveDropNames", () => {
  const names = new Map([[34009, "Hammer of Judgement"]]);
  const nameOf = (id: number) => {
    const name = names.get(id);
    return name === undefined ? undefined : { name, quality: "epic" as const, icon: "inv_mace_57" };
  };

  it("calls a drop what the item cache calls it", () => {
    // The guild's real row: the sheet wrote "Judgment", Wowhead says
    // "Judgement", and the drop table inherited the sheet's spelling.
    const [drop] = resolveDropNames(
      [{ ...base("hammerofjudgment", "Hammer of Judgment"), itemId: 34009, origin: "foundation" }],
      nameOf,
    );
    expect(drop.itemName).toBe("Hammer of Judgement");
    // What was typed is kept, because that is how somebody finds the row again
    // and how the operator page can show them what to fix.
    expect(drop.writtenName).toBe("Hammer of Judgment");
  });

  it("leaves an unresolved drop exactly as written", () => {
    // With no id, the typed name is the only handle anybody has on it.
    const [drop] = resolveDropNames(
      [{ ...base("newthing", "New Thing"), origin: "foundation" }],
      nameOf,
    );
    expect(drop.itemName).toBe("New Thing");
    expect(drop.writtenName).toBeUndefined();
  });

  it("says nothing when the two already agree", () => {
    const [drop] = resolveDropNames(
      [{ ...base("hammerofjudgement", "Hammer of Judgement"), itemId: 34009, origin: "foundation" }],
      nameOf,
    );
    expect(drop.writtenName).toBeUndefined();
  });

  it("corrects a guild's own addition too", () => {
    // Typed by an officer mid-raid — the likeliest of all to be misspelled.
    const [drop] = resolveDropNames(
      [{ ...base("hammerofjudgment", "Hammer of Judgment"), itemId: 34009, origin: "guild" }],
      nameOf,
    );
    expect(drop.itemName).toBe("Hammer of Judgement");
    expect(drop.origin).toBe("guild");
  });
});

describe("resolveDropNames — two drops that really share a name", () => {
  it("keeps the council's annotation rather than making twins identical", () => {
    // Both Warglaives are called "Warglaive of Azzinoth". The sheet's
    // "(Main Hand)" is the council's annotation and the only thing separating
    // the two rows under Illidan.
    const names = new Map([
      [32837, "Warglaive of Azzinoth"],
      [32838, "Warglaive of Azzinoth"],
    ]);
    const factsOf = (id: number) => {
      const name = names.get(id);
      return name === undefined ? undefined : { name };
    };
    const drops = resolveDropNames(
      [
        {
          ...base("warglaiveofazzinothmainhand", "Warglaive of Azzinoth (Main Hand)", "Illidan Stormrage"),
          itemId: 32837,
          origin: "foundation" as const,
        },
        {
          ...base("warglaiveofazzinothoffhand", "Warglaive of Azzinoth (Off Hand)", "Illidan Stormrage"),
          itemId: 32838,
          origin: "foundation" as const,
        },
      ],
      factsOf,
    );
    expect(drops.map((d) => d.itemName)).toEqual([
      "Warglaive of Azzinoth (Main Hand)",
      "Warglaive of Azzinoth (Off Hand)",
    ]);
    // Still traceable to the real item, just not renamed to it.
    expect(drops[0].resolvedName).toBe("Warglaive of Azzinoth");
  });

  it("still corrects a name that has no twin under that boss", () => {
    const names = new Map([
      [1, "Warglaive of Azzinoth"],
      [2, "Something Else"],
    ]);
    const factsOf = (id: number) => {
      const name = names.get(id);
      return name === undefined ? undefined : { name };
    };
    const drops = resolveDropNames(
      [
        { ...base("warglaive", "Warglave of Azzinoth", "Illidan Stormrage"), itemId: 1, origin: "foundation" as const },
        { ...base("other", "Something Else", "Illidan Stormrage"), itemId: 2, origin: "foundation" as const },
      ],
      factsOf,
    );
    expect(drops[0].itemName).toBe("Warglaive of Azzinoth");
  });
});

describe("resolveDropNames — the item's own icon and quality", () => {
  it("carries them across so a drop renders like every other item", () => {
    const [drop] = resolveDropNames(
      [{ ...base("belt", "Belt"), itemId: 1, origin: "foundation" }],
      () => ({ name: "Belt", quality: "epic" as const, icon: "inv_belt_01" }),
    );
    expect(drop.quality).toBe("epic");
    expect(drop.icon).toBe("inv_belt_01");
  });

  it("carries them even when the written name is kept", () => {
    // A row keeping its annotation still points at a real item and has to look
    // like one — the icon belongs to the item, never to the drop table.
    const facts = () => ({ name: "Warglaive of Azzinoth", quality: "legendary" as const, icon: "inv_weapon_glaive_01" });
    const drops = resolveDropNames(
      [
        { ...base("wgmain", "Warglaive of Azzinoth (Main Hand)", "Illidan Stormrage"), itemId: 1, origin: "foundation" },
        { ...base("wgoff", "Warglaive of Azzinoth (Off Hand)", "Illidan Stormrage"), itemId: 2, origin: "foundation" },
      ],
      facts,
    );
    expect(drops.map((d) => d.itemName)).toEqual([
      "Warglaive of Azzinoth (Main Hand)",
      "Warglaive of Azzinoth (Off Hand)",
    ]);
    expect(drops.every((d) => d.icon === "inv_weapon_glaive_01")).toBe(true);
    expect(drops.every((d) => d.quality === "legendary")).toBe(true);
  });

  it("leaves a drop with no cached item bare rather than inventing art", () => {
    const [drop] = resolveDropNames(
      [{ ...base("newthing", "New Thing"), itemId: 99, origin: "foundation" }],
      () => undefined,
    );
    expect(drop.icon).toBeUndefined();
    expect(drop.quality).toBeUndefined();
  });
});
