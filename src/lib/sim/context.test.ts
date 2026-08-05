import { describe, expect, it } from "vitest";
import { auditHeadline, auditSimContext, bossDebuffUptime, playerBuffUptime } from "@/lib/sim/context";
import type { IndividualSimSettings } from "@/lib/sim/request";
import type { WclPlayerFight } from "@/lib/types";

/** Katzewarr's real Void Reaver pull, trimmed to the fields the audit reads. */
function pull(over: Partial<WclPlayerFight> = {}): WclPlayerFight {
  return {
    id: "p", reportCode: "R", fightId: 77, encounterId: 601, encounterName: "Void Reaver",
    kill: true, durationMs: 134_000, actorName: "Katzewarr", characterId: null, role: "dps",
    deaths: 0, flask: "Flask of Relentless Assault", elixirs: [], scrolls: [], food: true,
    weaponBuff: true, prepot: false, potions: ["Haste Potion"], otherCasts: [], extras: [],
    cooldowns: [], castTimes: [], upkeep: [], gear: [], talents: [21, 40, 0],
    drums: 0, runes: 0, healthstones: 0, sappers: 1, missingEnchants: [],
    ...over,
  } as WclPlayerFight;
}

/** The real config off Katzewarr's exported link. */
const settings: IndividualSimSettings = {
  player: {
    consumables: { potId: 22838, flaskId: 22854, foodId: 27658, ohImbueId: 29453 },
    buffs: { blessingOfKings: true, blessingOfMight: "TristateEffectImproved" },
  } as never,
  raidBuffs: { bloodlust: true, powerWordFortitude: "TristateEffectImproved" },
  encounter: { duration: 134 },
  debuffs: {
    misery: true,
    faerieFire: "TristateEffectImproved",
    exposeArmor: "TristateEffectImproved",
    curseOfRecklessness: true,
    huntersMark: "TristateEffectImproved",
    improvedSealOfTheCrusader: "TristateEffectImproved",
    mangle: true,
    bloodFrenzy: true,
    giftOfArthas: true,
  },
  partyBuffs: { drums: "LesserDrumsOfBattle" },
};

/** What the raid actually managed on the boss, from the real pull. */
const realDebuffs = {
  "Hunter's Mark": 99,
  "Faerie Fire": 98,
  "Judgement of the Crusader": 98,
  "Curse of Recklessness": 97,
  Misery: 94,
  "Expose Armor": 90,
  "Mangle (Cat)": 77,
  "Sunder Armor": 8,
};

describe("bossDebuffUptime", () => {
  it("takes the best uptime across the raid, not one player's own", () => {
    // A player's row only knows what they kept up; a raid debuff is whatever
    // the raid managed between them.
    const rows = [
      pull({ upkeep: [{ name: "Expose Armor", pct: 40, targets: [{ target: "Void Reaver", boss: true, pct: 40, segments: [], applications: 1 }] }] }),
      pull({ upkeep: [{ name: "Expose Armor", pct: 90, targets: [{ target: "Void Reaver", boss: true, pct: 90, segments: [], applications: 1 }] }] }),
    ];
    expect(bossDebuffUptime(rows)["Expose Armor"]).toBe(90);
  });

  it("sees nothing when handed only the audited player's own row", () => {
    /*
     * The regression this guards: the panel fed it getCharacterPerformance's
     * rows, which are filtered to one raider. A debuff is recorded against
     * whoever applied it, so the whole raid's kit read as "not tracked by this
     * app" — a data-plumbing bug wearing the costume of a tracking gap.
     */
    const own = pull({ actorName: "Katzewarr", upkeep: [] });
    expect(bossDebuffUptime([own])).toEqual({});
  });

  it("ignores uptime on adds — a sim's debuff means on the boss", () => {
    const rows = [
      pull({ upkeep: [{ name: "Misery", pct: 99, targets: [{ target: "Add", boss: false, pct: 99, segments: [], applications: 1 }] }] }),
    ];
    expect(bossDebuffUptime(rows).Misery).toBeUndefined();
  });
});

describe("playerBuffUptime", () => {
  const rows = [
    // The neck's wearer is a different raider; Katzewarr is a recipient.
    pull({
      actorName: "Wando",
      upkeep: [
        {
          name: "Braided Eternium Chain",
          pct: 100,
          targets: [
            { target: "Katzewarr", boss: false, player: true, pct: 96, segments: [], applications: 1 },
            { target: "Wando", boss: false, player: true, pct: 100, segments: [], applications: 1 },
          ],
        },
      ],
    }),
    pull({ actorName: "Katzewarr", upkeep: [] }),
  ] as never as WclPlayerFight[];

  it("finds a buff the player received from someone else's row", () => {
    // Katzewarr's own row knows nothing about it — it's recorded on the wearer.
    expect(playerBuffUptime(rows, "Katzewarr")["Braided Eternium Chain"]).toBe(96);
  });

  it("does not credit a different party member's coverage", () => {
    expect(playerBuffUptime(rows, "Scomb")["Braided Eternium Chain"]).toBeUndefined();
  });

  it("matches names case-insensitively", () => {
    expect(playerBuffUptime(rows, "katzewarr")["Braided Eternium Chain"]).toBe(96);
  });
});

describe("auditSimContext", () => {
  const audit = auditSimContext({ settings, pull: pull(), bossDebuffs: realDebuffs, simDurationMs: 134_000 });
  const find = (name: string) => audit.rows.find((r) => r.name === name)!;

  it("confirms the debuffs the raid really kept up", () => {
    expect(find("Misery").verdict).toBe("match");
    expect(find("Faerie Fire").verdict).toBe("match");
    expect(find("Hunter's Mark").verdict).toBe("match");
  });

  it("flags a debuff the sim assumed that the raid never applied", () => {
    // Blood Frenzy and Gift of Arthas are switched on in the sim and appear
    // nowhere in the log — the sim is being handed damage the raid didn't have.
    expect(find("Blood Frenzy").verdict).toBe("unknown");
    expect(find("Blood Frenzy").favours).toBe("neither");
  });

  it("ignores a debuff this sim doesn't model, however well the raid kept it", () => {
    // Curse of the Elements is spell damage: 98% uptime on the boss moves a
    // Fury warrior's number by nothing. A row for it would imply his logged
    // DPS was flattered by something that never touched him.
    const a = auditSimContext({
      settings,
      pull: pull(),
      bossDebuffs: { ...realDebuffs, "Curse of the Elements": 98 },
    });
    expect(a.rows.some((r) => r.name === "Curse of the Elements")).toBe(false);
  });

  it("still audits a debuff the sim does model", () => {
    // The filter is "does this sim model it", not "is it a caster debuff" —
    // a shadow priest's config would audit Misery the same way.
    expect(find("Misery").verdict).toBe("match");
  });

  it("calls a partial uptime a difference, not a match", () => {
    // Mangle at 77% is not the permanently-applied debuff a sim models.
    expect(find("Mangle").verdict).toBe("differs");
    expect(find("Mangle").favours).toBe("sim");
  });

  it("treats Expose Armor and Sunder Armor as one armor slot", () => {
    // They overwrite each other. With Expose at 90%, the leftover 8% Sunder is
    // not a failure to keep Sunder up — stacking it was impossible.
    const withSunder = auditSimContext({
      settings: { ...settings, debuffs: { ...settings.debuffs, sunderArmor: true } },
      pull: pull(),
      bossDebuffs: realDebuffs,
    });
    expect(withSunder.rows.some((r) => r.name === "Sunder Armor")).toBe(false);
    const armor = withSunder.rows.find((r) => r.name === "Armor reduction")!;
    expect(armor.verdict).toBe("match");
    expect(armor.logged).toContain("Expose Armor");
  });

  it("satisfies the armor slot from Sunder when no rogue is exposing", () => {
    const a = auditSimContext({ settings, pull: pull(), bossDebuffs: { "Sunder Armor": 95 } });
    const armor = a.rows.find((r) => r.name === "Armor reduction")!;
    expect(armor.verdict).toBe("match");
    expect(armor.logged).toContain("Sunder Armor 95%");
  });

  it("flags the armor slot when neither debuff was really up", () => {
    const a = auditSimContext({ settings, pull: pull(), bossDebuffs: { "Sunder Armor": 8 } });
    expect(a.rows.find((r) => r.name === "Armor reduction")).toMatchObject({
      verdict: "sim-only",
      favours: "sim",
    });
  });

  it("catches a party neck the sim assumed but this player's group lacked", () => {
    // The raid can own the neck and still leave this group uncovered — the
    // failure a gear check can't see.
    const a = auditSimContext({
      settings: { ...settings, partyBuffs: { braidedEterniumChain: true } },
      pull: pull(),
      bossDebuffs: realDebuffs,
      playerBuffs: {},
    });
    expect(a.rows.find((r) => r.name === "Braided Eternium Chain")).toMatchObject({
      verdict: "unknown",
    });
  });

  it("confirms a party neck the player actually had", () => {
    const a = auditSimContext({
      settings: { ...settings, partyBuffs: { braidedEterniumChain: true } },
      pull: pull(),
      bossDebuffs: realDebuffs,
      playerBuffs: { "Braided Eternium Chain": 96 },
    });
    expect(a.rows.find((r) => r.name === "Braided Eternium Chain")!.verdict).toBe("match");
  });

  it("flags a neck that only covered part of the pull", () => {
    const a = auditSimContext({
      settings: { ...settings, partyBuffs: { braidedEterniumChain: true } },
      pull: pull(),
      bossDebuffs: realDebuffs,
      playerBuffs: { "Braided Eternium Chain": 45 },
    });
    expect(a.rows.find((r) => r.name === "Braided Eternium Chain")).toMatchObject({
      verdict: "differs",
      favours: "sim",
    });
  });

  it("catches the sim assuming drums nobody brought", () => {
    expect(find("Drums of Battle")).toMatchObject({ verdict: "sim-only", favours: "sim" });
  });

  describe("drums are a party buff, not this raider's own cast", () => {
    it("counts the whole raid, not the audited player's row", () => {
      /*
       * Drums come from a leatherworker in the party, so the audited raider's
       * own count is almost always zero. Reading it said "none in the raid" on
       * pulls where three raiders had drummed.
       */
      const a = auditSimContext({
        settings,
        pull: pull({ drums: 0 }),
        bossDebuffs: realDebuffs,
        raidDrums: 3,
      });
      const drums = a.rows.find((r) => r.name === "Drums of Battle")!;
      expect(drums.verdict).toBe("match");
      expect(drums.logged).toContain("3 used in the raid");
    });

    it("measures the raider's own drum uptime when the aura list is there", () => {
      /*
       * An earlier pass concluded drums never reach the combat log and reported
       * only the raid's count. That came from a probe whose WCL filter used
       * single quotes and so matched nothing — the buff is logged per recipient,
       * and 22% on this raider is a different story from "4 were used".
       */
      const a = auditSimContext({
        settings,
        pull: pull(),
        bossDebuffs: realDebuffs,
        raidDrums: 4,
        playerAuras: { "Drums of Battle": { pct: 22, uses: 1 } },
      });
      const drums = a.rows.find((r) => r.name === "Drums of Battle")!;
      expect(drums.verdict).toBe("differs");
      expect(drums.logged).toContain("22% of the pull");
      expect(drums.inferred).toBeUndefined();
    });

    it("says he was out of range when the raid drummed and he has no aura", () => {
      const a = auditSimContext({
        settings,
        pull: pull(),
        bossDebuffs: realDebuffs,
        raidDrums: 4,
        playerAuras: {},
      });
      expect(a.rows.find((r) => r.name === "Drums of Battle")!.logged).toMatch(/none reached this raider/i);
    });

    it("falls back to the raid count when no aura list was fetched", () => {
      const a = auditSimContext({ settings, pull: pull(), bossDebuffs: realDebuffs, raidDrums: 2 });
      const drums = a.rows.find((r) => r.name === "Drums of Battle")!;
      expect(drums.inferred).toBe(true);
      expect(drums.logged).toContain("2 used in the raid");
    });

    it("still reports a raid that brought none", () => {
      const a = auditSimContext({ settings, pull: pull(), bossDebuffs: realDebuffs, raidDrums: 0 });
      const drums = a.rows.find((r) => r.name === "Drums of Battle")!;
      expect(drums.verdict).toBe("sim-only");
      // "Nobody drummed" is measured — every raider's own casts are recorded.
      expect(drums.inferred).toBeUndefined();
    });
  });

  describe("Blood Frenzy, which the combat log never carries", () => {
    it("reports it as inferred rather than absent", () => {
      const a = auditSimContext({
        settings,
        pull: pull(),
        bossDebuffs: realDebuffs,
        tracks: { collected: new Set(["Blood Frenzy"]), atImport: new Set(["Blood Frenzy"]) },
        bloodFrenzy: { kind: "inferred", pct: 87, by: "Dëltâ", build: "33/28/0", via: "Deep Wounds" },
      });
      const bf = a.rows.find((r) => r.name === "Blood Frenzy")!;
      expect(bf.verdict).toBe("match");
      expect(bf.inferred).toBe(true);
      expect(bf.logged).toContain("Dëltâ");
      expect(bf.logged).toContain("Deep Wounds");
    });

    it("never says 'nobody applied it' just because it was never logged", () => {
      // The coverage rules would otherwise turn a debuff TBC simply doesn't
      // emit into a permanent finding against the raid.
      const a = auditSimContext({
        settings,
        pull: pull(),
        bossDebuffs: realDebuffs,
        tracks: { collected: new Set(["Blood Frenzy"]), atImport: new Set(["Blood Frenzy"]) },
        bloodFrenzy: { kind: "inferred", pct: 87, by: "Dëltâ", via: "Deep Wounds" },
      });
      expect(a.rows.find((r) => r.name === "Blood Frenzy")!.logged).not.toMatch(/nobody/i);
    });

    it("is a solid finding when no Arms warrior was in the raid", () => {
      const a = auditSimContext({
        settings,
        pull: pull(),
        bossDebuffs: realDebuffs,
        bloodFrenzy: { kind: "no-arms-warrior" },
      });
      const bf = a.rows.find((r) => r.name === "Blood Frenzy")!;
      expect(bf).toMatchObject({ verdict: "sim-only", favours: "sim" });
      // Nobody could have brought it, so this one is observed, not reasoned.
      expect(bf.inferred).toBeUndefined();
    });

    it("stays honest when handed no evidence at all", () => {
      const a = auditSimContext({ settings, pull: pull(), bossDebuffs: realDebuffs });
      expect(a.rows.find((r) => r.name === "Blood Frenzy")).toMatchObject({ verdict: "unknown" });
    });
  });

  it("counts potions against what the fight allowed, not a pre-pot flag", () => {
    // TBC's potion cooldown is 2 minutes and starts before the pull, so raiders
    // chain them with cooldowns. "Did you pre-pot" was the wrong question.
    // 134s allows 2; he used 1, so it's short but not absent.
    expect(find("Potions")).toMatchObject({ verdict: "differs", favours: "sim" });
    expect(find("Potions").logged).toContain("1 of 2");
  });

  it("matches when the raider used everything the fight allowed", () => {
    const a = auditSimContext({
      settings,
      pull: pull({ potions: ["Haste Potion", "Haste Potion"] }),
      bossDebuffs: realDebuffs,
    });
    expect(a.rows.find((r) => r.name === "Potions")!.verdict).toBe("match");
  });

  it("credits a pre-pull potion as one of the allowance", () => {
    const a = auditSimContext({
      settings,
      pull: pull({ potions: ["Haste Potion"], prepot: true }),
      bossDebuffs: realDebuffs,
    });
    const potions = a.rows.find((r) => r.name === "Potions")!;
    expect(potions.verdict).toBe("match");
    expect(potions.logged).toContain("pre-pull");
  });

  it("flags a raider who potted not at all", () => {
    const a = auditSimContext({
      settings,
      pull: pull({ potions: [] }),
      bossDebuffs: realDebuffs,
    });
    expect(a.rows.find((r) => r.name === "Potions")).toMatchObject({
      verdict: "sim-only",
      favours: "sim",
    });
  });

  it("scales the allowance with fight length", () => {
    // A 400s Kael'thas affords four, not two.
    const a = auditSimContext({
      settings,
      pull: pull({ durationMs: 400_000, potions: ["Haste Potion"] }),
      bossDebuffs: realDebuffs,
    });
    expect(a.rows.find((r) => r.name === "Potions")!.logged).toContain("of 4");
  });

  it("confirms the consumables he did bring", () => {
    expect(find("Flask").verdict).toBe("match");
    expect(find("Food buff").verdict).toBe("match");
    expect(find("Weapon buff").verdict).toBe("match");
  });

  it("credits the pull when it had something the sim didn't assume", () => {
    const a = auditSimContext({
      settings: { ...settings, partyBuffs: {} },
      pull: pull({ drums: 3 }),
      bossDebuffs: realDebuffs,
    });
    expect(a.rows.find((r) => r.name === "Drums of Battle")).toMatchObject({
      verdict: "log-only",
      favours: "log",
    });
  });

  it("says 'not tracked' rather than inventing an absence, when told nothing", () => {
    // With no coverage stated we cannot tell "the raid didn't have it" from
    // "we never asked WCL for it", so the row must claim neither.
    expect(find("Gift of Arthas").logged).toMatch(/not tracked/i);
    expect(audit.unknown).toBeGreaterThan(0);
  });

  /*
   * The three silences.
   *
   * An aura missing from a pull's rows means one of three very different
   * things, and the panel spent a release calling all of them "not tracked by
   * this app" — on reports that had just been refetched with the track in
   * place. Absence is only a finding if we asked for it when we imported.
   */
  describe("an aura with no rows in the pull", () => {
    const tracked = { collected: new Set(["Gift of Arthas"]), atImport: new Set(["Gift of Arthas"]) };

    it("is a real finding when the report was imported with that track", () => {
      const a = auditSimContext({
        settings,
        pull: pull(),
        bossDebuffs: realDebuffs,
        tracks: tracked,
      });
      // A tank drinks it and it procs on the boss — so its absence from a
      // report that asked for it is a fact about the raid, not a gap.
      expect(a.rows.find((r) => r.name === "Gift of Arthas")).toMatchObject({
        verdict: "sim-only",
        favours: "sim",
      });
      expect(a.rows.find((r) => r.name === "Gift of Arthas")!.logged).toMatch(/nobody/i);
    });

    it("asks for a refetch when the track was added after the import", () => {
      const a = auditSimContext({
        settings,
        pull: pull(),
        bossDebuffs: realDebuffs,
        tracks: { collected: new Set(["Gift of Arthas"]), atImport: new Set(["Sunder Armor"]) },
      });
      const row = a.rows.find((r) => r.name === "Gift of Arthas")!;
      expect(row.verdict).toBe("unknown");
      expect(row.logged).toMatch(/refetch/i);
    });

    it("stays unverifiable when the app doesn't follow the aura at all", () => {
      const a = auditSimContext({
        settings,
        pull: pull(),
        bossDebuffs: realDebuffs,
        tracks: { collected: new Set(["Sunder Armor"]), atImport: new Set(["Sunder Armor"]) },
      });
      expect(a.rows.find((r) => r.name === "Gift of Arthas")!.logged).toMatch(/not tracked/i);
    });

    it("reports an uncovered party neck as uncovered, not as unknown", () => {
      const a = auditSimContext({
        settings: { ...settings, partyBuffs: { braidedEterniumChain: true } },
        pull: pull(),
        bossDebuffs: realDebuffs,
        playerBuffs: {},
        tracks: {
          collected: new Set(["Braided Eternium Chain"]),
          atImport: new Set(["Braided Eternium Chain"]),
        },
      });
      expect(a.rows.find((r) => r.name === "Braided Eternium Chain")).toMatchObject({
        verdict: "sim-only",
        favours: "sim",
      });
    });

    it("won't call armor reduction absent unless BOTH auras were collected", () => {
      // Expose Armor overwrites Sunder. Reporting "no Sunder" while Expose was
      // untracked would be a finding invented from half the picture.
      const a = auditSimContext({
        settings,
        pull: pull(),
        bossDebuffs: {},
        tracks: { collected: new Set(["Sunder Armor"]), atImport: new Set(["Sunder Armor"]) },
      });
      expect(a.rows.find((r) => r.name === "Armor reduction")!.verdict).toBe("unknown");
    });
  });

  it("flags a fight length that doesn't match the pull", () => {
    const a = auditSimContext({ settings, pull: pull(), bossDebuffs: realDebuffs, simDurationMs: 200_000 });
    expect(a.rows.find((r) => r.name === "Fight length")!.verdict).toBe("differs");
  });

  it("accepts a small length drift as a match", () => {
    const a = auditSimContext({ settings, pull: pull(), bossDebuffs: realDebuffs, simDurationMs: 136_000 });
    expect(a.rows.find((r) => r.name === "Fight length")!.verdict).toBe("match");
  });

  it("lists the assumptions alphabetically, so a named row is findable", () => {
    // Was "differences first", which reads well the first time and badly every
    // time after — you come back to this table looking for one row.
    const names = audit.rows.map((r) => r.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  describe("a spell-damage debuff is a row like any other", () => {
    it("counts Misery the same way for a warrior as for a caster", () => {
      // It does nothing for the warrior's own number, but the raid's damage
      // depends on it and the panel is read about a raid night.
      for (const className of ["Warrior", "Priest"]) {
        const a = auditSimContext({ settings, pull: pull({ className }), bossDebuffs: realDebuffs });
        const misery = a.rows.find((r) => r.name === "Misery")!;
        expect(misery.verdict, className).toBe("match");
        expect(misery.favours, className).toBe("neither");
      }
    });

    it("counts every matched row, with nothing held back", () => {
      const a = auditSimContext({ settings, pull: pull(), bossDebuffs: realDebuffs });
      expect(a.matched).toBe(a.rows.filter((r) => r.verdict === "match").length);
    });
  });

  describe("buffs the sim assumes beyond the debuff list", () => {
    it("measures a buff on the raider rather than guessing from the raid", () => {
      // Heroism was on him for 29% of the pull — a Bloodlust cast somewhere in
      // the raid says nothing about whether it reached this party.
      const a = auditSimContext({
        settings,
        pull: pull(),
        bossDebuffs: realDebuffs,
        playerAuras: { Heroism: { pct: 29, uses: 1 }, "Greater Blessing of Kings": { pct: 100, uses: 1 } },
      });
      expect(a.rows.find((r) => r.name === "Bloodlust / Heroism")).toMatchObject({
        verdict: "differs",
        favours: "sim",
      });
      expect(a.rows.find((r) => r.name === "Blessing of Kings")).toMatchObject({ verdict: "match" });
    });

    it("reports a buff the raider simply never had", () => {
      const a = auditSimContext({
        settings,
        pull: pull(),
        bossDebuffs: realDebuffs,
        playerAuras: { "Greater Blessing of Kings": { pct: 100, uses: 1 } },
      });
      expect(a.rows.find((r) => r.name === "Bloodlust / Heroism")).toMatchObject({
        verdict: "sim-only",
        favours: "sim",
      });
    });

    it("falls back to totem drops, which the combat log never carries as buffs", () => {
      const a = auditSimContext({
        settings: { ...settings, partyBuffs: { ...settings.partyBuffs, windfuryTotem: true } },
        pull: pull(),
        bossDebuffs: realDebuffs,
        playerAuras: {},
        raidCasts: { "Windfury Totem": 13 },
      });
      const wf = a.rows.find((r) => r.name === "Windfury Totem")!;
      expect(wf.verdict).toBe("match");
      expect(wf.inferred).toBe(true);
      expect(wf.logged).toMatch(/dropped/i);
    });

    it("says 'not tracked' only when there is genuinely nothing to read", () => {
      // No aura table fetched and no totem drops: the honest answer.
      const a = auditSimContext({ settings, pull: pull(), bossDebuffs: realDebuffs });
      expect(a.rows.find((r) => r.name === "Blessing of Kings")).toMatchObject({
        verdict: "unknown",
      });
    });

    it("says nothing about a buff the sim didn't switch on", () => {
      const a = auditSimContext({
        settings: { ...settings, raidBuffs: {}, partyBuffs: {}, player: { ...settings.player } },
        pull: pull(),
        bossDebuffs: realDebuffs,
      });
      expect(a.rows.some((r) => r.name === "Bloodlust / Heroism")).toBe(false);
    });
  });

  it("counts which side each difference flatters", () => {
    expect(audit.favoursSim).toBeGreaterThan(0);
    expect(audit.matched).toBeGreaterThan(0);
  });
});

describe("auditHeadline", () => {
  it("says the gap is real when nothing differs", () => {
    // A genuinely matched setup: the sim assumes exactly the kit he brought.
    const clean = auditSimContext({
      settings: {
        encounter: { duration: 134 },
        debuffs: {},
        partyBuffs: {},
        player: {
          consumables: { flaskId: 22854, foodId: 27658, ohImbueId: 29453, potId: 22838 },
        } as never,
      },
      // 134s affords two potions; he took both, so nothing is out of step.
      pull: pull({ potions: ["Haste Potion", "Haste Potion"] }),
      bossDebuffs: {},
      simDurationMs: 134_000,
    });
    expect(clean.favoursSim).toBe(0);
    expect(clean.favoursLog).toBe(0);
    expect(auditHeadline(clean)).toMatch(/rotation and cooldowns/i);
  });

  it("summarises the direction of the differences", () => {
    const audit = auditSimContext({ settings, pull: pull(), bossDebuffs: realDebuffs, simDurationMs: 134_000 });
    expect(auditHeadline(audit)).toMatch(/favouring the sim/);
  });
});
