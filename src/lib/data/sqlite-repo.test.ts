import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { getSqliteRepo } from "@/lib/data/sqlite-repo";
import { loadSeedStore } from "@/lib/data/seed-data";
import type { GearSetDraft, WclPlayerFightDraft } from "@/lib/data/repo";
import { TRACKED_AURA_NAMES } from "@/lib/wcl/class-tracks";

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

  describe("pinned current-gear slots", () => {
    /** Thrainn wears the Felsteel Helm; his P1 list wants Helm of the Fallen Defender. */
    const FELSTEEL_HELM = 23517;
    const TIER_HELM = 29761;

    it("overrides the imported slot everywhere the loot council reads it", async () => {
      const repo = getSqliteRepo();
      const thrainn = (await repo.findCharacterByName("Thrainn"))!;
      const before = (await repo.getCharacterBundle("thrainn"))!;
      const p1Before = before.wishlists.find((w) => w.phase === 1)!;
      expect(p1Before.rows.find((r) => r.slot === "head")!.state).toBe("open");

      const pinned = await repo.setCurrentGearOverride(
        thrainn.id,
        { slot: "head", itemId: TIER_HELM, itemName: "Helm of the Fallen Defender" },
        "logs",
      );
      expect(pinned.ok).toBe(true);

      const after = (await repo.getCharacterBundle("thrainn"))!;
      // The wishlist row closes...
      const p1After = after.wishlists.find((w) => w.phase === 1)!;
      expect(p1After.rows.find((r) => r.slot === "head")!.state).toBe("equipped");
      expect(p1After.completion.satisfied).toBe(p1Before.completion.satisfied + 1);
      // ...current gear reads the pin, while the import is kept intact for undo...
      expect(after.current!.slots.find((s) => s.slot === "head")!.itemId).toBe(TIER_HELM);
      expect(after.importedCurrent!.slots.find((s) => s.slot === "head")!.itemId).toBe(FELSTEEL_HELM);
      expect(after.currentOverrides.map((o) => o.item.slot)).toEqual(["head"]);
      // ...and contention agrees he no longer needs it.
      const contention = (await repo.getItemContention(TIER_HELM))!;
      expect(contention.wishers.find((w) => w.character.id === thrainn.id)!.satisfied).toBe(true);
    });

    it("hands the slot back to the import when cleared", async () => {
      const repo = getSqliteRepo();
      const thrainn = (await repo.findCharacterByName("Thrainn"))!;
      await repo.setCurrentGearOverride(
        thrainn.id,
        { slot: "head", itemId: TIER_HELM, itemName: "Helm of the Fallen Defender" },
        "logs",
      );

      expect(await repo.clearCurrentGearOverride(thrainn.id, "head")).toBe(true);
      expect(await repo.clearCurrentGearOverride(thrainn.id, "head")).toBe(false); // already gone

      const bundle = (await repo.getCharacterBundle("thrainn"))!;
      expect(bundle.current!.slots.find((s) => s.slot === "head")!.itemId).toBe(FELSTEEL_HELM);
      expect(bundle.currentOverrides).toEqual([]);
    });

    it("stands alone as current gear for a character who never imported a set", async () => {
      const repo = getSqliteRepo();
      const created = await repo.createCharacter({
        name: "Zugzug",
        class: "Warrior",
        spec: "Fury",
        role: "Melee DPS",
        status: "main",
      });
      if (!created.ok) throw new Error(created.error);
      expect((await repo.getCharacterBundle("zugzug"))!.current).toBeUndefined();

      await repo.setCurrentGearOverride(
        created.character.id,
        { slot: "head", itemId: TIER_HELM, itemName: "Helm of the Fallen Defender" },
        "logs",
      );
      const bundle = (await repo.getCharacterBundle("zugzug"))!;
      expect(bundle.current!.slots).toEqual([
        { slot: "head", itemId: TIER_HELM, itemName: "Helm of the Fallen Defender" },
      ]);
      expect(bundle.importedCurrent).toBeUndefined();
      expect(bundle.summary.hasCurrentGear).toBe(true);

      expect(await repo.clearCurrentGearOverrides(created.character.id)).toBe(1);
      expect((await repo.getCharacterBundle("zugzug"))!.current).toBeUndefined();
    });

    it("writes many slots at once, leaving hand-set ones alone", async () => {
      const repo = getSqliteRepo();
      const thrainn = (await repo.findCharacterByName("Thrainn"))!;
      // An officer's deliberate correction, made before the bulk pass.
      await repo.setCurrentGearOverride(
        thrainn.id,
        { slot: "head", itemId: 111, itemName: "Hand-set Helm" },
        "manual",
      );

      const bulk = await repo.setCurrentGearOverrides(
        thrainn.id,
        [
          { slot: "head", itemId: 222, itemName: "Logged Helm" },
          { slot: "feet", itemId: 333, itemName: "Logged Boots" },
          { slot: "waist", itemId: 444, itemName: "Logged Belt" },
        ],
        "logs",
      );
      expect(bulk).toMatchObject({ ok: true, written: 2, kept: 1 });

      const bundle = (await repo.getCharacterBundle("thrainn"))!;
      const bySlot = new Map(bundle.current!.slots.map((s) => [s.slot, s]));
      // The hand-set slot survived the sweep; the other two were filled.
      expect(bySlot.get("head")!.itemId).toBe(111);
      expect(bySlot.get("feet")!.itemId).toBe(333);
      expect(bySlot.get("waist")!.itemId).toBe(444);
    });

    it("overwrites hand-set slots when the caller asks for a replace", async () => {
      const repo = getSqliteRepo();
      const thrainn = (await repo.findCharacterByName("Thrainn"))!;
      await repo.setCurrentGearOverride(
        thrainn.id,
        { slot: "head", itemId: 111, itemName: "Hand-set Helm" },
        "manual",
      );
      const bulk = await repo.setCurrentGearOverrides(
        thrainn.id,
        [{ slot: "head", itemId: 222, itemName: "Logged Helm" }],
        "logs",
        { replace: true },
      );
      expect(bulk).toMatchObject({ ok: true, written: 1, kept: 0 });

      const bundle = (await repo.getCharacterBundle("thrainn"))!;
      expect(bundle.current!.slots.find((s) => s.slot === "head")!.itemId).toBe(222);
      expect(bundle.currentOverrides.find((o) => o.item.slot === "head")!.source).toBe("logs");
    });

    it("records where a pinned slot was picked from", async () => {
      const repo = getSqliteRepo();
      const thrainn = (await repo.findCharacterByName("Thrainn"))!;
      // Gear won on an unlogged night has no log to validate against — the
      // manual source is how it gets recorded at all.
      const manual = await repo.setCurrentGearOverride(
        thrainn.id,
        { slot: "feet", itemId: 28747, itemName: "Battlescar Boots" },
        "manual",
      );
      expect(manual).toMatchObject({ ok: true });
      if (!manual.ok) throw new Error("unreachable");
      expect(manual.override.source).toBe("manual");

      const bundle = (await repo.getCharacterBundle("thrainn"))!;
      expect(bundle.currentOverrides.find((o) => o.item.slot === "feet")?.source).toBe("manual");
    });

    it("teaches the item cache whatever a hand-picked slot knew", async () => {
      const repo = getSqliteRepo();
      const thrainn = (await repo.findCharacterByName("Thrainn"))!;
      expect(await repo.getItem(99123)).toBeUndefined();
      await repo.setCurrentGearOverride(
        thrainn.id,
        { slot: "waist", itemId: 99123, itemName: "Belt of Testing" },
        "manual",
      );
      expect(await repo.getItem(99123)).toMatchObject({ name: "Belt of Testing", slot: "waist" });
    });

    it("goes with the character when one is deleted", async () => {
      const repo = getSqliteRepo();
      const thrainn = (await repo.findCharacterByName("Thrainn"))!;
      await repo.setCurrentGearOverride(
        thrainn.id,
        { slot: "head", itemId: TIER_HELM, itemName: "Helm of the Fallen Defender" },
        "logs",
      );
      expect((await repo.deleteCharacter(thrainn.id)).ok).toBe(true);
      // A dangling override would fail validateStore on the next model rebuild.
      expect(await repo.getCharacterBundle("thrainn")).toBeNull();
    });

    it("keeps the off-spec kit out of everything loot is judged on", async () => {
      const repo = getSqliteRepo();
      const thrainn = (await repo.findCharacterByName("Thrainn"))!;
      const OFFSPEC_HELM = 28963;

      // Same slot, both kits — the whole point of the second set.
      await repo.setCurrentGearOverride(
        thrainn.id,
        { slot: "head", itemId: OFFSPEC_HELM, itemName: "Warbringer Battle-Helm" },
        "logs",
        "off",
      );
      const bundle = (await repo.getCharacterBundle("thrainn"))!;

      expect(bundle.offSpecCurrent!.slots).toEqual([
        { slot: "head", itemId: OFFSPEC_HELM, itemName: "Warbringer Battle-Helm" },
      ]);
      expect(bundle.offSpecOverrides.map((o) => o.item.slot)).toEqual(["head"]);
      // The main-spec answer is untouched: still the imported helm, no pins...
      expect(bundle.current!.slots.find((s) => s.slot === "head")!.itemId).toBe(FELSTEEL_HELM);
      expect(bundle.currentOverrides).toEqual([]);
      // ...so his P1 head row is still open and he still contends for the tier helm.
      expect(
        bundle.wishlists.find((w) => w.phase === 1)!.rows.find((r) => r.slot === "head")!.state,
      ).toBe("open");
      const contention = (await repo.getItemContention(TIER_HELM))!;
      expect(contention.wishers.find((w) => w.character.id === thrainn.id)!.satisfied).toBe(false);
    });

    it("clears one kit without touching the other", async () => {
      const repo = getSqliteRepo();
      const thrainn = (await repo.findCharacterByName("Thrainn"))!;
      await repo.setCurrentGearOverride(
        thrainn.id,
        { slot: "head", itemId: TIER_HELM, itemName: "Helm of the Fallen Defender" },
        "logs",
      );
      await repo.setCurrentGearOverride(
        thrainn.id,
        { slot: "head", itemId: 28963, itemName: "Warbringer Battle-Helm" },
        "logs",
        "off",
      );

      // A main-spec clear names the main-spec row only.
      expect(await repo.clearCurrentGearOverride(thrainn.id, "head")).toBe(true);
      expect(await repo.clearCurrentGearOverride(thrainn.id, "head")).toBe(false);
      const afterMain = (await repo.getCharacterBundle("thrainn"))!;
      expect(afterMain.currentOverrides).toEqual([]);
      expect(afterMain.offSpecOverrides).toHaveLength(1);

      expect(await repo.clearCurrentGearOverrides(thrainn.id, "off")).toBe(1);
      const afterOff = (await repo.getCharacterBundle("thrainn"))!;
      expect(afterOff.offSpecOverrides).toEqual([]);
      expect(afterOff.offSpecCurrent).toBeUndefined();
    });
  });

  describe("alts contending is the council's call", () => {
    /** An alt and a main who both want the same drop. */
    async function twoWishers() {
      const repo = getSqliteRepo();
      const roster = await repo.listCharacters();
      const main = roster.find((c) => c.character.status === "main")!.character;
      // Asserted rather than guarded: if the seed ever loses its alt these
      // tests must fail loudly, not quietly stop testing anything.
      const alt = roster.find((c) => c.character.status === "alt")?.character;
      expect(alt, "the seed roster needs an alt for these tests").toBeDefined();
      return { repo, main, alt: alt! };
    }

    it("leaves alts off the board by default, named beneath it", async () => {
      const { repo, main, alt } = await twoWishers();
      await repo.upsertGearSet(wishlistDraft(main.id, 3, 34333), { replace: true });
      await repo.upsertGearSet(wishlistDraft(alt.id, 3, 34333), { replace: true });

      const contention = await repo.getItemContention(34333);
      expect(contention!.wishers.map((w) => w.character.id)).toContain(main.id);
      expect(contention!.wishers.map((w) => w.character.id)).not.toContain(alt.id);
      expect(contention!.altWishers).toContain(alt.name);
    });

    it("ranks them among the mains once the council opts in", async () => {
      const { repo, main, alt } = await twoWishers();
      await repo.upsertGearSet(wishlistDraft(main.id, 3, 34333), { replace: true });
      await repo.upsertGearSet(wishlistDraft(alt.id, 3, 34333), { replace: true });

      await repo.setGuildPolicy({ loot: { altsContend: true } });
      const contention = await repo.getItemContention(34333);
      expect(contention!.wishers.map((w) => w.character.id)).toContain(alt.id);
      // Named beneath the board only while they're excluded from it.
      expect(contention!.altWishers).not.toContain(alt.name);
      // And the standing multiplier is what puts them behind a main.
      const altRow = contention!.wishers.find((w) => w.character.id === alt.id);
      expect(altRow!.priority?.adjustments.some((a) => a.key === "standing")).toBe(true);
    });
  });

  describe("award decision snapshot", () => {
    /** A contested item with a roster wisher, ready to award. */
    async function contested() {
      const repo = getSqliteRepo();
      const roster = await repo.listCharacters();
      const winner = roster.find((c) => c.character.status === "main")!.character;
      await repo.upsertGearSet(wishlistDraft(winner.id, 3, 34333), { replace: true });
      const session = (await repo.listRaidSessions())[0];
      return { repo, winner, session };
    }

    const award = (winnerId: string) => ({
      itemId: 34333,
      itemName: "Contested Thing",
      rawWinnerName: "x",
      characterId: winnerId,
      external: false,
      offspec: false,
    });

    it("freezes the arithmetic when the award comes from the board", async () => {
      const { repo, winner, session } = await contested();
      const result = await repo.addLootAward(session.id, {
        ...award(winner.id),
        rawWinnerName: winner.name,
      });
      expect(result.ok).toBe(true);

      const decision = result.ok ? result.award.decision : undefined;
      expect(decision).toBeDefined();
      expect(decision!.rank).toBe(1);
      expect(decision!.contenders).toBeGreaterThan(0);
      expect(decision!.weights).toEqual({
        attendance: 35,
        lootDebt: 30,
        performance: 20,
        preparation: 15,
      });
      // The factors carry their own arithmetic, so the note reads without
      // recomputing anything.
      expect(decision!.factors.map((f) => f.label)).toContain("Attendance");
    });

    it("stays frozen when the council changes the weights afterwards", async () => {
      const { repo, winner, session } = await contested();
      const result = await repo.addLootAward(session.id, {
        ...award(winner.id),
        rawWinnerName: winner.name,
      });
      const before = result.ok ? result.award.decision : undefined;

      await repo.setGuildPolicy({ weights: { attendance: 5, lootDebt: 90 } });

      const stored = (await repo.listLootAwards()).find((a) => a.award.itemId === 34333);
      // THE guarantee: June's decision still reads in June's terms.
      expect(stored!.award.decision!.weights).toEqual(before!.weights);
      expect(stored!.award.decision!.weights.attendance).toBe(35);
    });

    it("records no snapshot for an off-roster destination", async () => {
      const { repo, session } = await contested();
      const result = await repo.addLootAward(session.id, {
        itemId: 34333,
        itemName: "Contested Thing",
        rawWinnerName: "Disenchanted",
        characterId: null,
        external: true,
        offspec: false,
      });
      // Absent, not zero: the award never came from the ranking.
      expect(result.ok && result.award.decision).toBeUndefined();
    });

    it("records no snapshot when the winner wasn't on the board", async () => {
      const repo = getSqliteRepo();
      const roster = await repo.listCharacters();
      const nobody = roster.find((c) => c.character.status === "main")!.character;
      const session = (await repo.listRaidSessions())[0];
      // Item nobody wishlisted — there is no board to freeze.
      const result = await repo.addLootAward(session.id, {
        itemId: 999999,
        itemName: "Uncontested",
        rawWinnerName: nobody.name,
        characterId: nobody.id,
        external: false,
        offspec: false,
      });
      expect(result.ok && result.award.decision).toBeUndefined();
    });

    it("survives a round trip through the database", async () => {
      const { repo, winner, session } = await contested();
      await repo.addLootAward(session.id, { ...award(winner.id), rawWinnerName: winner.name });
      const stored = (await repo.listLootAwards()).find((a) => a.award.itemId === 34333);
      expect(stored!.award.decision!.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(stored!.award.decision!.factors.length).toBeGreaterThan(0);
    });
  });

  describe("wishlist alternatives", () => {
    async function aCharacter() {
      const repo = getSqliteRepo();
      const roster = await repo.listCharacters();
      return { repo, character: roster[0].character };
    }

    it("stores fallbacks in the order given, ranked from 1", async () => {
      const { repo, character } = await aCharacter();
      await repo.setWishlistAlternatives({
        characterId: character.id,
        phase: 3,
        slot: "waist",
        items: [{ itemId: 300, itemName: "Second" }, { itemId: 400, itemName: "Third" }],
      });
      const alts = await repo.listWishlistAlternatives();
      expect(alts.map((a) => [a.itemId, a.rank])).toEqual([
        [300, 1],
        [400, 2],
      ]);
    });

    it("replaces the whole slot, renumbering so no gap survives", async () => {
      const { repo, character } = await aCharacter();
      const set = (items: number[]) =>
        repo.setWishlistAlternatives({
          characterId: character.id,
          phase: 3,
          slot: "waist",
          items: items.map((itemId) => ({ itemId })),
        });

      await set([300, 400, 500]);
      // Drop the middle one: what was 3rd must become 2nd, not stay 3rd.
      await set([300, 500]);
      const alts = await repo.listWishlistAlternatives();
      expect(alts.map((a) => [a.itemId, a.rank])).toEqual([
        [300, 1],
        [500, 2],
      ]);
    });

    it("reorders on save, because rank comes from position", async () => {
      const { repo, character } = await aCharacter();
      const set = (items: number[]) =>
        repo.setWishlistAlternatives({
          characterId: character.id,
          phase: 3,
          slot: "waist",
          items: items.map((itemId) => ({ itemId })),
        });
      await set([300, 400]);
      await set([400, 300]);
      const alts = await repo.listWishlistAlternatives();
      expect(alts.find((a) => a.itemId === 400)?.rank).toBe(1);
      expect(alts.find((a) => a.itemId === 300)?.rank).toBe(2);
    });

    it("refuses to give one item two ranks", async () => {
      const { repo, character } = await aCharacter();
      await repo.setWishlistAlternatives({
        characterId: character.id,
        phase: 3,
        slot: "waist",
        items: [{ itemId: 300 }, { itemId: 300 }],
      });
      expect(await repo.listWishlistAlternatives()).toHaveLength(1);
    });

    it("keeps phases and slots apart", async () => {
      const { repo, character } = await aCharacter();
      const base = { characterId: character.id, items: [{ itemId: 300 }] };
      await repo.setWishlistAlternatives({ ...base, phase: 3, slot: "waist" });
      await repo.setWishlistAlternatives({ ...base, phase: 4, slot: "waist" });
      await repo.setWishlistAlternatives({ ...base, phase: 3, slot: "head" });
      expect(await repo.listWishlistAlternatives()).toHaveLength(3);
    });

    it("rejects an unknown character or phase", async () => {
      const { repo, character } = await aCharacter();
      expect(
        await repo.setWishlistAlternatives({ characterId: "nope", phase: 3, slot: "waist", items: [] }),
      ).toMatchObject({ ok: false });
      expect(
        await repo.setWishlistAlternatives({ characterId: character.id, phase: 9, slot: "waist", items: [] }),
      ).toMatchObject({ ok: false });
    });

    it("reaches the character's wishlist rows", async () => {
      const { repo, character } = await aCharacter();
      await repo.upsertGearSet(wishlistDraft(character.id, 3, 34333), { replace: true });
      await repo.setWishlistAlternatives({
        characterId: character.id,
        phase: 3,
        slot: "head",
        items: [{ itemId: 30048, itemName: "Fallback" }],
      });
      const bundle = await repo.getCharacterBundle(character.name.toLowerCase());
      const p3 = bundle!.wishlists.find((w) => w.phase === 3);
      const head = p3!.rows.find((r) => r.slot === "head");
      expect(head!.alternatives.map((a) => a.itemId)).toEqual([30048]);
    });
  });

  describe("class guides", () => {
    it("starts empty — the app ships no opinion about any class", async () => {
      const repo = getSqliteRepo();
      expect(await repo.listClassGuides()).toEqual([]);
    });

    it("stores a class guide and a spec guide side by side", async () => {
      const repo = getSqliteRepo();
      await repo.setClassGuide({
        wowClass: "Warrior",
        spec: "",
        body: "Show up enchanted.",
        sources: ["https://www.wowhead.com/tbc/class/warrior"],
        author: "Fredrik",
      });
      await repo.setClassGuide({
        wowClass: "Warrior",
        spec: "Fury",
        body: "Haste potion with Bloodlust.",
        sources: [],
      });

      const guides = await repo.listClassGuides();
      expect(guides).toHaveLength(2);
      const shared = guides.find((g) => g.spec === "");
      expect(shared).toMatchObject({ body: "Show up enchanted.", author: "Fredrik" });
      expect(shared!.sources).toEqual(["https://www.wowhead.com/tbc/class/warrior"]);
      expect(guides.find((g) => g.spec === "Fury")?.body).toBe("Haste potion with Bloodlust.");
    });

    it("overwrites in place rather than stacking copies", async () => {
      const repo = getSqliteRepo();
      await repo.setClassGuide({ wowClass: "Mage", spec: "Fire", body: "First.", sources: [] });
      await repo.setClassGuide({ wowClass: "Mage", spec: "Fire", body: "Second.", sources: [] });
      const guides = await repo.listClassGuides();
      expect(guides).toHaveLength(1);
      expect(guides[0].body).toBe("Second.");
    });

    it("deletes on an empty body — silence and 'nothing to say' are different claims", async () => {
      const repo = getSqliteRepo();
      await repo.setClassGuide({ wowClass: "Rogue", spec: "", body: "Something.", sources: [] });
      expect(await repo.listClassGuides()).toHaveLength(1);

      const result = await repo.setClassGuide({ wowClass: "Rogue", spec: "", body: "   ", sources: [] });
      expect(result).toEqual({ ok: true, deleted: true });
      expect(await repo.listClassGuides()).toEqual([]);
    });

    it("refuses a class or spec the game doesn't have", async () => {
      const repo = getSqliteRepo();
      expect(await repo.setClassGuide({ wowClass: "Death Knight", spec: "", body: "x", sources: [] }))
        .toMatchObject({ ok: false });
      expect(await repo.setClassGuide({ wowClass: "Warrior", spec: "Frost", body: "x", sources: [] }))
        .toMatchObject({ ok: false });
    });

    it("drops blank source lines rather than storing empties", async () => {
      const repo = getSqliteRepo();
      await repo.setClassGuide({
        wowClass: "Priest",
        spec: "Shadow",
        body: "x",
        sources: ["  ", "https://example.com/a", ""],
      });
      expect((await repo.listClassGuides())[0].sources).toEqual(["https://example.com/a"]);
    });
  });

  describe("editable loot policy", () => {
    it("seeds every item's spec priority from the guild's sheet", async () => {
      const repo = getSqliteRepo();
      const rule = await repo.getItemPriorityRule(0, "Madness of the Betrayer");
      expect(rule).toMatchObject({ origin: "sheet", source: "The Illidari Council" });
      expect(rule!.tiers.map((t) => t.tags)).toEqual([
        ["Hunter"],
        ["DPS Warrior"],
        ["MS"],
        ["OS"],
      ]);
    });

    it("serves the seeded sheet as a whole document", async () => {
      const repo = getSqliteRepo();
      const sheet = await repo.getPrioritySheet(3);
      expect(sheet.origin).toBe("seed");
      expect(sheet.phase).toBe(3);
      expect(sheet.ruleCount).toBeGreaterThan(100);
      expect(sheet.sections.map((s) => s.source)).toContain("The Illidari Council");
    });

    it("has no sheet for a phase nobody has written one for", async () => {
      const repo = getSqliteRepo();
      const sheet = await repo.getPrioritySheet(4);
      expect(sheet.origin).toBe("none");
      expect(sheet.ruleCount).toBe(0);
      expect(sheet.sections).toEqual([]);
    });

    it("takes a pasted sheet and ranks against it immediately", async () => {
      const repo = getSqliteRepo();
      const markdown = [
        "### Zul'Aman Trash",
        "| Item | Priority | Slot | Notes |",
        "|---|---|---|---|",
        "| Amani Punisher | Rogue > DPS Warrior > MS > OS | Main Hand | |",
      ].join("\n");

      const saved = await repo.setPrioritySheet({ phase: 4, markdown, author: "Fredrik" });
      expect(saved).toEqual({ ok: true, ruleCount: 1 });

      // THE point of this feature: the read model must see the new sheet
      // without a process restart. The parse used to be cached at module
      // scope, where bumping data_version could not reach it.
      const sheet = await repo.getPrioritySheet(4);
      expect(sheet.origin).toBe("pasted");
      expect(sheet.author).toBe("Fredrik");
      expect(sheet.ruleCount).toBe(1);
      expect(sheet.sections[0].rows[0].itemName).toBe("Amani Punisher");
    });

    it("refuses a paste that parses to nothing rather than storing silence", async () => {
      const repo = getSqliteRepo();
      const before = await repo.getPrioritySheet(3);
      const result = await repo.setPrioritySheet({ phase: 3, markdown: "just some prose" });
      expect(result.ok).toBe(false);
      // The working sheet is untouched.
      expect((await repo.getPrioritySheet(3)).ruleCount).toBe(before.ruleCount);
    });

    it("reverts to the shipped sheet when a pasted one is dropped", async () => {
      const repo = getSqliteRepo();
      const seeded = await repo.getPrioritySheet(3);
      const markdown = [
        "### Replaced",
        "| Item | Priority | Slot | Notes |",
        "|---|---|---|---|",
        "| Only Item | MS > OS | Back | |",
      ].join("\n");

      await repo.setPrioritySheet({ phase: 3, markdown });
      expect((await repo.getPrioritySheet(3)).ruleCount).toBe(1);

      await repo.deletePrioritySheet(3);
      const back = await repo.getPrioritySheet(3);
      expect(back.origin).toBe("seed");
      expect(back.ruleCount).toBe(seeded.ruleCount);
    });

    it("keeps per-item officer edits on top of a replaced sheet", async () => {
      const repo = getSqliteRepo();
      await repo.setItemPriorityRule("Amani Punisher", "Enhancement > MS");
      const markdown = [
        "### Zul'Aman Trash",
        "| Item | Priority | Slot | Notes |",
        "|---|---|---|---|",
        "| Amani Punisher | Rogue > MS > OS | Main Hand | |",
      ].join("\n");
      await repo.setPrioritySheet({ phase: 4, markdown });

      const sheet = await repo.getPrioritySheet(4);
      const row = sheet.sections[0].rows[0];
      expect(row.origin).toBe("officer");
      expect(row.chain).toBe("Enhancement > MS");
      expect(row.sheetChain).toBe("Rogue > MS > OS");
    });

    it("lets an officer override a chain and hand it back again", async () => {
      const repo = getSqliteRepo();
      const saved = await repo.setItemPriorityRule(
        "Madness of the Betrayer",
        "Rogue > Hunter > MS > OS",
      );
      expect(saved.ok).toBe(true);

      const edited = await repo.getItemPriorityRule(0, "Madness of the Betrayer");
      expect(edited).toMatchObject({ origin: "officer", chain: "Rogue > Hunter > MS > OS" });

      // An empty chain is how the sheet takes the item back.
      expect((await repo.setItemPriorityRule("Madness of the Betrayer", "")).ok).toBe(true);
      expect((await repo.getItemPriorityRule(0, "Madness of the Betrayer"))!.origin).toBe("sheet");
    });

    it("matches an override by name however it's punctuated", async () => {
      const repo = getSqliteRepo();
      await repo.setItemPriorityRule("kazrogals hardened heart", "Prot Warrior > MS > OS");
      // The sheet spells it "Kaz'rogal's Hardened Heart" — same item.
      const rule = await repo.getItemPriorityRule(0, "Kaz'rogal's Hardened Heart");
      expect(rule).toMatchObject({ origin: "officer" });
    });

    it("rejects an override with nothing to match on", async () => {
      const repo = getSqliteRepo();
      expect(await repo.setItemPriorityRule("   ", "Rogue > MS")).toMatchObject({ ok: false });
      expect(await repo.setItemPriorityRule("???", "Rogue > MS")).toMatchObject({ ok: false });
    });

    it("stores the council's weighting and defaults the rest", async () => {
      const repo = getSqliteRepo();
      expect(await repo.getLootPriorityWeights()).toMatchObject({ attendance: 35, lootDebt: 30 });

      expect((await repo.setGuildPolicy({ weights: { attendance: 50 } })).ok).toBe(true);
      const weights = await repo.getLootPriorityWeights();
      expect(weights.attendance).toBe(50);
      // Untouched factors keep the code default rather than dropping to zero.
      expect(weights.performance).toBe(20);
    });

    it("refuses a weighting where nothing counts", async () => {
      const repo = getSqliteRepo();
      const result = await repo.setGuildPolicy({
        weights: { attendance: 0, lootDebt: 0, performance: 0, preparation: 0 },
      });
      expect(result.ok).toBe(false);
    });

    it("defaults every policy group until an officer sets one", async () => {
      const repo = getSqliteRepo();
      const policy = await repo.getGuildPolicy();
      expect(policy.standing).toEqual({ main: 1, trial: 1, alt: 0.7, inactive: 0.4, pug: 0.25 });
      expect(policy.attendance).toEqual({ recentRaids: 10, weeks: 8 });
      expect(policy.preparation.coverage).toBe("any");
      expect(policy.performance.parseMetric).toBe("all");
    });

    it("stores the parse metric and rejects anything that isn't one", async () => {
      const repo = getSqliteRepo();
      await repo.setGuildPolicy({ performance: { parseMetric: "bracket" } });
      expect((await repo.getGuildPolicy()).performance.parseMetric).toBe("bracket");

      await repo.setGuildPolicy({
        performance: { parseMetric: "median" as unknown as "all" },
      });
      // Junk is discarded, and the group falls back rather than half-saving.
      expect((await repo.getGuildPolicy()).performance.parseMetric).toBe("all");
    });

    it("stores the coverage standard and rejects anything that isn't one", async () => {
      const repo = getSqliteRepo();
      await repo.setGuildPolicy({ preparation: { coverage: "full" } });
      expect((await repo.getGuildPolicy()).preparation.coverage).toBe("full");

      await repo.setGuildPolicy({
        preparation: { coverage: "sometimes" as unknown as "any" },
      });
      expect((await repo.getGuildPolicy()).preparation.coverage).toBe("any");
    });

    it("carries a policy saved under the boolean this replaced", async () => {
      // `preparation.elixirCounts` was a checkbox: false meant "only a flask
      // counts". An officer who ticked it made a real decision, so it lands on
      // the mode that means the same thing rather than silently defaulting.
      const repo = getSqliteRepo();
      await repo.setGuildPolicy({
        preparation: { elixirCounts: false } as unknown as { coverage: "any" },
      });
      expect((await repo.getGuildPolicy()).preparation.coverage).toBe("flaskOnly");

      await repo.setGuildPolicy({
        preparation: { elixirCounts: true } as unknown as { coverage: "any" },
      });
      expect((await repo.getGuildPolicy()).preparation.coverage).toBe("any");
    });

    it("saves one policy group without disturbing another", async () => {
      const repo = getSqliteRepo();
      await repo.setGuildPolicy({ standing: { alt: 0.9 } });
      await repo.setGuildPolicy({ standing: { alt: 0.9 }, attendance: { recentRaids: 6 } });

      const policy = await repo.getGuildPolicy();
      expect(policy.standing.alt).toBe(0.9);
      expect(policy.standing.main).toBe(1);
      expect(policy.attendance.recentRaids).toBe(6);
      expect(policy.attendance.weeks).toBe(8);
    });

    it("discards junk rather than letting it reach a ranking", async () => {
      const repo = getSqliteRepo();
      await repo.setGuildPolicy({
        // Out of range, wrong type, and a multiplier of zero — which would be a
        // ban rather than a ranking.
        weights: { attendance: 500 },
        standing: { alt: 0, pug: "nope" as unknown as number },
      } as never);
      const policy = await repo.getGuildPolicy();
      expect(policy.weights.attendance).toBe(35);
      expect(policy.standing.alt).toBe(0.7);
      expect(policy.standing.pug).toBe(0.25);
    });

    it("an alt multiplier the council raised actually moves the score", async () => {
      const repo = getSqliteRepo();
      const before = await repo.getGuildPolicy();
      expect(before.standing.alt).toBe(0.7);

      await repo.setGuildPolicy({ standing: { alt: 1 } });
      expect((await repo.getGuildPolicy()).standing.alt).toBe(1);
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

    it("records a second spec they raid in, and clears it again", async () => {
      const repo = getSqliteRepo();
      const thrainn = (await repo.findCharacterByName("Thrainn"))!;
      const base = {
        name: thrainn.name,
        class: thrainn.class,
        spec: thrainn.spec,
        role: thrainn.role,
        status: thrainn.status,
      };

      const saved = await repo.updateCharacter(thrainn.id, {
        ...base,
        offSpec: "Fury",
        offSpecRole: "Melee DPS",
      });
      expect(saved).toMatchObject({ ok: true });
      const withOffSpec = (await repo.getCharacterBundle("thrainn"))!.character;
      expect(withOffSpec).toMatchObject({ offSpec: "Fury", offSpecRole: "Melee DPS" });

      // Omitting it is how an officer says "they only play the one spec now".
      await repo.updateCharacter(thrainn.id, base);
      const cleared = (await repo.getCharacterBundle("thrainn"))!.character;
      expect(cleared.offSpec).toBeUndefined();
      expect(cleared.offSpecRole).toBeUndefined();
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
            prepot: false, potions: [], otherCasts: [], extras: [], cooldowns: [], castTimes: [], upkeep: [],
            deaths: 0, deathTimes: [], drums: 0, runes: 0, healthstones: 0, sappers: 0, missingEnchants: [], gear: [], talents: [],
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

  it("migrates a database created before talents were captured", async () => {
    // The one bug class a from-scratch suite is blind to: a column added to the
    // CREATE TABLE block alone works on a fresh database and throws on the
    // user's real one. Only migrate() reaches an existing database.
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
      gear_json TEXT NOT NULL DEFAULT '[]',
      missing_enchants_json TEXT NOT NULL DEFAULT '[]'
    )`);
    old.close();

    const repo = getSqliteRepo(); // boots, runs migrate(), seeds
    const perf = (await repo.getCharacterPerformance("kazrak"))!;
    // Pre-talent rows read back as an empty array, never undefined — callers
    // treat that as "unknown build" rather than crashing.
    expect(perf.reports[0].rows.every((r) => Array.isArray(r.talents))).toBe(true);
  });

  it("round-trips a pull's talent split", async () => {
    const repo = getSqliteRepo();
    const code = "TALENT0000000001";
    const saved = await repo.saveWclReport(
      { code, title: "Talent night", startTime: "2026-06-18T19:00:00Z", endTime: "2026-06-18T22:00:00Z", raidSessionId: null },
      [
        {
          fightId: 1, encounterId: 601, encounterName: "Void Reaver", kill: true, durationMs: 134000,
          actorName: "Thrainn", role: "dps", deaths: 0, deathTimes: [], elixirs: [], scrolls: [], food: false,
          weaponBuff: false, prepot: false, potions: [], otherCasts: [], extras: [], cooldowns: [],
          castTimes: [], upkeep: [], drums: 0, runes: 0, healthstones: 0, sappers: 0,
          missingEnchants: [], gear: [], talents: [33, 28, 0],
        },
      ],
    );
    expect(saved.ok).toBe(true);
    const perf = (await repo.getCharacterPerformance("thrainn"))!;
    const row = perf.reports.flatMap((r) => r.rows).find((r) => r.encounterName === "Void Reaver")!;
    expect(row.talents).toEqual([33, 28, 0]);
  });

  describe("tier tokens", () => {
    const TOKEN = 30242;
    const PIECE = 30166;

    it("stores the edge on the piece and marks the token a token", async () => {
      const repo = getSqliteRepo();
      expect(await repo.saveTokenRedemptions([{ pieceId: PIECE, tokenId: TOKEN }])).toBe(1);
      expect((await repo.getItem(PIECE))!.redeemsFrom).toBe(TOKEN);
      expect((await repo.getItem(TOKEN))!.armorToken).toBe(true);
      // The edge does not run backwards.
      expect((await repo.getItem(TOKEN))!.redeemsFrom).toBeUndefined();
    });

    it("lets a token win satisfy the wishlist row for the piece it buys", async () => {
      // End to end, because this is the whole point: a Gargul paste naming the
      // token has to close a wishlist slot naming the piece.
      const repo = getSqliteRepo();
      const character = (await repo.findCharacterByName("Thrainn"))!;
      await repo.upsertGearSet(
        { ...wishlistDraft(character.id, 2, PIECE), name: "P2 tier" },
        { replace: true },
      );
      await repo.createRaidSessionWithAwards(
        { date: "2026-06-11", zones: ["Serpentshrine Cavern"], source: "gargul" },
        [{ rawWinnerName: "Thrainn", itemId: TOKEN, itemName: "Helm of the Vanquished Champion", awardedAt: "2026-06-11T21:00:00", offspec: false }],
      );

      const before = (await repo.getCharacterBundle("thrainn"))!;
      expect(before.wishlists.find((w) => w.phase === 2)!.rows[0].state).toBe("open");

      await repo.saveTokenRedemptions([{ pieceId: PIECE, tokenId: TOKEN }]);

      const after = (await repo.getCharacterBundle("thrainn"))!;
      const row = after.wishlists.find((w) => w.phase === 2)!.rows[0];
      expect(row.state).toBe("awarded");
      expect(row.awardedVia?.itemId).toBe(TOKEN);
    });

    it("queues ids that might be tokens, and stops once they have been asked about", async () => {
      const repo = getSqliteRepo();
      // A verified row with no slot: what a token looks like before anyone asks.
      await repo.saveResolvedItems([{ id: 99960, name: "Might Be A Token", quality: "epic" }]);
      expect((await repo.listTokenBackfill()).unchecked).toContain(99960);

      // Wowhead answers "ordinary item" — it must not come round again.
      await repo.saveResolvedItems([{ id: 99960, name: "Might Be A Token", quality: "epic", armorToken: false }]);
      const asked = await repo.listTokenBackfill();
      expect(asked.unchecked).not.toContain(99960);
      expect(asked.tokensWithoutPieces).not.toContain(99960);
    });

    it("queues a known token until its vendor listing has been read", async () => {
      const repo = getSqliteRepo();
      await repo.saveResolvedItems([{ id: TOKEN, name: "Helm of the Vanquished Champion", armorToken: true }]);
      expect((await repo.listTokenBackfill()).tokensWithoutPieces).toContain(TOKEN);

      await repo.saveTokenRedemptions([{ pieceId: PIECE, tokenId: TOKEN }]);
      expect((await repo.listTokenBackfill()).tokensWithoutPieces).not.toContain(TOKEN);
    });

    it("keeps anything a gear set names out of the candidate queue", async () => {
      // Structural, not a guess: a token can't be equipped, so nothing that
      // exports a gear set can name one.
      const repo = getSqliteRepo();
      const character = (await repo.findCharacterByName("Thrainn"))!;
      await repo.saveResolvedItems([{ id: 99961, name: "A Real Helm", slot: "head" }]);
      expect((await repo.listTokenBackfill()).unchecked).toContain(99961);

      await repo.upsertGearSet(wishlistDraft(character.id, 3, 99961), { replace: true });
      expect((await repo.listTokenBackfill()).unchecked).not.toContain(99961);
    });

    it("asks about awarded ids before anything else", async () => {
      // A capped press should spend itself on loot the guild actually won —
      // a token in the ledger has awards waiting on the answer.
      const repo = getSqliteRepo();
      await repo.saveResolvedItems([
        { id: 99970, name: "Never Seen", slot: "head" },
        { id: 99971, name: "Won At A Boss" },
      ]);
      await repo.createRaidSessionWithAwards(
        { date: "2026-06-12", zones: ["Serpentshrine Cavern"], source: "gargul" },
        [{ rawWinnerName: "Thrainn", itemId: 99971, itemName: "Won At A Boss", awardedAt: "2026-06-12T21:00:00", offspec: false }],
      );
      const { unchecked } = await repo.listTokenBackfill();
      expect(unchecked.indexOf(99971)).toBeLessThan(unchecked.indexOf(99970));
    });
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

  it("fills the gaps in a cached item without touching what it already knew", async () => {
    const repo = getSqliteRepo();
    // A loot paste that only knew a name and a color.
    expect(await repo.addItemsIfMissing([{ id: 99951, name: "Half-Known Blade", quality: "epic" }])).toBe(1);
    // A log's gear snapshot later supplies the icon — and a wrong name, ignored.
    expect(await repo.addItemsIfMissing([{ id: 99951, name: "Wrong", icon: "inv_sword_48" }])).toBe(1);
    expect(await repo.getItem(99951)).toMatchObject({
      name: "Half-Known Blade",
      quality: "epic",
      icon: "inv_sword_48",
    });
    // Nothing new to learn — the row is left alone and reported as untouched.
    expect(await repo.addItemsIfMissing([{ id: 99951, name: "Wrong again" }])).toBe(0);
  });

  it("lists items that would render as a bare id, and stops listing them once resolved", async () => {
    const repo = getSqliteRepo();
    const session = await repo.createRaidSessionWithAwards(
      { date: "2026-06-11", zones: ["Serpentshrine Cavern"], source: "gargul" },
      [{ rawWinnerName: "Thrainn", itemId: 99952, itemName: "Item #99952", awardedAt: "2026-06-11T21:00:00", offspec: false }],
    );
    expect(session.inserted).toBe(1);
    expect(await repo.listUnresolvedItemIds()).toContain(99952);

    // What the Wowhead resolver hands back. It has to go in as *resolved* —
    // an ordinary import would fill the same fields and leave the row
    // unconfirmed, which is a different claim and stays on the list.
    await repo.saveResolvedItems([{ id: 99952, name: "Fathom-Brooch of the Tidewalker", quality: "epic", icon: "inv_jewelry_necklace_21" }]);
    expect(await repo.listUnresolvedItemIds()).not.toContain(99952);

    // The invented name frozen into the award row is repaired from the cache.
    expect(await repo.repairPlaceholderAwardNames()).toBe(1);
    const award = (await repo.listLootAwards()).find((a) => a.award.itemId === 99952)!;
    expect(award.award.itemName).toBe("Fathom-Brooch of the Tidewalker");
    expect(await repo.repairPlaceholderAwardNames()).toBe(0);
  });

  it("puts the shipped drop table back on rows that lost it, and never over an officer", async () => {
    const repo = getSqliteRepo();

    // A row the resolver stripped because it had been curated onto the wrong
    // item: name confirmed, zone and phase gone.
    await repo.saveResolvedItems([
      { id: 28830, name: "Something Else Entirely", quality: "epic", icon: "inv_sword_48" },
    ]);
    expect((await repo.getItem(28830))!.source).toBeUndefined();

    // The shipped list still knows where the real 28830 comes from.
    expect(await repo.applyCuratedItemSources()).toBeGreaterThan(0);
    expect((await repo.getItem(28830))!.source?.boss).toBe("Gruul the Dragonkiller");

    // Idempotent: nothing left to fill means nothing written.
    expect(await repo.applyCuratedItemSources()).toBe(0);
  });

  it("never lets the shipped drop table overwrite an officer's own answer", async () => {
    const repo = getSqliteRepo();
    await repo.setItemCuration(28830, {
      phase: 5,
      source: { zone: "Sunwell Plateau", boss: "Kil'jaeden" },
    });
    await repo.applyCuratedItemSources();

    const item = (await repo.getItem(28830))!;
    expect(item.source).toEqual({ zone: "Sunwell Plateau", boss: "Kil'jaeden" });
    expect(item.phase).toBe(5);
  });

  it("curates an item's drop and phase by hand, and clears them again", async () => {
    const repo = getSqliteRepo();
    expect((await repo.getItem(28830))!.phase).toBe(1);

    expect(await repo.setItemCuration(28830, {
      phase: 3,
      source: { zone: "Black Temple", boss: "Illidan Stormrage" },
    })).toEqual({ ok: true });
    const edited = (await repo.getItem(28830))!;
    expect(edited.phase).toBe(3);
    expect(edited.source).toEqual({ zone: "Black Temple", boss: "Illidan Stormrage" });

    // Clearing is a real answer, not a failure to answer: the curated list got
    // a number of these attached to the wrong id, and no source beats a wrong one.
    expect(await repo.setItemCuration(28830, { phase: null, source: null })).toEqual({ ok: true });
    const cleared = (await repo.getItem(28830))!;
    expect(cleared.phase).toBeUndefined();
    expect(cleared.source).toBeUndefined();
  });

  it("curates an item the cache has never held, and puts it on the loot plan", async () => {
    const repo = getSqliteRepo();
    expect(await repo.getItem(99980)).toBeUndefined();
    expect(await repo.setItemCuration(99980, {
      phase: 2,
      source: { zone: "Serpentshrine Cavern", boss: "Lady Vashj" },
    })).toEqual({ ok: true });
    expect((await repo.getItem(99980))!.phase).toBe(2);

    // Zone is what the loot plan groups by — curating one has to be enough to
    // put a drop back on it, which is the whole reason this write exists.
    const plan = await repo.getLootPlan("Serpentshrine Cavern");
    const ids = plan.bosses.flatMap((b) => b.items.map((i) => i.itemId));
    expect(ids).toContain(99980);
  });

  it("refuses a source with no zone", async () => {
    const repo = getSqliteRepo();
    const result = await repo.setItemCuration(28830, { phase: 1, source: { zone: "   " } });
    expect(result.ok).toBe(false);
  });

  it("moves the guild between phases, and puts it back", async () => {
    const repo = getSqliteRepo();
    const before = (await repo.getGuild()).activePhase;
    const other = before === 3 ? 2 : 3;

    expect(await repo.setActivePhase(other)).toEqual({ ok: true });
    expect((await repo.getGuild()).activePhase).toBe(other);

    // The point of the control is that it is reversible — an officer trying a
    // phase on has to be able to get back exactly where they were.
    expect(await repo.setActivePhase(before)).toEqual({ ok: true });
    expect((await repo.getGuild()).activePhase).toBe(before);
  });

  it("refuses a phase the app doesn't have", async () => {
    const repo = getSqliteRepo();
    const before = (await repo.getGuild()).activePhase;
    const result = await repo.setActivePhase(9 as never);
    expect(result.ok).toBe(false);
    expect((await repo.getGuild()).activePhase).toBe(before);
  });

  it("keeps offering a curated item until Wowhead itself confirms it", async () => {
    const repo = getSqliteRepo();
    // Dragonspine Trophy comes from the curated seed: name, quality and icon
    // all present, none of them checked. A complete-looking row is exactly the
    // case that used to be unreachable — eight wrong-icon reports landed here.
    const seeded = (await repo.getItem(28830))!;
    expect(seeded.name).toBeDefined();
    expect(seeded.icon).toBeDefined();
    expect(seeded.verified).toBe(false);
    expect(await repo.listUnresolvedItemIds()).toContain(28830);

    // An ordinary import can't clear it, no matter what it claims to know.
    await repo.addItemsIfMissing([{ id: 28830, name: "Whatever", icon: "inv_misc_questionmark" }]);
    expect(await repo.listUnresolvedItemIds()).toContain(28830);

    await repo.saveResolvedItems([
      { id: 28830, name: "Dragonspine Trophy", quality: "epic", icon: "inv_misc_bone_11", slot: "trinket1" },
    ]);
    expect(await repo.listUnresolvedItemIds()).not.toContain(28830);
  });

  it("drops zone, boss and phase when the curated row was on the wrong id", async () => {
    const repo = getSqliteRepo();
    const seeded = (await repo.getItem(28830))!;
    expect(seeded.source).toBeDefined();
    expect(seeded.phase).toBeDefined();

    // Wowhead says this id is a different item entirely. Whatever zone, boss
    // and phase were written beside the old name belong to the item the author
    // meant, not to this one — keeping them would pin a Gruul's Lair drop onto
    // something else and every phase filter downstream would believe it.
    await repo.saveResolvedItems([
      { id: 28830, name: "Something Else Entirely", quality: "epic", icon: "inv_sword_48" },
    ]);

    const after = (await repo.getItem(28830))!;
    expect(after.name).toBe("Something Else Entirely");
    expect(after.source).toBeUndefined();
    expect(after.phase).toBeUndefined();
    expect(after.verified).toBe(true);
  });

  it("lets Wowhead overwrite a guessed icon, but never the guild's own answers", async () => {
    const repo = getSqliteRepo();
    const before = (await repo.getItem(28830))!;
    // The seed is where zone/boss/phase come from; Wowhead's XML has none of
    // them, so resolving must not blank what the officers curated.
    expect(before.source).toBeDefined();
    expect(before.phase).toBeDefined();

    await repo.saveResolvedItems([
      { id: 28830, name: "Dragonspine Trophy", quality: "epic", icon: "inv_misc_bone_11", slot: "trinket1" },
    ]);

    const after = (await repo.getItem(28830))!;
    expect(after.icon).toBe("inv_misc_bone_11");
    expect(after.verified).toBe(true);
    expect(after.source).toEqual(before.source);
    expect(after.phase).toBe(before.phase);
  });

  it("counts what Wowhead disagreed with, not what it wrote", async () => {
    const repo = getSqliteRepo();
    const seeded = (await repo.getItem(28830))!;
    // Same id, a different icon: one correction.
    expect(await repo.saveResolvedItems([
      { id: 28830, name: seeded.name, quality: seeded.quality, icon: "inv_misc_bone_11" },
    ])).toBe(1);
    // Now it agrees — still written (the row is re-stamped), nothing corrected.
    expect(await repo.saveResolvedItems([
      { id: 28830, name: seeded.name, quality: seeded.quality, icon: "inv_misc_bone_11" },
    ])).toBe(0);
    // An id the cache never held is learned, not corrected.
    expect(await repo.saveResolvedItems([
      { id: 99970, name: "Brand New", quality: "epic", icon: "inv_sword_48" },
    ])).toBe(0);
    expect((await repo.getItem(99970))!.verified).toBe(true);
  });

  it("pins a sheet name to an item id when no lookup can settle it", async () => {
    const repo = getSqliteRepo();
    // Both Warglaives are called "Warglaive of Azzinoth"; the sheet tells them
    // apart with an annotation that is nobody's item name, so only a person can.
    const name = "Warglaive of Azzinoth (Main Hand)";
    expect(await repo.listUnmatchedSheetNames()).toContain(name);

    expect((await repo.setSheetItemId(name, 32837)).ok).toBe(true);
    // Settled: it stops being offered to the automatic lookup, which would only
    // ever come back with "two items share this name".
    expect(await repo.listUnmatchedSheetNames()).not.toContain(name);
    // The pinned id is seeded into the cache, so the resolver fills it in and
    // the row renders with an icon rather than as an id nobody has heard of.
    expect(await repo.getItem(32837)).toBeDefined();

    // Punctuation and case don't count, so a re-pasted sheet keeps the pin.
    expect((await repo.setSheetItemId("warglaive of azzinoth (main hand)", 32838)).ok).toBe(true);

    // Unpinning hands the name back to automatic matching.
    expect((await repo.setSheetItemId(name, undefined)).ok).toBe(true);
    expect(await repo.listUnmatchedSheetNames()).toContain(name);
    expect((await repo.setSheetItemId("   ", 1)).ok).toBe(false);
  });

  it("puts rings back in the token queue after they were filed as tokens", async () => {
    // The state the buggy classifier left: rings flagged as armor tokens with
    // their slot wiped, plus one genuine token something redeems from.
    const old = new DatabaseSync(process.env.PROJECTLC_DB!);
    old.exec(`CREATE TABLE items (
      id INTEGER PRIMARY KEY, name TEXT, quality TEXT, icon TEXT, slot TEXT,
      source_json TEXT, phase INTEGER, verified INTEGER NOT NULL DEFAULT 0,
      armor_token INTEGER, redeems_from INTEGER
    )`);
    const ins = old.prepare(
      "INSERT INTO items (id, name, verified, armor_token, redeems_from, slot) VALUES (?, ?, 1, ?, ?, ?)",
    );
    ins.run(29997, "Band of the Ranger-General", 1, null, null); // a ring, mis-flagged
    ins.run(30242, "Helm of the Vanquished Champion", 1, null, null); // a real token
    ins.run(30169, "A tier helm", null, 30242, "head"); // proof 30242 buys something
    old.close();

    const repo = getSqliteRepo();
    // The ring is handed back to the item resolver, so the fixed classifier
    // re-answers and the same write restores the slot it lost.
    const ring = (await repo.getItem(29997))!;
    expect(ring.armorToken).toBeUndefined();
    expect(ring.verified).toBe(false);
    expect(await repo.listUnresolvedItemIds()).toContain(29997);
    // Deliberately that queue and not the token one: the token queue skips any
    // row a gear set names, so a ring somebody wishlisted would have sat there
    // flagless and slotless for ever, invisible to both.
    expect((await repo.listTokenBackfill()).unchecked).not.toContain(29997);
    // The token is left alone: a piece pointing at it is proof no ring can fake.
    expect((await repo.getItem(30242))!.armorToken).toBe(true);

    // And it is stamped as done, which is what stops it running again: without
    // that, a real token with no pieces mapped yet would be cleared on every
    // boot and the queue would ping-pong for ever — the very symptom it fixes.
    const db = new DatabaseSync(process.env.PROJECTLC_DB!);
    const stamp = db
      .prepare("SELECT value FROM meta WHERE key = ?")
      .get("repair:armor_token_needs_class");
    db.close();
    expect(stamp).toBeDefined();
  });

  it("migrates a database created before item provenance was tracked", async () => {
    // The pre-verified items table, with one row of each kind: a curated entry
    // (the seed is the only writer of source_json) and one harvested from a
    // log. The migration must trust the machine and re-check the human.
    const old = new DatabaseSync(process.env.PROJECTLC_DB!);
    old.exec(`CREATE TABLE items (
      id INTEGER PRIMARY KEY, name TEXT, quality TEXT, icon TEXT, slot TEXT,
      source_json TEXT, phase INTEGER
    )`);
    old.prepare("INSERT INTO items (id, name, quality, icon, source_json) VALUES (?, ?, ?, ?, ?)")
      .run(99960, "Curated Guess", "epic", "inv_misc_questionmark", JSON.stringify({ zone: "Karazhan" }));
    old.prepare("INSERT INTO items (id, name, quality, icon) VALUES (?, ?, ?, ?)")
      .run(99961, "Read Off A Log", "epic", "inv_sword_48");
    old.close();

    const repo = getSqliteRepo();
    expect((await repo.getItem(99960))!.verified).toBe(false);
    expect((await repo.getItem(99961))!.verified).toBe(true);

    const unresolved = await repo.listUnresolvedItemIds();
    expect(unresolved).toContain(99960);

    // The trusted row is still queued, but for a different and much smaller
    // reason: it was confirmed before the phase was read off Wowhead's answer,
    // so it is owed exactly one more lookup. Ordering says which is which —
    // the unverified guess is asked about first.
    expect((await repo.getItem(99961))!.phaseChecked).toBe(false);
    expect(unresolved.indexOf(99960)).toBeLessThan(unresolved.indexOf(99961));

    // And once it has been asked, it never comes back — including when Wowhead
    // had no phase for it, which is true of most of the tier's launch items.
    await repo.saveResolvedItems([
      { id: 99961, name: "Read Off A Log", quality: "epic", icon: "inv_sword_48" },
    ]);
    expect((await repo.getItem(99961))!.phase).toBeUndefined();
    expect(await repo.listUnresolvedItemIds()).not.toContain(99961);
  });

  it("awards a wishlist item by hand and clears it again", async () => {
    const repo = getSqliteRepo();
    const before = (await repo.getCharacterBundle("thrainn"))!;
    const openRow = before.wishlists[0].rows.find((r) => r.state === "open")!;
    expect(openRow.awardId).toBeUndefined();

    // What the character page's dialog does for "+ New manual entry".
    const session = await repo.createRaidSessionWithAwards(
      { date: "2026-07-28", zones: ["Serpentshrine Cavern"], source: "manual", note: "Manual loot entry" },
      [
        {
          rawWinnerName: before.character.name,
          itemId: openRow.wished.itemId,
          itemName: openRow.wished.itemName,
          awardedAt: "2026-07-28T12:00:00",
          offspec: false,
        },
      ],
    );
    expect(session.inserted).toBe(1);

    const awarded = (await repo.getCharacterBundle("thrainn"))!;
    const awardedRow = awarded.wishlists[0].rows.find((r) => r.wished.itemId === openRow.wished.itemId)!;
    expect(awardedRow.state).toBe("awarded");
    expect(awardedRow.awardId).toBeDefined();
    // Completion and the loot ledger move with it — one source of truth.
    expect(awarded.wishlists[0].completion.satisfied).toBe(before.wishlists[0].completion.satisfied + 1);
    expect(awarded.awards.some((a) => a.award.itemId === openRow.wished.itemId)).toBe(true);

    expect(await repo.deleteLootAward(awardedRow.awardId!)).toBe(true);
    const cleared = (await repo.getCharacterBundle("thrainn"))!;
    const clearedRow = cleared.wishlists[0].rows.find((r) => r.wished.itemId === openRow.wished.itemId)!;
    expect(clearedRow.state).toBe("open");
    expect(clearedRow.awardId).toBeUndefined();
    expect(cleared.wishlists[0].completion.satisfied).toBe(before.wishlists[0].completion.satisfied);
  });

  it("files a hand-written award into an existing raid night", async () => {
    const repo = getSqliteRepo();
    const character = (await repo.findCharacterByName("Thrainn"))!;
    const session = (await repo.listRaidSessions())[0];
    const result = await repo.addLootAward(session.id, {
      itemId: 30048,
      itemName: "Brighthelm of Justice",
      rawWinnerName: character.name,
      characterId: character.id,
      external: false,
      offspec: true,
      note: "traded after the raid",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    // Filed under that night, linked to the character, off-spec kept.
    expect(result.award.raidSessionId).toBe(session.id);
    expect(result.award.characterId).toBe(character.id);
    expect(result.award.offspec).toBe(true);
    expect(result.award.awardedAt.startsWith(session.date)).toBe(true);
  });

  it("harvests icons out of stored log gear into the cache", async () => {
    const repo = getSqliteRepo();
    await repo.saveWclReport(
      {
        code: "GEARICONS",
        title: "Gear icon harvest",
        zone: "Tempest Keep",
        startTime: "2026-06-11T18:00:00.000Z",
        endTime: "2026-06-11T22:00:00.000Z",
      },
      [
        {
          fightId: 1, encounterId: 601, encounterName: "Al'ar", kill: true, durationMs: 300000,
          actorName: "Thrainn", role: "dps", deaths: 0, deathTimes: [], elixirs: [], scrolls: [], food: false,
          weaponBuff: false, prepot: false, potions: [], otherCasts: [], extras: [], cooldowns: [],
          castTimes: [], upkeep: [], drums: 0, runes: 0, healthstones: 0, sappers: 0,
          missingEnchants: [], talents: [],
          // The snapshot spells icons with an extension; the cache stores them bare.
          gear: [{ slot: 0, id: 99953, icon: "inv_helmet_15.jpg", gems: [] }],
        },
      ],
    );
    expect(await repo.getItem(99953)).toMatchObject({ icon: "inv_helmet_15" });
  });

  it("records which uptime tracks the report was fetched with", async () => {
    /*
     * Without this, an aura missing from a report is ambiguous forever: the
     * raid didn't have it, or we hadn't started asking for it. The sim audit
     * spent a release calling both "not tracked by this app" — on data that had
     * just been refetched. See docs/change-chains.md §1.
     */
    const repo = getSqliteRepo();
    const saved = await repo.saveWclReport(
      {
        code: "TRACKSTAMP",
        title: "Track stamp",
        startTime: "2026-06-11T18:00:00.000Z",
        endTime: "2026-06-11T22:00:00.000Z",
      },
      [
        {
          fightId: 1, encounterId: 601, encounterName: "Al'ar", kill: true, durationMs: 300000,
          actorName: "Thrainn", role: "dps", deaths: 0, deathTimes: [], elixirs: [], scrolls: [], food: false,
          weaponBuff: false, prepot: false, potions: [], otherCasts: [], extras: [], cooldowns: [],
          castTimes: [], upkeep: [], drums: 0, runes: 0, healthstones: 0, sappers: 0,
          missingEnchants: [], talents: [], gear: [],
        },
      ],
    );
    expect(saved.ok).toBe(true);
    // Stamped from the live list rather than passed in, so it can't drift.
    expect(TRACKED_AURA_NAMES).toContain("Blood Frenzy");
    const stored = (await repo.listWclReports()).find((r) => r.report.code === "TRACKSTAMP")!;
    expect(stored.report.upkeepTracks).toEqual(TRACKED_AURA_NAMES);
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
        deathTimes: [],
        talents: [],
        elixirs: [],
        scrolls: [],
        food: true,
        weaponBuff: true,
        prepot: false,
        potions: [],
        otherCasts: [],
        extras: [],
        cooldowns: [],
        castTimes: [],
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

    it("keeps a raid's consumable adjustments, and lets them be undone", async () => {
      const repo = getSqliteRepo();
      expect(await repo.getReportConsumableAdjustments("NOPE")).toEqual([]);

      const at = "2026-08-02T20:00:00.000Z";
      await repo.setReportConsumableAdjustments("RAID1", [
        { actorName: "Thrainn", name: "Flask of Relentless Assault", delta: 1, note: "flasked pre-log", at },
        { actorName: "Pyrelia", name: "Super Mana Potion", delta: -2, at },
      ]);
      const saved = await repo.getReportConsumableAdjustments("RAID1");
      expect(saved).toHaveLength(2);
      expect(saved[0]).toMatchObject({ actorName: "Thrainn", delta: 1, note: "flasked pre-log" });
      expect(saved[1].note).toBeUndefined();

      // A zero delta is a no-op pretending to be a correction — dropped on read.
      await repo.setReportConsumableAdjustments("RAID1", [
        { actorName: "Thrainn", name: "Food", delta: 0, at },
      ]);
      expect(await repo.getReportConsumableAdjustments("RAID1")).toEqual([]);

      // Adjustments are scoped to their own raid.
      await repo.setReportConsumableAdjustments("RAID2", [
        { actorName: "Thrainn", name: "Food", delta: 3, at },
      ]);
      expect(await repo.getReportConsumableAdjustments("RAID1")).toEqual([]);
      expect(await repo.getReportConsumableAdjustments("RAID2")).toHaveLength(1);
    });

    it("stores off-pull consumables against the raider who used them", async () => {
      const repo = getSqliteRepo();
      const thrainn = (await repo.findCharacterByName("Thrainn"))!;
      const saved = await repo.saveWclReport(
        { code: "OFFPULL1", title: "Trash night", zone: "Serpentshrine Cavern", startTime: "2026-07-01T18:00:00.000Z", endTime: "2026-07-01T22:00:00.000Z" },
        [fightDraft({ fightId: 1, actorName: "Thrainn" })],
        [
          {
            actorName: "Thrainn",
            potions: ["Super Mana Potion", "Super Mana Potion"],
            otherCasts: ["Dark Rune"],
            drums: 0,
            runes: 1,
            healthstones: 0,
            sappers: 0,
            petConsumables: [],
          },
          // A name nobody on the roster answers to still gets stored — it just
          // hangs off no character, exactly like an unmatched pull.
          {
            actorName: "Randompug",
            potions: ["Haste Potion"],
            otherCasts: [],
            drums: 0,
            runes: 0,
            healthstones: 0,
            sappers: 0,
            petConsumables: ["Kibler's Bits"],
          },
        ],
      );
      expect(saved.ok).toBe(true);

      const perf = (await repo.getCharacterPerformance("thrainn"))!;
      const offPull = perf.offPull.find((o) => o.reportCode === "OFFPULL1")!;
      expect(offPull.characterId).toBe(thrainn.id);
      expect(offPull.potions).toEqual(["Super Mana Potion", "Super Mana Potion"]);
      expect(offPull.runes).toBe(1);
      // It rides along on the report view too, for the per-night panel.
      expect(perf.reports.find((r) => r.report.code === "OFFPULL1")!.offPull).toEqual(offPull);

      // Re-importing the report replaces the off-pull rows rather than doubling them.
      await repo.saveWclReport(
        { code: "OFFPULL1", title: "Trash night", zone: "Serpentshrine Cavern", startTime: "2026-07-01T18:00:00.000Z", endTime: "2026-07-01T22:00:00.000Z" },
        [fightDraft({ fightId: 1, actorName: "Thrainn" })],
        [{ actorName: "Thrainn", potions: ["Haste Potion"], otherCasts: [], drums: 0, runes: 0, healthstones: 0, sappers: 0, petConsumables: [] }],
      );
      const after = (await repo.getCharacterPerformance("thrainn"))!;
      expect(after.offPull.filter((o) => o.reportCode === "OFFPULL1")).toHaveLength(1);
      expect(after.offPull.find((o) => o.reportCode === "OFFPULL1")!.potions).toEqual(["Haste Potion"]);

      // And they go when the report does — a dangling row fails validateStore.
      expect((await repo.deleteWclReport("OFFPULL1")).ok).toBe(true);
      expect((await repo.getCharacterPerformance("thrainn"))!.offPull).toEqual([]);
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

    it("round-trips a raid's board, keeping reports independent", async () => {
      const repo = getSqliteRepo();
      // Never laid out → an empty board, which is also what the page offers.
      const blank = await repo.getRaidBoard("RPT1");
      expect(blank.groups).toHaveLength(8);
      expect(blank.groups.flat()).toEqual([]);

      await repo.setRaidBoard("RPT1", {
        groups: [
          [{ name: "Pyrelia" }, { name: "Velora", spec: "Restoration" }],
          [{ name: "Katzewarr" }],
          [],
          [],
          [],
          [],
          [],
          [],
        ],
      });
      const saved = await repo.getRaidBoard("RPT1");
      expect(saved.groups[0]).toEqual([
        { name: "Pyrelia" },
        // The officer's "count her as Resto here" survives the round trip.
        { name: "Velora", spec: "Restoration" },
      ]);
      expect(saved.groups[1]).toEqual([{ name: "Katzewarr" }]);
      expect((await repo.getRaidBoard("RPT2")).groups.flat()).toEqual([]);

      // Clearing the board removes the record entirely — "never laid out" and
      // "laid out, then cleared" are deliberately the same state.
      await repo.setRaidBoard("RPT1", { groups: [[], [], [], [], [], [], [], []] });
      expect((await repo.getRaidBoard("RPT1")).groups.flat()).toEqual([]);
    });

    it("sanitizes a board on save rather than trusting the board", async () => {
      const repo = getSqliteRepo();
      await repo.setRaidBoard("RPT4", {
        // Six in a group, the same raider twice, and a blank slot.
        groups: [["A", "B", "C", "D", "E", "F"], ["a", "G", ""], [], [], [], [], [], []],
      } as never);
      const saved = await repo.getRaidBoard("RPT4");
      expect(saved.groups[0].map((s) => s.name)).toEqual(["A", "B", "C", "D", "E"]);
      // "a" is "A" again — nobody buffs two groups at once.
      expect(saved.groups[1].map((s) => s.name)).toEqual(["G"]);
    });

    it("keeps the template's board apart from every raid's", async () => {
      const repo = getSqliteRepo();
      expect((await repo.getTemplateBoard()).groups.flat()).toEqual([]);

      await repo.setTemplateBoard({
        groups: [[{ name: "Pyrelia" }], [], [], [], [], [], [], []],
      });
      await repo.setRaidBoard("RPT6", {
        groups: [[{ name: "Velora" }], [], [], [], [], [], [], []],
      });

      // A plan for next week and the record of a night that happened are two
      // different things, and neither may overwrite the other.
      expect((await repo.getTemplateBoard()).groups[0]).toEqual([{ name: "Pyrelia" }]);
      expect((await repo.getRaidBoard("RPT6")).groups[0]).toEqual([{ name: "Velora" }]);

      await repo.setTemplateBoard({ groups: [[], [], [], [], [], [], [], []] });
      expect((await repo.getTemplateBoard()).groups.flat()).toEqual([]);
      expect((await repo.getRaidBoard("RPT6")).groups[0]).toEqual([{ name: "Velora" }]);
    });

    it("commits a board to disk, not just to the process", async () => {
      // The whole point of persisting: arranging 25 people must not be work you
      // lose to closing the tab. Read back over a second connection, because a
      // value the in-process cache is holding would pass a same-connection read
      // whether or not the transaction ever reached the file.
      await getSqliteRepo().setRaidBoard("RPT7", {
        groups: [[{ name: "Pyrelia" }, { name: "Velora", spec: "Holy" }], [], [], [], [], [], [], []],
      });

      const onDisk = new DatabaseSync(process.env.PROJECTLC_DB!, { readOnly: true });
      const row = onDisk.prepare("SELECT value FROM meta WHERE key = ?").get("raid_board:RPT7") as
        | { value: string }
        | undefined;
      onDisk.close();

      expect(JSON.parse(row!.value).groups[0]).toEqual([
        { name: "Pyrelia" },
        { name: "Velora", spec: "Holy" },
      ]);
    });

    it("still reads a board saved before spec overrides existed", async () => {
      // Boards were stored as bare names. A stored board is the record of a real
      // raid night, so the old shape has to keep reading — forever.
      const repo = getSqliteRepo();
      await repo.getGuild(); // opens (and schema-creates) the database
      const raw = new DatabaseSync(process.env.PROJECTLC_DB!);
      raw.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(
        "raid_board:RPT5",
        JSON.stringify({ groups: [["Pyrelia", "Velora"], [], [], [], [], [], [], []] }),
      );
      raw.close();

      const saved = await repo.getRaidBoard("RPT5");
      expect(saved.groups[0]).toEqual([{ name: "Pyrelia" }, { name: "Velora" }]);
    });

    it("round-trips the excluded pulls of a raid and applies them to its rollup", async () => {
      const repo = getSqliteRepo();
      await repo.saveWclReport(reportDraft, [
        fightDraft({ fightId: 1, actorName: "Pyrelia", potions: ["Haste Potion"] }),
        fightDraft({ fightId: 2, actorName: "Pyrelia", encounterName: "Moroes", kill: false, potions: ["Haste Potion"] }),
      ]);
      expect(await repo.getReportExcludedFights(reportDraft.code)).toEqual([]);
      expect((await repo.getRaidReport(reportDraft.code))!.prep.potionsTotal).toBe(2);

      await repo.setReportExcludedFights(reportDraft.code, [2]);
      expect(await repo.getReportExcludedFights(reportDraft.code)).toEqual([2]);
      const filtered = (await repo.getRaidReport(reportDraft.code))!;
      // The pull stays visible, flagged, but its potion no longer counts.
      expect(filtered.fights.map((f) => f.excluded)).toEqual([undefined, true]);
      expect(filtered.prep.potionsTotal).toBe(1);

      // Clearing the filter counts the whole night again.
      await repo.setReportExcludedFights(reportDraft.code, []);
      expect((await repo.getRaidReport(reportDraft.code))!.prep.potionsTotal).toBe(2);
    });

    it("carries an excused pull through to the raider's own page", async () => {
      const repo = getSqliteRepo();
      await repo.saveWclReport(reportDraft, [
        fightDraft({ fightId: 1, actorName: "Pyrelia", flask: "Flask of Relentless Assault" }),
        fightDraft({ fightId: 2, actorName: "Pyrelia", encounterName: "Moroes", food: false }),
      ]);
      const before = (await repo.getCharacterPerformance("pyrelia"))!.reports[0];
      expect(before.summary.flaskPct).toBe(50);
      expect(before.excusedFightIds).toEqual([]);

      await repo.setReportExcludedFights(reportDraft.code, [2]);
      const after = (await repo.getCharacterPerformance("pyrelia"))!.reports[0];
      // The pull is still listed — an officer excusing a farm boss still wants
      // to read it — but the figures it fed are gone. This is the whole point:
      // the switch used to clean up the raid page and leave the same pull
      // scoring against the raider here, on the standing board and in loot.
      expect(after.rows).toHaveLength(2);
      expect(after.excusedFightIds).toEqual([2]);
      expect(after.summary.flaskPct).toBe(100);
      expect(after.summary.fights).toBe(1);
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

    it("keeps notes on an item, newest first, about the item or about a raider", async () => {
      const repo = getSqliteRepo();
      const kazrak = (await repo.findCharacterByName("Kazrak"))!;

      const general = await repo.addItemComment({
        itemId: 30900,
        voice: "officer",
        body: "Contested every week — flag it high value.",
        author: "Aldric",
      });
      const aboutKazrak = await repo.addItemComment({
        itemId: 30900,
        characterId: kazrak.id,
        voice: "raider",
        body: "2nd choice for me, I'd rather hold for the T5 gloves.",
      });
      expect(general.ok && aboutKazrak.ok).toBe(true);
      if (!general.ok || !aboutKazrak.ok) throw new Error("unreachable");

      const notes = await repo.listItemComments(30900);
      expect(notes.length).toBe(2);
      expect(notes[0].id).toBe(aboutKazrak.comment.id); // newest first
      expect(notes[0].characterId).toBe(kazrak.id);
      expect(notes[0].voice).toBe("raider");
      expect(notes[1].characterId).toBeUndefined(); // about the item itself
      expect(notes[1].author).toBe("Aldric");

      expect((await repo.countItemComments()).get(30900)).toBe(2);
      expect(await repo.listItemComments(30901)).toEqual([]);

      expect(await repo.deleteItemComment(general.comment.id)).toBe(true);
      expect(await repo.deleteItemComment(general.comment.id)).toBe(false); // already gone
      expect((await repo.listItemComments(30900)).length).toBe(1);
    });

    it("rejects an item note naming a character who doesn't exist", async () => {
      const repo = getSqliteRepo();
      const res = await repo.addItemComment({ itemId: 30900, characterId: "chr_missing", voice: "officer", body: "x" });
      expect(res.ok).toBe(false);
    });

    it("takes a note on an item the cache has never seen", async () => {
      // Officers discuss drops before the item is imported, and a note is how
      // they record that. Nothing here is scored, so there is nothing to break.
      const repo = getSqliteRepo();
      const res = await repo.addItemComment({ itemId: 99999901, voice: "officer", body: "Ask Blizzard." });
      expect(res.ok).toBe(true);
      expect((await repo.listItemComments(99999901)).length).toBe(1);
    });

    it("unlinks an item note when its raider is deleted rather than destroying it", async () => {
      // Invariant 6: past loot decisions stay explainable. The note stops
      // naming somebody; it does not disappear with them.
      const repo = getSqliteRepo();
      const velora = (await repo.findCharacterByName("Velora"))!;
      const added = await repo.addItemComment({
        itemId: 30902,
        characterId: velora.id,
        voice: "officer",
        body: "Agreed she gets the next one.",
      });
      expect(added.ok).toBe(true);
      expect((await repo.deleteCharacter(velora.id)).ok).toBe(true);

      const notes = await repo.listItemComments(30902);
      expect(notes.length).toBe(1);
      expect(notes[0].body).toBe("Agreed she gets the next one.");
      expect(notes[0].characterId).toBeUndefined();
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

  describe("memoized views", () => {
    it("serves the same derived view twice without recomputing it", async () => {
      const repo = getSqliteRepo();
      // Same read model, so the second call is the cache. Identity is the
      // observable part; the point is that the work is not redone.
      expect(await repo.listCharacters()).toBe(await repo.listCharacters());
      expect(await repo.listItemDemand()).toBe(await repo.listItemDemand());
      expect(await repo.getDashboard()).toBe(await repo.getDashboard());
    });

    it("drops the cache on a write, so a stale view can never be served", async () => {
      // The failure that would matter: a memo outliving the data it derives
      // from. The read model is keyed on data_version, which every write bumps.
      const repo = getSqliteRepo();
      const before = await repo.listCharacters();
      const beforeCount = before.length;

      const created = await repo.createCharacter({
        name: "Memotest",
        class: "Warrior",
        spec: "Fury",
        role: "Melee DPS",
        status: "main",
      });
      if (!created.ok) throw new Error(created.error);

      const after = await repo.listCharacters();
      expect(after).not.toBe(before);
      expect(after.length).toBe(beforeCount + 1);
      expect(after.some((c) => c.character.name === "Memotest")).toBe(true);
    });
  });

  describe("feedback", () => {
    it("files a report, keeps the context, then resolves and deletes it", async () => {
      const repo = getSqliteRepo();
      expect(await repo.listFeedback()).toHaveLength(0);

      const added = await repo.addFeedback({
        body: "Gold column reads 0 after importing last night's log",
        reporter: "Aldric",
        route: "/logs",
        url: "http://localhost:3000/logs?report=abc123",
        context: { elementLabel: 'td “0g”', viewport: "1512×945", theme: "dark" },
      });
      expect(added.ok).toBe(true);
      if (!added.ok) throw new Error("unreachable");
      expect(added.report.status).toBe("open");

      const [stored] = await repo.listFeedback();
      expect(stored.body).toContain("Gold column");
      expect(stored.reporter).toBe("Aldric");
      // The query string is the state that broke — it has to survive the round trip.
      expect(stored.url).toContain("?report=abc123");
      expect(stored.context?.elementLabel).toBe('td “0g”');
      expect(stored.context?.theme).toBe("dark");

      expect(await repo.setFeedbackStatus(added.report.id, "resolved")).toBe(true);
      expect((await repo.listFeedback())[0].status).toBe("resolved");

      expect(await repo.deleteFeedback(added.report.id)).toBe(true);
      expect(await repo.deleteFeedback(added.report.id)).toBe(false); // already gone
      expect(await repo.listFeedback()).toHaveLength(0);
    });

    it("triages a report without touching what the reporter wrote", async () => {
      const repo = getSqliteRepo();
      const added = await repo.addFeedback({
        body: "Two edit buttons on the priority sheet",
        route: "/loot/priority",
        url: "http://localhost:3000/loot/priority?phase=3",
      });
      if (!added.ok) throw new Error("unreachable");
      // Filed, not yet judged — the state an officer scans the page for.
      expect(added.report.priority).toBe("unset");
      expect(added.report.adminNote).toBeUndefined();

      expect(await repo.setFeedbackTriage(added.report.id, { priority: "major" })).toBe(true);
      expect(
        await repo.setFeedbackTriage(added.report.id, {
          adminNote: "  Fixed in the sheet editor.  ",
          adminNoteAuthor: "Fredrik",
        }),
      ).toBe(true);
      const [stored] = await repo.listFeedback();
      expect(stored.priority).toBe("major");
      expect(stored.adminNote).toBe("Fixed in the sheet editor.");
      // Signed and stamped: "somebody decided this" and "Fredrik decided this
      // on Tuesday" are different messages to whoever reads it next.
      expect(stored.adminNoteAuthor).toBe("Fredrik");
      expect(stored.adminNoteAt).toBeDefined();
      // Setting one field never blanks the other, and the report itself stands.
      expect(stored.body).toBe("Two edit buttons on the priority sheet");
      expect(stored.status).toBe("open");

      // An empty note clears it; an empty triage changes nothing at all.
      expect(await repo.setFeedbackTriage(added.report.id, { adminNote: "" })).toBe(true);
      const cleared = (await repo.listFeedback())[0];
      expect(cleared.adminNote).toBeUndefined();
      // The signature goes with it — a name left on a deleted note attributes
      // nothing to anybody.
      expect(cleared.adminNoteAuthor).toBeUndefined();
      expect(cleared.adminNoteAt).toBeUndefined();
      expect((await repo.listFeedback())[0].priority).toBe("major");
      expect(await repo.setFeedbackTriage(added.report.id, {})).toBe(false);
    });

    it("puts open reports first, worst first, and the unjudged above the minor", async () => {
      const repo = getSqliteRepo();
      const file = async (body: string) => {
        const r = await repo.addFeedback({ body, route: "/loot", url: "http://x/loot" });
        if (!r.ok) throw new Error("unreachable");
        return r.report.id;
      };
      const minor = await file("minor one");
      const untriaged = await file("nobody has looked at this");
      const major = await file("major one");
      const closed = await file("closed one");
      await repo.setFeedbackTriage(minor, { priority: "minor" });
      await repo.setFeedbackTriage(major, { priority: "major" });
      await repo.setFeedbackTriage(closed, { status: "resolved", priority: "major" });

      expect((await repo.listFeedback()).map((r) => r.id)).toEqual([
        major,
        untriaged,
        minor,
        closed,
      ]);
    });

    it("keeps a report with no context at all — declining to share is not an error", async () => {
      const repo = getSqliteRepo();
      const added = await repo.addFeedback({
        body: "Something is off on the roster page",
        route: "/roster",
        url: "http://localhost:3000/roster",
      });
      expect(added.ok).toBe(true);

      const [stored] = await repo.listFeedback();
      expect(stored.context).toBeUndefined();
      expect(stored.reporter).toBeUndefined();
    });

    it("lists open reports before resolved ones, newest first inside each", async () => {
      const repo = getSqliteRepo();
      const file = async (body: string) => {
        const r = await repo.addFeedback({ body, route: "/", url: "http://localhost:3000/" });
        if (!r.ok) throw new Error("unreachable");
        // Ordering is by ISO timestamp, so two reports filed in the same
        // millisecond would tie — space them out.
        await new Promise((resolve) => setTimeout(resolve, 2));
        return r.report.id;
      };
      const first = await file("first");
      await file("second");
      const third = await file("third");

      await repo.setFeedbackStatus(third, "resolved");

      // `third` is newest but resolved, so it sinks below both open ones.
      expect((await repo.listFeedback()).map((r) => r.body)).toEqual(["second", "first", "third"]);

      await repo.setFeedbackStatus(first, "resolved");
      expect((await repo.listFeedback()).map((r) => r.body)).toEqual(["second", "third", "first"]);
    });

    it("refuses an empty report rather than storing a blank row", async () => {
      const repo = getSqliteRepo();
      const added = await repo.addFeedback({ body: "", route: "/", url: "http://localhost:3000/" });
      expect(added.ok).toBe(false);
      expect(await repo.listFeedback()).toHaveLength(0);
    });

    it("keeps bug and feedback apart, and defaults to bug when unsaid", async () => {
      const repo = getSqliteRepo();
      await repo.addFeedback({
        kind: "feedback",
        body: "Roster should remember the sort order",
        route: "/roster",
        url: "http://localhost:3000/roster",
      });
      const idea = (await repo.listFeedback())[0];
      expect(idea.kind).toBe("feedback");

      // Omitting kind is how everything filed before the two buttons existed
      // arrives, and it has to keep meaning "bug".
      await repo.addFeedback({ body: "Column is blank", route: "/", url: "http://localhost:3000/" });
      const kinds = (await repo.listFeedback()).map((r) => r.kind);
      expect(kinds).toContain("bug");
      expect(kinds).toContain("feedback");
    });

    it("adds `kind` to a feedback table that predates the column", async () => {
      // The failure §2 warns about: this table shipped without `kind`, so a
      // CREATE TABLE change alone would work here and throw on a real database.
      // Build the old shape by hand, then let the repo migrate it.
      const file = path.join(mkdtempSync(path.join(tmpdir(), "projectlc-old-")), "old.db");
      const raw = new DatabaseSync(file);
      raw.exec(`CREATE TABLE feedback (
        id TEXT PRIMARY KEY, reporter TEXT, body TEXT NOT NULL, route TEXT NOT NULL,
        url TEXT NOT NULL, context_json TEXT, status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL
      );`);
      raw.prepare(
        `INSERT INTO feedback (id, body, route, url, status, created_at)
         VALUES ('fb_old', 'Filed before kind existed', '/loot', 'http://x/loot', 'open', '2026-01-01T00:00:00.000Z')`,
      ).run();
      raw.close();

      process.env.PROJECTLC_DB = file;
      const repo = getSqliteRepo();

      const [migrated] = await repo.listFeedback();
      expect(migrated.id).toBe("fb_old");
      expect(migrated.body).toBe("Filed before kind existed");
      expect(migrated.kind).toBe("bug"); // backfilled by the column default
    });
  });
});

describe("roster standing", () => {
  it("places mains and alts on separate boards, and pugs on neither", async () => {
    const repo = getSqliteRepo();
    const standing = await repo.getRosterStanding();
    const characters = await repo.listCharacters();
    const mains = characters.filter((c) => c.character.status === "main");
    const others = characters.filter(
      (c) => c.character.status === "alt" || c.character.status === "inactive",
    );

    expect(standing.mains.rows.map((r) => r.name).sort()).toEqual(
      mains.map((c) => c.character.name).sort(),
    );
    expect(standing.alts.rows.map((r) => r.name).sort()).toEqual(
      others.map((c) => c.character.name).sort(),
    );
    expect(standing.mains.rows.some((r) => r.status !== "main")).toBe(false);
    // A pug in either pool would move everybody's percentile.
    const all = [...standing.mains.rows, ...standing.alts.rows];
    expect(all.some((r) => r.status === "pug")).toBe(false);
  });

  it("orders each board weakest first, with the unplaced last", async () => {
    const repo = getSqliteRepo();
    const { mains } = await repo.getRosterStanding();
    const placed = mains.rows.filter((r) => r.standing !== undefined).map((r) => r.standing!);
    expect([...placed].sort((a, b) => a - b)).toEqual(placed);
    const firstUnplaced = mains.rows.findIndex((r) => r.standing === undefined);
    if (firstUnplaced >= 0) {
      expect(mains.rows.slice(firstUnplaced).every((r) => r.standing === undefined)).toBe(true);
    }
  });

  it("re-places the roster when the council changes the weighting", async () => {
    const repo = getSqliteRepo();
    const before = await repo.getRosterStanding();
    // Dropping the raid minimum places raiders the default wouldn't, which is
    // the knob doing its job — the board is live, not frozen like an award.
    await repo.setGuildPolicy({
      roster: { weights: { attendance: 100, performance: 0, preparation: 0 }, minRaids: 0 },
    });
    const after = await repo.getRosterStanding();
    expect(after.mains.rows.length).toBe(before.mains.rows.length);
    expect(after.mains.pool).toBeGreaterThan(before.mains.pool);
    expect(after.mains.unplaced).toBeLessThan(before.mains.unplaced);
  });

  it("sanitizes the nested roster weights rather than trusting them", async () => {
    const repo = getSqliteRepo();
    await repo.setGuildPolicy({
      roster: {
        // Out of range and the wrong type — neither may reach a board.
        weights: { attendance: 500, performance: "lots" as unknown as number, preparation: 25 },
        minRaids: 4,
      },
    });
    const policy = await repo.getGuildPolicy();
    expect(policy.roster.weights.attendance).toBe(34); // back to the default
    expect(policy.roster.weights.performance).toBe(33);
    expect(policy.roster.weights.preparation).toBe(25); // the one good value stands
    expect(policy.roster.minRaids).toBe(4);
  });

  it("falls back per weight, so a partial record can't zero a column", async () => {
    // setGuildPolicy replaces rather than merges — merging is the server
    // action's job — so a stored record naming one weight has to resolve the
    // siblings to their defaults, not to nothing.
    const repo = getSqliteRepo();
    await repo.setGuildPolicy({
      roster: { weights: { attendance: 60 } as unknown as Record<"attendance" | "performance" | "preparation", number> },
    });
    const policy = await repo.getGuildPolicy();
    expect(policy.roster.weights).toEqual({ attendance: 60, performance: 33, preparation: 33 });
    expect(policy.roster.minRaids).toBe(3);
  });
});

describe("manual gear sets", () => {
  it("saves a hand-built wishlist for a phase nobody exported", async () => {
    const repo = getSqliteRepo();
    const kazrak = (await repo.findCharacterByName("Kazrak"))!;
    const result = await repo.upsertGearSet(
      {
        characterId: kazrak.id,
        kind: "wishlist",
        phase: 4,
        name: "P4 wishlist",
        source: "manual",
        stats: {},
        slots: [{ slot: "waist", itemId: 30900, itemName: "Item 30900" }],
      },
      { replace: false },
    );
    expect(result.status).toBe("created");

    const sets = await repo.listGearSets();
    const p4 = sets.find((s) => s.characterId === kazrak.id && s.phase === 4)!;
    expect(p4.source).toBe("manual");
    expect(p4.slots).toHaveLength(1);
  });

  it("refuses to silently overwrite a phase that already has a set", async () => {
    const repo = getSqliteRepo();
    const kazrak = (await repo.findCharacterByName("Kazrak"))!;
    const draft = {
      characterId: kazrak.id,
      kind: "wishlist" as const,
      phase: 5 as const,
      name: "P5 wishlist",
      source: "manual" as const,
      stats: {},
      slots: [{ slot: "head" as const, itemId: 30901, itemName: "Item 30901" }],
    };
    expect((await repo.upsertGearSet(draft, { replace: false })).status).toBe("created");
    expect((await repo.upsertGearSet(draft, { replace: false })).status).toBe("exists");
    expect((await repo.upsertGearSet(draft, { replace: true })).status).toBe("replaced");
  });

  it("counts a hand-built list from any phase when reading what a raider asked for", async () => {
    // The point of the tool: the guild runs one phase with lists imported for
    // another, and the loot rules read every phase. A P5 list has to answer
    // "did they ask for this" while the guild is still on P2.
    const repo = getSqliteRepo();
    const kazrak = (await repo.findCharacterByName("Kazrak"))!;
    await repo.upsertGearSet(
      {
        characterId: kazrak.id,
        kind: "wishlist",
        phase: 5,
        name: "P5 wishlist",
        source: "manual",
        stats: {},
        slots: [{ slot: "waist", itemId: 40404, itemName: "Item 40404" }],
      },
      { replace: true },
    );
    const contention = await repo.getItemContention(40404);
    expect(contention?.wishers.some((w) => w.character.id === kazrak.id)).toBe(true);
  });
});
