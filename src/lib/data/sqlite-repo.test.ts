import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { getSqliteRepo } from "@/lib/data/sqlite-repo";
import { loadSeedStore } from "@/lib/data/seed-data";
import type { GearSetDraft, WclPlayerFightDraft } from "@/lib/data/repo";

/** Each test gets a fresh database file; the repo re-opens per path. */
beforeEach(() => {
  process.env.PROJECTLC_DB = path.join(mkdtempSync(path.join(tmpdir(), "projectlc-")), "test.db");
});

function wishlistDraft(characterId: string, phase: 1 | 2 | 3 | 4 | 5, itemId: number): GearSetDraft {
  return {
    characterId,
    kind: "wishlist",
    phase,
    name: `P${phase} test list`,
    source: "sixtyupgrades",
    stats: { stamina: 100 },
    slots: [{ slot: "head", itemId, itemName: `Item ${itemId}` }],
  };
}

describe("sqlite repo", () => {
  it("seeds a fresh database from the seed JSON", async () => {
    const repo = getSqliteRepo();
    const seed = loadSeedStore();
    expect((await repo.getGuild()).name).toBe(seed.guild.name);
    expect(await repo.listCharacters()).toHaveLength(seed.roster.length);
    expect(await repo.listItems()).toHaveLength(seed.items.length);
    expect(await repo.listLootAwards()).toHaveLength(seed.lootAwards.length);
  });

  describe("gear set update flow", () => {
    it("creates, refuses to silently overwrite, then replaces on confirm", async () => {
      const repo = getSqliteRepo();
      const character = (await repo.findCharacterByName("Thrainn"))!;

      // Thrainn's seeded P1 wishlist exists — a new import must not overwrite it.
      const refused = await repo.upsertGearSet(wishlistDraft(character.id, 1, 111), { replace: false });
      expect(refused.status).toBe("exists");
      if (refused.status !== "exists") throw new Error("unreachable");
      const seededName = refused.existing.name;

      const replaced = await repo.upsertGearSet(wishlistDraft(character.id, 1, 111), { replace: true });
      expect(replaced.status).toBe("replaced");
      if (replaced.status !== "replaced") throw new Error("unreachable");
      expect(replaced.previous.name).toBe(seededName);

      // The read model reflects the replacement: one P1 wishlist, the new one.
      const bundle = (await repo.getCharacterBundle("thrainn"))!;
      const p1 = bundle.wishlists.filter((w) => w.phase === 1);
      expect(p1).toHaveLength(1);
      expect(p1[0].set.name).toBe("P1 test list");
      expect(p1[0].set.slots[0].itemId).toBe(111);
    });

    it("keeps wishlists per phase independent", async () => {
      const repo = getSqliteRepo();
      const character = (await repo.findCharacterByName("Lunara"))!; // current-only character
      expect(await repo.findExistingSet(character.id, "wishlist", 3)).toBeUndefined();

      const created = await repo.upsertGearSet(wishlistDraft(character.id, 3, 222), { replace: false });
      expect(created.status).toBe("created");
      const other = await repo.upsertGearSet(wishlistDraft(character.id, 4, 333), { replace: false });
      expect(other.status).toBe("created");

      const bundle = (await repo.getCharacterBundle("lunara"))!;
      expect(bundle.wishlists.map((w) => w.phase)).toEqual([3, 4]);
    });

    it("treats current gear as a singleton per character", async () => {
      const repo = getSqliteRepo();
      const character = (await repo.findCharacterByName("Thrainn"))!;
      const result = await repo.upsertGearSet(
        { ...wishlistDraft(character.id, 1, 444), kind: "current", phase: undefined, name: "New current" },
        { replace: false },
      );
      expect(result.status).toBe("exists"); // seeded current gear is protected too
    });

    it("deletes a set without touching loot history", async () => {
      const repo = getSqliteRepo();
      const bundleBefore = (await repo.getCharacterBundle("thrainn"))!;
      const awardsBefore = bundleBefore.awards.length;
      const setId = bundleBefore.wishlists[0].set.id;

      expect(await repo.deleteGearSet(setId)).toBe(true);
      expect(await repo.deleteGearSet(setId)).toBe(false); // already gone

      const bundleAfter = (await repo.getCharacterBundle("thrainn"))!;
      expect(bundleAfter.wishlists.length).toBe(bundleBefore.wishlists.length - 1);
      expect(bundleAfter.awards.length).toBe(awardsBefore);
    });
  });

  describe("characters", () => {
    it("creates a character and rejects duplicate names case-insensitively", async () => {
      const repo = getSqliteRepo();
      const created = await repo.createCharacter({
        name: "Zugzug",
        class: "Warrior",
        spec: "Fury",
        role: "Melee DPS",
        status: "main",
      });
      expect(created.ok).toBe(true);

      const dup = await repo.createCharacter({
        name: "zugzug",
        class: "Shaman",
        spec: "Enhancement",
        role: "Melee DPS",
        status: "main",
      });
      expect(dup.ok).toBe(false);
    });

    it("updates a character; gear sets and awards follow the id through a rename", async () => {
      const repo = getSqliteRepo();
      const thrainn = (await repo.findCharacterByName("Thrainn"))!;
      const result = await repo.updateCharacter(thrainn.id, {
        name: "Thrainnz",
        class: thrainn.class,
        spec: "Fury",
        role: "Melee DPS",
        status: thrainn.status,
        race: thrainn.race,
        note: thrainn.note,
      });
      expect(result.ok).toBe(true);

      expect(await repo.getCharacterBundle("thrainn")).toBeNull();
      const renamed = (await repo.getCharacterBundle("thrainnz"))!;
      expect(renamed.character.spec).toBe("Fury");
      expect(renamed.wishlists.length).toBeGreaterThan(0);
      expect(renamed.awards.length).toBeGreaterThan(0);

      // Renaming onto an existing name is refused.
      const collision = await repo.updateCharacter(thrainn.id, {
        name: "Sylvaria",
        class: thrainn.class,
        spec: thrainn.spec,
        role: thrainn.role,
        status: thrainn.status,
      });
      expect(collision.ok).toBe(false);
    });
  });

  describe("gargul commits", () => {
    const award = (itemId: number, winner: string, at: string) => ({
      rawWinnerName: winner,
      itemId,
      itemName: `Item ${itemId}`,
      awardedAt: at,
      offspec: false,
    });

    it("resolves winners by roster name and keeps unknown winners unresolved", async () => {
      const repo = getSqliteRepo();
      const result = await repo.createRaidSessionWithAwards(
        { date: "2026-06-11", zones: ["Serpentshrine Cavern"], source: "gargul" },
        [award(99901, "Thrainn", "2026-06-11T21:00:00"), award(99902, "Pugmage", "2026-06-11T21:05:00")],
      );
      expect(result.inserted).toBe(2);
      expect(result.unresolved).toEqual(["Pugmage"]);

      const awards = await repo.listLootAwards();
      const mine = awards.find((a) => a.award.itemId === 99901)!;
      expect(mine.award.characterId).not.toBeNull();
      expect(mine.character?.name).toBe("Thrainn");
      const pug = awards.find((a) => a.award.itemId === 99902)!;
      expect(pug.award.characterId).toBeNull();
    });

    it("skips already-recorded awards and creates no session when everything is a duplicate", async () => {
      const repo = getSqliteRepo();
      const lines = [award(99903, "Velora", "2026-06-11T21:00:00")];
      const first = await repo.createRaidSessionWithAwards(
        { date: "2026-06-11", zones: ["Karazhan"], source: "gargul" },
        lines,
      );
      expect(first.inserted).toBe(1);

      const again = await repo.createRaidSessionWithAwards(
        { date: "2026-06-12", zones: ["Karazhan"], source: "gargul" },
        lines,
      );
      expect(again.inserted).toBe(0);
      expect(again.skippedDuplicates).toBe(1);
      expect(again.session).toBeUndefined();
      const sessions = await repo.listRaidSessions();
      expect(sessions.filter((s) => s.date === "2026-06-12")).toHaveLength(0);
    });
  });

  describe("winner resolution", () => {
    const award = (itemId: number, winner: string) => ({
      rawWinnerName: winner,
      itemId,
      itemName: `Item ${itemId}`,
      awardedAt: "2026-06-11T21:00:00",
      offspec: false,
    });

    it("seeded disenchants count as off-roster, not unresolved", async () => {
      const repo = getSqliteRepo();
      expect((await repo.getDashboard()).unresolvedCount).toBe(0);
      const de = (await repo.listLootAwards()).find((a) => a.award.rawWinnerName === "_disenchanted")!;
      expect(de.award.external).toBe(true);
      expect(de.award.characterId).toBeNull();
    });

    it("assigns an unresolved award to a roster character", async () => {
      const repo = getSqliteRepo();
      await repo.createRaidSessionWithAwards(
        { date: "2026-06-11", zones: ["Karazhan"], source: "gargul" },
        [award(99910, "Pugmage")],
      );
      expect((await repo.getDashboard()).unresolvedCount).toBe(1);

      const velora = (await repo.findCharacterByName("Velora"))!;
      const pug = (await repo.listLootAwards()).find((a) => a.award.itemId === 99910)!;
      const result = await repo.resolveAward(pug.award.id, { kind: "character", characterId: velora.id });
      expect(result.ok).toBe(true);

      const after = (await repo.listLootAwards()).find((a) => a.award.itemId === 99910)!;
      expect(after.character?.name).toBe("Velora");
      expect(after.award.external).toBe(false);
      expect((await repo.getDashboard()).unresolvedCount).toBe(0);
      // rawWinnerName stays exactly what Gargul said.
      expect(after.award.rawWinnerName).toBe("Pugmage");
    });

    it("marks an award off-roster and can reopen it", async () => {
      const repo = getSqliteRepo();
      await repo.createRaidSessionWithAwards(
        { date: "2026-06-11", zones: ["Karazhan"], source: "gargul" },
        [award(99911, "Banker")],
      );
      const banked = (await repo.listLootAwards()).find((a) => a.award.itemId === 99911)!;

      const settled = await repo.resolveAward(banked.award.id, { kind: "external" });
      expect(settled.ok).toBe(true);
      expect((await repo.getDashboard()).unresolvedCount).toBe(0);
      const externalNow = (await repo.listLootAwards()).find((a) => a.award.itemId === 99911)!;
      expect(externalNow.award.external).toBe(true);
      expect(externalNow.character).toBeUndefined();

      const reopened = await repo.resolveAward(banked.award.id, { kind: "unresolved" });
      expect(reopened.ok).toBe(true);
      expect((await repo.getDashboard()).unresolvedCount).toBe(1);
    });

    it("re-assigning clears a previous character link", async () => {
      const repo = getSqliteRepo();
      await repo.createRaidSessionWithAwards(
        { date: "2026-06-11", zones: ["Karazhan"], source: "gargul" },
        [award(99912, "Thrainn")],
      );
      const auto = (await repo.listLootAwards()).find((a) => a.award.itemId === 99912)!;
      expect(auto.character?.name).toBe("Thrainn");

      // Council corrects the entry: this actually went to the bank.
      await repo.resolveAward(auto.award.id, { kind: "external" });
      const fixed = (await repo.listLootAwards()).find((a) => a.award.itemId === 99912)!;
      expect(fixed.character).toBeUndefined();
      expect(fixed.award.external).toBe(true);
    });

    it("rejects unknown awards and unknown characters", async () => {
      const repo = getSqliteRepo();
      expect((await repo.resolveAward("la_missing", { kind: "external" })).ok).toBe(false);

      await repo.createRaidSessionWithAwards(
        { date: "2026-06-11", zones: ["Karazhan"], source: "gargul" },
        [award(99913, "Pugmage")],
      );
      const pug = (await repo.listLootAwards()).find((a) => a.award.itemId === 99913)!;
      const result = await repo.resolveAward(pug.award.id, { kind: "character", characterId: "chr_missing" });
      expect(result.ok).toBe(false);
      expect((await repo.getDashboard()).unresolvedCount).toBe(1); // untouched
    });
  });

  describe("loot editing", () => {
    async function seedSession(repo: ReturnType<typeof getSqliteRepo>) {
      const result = await repo.createRaidSessionWithAwards(
        { date: "2026-06-11", zones: ["Karazhan"], source: "gargul" },
        [{ rawWinnerName: "Thrainn", itemId: 99930, itemName: "Test Blade", awardedAt: "2026-06-11T21:00:00", offspec: false }],
      );
      return result.session!.id;
    }

    it("adds a manual award to a session, auto-linking a roster name", async () => {
      const repo = getSqliteRepo();
      const sessionId = await seedSession(repo);

      const added = await repo.addLootAward(sessionId, {
        itemId: 28830,
        itemName: "Dragonspine Trophy",
        rawWinnerName: "Velora",
        characterId: null, // the repo trusts the caller; the action resolves the link
        external: false,
        offspec: true,
        note: "council pick",
      });
      expect(added.ok).toBe(true);
      if (!added.ok) throw new Error("unreachable");
      expect(added.award.awardedAt).toBe("2026-06-11T12:00:00"); // session date at noon
      expect(added.award.offspec).toBe(true);

      const ledgerRow = (await repo.listLootAwards()).find((a) => a.award.id === added.award.id)!;
      expect(ledgerRow.award.itemId).toBe(28830);
      expect(ledgerRow.session.id).toBe(sessionId);
    });

    it("rejects an award on a missing session or with a bad item id", async () => {
      const repo = getSqliteRepo();
      const sessionId = await seedSession(repo);
      const base = { itemName: "X", rawWinnerName: "Thrainn", characterId: null, external: false, offspec: false };
      expect((await repo.addLootAward("rs_nope", { ...base, itemId: 100 })).ok).toBe(false);
      expect((await repo.addLootAward(sessionId, { ...base, itemId: 0 })).ok).toBe(false);
      const linkedToGhost = await repo.addLootAward(sessionId, { ...base, itemId: 100, characterId: "chr_missing" });
      expect(linkedToGhost.ok).toBe(false);
    });

    it("edits an award's item, winner and off-spec flag and re-derives the link", async () => {
      const repo = getSqliteRepo();
      const sessionId = await seedSession(repo);
      const award = (await repo.listLootAwards()).find((a) => a.award.itemId === 99930)!;
      const velora = (await repo.findCharacterByName("Velora"))!;

      const updated = await repo.updateLootAward(award.award.id, {
        itemId: 28773,
        itemName: "Gorehowl",
        rawWinnerName: velora.name,
        characterId: velora.id,
        external: false,
        offspec: true,
        note: "reassigned",
      });
      expect(updated.ok).toBe(true);

      const after = (await repo.listLootAwards()).find((a) => a.award.id === award.award.id)!;
      expect(after.award.itemId).toBe(28773);
      expect(after.character?.name).toBe("Velora");
      expect(after.award.offspec).toBe(true);
      expect(after.award.raidSessionId).toBe(sessionId); // session/date are preserved
    });

    it("deletes a single award and reports a missing one", async () => {
      const repo = getSqliteRepo();
      await seedSession(repo);
      const award = (await repo.listLootAwards()).find((a) => a.award.itemId === 99930)!;
      const before = (await repo.listLootAwards()).length;

      expect(await repo.deleteLootAward(award.award.id)).toBe(true);
      expect(await repo.deleteLootAward(award.award.id)).toBe(false);
      expect((await repo.listLootAwards()).length).toBe(before - 1);
    });

    it("deletes a whole import: awards go, the session goes, a linked report is unlinked", async () => {
      const repo = getSqliteRepo();
      const sessionId = await seedSession(repo);
      // A report linked to the session must survive the delete, just unlinked.
      await repo.saveWclReport(
        { code: "DELME000000000001", title: "Linked night", startTime: "2026-06-11T19:00:00Z", endTime: "2026-06-11T22:00:00Z", raidSessionId: sessionId },
        [
          {
            fightId: 1, encounterId: 1, encounterName: "Prince", kill: true, durationMs: 1000,
            actorName: "Thrainn", role: "dps", elixirs: [], scrolls: [], food: false, weaponBuff: false,
            prepot: false, potions: [], otherCasts: [], extras: [], cooldowns: [], upkeep: [],
            deaths: 0, drums: 0, runes: 0, healthstones: 0, sappers: 0, missingEnchants: [], gear: [],
          },
        ],
      );

      const result = await repo.deleteRaidSession(sessionId);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.deletedAwards).toBe(1);
      expect(result.unlinkedReports).toBe(1);

      expect((await repo.listRaidSessions()).some((s) => s.id === sessionId)).toBe(false);
      expect((await repo.listLootAwards()).some((a) => a.award.raidSessionId === sessionId)).toBe(false);
      // The report itself is kept (now session-less), so the store stays valid.
      const report = (await repo.listWclReports()).find((r) => r.report.code === "DELME000000000001")!;
      expect(report.report.raidSessionId).toBeNull();
      expect((await repo.deleteRaidSession(sessionId)).ok).toBe(false); // already gone
    });
  });

  describe("item demand index", () => {
    it("lists contested items first with demand counts", async () => {
      const repo = getSqliteRepo();
      const demand = await repo.listItemDemand();

      const gorehowl = demand.find((d) => d.itemId === 28773)!;
      expect(gorehowl).toBeDefined();
      expect(gorehowl.name).toBe("Gorehowl");
      expect(gorehowl.wisherCount).toBeGreaterThanOrEqual(2);
      expect(gorehowl.awardCount).toBeGreaterThanOrEqual(1);

      // Sorted by open demand; no duplicate ids; award-only items still appear.
      expect(demand[0].openCount).toBeGreaterThanOrEqual(demand[demand.length - 1].openCount);
      expect(new Set(demand.map((d) => d.itemId)).size).toBe(demand.length);

      await repo.createRaidSessionWithAwards(
        { date: "2026-06-11", zones: ["Karazhan"], source: "gargul" },
        [{ rawWinnerName: "Thrainn", itemId: 99920, itemName: "Uncached Blade", awardedAt: "2026-06-11T21:00:00", offspec: false }],
      );
      const fresh = (await repo.listItemDemand()).find((d) => d.itemId === 99920)!;
      expect(fresh.name).toBe("Uncached Blade"); // denormalized name survives a cache miss
      expect(fresh.awardCount).toBe(1);
    });
  });

  it("migrates a database created before the external column existed", async () => {
    // Pre-create loot_awards with the M2 schema; opening the repo must ALTER it.
    const old = new DatabaseSync(process.env.PROJECTLC_DB!);
    old.exec(`CREATE TABLE loot_awards (
      id TEXT PRIMARY KEY, raid_session_id TEXT NOT NULL, character_id TEXT,
      raw_winner_name TEXT NOT NULL, item_id INTEGER NOT NULL, item_name TEXT NOT NULL,
      awarded_at TEXT NOT NULL, offspec INTEGER NOT NULL, note TEXT
    )`);
    old.close();

    const repo = getSqliteRepo();
    const awards = await repo.listLootAwards(); // seeds + re-reads through zod (external required)
    expect(awards.length).toBeGreaterThan(0);
    expect(awards.every((a) => typeof a.award.external === "boolean")).toBe(true);
  });

  it("migrates wcl_player_fights tables created before scroll tracking", async () => {
    const old = new DatabaseSync(process.env.PROJECTLC_DB!);
    old.exec(`CREATE TABLE wcl_player_fights (
      id TEXT PRIMARY KEY, report_code TEXT NOT NULL, fight_id INTEGER NOT NULL,
      encounter_id INTEGER NOT NULL, encounter_name TEXT NOT NULL, kill INTEGER NOT NULL,
      fight_percentage REAL, duration_ms INTEGER NOT NULL, actor_name TEXT NOT NULL,
      character_id TEXT, class_name TEXT, spec TEXT, role TEXT NOT NULL,
      parse_percent REAL, bracket_percent REAL, amount REAL, deaths INTEGER NOT NULL DEFAULT 0,
      flask TEXT, elixirs_json TEXT NOT NULL DEFAULT '[]', food INTEGER NOT NULL DEFAULT 0,
      weapon_buff INTEGER NOT NULL DEFAULT 0, prepot INTEGER NOT NULL DEFAULT 0,
      potions_json TEXT NOT NULL DEFAULT '[]', drums INTEGER NOT NULL DEFAULT 0,
      runes INTEGER NOT NULL DEFAULT 0, healthstones INTEGER NOT NULL DEFAULT 0,
      missing_enchants_json TEXT NOT NULL DEFAULT '[]'
    )`);
    old.close();

    const repo = getSqliteRepo(); // boots, runs migrate(), seeds
    const perf = (await repo.getCharacterPerformance("kazrak"))!;
    expect(perf.reports[0].rows.every((r) => Array.isArray(r.scrolls))).toBe(true);
    // Later additive columns join the same migration path.
    expect(perf.reports[0].rows.every((r) => Array.isArray(r.cooldowns) && Array.isArray(r.upkeep))).toBe(true);
    // Seeded toolkit data round-trips through its JSON columns.
    expect(perf.reports[0].rows.some((r) => r.cooldowns.includes("Death Wish"))).toBe(true);
    expect(perf.reports[0].rows.some((r) => r.upkeep.some((u) => u.name === "Battle Shout" && u.pct > 0))).toBe(true);
  });

  it("addItemsIfMissing never overwrites existing cache entries", async () => {
    const repo = getSqliteRepo();
    const dst = (await repo.getItem(28830))!; // Dragonspine Trophy from seed
    const added = await repo.addItemsIfMissing([
      { id: 28830, name: "Wrong Name", quality: "poor", icon: "inv_misc_questionmark" },
      { id: 99950, name: "Brand New", quality: "epic", icon: "inv_misc_questionmark" },
    ]);
    expect(added).toBe(1);
    expect((await repo.getItem(28830))!.name).toBe(dst.name);
    expect((await repo.getItem(99950))!.name).toBe("Brand New");
  });

  describe("warcraft logs performance", () => {
    function fightDraft(
      over: Partial<WclPlayerFightDraft> & { fightId: number; actorName: string },
    ): WclPlayerFightDraft {
      return {
        encounterId: 700,
        encounterName: "Attumen the Huntsman",
        kill: true,
        durationMs: 200000,
        role: "dps",
        deaths: 0,
        elixirs: [],
        scrolls: [],
        food: true,
        weaponBuff: true,
        prepot: false,
        potions: [],
        otherCasts: [],
        extras: [],
        cooldowns: [],
        upkeep: [],
        gear: [],
        drums: 0,
        runes: 0,
        healthstones: 0,
        sappers: 0,
        missingEnchants: [],
        ...over,
      };
    }

    const reportDraft = {
      code: "TESTreport000001",
      title: "Kara split",
      zone: "Karazhan",
      startTime: "2026-06-10T19:00:00.000Z",
      endTime: "2026-06-10T22:30:00.000Z",
    };

    it("rolls up the seeded report per character", async () => {
      const repo = getSqliteRepo();
      const perf = (await repo.getCharacterPerformance("kazrak"))!;
      expect(perf.reports).toHaveLength(1);
      const view = perf.reports[0];
      expect(view.report.zone).toBe("Serpentshrine Cavern");
      expect(view.session?.id).toBe("rs-2026-06-04-ssc");
      expect(view.summary.fights).toBe(5);
      expect(view.summary.kills).toBe(3);
      expect(view.summary.role).toBe("dps");
      expect(view.summary.medianParse).toBeDefined();
      expect(view.summary.flaskOrElixirsPct).toBe(100);
      expect(perf.career?.bestParse).toBe(96);

      // A roster character with no rows still resolves, with no reports.
      const none = (await repo.getCharacterPerformance("skarn"))!;
      expect(none.reports).toHaveLength(0);
      expect(none.career).toBeUndefined();
    });

    it("saves a fetched report, matching players to the roster by name", async () => {
      const repo = getSqliteRepo();
      const saved = await repo.saveWclReport(reportDraft, [
        fightDraft({ fightId: 1, actorName: "Pyrelia", parsePercent: 88 }),
        fightDraft({ fightId: 1, actorName: "Randompug" }),
      ]);
      expect(saved.ok).toBe(true);
      if (!saved.ok) throw new Error("unreachable");
      expect(saved.matched).toEqual(["Pyrelia"]);
      expect(saved.unmatched).toEqual(["Randompug"]);
      expect(saved.replaced).toBe(false);

      const perf = (await repo.getCharacterPerformance("pyrelia"))!;
      expect(perf.reports).toHaveLength(1);
      expect(perf.reports[0].rows[0].parsePercent).toBe(88);

      // Seed report + this one, newest (June 10) first.
      const reports = await repo.listWclReports();
      expect(reports.map((r) => r.report.code)).toEqual(["TESTreport000001", "SEEDsscProgress1"]);
    });

    it("replaces a report wholesale on refetch", async () => {
      const repo = getSqliteRepo();
      await repo.saveWclReport(reportDraft, [
        fightDraft({ fightId: 1, actorName: "Pyrelia" }),
        fightDraft({ fightId: 2, actorName: "Pyrelia", encounterName: "Moroes", kill: false }),
      ]);
      const again = await repo.saveWclReport(reportDraft, [
        fightDraft({ fightId: 1, actorName: "Pyrelia", parsePercent: 99 }),
      ]);
      expect(again.ok).toBe(true);
      if (!again.ok) throw new Error("unreachable");
      expect(again.replaced).toBe(true);

      const perf = (await repo.getCharacterPerformance("pyrelia"))!;
      const rows = perf.reports.find((r) => r.report.code === reportDraft.code)!.rows;
      expect(rows).toHaveLength(1);
      expect(rows[0].parsePercent).toBe(99);
      expect(await repo.listWclReports()).toHaveLength(2);
    });

    it("round-trips per-raid consumable prices, keeping reports independent", async () => {
      const repo = getSqliteRepo();
      // No prices logged yet → empty (the gold view falls back to defaults).
      expect(await repo.getReportConsumablePrices("RPT1")).toEqual({});

      await repo.setReportConsumablePrices("RPT1", {
        "Haste Potion": { gold: 42, charges: 1 },
        "Drums of Battle": { gold: 20, charges: 50 },
      });
      expect(await repo.getReportConsumablePrices("RPT1")).toEqual({
        "Haste Potion": { gold: 42, charges: 1 },
        "Drums of Battle": { gold: 20, charges: 50 },
      });
      // A different raid keeps its own (empty) prices.
      expect(await repo.getReportConsumablePrices("RPT2")).toEqual({});
    });

    it("sanitizes malformed price entries on save", async () => {
      const repo = getSqliteRepo();
      await repo.setReportConsumablePrices("RPT3", {
        "Good Potion": { gold: 10, charges: 2 },
        "Bad Gold": { gold: -5, charges: 1 },
        "Bad Charges": { gold: 5, charges: 0 },
      } as never);
      const saved = await repo.getReportConsumablePrices("RPT3");
      expect(saved["Good Potion"]).toEqual({ gold: 10, charges: 2 });
      expect(saved["Bad Gold"]).toBeUndefined(); // negative gold dropped
      expect(saved["Bad Charges"]).toEqual({ gold: 5, charges: 1 }); // charges clamped to ≥1
    });

    it("moves a character to pug and back, excluding them from guild stats", async () => {
      const repo = getSqliteRepo();
      const velora = (await repo.findCharacterByName("Velora"))!;
      const before = await repo.getDashboard();

      await repo.updateCharacter(velora.id, { ...velora, status: "pug" });
      const asPug = await repo.getDashboard();
      expect(asPug.rosterSize).toBe(before.rosterSize - 1);
      const allFairness = asPug.fairness.find((g) => g.phase === "all")!;
      expect(allFairness.entries.some((e) => e.character.id === velora.id)).toBe(false);
      // Their loot and log history still resolve to the profile.
      expect((await repo.getCharacterBundle("velora"))!.awards.length).toBeGreaterThan(0);
      expect((await repo.getCharacterPerformance("velora"))!.reports).toHaveLength(1);

      await repo.updateCharacter(velora.id, { ...velora, status: "main" });
      const restored = await repo.getDashboard();
      expect(restored.rosterSize).toBe(before.rosterSize);
    });

    it("attaches log history at read time when an untracked player gets tracked", async () => {
      const repo = getSqliteRepo();
      await repo.saveWclReport(reportDraft, [
        fightDraft({ fightId: 1, actorName: "Newpug", parsePercent: 42 }),
        fightDraft({ fightId: 2, actorName: "Newpug", encounterName: "Moroes" }),
      ]);

      const untracked = await repo.listUntrackedLogPlayers();
      const pug = untracked.find((p) => p.name === "Newpug")!;
      expect(pug.appearances).toBe(2);
      expect(pug.reportCount).toBe(1);

      const created = await repo.createCharacter({
        name: "Newpug",
        class: "Mage",
        spec: "Fire",
        role: "Ranged DPS",
        status: "pug",
      });
      expect(created.ok).toBe(true);

      // No re-fetch needed: name matching is derived at read time.
      expect((await repo.listUntrackedLogPlayers()).some((p) => p.name === "Newpug")).toBe(false);
      const perf = (await repo.getCharacterPerformance("newpug"))!;
      expect(perf.reports).toHaveLength(1);
      expect(perf.reports[0].rows).toHaveLength(2);
      expect(perf.reports[0].rows[0].parsePercent).toBe(42);
      // And they stay out of the guild roster KPIs (13 seeded, Newpug excluded).
      expect((await repo.getDashboard()).rosterSize).toBe(13);
    });

    it("deletes a character, unlinking awards and log history instead of destroying them", async () => {
      const repo = getSqliteRepo();
      const velora = (await repo.findCharacterByName("Velora"))!;
      const awardsBefore = (await repo.listLootAwards()).length;

      const result = await repo.deleteCharacter(velora.id);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.unlinkedAwards).toBeGreaterThan(0);
      expect(result.unlinkedLogRows).toBe(5); // her 5 seeded SSC pulls

      expect(await repo.findCharacterByName("Velora")).toBeUndefined();
      expect(await repo.getCharacterBundle("velora")).toBeNull();
      // The ledger keeps every award, reopened under the raw Gargul name.
      const awards = await repo.listLootAwards();
      expect(awards).toHaveLength(awardsBefore);
      const hers = awards.filter((a) => a.award.rawWinnerName === "Velora");
      expect(hers.length).toBeGreaterThan(0);
      expect(hers.every((a) => a.character === undefined && !a.award.external)).toBe(true);
      // Log pulls resurface as an untracked name.
      const untracked = await repo.listUntrackedLogPlayers();
      expect(untracked.find((p) => p.name === "Velora")?.appearances).toBe(5);
    });

    it("computes attendance from imported reports", async () => {
      const repo = getSqliteRepo();
      // Baseline: one seed report, full presence.
      const kazrakBefore = (await repo.listCharacters()).find((s) => s.character.name === "Kazrak")!;
      expect(kazrakBefore.attendance).toMatchObject({ raidsTotal: 1, raidsAttended: 1, raidPct: 100, pullPct: 100 });

      // Second report: Pyrelia present for 1 of 2 pulls, Kazrak absent.
      await repo.saveWclReport(reportDraft, [
        fightDraft({ fightId: 1, actorName: "Pyrelia" }),
        fightDraft({ fightId: 1, actorName: "Thrainn" }),
        fightDraft({ fightId: 2, actorName: "Thrainn", encounterName: "Moroes" }),
      ]);

      const summaries = await repo.listCharacters();
      // Kazrak was around for both logged raids and missed the second: 50%.
      const kazrak = summaries.find((s) => s.character.name === "Kazrak")!.attendance!;
      expect(kazrak).toMatchObject({
        raidsTotal: 2, raidsAttended: 1, raidsTracked: 2, raidPct: 50,
        recentAttended: 1, recentTotal: 2, pullPct: 100,
      });
      // Per-reset check: seed raid (Thu 4 Jun → week of Wed 3 Jun) attended,
      // the new raid week (Wed 10 Jun) missed.
      expect(kazrak.weeks).toEqual([
        { start: "2026-06-03", attended: true, reports: 1, excused: false },
        { start: "2026-06-10", attended: false, reports: 1, excused: false },
      ]);
      expect(kazrak.weeksAttended).toBe(1);
      expect(kazrak.weeksTracked).toBe(2);
      expect(kazrak.weeksExcused).toBe(0);
      // Spec from the most recent logged pulls rides along on the summary.
      expect(summaries.find((s) => s.character.name === "Kazrak")!.loggedSpec).toBe("Arms");
      // Pyrelia first appears in the SECOND report — the first one is from
      // before she joined and must not count against her: 1/1, not 1/2.
      const pyrelia = summaries.find((s) => s.character.name === "Pyrelia")!.attendance!;
      expect(pyrelia).toMatchObject({
        raidsTotal: 2, raidsAttended: 1, raidsTracked: 1, raidPct: 100,
        pullsAttended: 1, pullsTotal: 2, pullPct: 50,
      });
      expect(pyrelia.firstSeenAt).toBe("2026-06-10T19:00:00.000Z");
      // Weeks from before she joined don't appear in her per-reset row either.
      expect(pyrelia.weeks).toEqual([{ start: "2026-06-10", attended: true, reports: 1, excused: false }]);
      // Aldric never appears in any log: no percentage, just the context count.
      const aldric = summaries.find((s) => s.character.name === "Aldric")!.attendance!;
      expect(aldric).toMatchObject({ raidsTotal: 2, raidsAttended: 0, raidsTracked: 0 });
      expect(aldric.firstSeenAt).toBeUndefined();

      const perf = (await repo.getCharacterPerformance("pyrelia"))!;
      expect(perf.attendance?.raidPct).toBe(100);
      expect(perf.reports[0].reportPulls).toBe(2);
      expect(perf.reports[0].rows).toHaveLength(1);
    });

    it("excuses a reset week so it stops counting against the markup", async () => {
      const repo = getSqliteRepo();
      // Second report in a NEW reset week (10 Jun) that Kazrak misses → 50%.
      await repo.saveWclReport(reportDraft, [fightDraft({ fightId: 1, actorName: "Pyrelia" })]);
      const before = (await repo.listCharacters()).find((s) => s.character.name === "Kazrak")!.attendance!;
      expect(before).toMatchObject({ raidsTracked: 2, raidPct: 50, weeksAttended: 1, weeksTracked: 2 });

      const kazrakId = (await repo.findCharacterByName("Kazrak"))!.id;
      const set = await repo.setAttendanceExemption(kazrakId, "2026-06-10", true);
      expect(set.ok).toBe(true);

      const after = (await repo.listCharacters()).find((s) => s.character.name === "Kazrak")!.attendance!;
      // The excused week drops out of both denominators; only the attended
      // week (3 Jun) remains counted → back to 100%.
      expect(after).toMatchObject({ raidsTracked: 1, raidPct: 100, weeksAttended: 1, weeksTracked: 1, weeksExcused: 1 });
      expect(after.weeks.find((w) => w.start === "2026-06-10")!.excused).toBe(true);

      // Toggling it back restores the miss.
      await repo.setAttendanceExemption(kazrakId, "2026-06-10", false);
      const restored = (await repo.listCharacters()).find((s) => s.character.name === "Kazrak")!.attendance!;
      expect(restored).toMatchObject({ raidPct: 50, weeksTracked: 2, weeksExcused: 0 });
    });

    it("links an alt to its main and surfaces the relationship both ways", async () => {
      const repo = getSqliteRepo();
      const main = (await repo.findCharacterByName("Kazrak"))!;
      const alt = await repo.createCharacter({
        name: "Kazbank", class: "Warrior", spec: "Fury", role: "Melee DPS",
        status: "alt", mainCharacterId: main.id,
      });
      expect(alt.ok).toBe(true);

      const summaries = await repo.listCharacters();
      expect(summaries.find((s) => s.character.name === "Kazbank")!.mainCharacterName).toBe("Kazrak");
      expect(summaries.find((s) => s.character.name === "Kazrak")!.altNames).toContain("Kazbank");
    });

    it("deletes a wrongful report import, recounting everything", async () => {
      const repo = getSqliteRepo();
      await repo.saveWclReport(reportDraft, [
        fightDraft({ fightId: 1, actorName: "Pyrelia" }),
        fightDraft({ fightId: 1, actorName: "Wrongpug" }),
      ]);
      expect(await repo.listWclReports()).toHaveLength(2);
      expect((await repo.listUntrackedLogPlayers()).some((p) => p.name === "Wrongpug")).toBe(true);

      const deleted = await repo.deleteWclReport(reportDraft.code);
      expect(deleted.ok).toBe(true);
      if (!deleted.ok) throw new Error("unreachable");
      expect(deleted.rowsRemoved).toBe(2);

      expect(await repo.listWclReports()).toHaveLength(1);
      expect((await repo.getCharacterPerformance("pyrelia"))!.reports).toHaveLength(0);
      expect((await repo.listUntrackedLogPlayers()).some((p) => p.name === "Wrongpug")).toBe(false);
      // Attendance denominator shrinks back with the report.
      const kazrak = (await repo.listCharacters()).find((s) => s.character.name === "Kazrak")!;
      expect(kazrak.attendance).toMatchObject({ raidsTotal: 1, raidPct: 100 });

      expect((await repo.deleteWclReport("nonexistent000")).ok).toBe(false);
    });

    it("purges demo data while keeping everything imported", async () => {
      const repo = getSqliteRepo();
      // Real content on top of the seed: a character, a session+award, a report
      // linked to a DEMO session (the link must survive as unlinked).
      await repo.createCharacter({ name: "Realguy", class: "Rogue", spec: "Combat", role: "Melee DPS", status: "main" });
      await repo.createRaidSessionWithAwards(
        { date: "2026-06-12", zones: ["Karazhan"], source: "gargul" },
        [{ rawWinnerName: "Realguy", itemId: 28773, itemName: "Gorehowl", awardedAt: "2026-06-12T21:00:00", offspec: false }],
      );
      await repo.saveWclReport(
        { ...reportDraft, raidSessionId: "rs-2026-06-04-ssc" },
        [fightDraft({ fightId: 1, actorName: "Realguy" })],
      );

      const removed = await repo.purgeDemoData();
      expect(removed.characters).toBe(13);
      expect(removed.raidSessions).toBe(4);
      expect(removed.wclReports).toBe(1);
      expect(removed.lootAwards).toBeGreaterThan(0);

      const characters = await repo.listCharacters();
      expect(characters.map((c) => c.character.name)).toEqual(["Realguy"]);
      expect(await repo.listRaidSessions()).toHaveLength(1);
      expect(await repo.listLootAwards()).toHaveLength(1);
      const reports = await repo.listWclReports();
      expect(reports).toHaveLength(1);
      expect(reports[0].report.code).toBe(reportDraft.code);
      expect(reports[0].session).toBeUndefined(); // demo-session link removed, report kept
      expect((await repo.getCharacterPerformance("realguy"))!.reports).toHaveLength(1);
      // The item cache is real TBC data — it stays.
      expect(await repo.getItem(28830)).toBeDefined();
      expect((await repo.getDashboard()).rosterSize).toBe(1);
    });

    it("rejects an unknown raid session link and empty reports", async () => {
      const repo = getSqliteRepo();
      const badSession = await repo.saveWclReport(
        { ...reportDraft, raidSessionId: "rs-nope" },
        [fightDraft({ fightId: 1, actorName: "Pyrelia" })],
      );
      expect(badSession.ok).toBe(false);
      const empty = await repo.saveWclReport(reportDraft, []);
      expect(empty.ok).toBe(false);
      expect(await repo.listWclReports()).toHaveLength(1); // only the seed report
    });

    it("scopes a comparison column to the selected logs", async () => {
      const repo = getSqliteRepo();
      // Kazrak is in the seed report; give him a second one (newer).
      await repo.saveWclReport(reportDraft, [
        fightDraft({ fightId: 1, actorName: "Kazrak", parsePercent: 10, amount: 100 }),
      ]);

      const all = await repo.getComparison(["kazrak"]);
      const kAll = all.characters[0];
      // Picker options: both reports, newest first.
      expect(kAll.availableReports.map((r) => r.code)).toEqual(["TESTreport000001", "SEEDsscProgress1"]);
      expect(kAll.reports).toBe(2);

      // Filter to just the new report — only its pull feeds the column.
      const filtered = await repo.getComparison(["kazrak"], { kazrak: ["TESTreport000001"] });
      const kFilt = filtered.characters[0];
      expect(kFilt.reports).toBe(1);
      expect(kFilt.selectedReportCodes).toEqual(["TESTreport000001"]);
      expect(kFilt.fights).toBe(1);
      // The picker options don't shrink when a subset is active.
      expect(kFilt.availableReports).toHaveLength(2);

      // An unknown code in the filter falls back to all logs (never blank).
      const bogus = await repo.getComparison(["kazrak"], { kazrak: ["does-not-exist"] });
      expect(bogus.characters[0].reports).toBe(2);
    });
  });

  describe("comments + comparison", () => {
    it("adds, lists newest-first and deletes character comments", async () => {
      const repo = getSqliteRepo();
      const kazrak = (await repo.findCharacterByName("Kazrak"))!;
      const before = (await repo.getCharacterBundle("kazrak"))!.comments.length;

      const added = await repo.addCharacterComment({
        characterId: kazrak.id,
        category: "attendance",
        body: "Will miss next reset",
        author: "Aldric",
      });
      expect(added.ok).toBe(true);
      if (!added.ok) throw new Error("unreachable");

      const bundle = (await repo.getCharacterBundle("kazrak"))!;
      expect(bundle.comments.length).toBe(before + 1);
      expect(bundle.comments[0].id).toBe(added.comment.id); // newest first
      expect(bundle.comments[0].category).toBe("attendance");
      expect(bundle.comments[0].author).toBe("Aldric");

      expect(await repo.deleteCharacterComment(added.comment.id)).toBe(true);
      expect(await repo.deleteCharacterComment(added.comment.id)).toBe(false); // already gone
      expect((await repo.getCharacterBundle("kazrak"))!.comments.length).toBe(before);
    });

    it("rejects a comment on an unknown character", async () => {
      const repo = getSqliteRepo();
      const res = await repo.addCharacterComment({ characterId: "chr_missing", category: "note", body: "x" });
      expect(res.ok).toBe(false);
    });

    it("removes a character's comments on delete so the store stays valid", async () => {
      const repo = getSqliteRepo();
      const velora = (await repo.findCharacterByName("Velora"))!;
      await repo.addCharacterComment({ characterId: velora.id, category: "note", body: "test note" });
      expect((await repo.deleteCharacter(velora.id)).ok).toBe(true);
      // A dangling comment would make the next load throw — listing must succeed.
      expect((await repo.listCharacters()).some((c) => c.character.name === "Velora")).toBe(false);
    });

    it("compares up to 4 characters, dropping unknowns and preserving order", async () => {
      const repo = getSqliteRepo();
      const view = await repo.getComparison([
        "morgrave", "kazrak", "nope", "tidemar", "velora", "thrainn",
      ]);
      // Unknown "nope" dropped; capped at 4 before reaching Thrainn.
      expect(view.characters.map((c) => c.character.name)).toEqual([
        "Morgrave", "Kazrak", "Tidemar", "Velora",
      ]);

      const morgrave = view.characters[0];
      expect(morgrave.hasLogs).toBe(true);
      expect(morgrave.output).toBeGreaterThan(0);
      expect(morgrave.outputUnit).toBe("dps");
      // Morgrave keeps Curse of the Elements up in the seed; it rides along.
      expect(morgrave.upkeep.some((u) => u.name === "Curse of the Elements")).toBe(true);
      expect(morgrave.comments.length).toBeGreaterThan(0); // seeded officer notes
      // Boss debuff sorts to the top of the unioned track list.
      expect(view.upkeepTracks[0].kind).toBe("debuff");
    });

    it("dedupes repeated slugs in a comparison request", async () => {
      const repo = getSqliteRepo();
      const view = await repo.getComparison(["kazrak", "kazrak", "morgrave"]);
      expect(view.characters.map((c) => c.character.name)).toEqual(["Kazrak", "Morgrave"]);
    });
  });
});
