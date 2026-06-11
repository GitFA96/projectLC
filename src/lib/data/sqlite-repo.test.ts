import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { getSqliteRepo } from "@/lib/data/sqlite-repo";
import { loadSeedStore } from "@/lib/data/seed-data";
import type { GearSetDraft } from "@/lib/data/repo";

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
});
