import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getDataVersion, getDb } from "@/lib/data/db";
import { getSqliteRepo } from "@/lib/data/sqlite-repo";
import { normalizeItemName } from "@/lib/loot/priority-sheet";
import type { GearSetDraft, WclPlayerFightDraft, WriteRepo } from "@/lib/data/repo";
import type { Phase } from "@/lib/types";

/**
 * Invariant 3, half of it: **every write bumps `data_version`.**
 *
 * The other half — that the action ends in `refreshAfterWrite()` — is
 * `src/lib/auth/action-shape.test.ts`. Between them they cover the two caches
 * a write has to invalidate, and both failures are silent: the write commits,
 * the page serves the old value, and nothing anywhere says so.
 *
 * The discipline behind the bump is "copy a neighbour", which is exactly the
 * kind of rule a new method obeys ninety-five times and forgets once. So this
 * calls every method on `WriteRepo` and watches the number, and the reflective
 * test at the bottom means a method that is never listed here fails the build
 * rather than quietly going untested.
 *
 * ## Why the exceptions are asserted in the other direction
 *
 * `NO_BUMP` entries are asserted **not** to move the version, and each proves
 * its write actually landed before doing so — otherwise "did not bump" would
 * pass for a call that did nothing at all. That makes the list a claim checked
 * both ways: adding a bump to a board write is as red as removing one from its
 * neighbours, which is right, because the reason those five are exempt is a
 * measured cost rather than an oversight.
 *
 * ## What a case looks like
 *
 * `setup` runs first and its own writes are not counted — the version is read
 * between `setup` and `call`. Reads inside `call` are free. Where a method only
 * bumps when it changed something (`if (deleted) bumpDataVersion(db)` and its
 * kin), the call has to genuinely change something, which is why several of
 * these look more elaborate than "minimal".
 *
 * This lives beside `sqlite-repo.test.ts` rather than inside it: that file
 * tests what each write *means*, one behaviour per case, and this one tests a
 * single property of all of them at once by parsing the interface. They fail
 * for different reasons and are read at different times.
 */

/** Each test gets a fresh database file; the repo re-opens per path. */
function freshRepo(): WriteRepo {
  process.env.PROJECTLC_DB = path.join(mkdtempSync(path.join(tmpdir(), "projectlc-")), "test.db");
  return getSqliteRepo();
}

interface WriteCase<T> {
  /** Anything the call needs in place. Its writes are not counted. */
  setup?: (repo: WriteRepo) => Promise<T>;
  call: (repo: WriteRepo, from: T) => Promise<unknown>;
}

/**
 * Lets each entry infer its own setup type while the table stays one record.
 *
 * The cast is the price of that: `call` is contravariant in `T`, so a
 * `WriteCase<string>` is not assignable to `WriteCase<unknown>` however true it
 * is at the call site. Confined to this one line on purpose.
 */
const write = <T,>(c: WriteCase<T>): WriteCase<unknown> => c as WriteCase<unknown>;

const wishlist = (characterId: string, phase: Phase, itemId: number): GearSetDraft => ({
  characterId,
  kind: "wishlist",
  phase,
  name: `P${phase} contract list`,
  source: "sixtyupgrades",
  stats: { stamina: 100 },
  slots: [{ slot: "head", itemId, itemName: `Item ${itemId}` }],
});

const REPORT = {
  code: "CONTRACT00000001",
  title: "Contract night",
  zone: "Karazhan",
  startTime: "2026-06-10T19:00:00.000Z",
  endTime: "2026-06-10T22:30:00.000Z",
};

function fight(over: Partial<WclPlayerFightDraft> & { actorName: string }): WclPlayerFightDraft {
  return {
    fightId: 1,
    encounterId: 700,
    encounterName: "Attumen the Huntsman",
    kill: true,
    durationMs: 200000,
    role: "dps",
    deaths: 0,
    deathTimes: [],
    talents: [],
    elixirs: [],
    lateConsumables: [],
    scrolls: [],
    food: true,
    weaponBuff: true,
    prepot: false,
    potions: [],
    otherCasts: [],
    extras: [],
    cooldowns: [],
    castTimes: [],
    dispels: [],
    interrupts: [],
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

const SHEET = [
  "### Contract Boss",
  "| Item | Priority | Slot | Notes |",
  "|---|---|---|---|",
  "| Contract Blade | Rogue > MS > OS | Main Hand | |",
].join("\n");

/** An item the shipped P3 sheet files under Mount Hyjal, used to test the sheet backfill. */
const SHEET_ITEM = "Bracers of Martyrdom";

const emptyBoard = () => ({ groups: [[], [], [], [], [], [], [], []] });

const thrainn = async (repo: WriteRepo) => (await repo.findCharacterByName("Thrainn"))!;

/* ------------------------------------------------------------------------ */

/** Every write that must move `data_version`, with a call that really changes something. */
const BUMPS: Record<string, WriteCase<unknown>> = {
  upsertGearSet: write({
    call: async (repo) => repo.upsertGearSet(wishlist((await thrainn(repo)).id, 3, 34333), { replace: true }),
  }),
  deleteGearSet: write({
    call: async (repo) => {
      const set = (await repo.getCharacterBundle("thrainn"))!.wishlists[0].set;
      expect(await repo.deleteGearSet(set.id)).toBe(true);
    },
  }),
  setCurrentGearOverride: write({
    call: async (repo) =>
      repo.setCurrentGearOverride(
        (await thrainn(repo)).id,
        { slot: "head", itemId: 99770, itemName: "Contract Helm" },
        "manual",
      ),
  }),
  setCurrentGearOverrides: write({
    call: async (repo) =>
      repo.setCurrentGearOverrides(
        (await thrainn(repo)).id,
        [{ slot: "feet", itemId: 99771, itemName: "Contract Boots" }],
        "logs",
      ),
  }),
  clearCurrentGearOverride: write({
    setup: async (repo) => {
      const id = (await thrainn(repo)).id;
      await repo.setCurrentGearOverride(id, { slot: "head", itemId: 99770, itemName: "Contract Helm" }, "manual");
      return id;
    },
    call: async (repo, id) => expect(await repo.clearCurrentGearOverride(id, "head")).toBe(true),
  }),
  clearCurrentGearOverrides: write({
    setup: async (repo) => {
      const id = (await thrainn(repo)).id;
      await repo.setCurrentGearOverride(id, { slot: "head", itemId: 99770, itemName: "Contract Helm" }, "manual");
      return id;
    },
    call: async (repo, id) => expect(await repo.clearCurrentGearOverrides(id)).toBe(1),
  }),
  setGuildPolicy: write({
    call: async (repo) => repo.setGuildPolicy({ weights: { attendance: 40 } }),
  }),
  setActivePhase: write({
    call: async (repo) => {
      const before = (await repo.getGuild()).activePhase;
      return repo.setActivePhase(before === 3 ? 2 : 3);
    },
  }),
  setItemPriorityRule: write({
    call: async (repo) => repo.setItemPriorityRule({ itemName: "Gorehowl", phase: 2, chain: "DPS Warrior > MS" }),
  }),
  moveItemPriorityRule: write({
    setup: async (repo) => {
      await repo.setItemPriorityRule({ itemName: "Gorehowl", phase: 2, chain: "DPS Warrior > MS" });
    },
    call: async (repo) =>
      expect(await repo.moveItemPriorityRule({ itemName: "Gorehowl", fromPhase: 2, toPhase: 1 })).toEqual({ ok: true }),
  }),
  setPrioritySheet: write({
    call: async (repo) => expect(await repo.setPrioritySheet({ phase: 4, markdown: SHEET })).toEqual({ ok: true, ruleCount: 1 }),
  }),
  deletePrioritySheet: write({
    setup: async (repo) => {
      await repo.setPrioritySheet({ phase: 4, markdown: SHEET });
    },
    call: async (repo) => expect(await repo.deletePrioritySheet(4)).toEqual({ ok: true }),
  }),
  setWishlistAlternatives: write({
    call: async (repo) =>
      expect(
        await repo.setWishlistAlternatives({
          characterId: (await thrainn(repo)).id,
          phase: 3,
          slot: "waist",
          items: [{ itemId: 99772, itemName: "Contract Belt" }],
        }),
      ).toEqual({ ok: true }),
  }),
  upsertBossDrops: write({
    call: async (repo) =>
      expect(
        await repo.upsertBossDrops([{ zone: "Black Temple", boss: "Supremus", itemName: "Contract Belt" }]),
      ).toBe(1),
  }),
  deleteBossDrop: write({
    setup: async (repo) => {
      await repo.upsertBossDrops([{ zone: "Black Temple", boss: "Supremus", itemName: "Contract Belt" }]);
    },
    call: async (repo) => expect(await repo.deleteBossDrop("Black Temple", "Supremus", "Contract Belt")).toBe(true),
  }),
  seedFoundationalDrops: write({
    // Writes through upsertBossDrops, which is where its bump comes from.
    call: async (repo) => expect((await repo.seedFoundationalDrops()).fromSheets).toBeGreaterThan(0),
  }),
  setGuildDropOverride: write({
    call: async (repo) =>
      expect(
        await repo.setGuildDropOverride({
          zone: "Black Temple",
          boss: "Supremus",
          itemName: "Homebrew",
          action: "add",
        }),
      ).toEqual({ ok: true }),
  }),
  clearGuildDropOverride: write({
    setup: async (repo) => {
      await repo.setGuildDropOverride({
        zone: "Black Temple",
        boss: "Supremus",
        itemName: "Homebrew",
        action: "add",
      });
    },
    call: async (repo) => expect(await repo.clearGuildDropOverride("Black Temple", "Supremus", "Homebrew")).toBe(true),
  }),
  addBossComment: write({
    call: async (repo) =>
      expect((await repo.addBossComment({ zone: "Black Temple", boss: "Supremus", body: "Contract note" })).ok).toBe(true),
  }),
  deleteBossComment: write({
    setup: async (repo) => {
      const added = await repo.addBossComment({ zone: "Black Temple", boss: "Supremus", body: "Contract note" });
      if (!added.ok) throw new Error(added.error);
      return added.comment.id;
    },
    call: async (repo, id) => expect(await repo.deleteBossComment(id)).toBe(true),
  }),
  setGuide: write({
    call: async (repo) =>
      repo.setGuide({
        kind: "class",
        subject: "Warrior",
        section: "",
        owner: (await repo.getGuild()).id,
        body: "Show up enchanted.",
        sources: [],
      }),
  }),
  createCharacter: write({
    call: async (repo) =>
      expect(
        (await repo.createCharacter({
          name: "Contractguy",
          class: "Rogue",
          spec: "Combat",
          role: "Melee DPS",
          status: "main",
        })).ok,
      ).toBe(true),
  }),
  updateCharacter: write({
    call: async (repo) => {
      const c = await thrainn(repo);
      return repo.updateCharacter(c.id, {
        name: c.name,
        class: c.class,
        spec: c.spec,
        role: c.role,
        status: "inactive",
      });
    },
  }),
  deleteCharacter: write({
    call: async (repo) => expect((await repo.deleteCharacter((await thrainn(repo)).id)).ok).toBe(true),
  }),
  createRaidSessionWithAwards: write({
    call: async (repo) =>
      expect(
        (
          await repo.createRaidSessionWithAwards({ date: "2026-06-11", zones: ["Karazhan"], source: "gargul" }, [
            {
              rawWinnerName: "Thrainn",
              itemId: 99901,
              itemName: "Contract Blade",
              awardedAt: "2026-06-11T21:00:00",
              offspec: false,
            },
          ])
        ).inserted,
      ).toBe(1),
  }),
  resolveAward: write({
    setup: async (repo) => {
      await repo.createRaidSessionWithAwards({ date: "2026-06-11", zones: ["Karazhan"], source: "gargul" }, [
        {
          rawWinnerName: "Nobodyhere",
          itemId: 99902,
          itemName: "Contract Blade",
          awardedAt: "2026-06-11T21:00:00",
          offspec: false,
        },
      ]);
      return (await repo.listLootAwards()).find((a) => a.award.itemId === 99902)!.award.id;
    },
    call: async (repo, id) => expect((await repo.resolveAward(id, { kind: "external" })).ok).toBe(true),
  }),
  addLootAward: write({
    call: async (repo) => {
      const session = (await repo.listRaidSessions())[0];
      const winner = await thrainn(repo);
      return expect(
        (
          await repo.addLootAward(session.id, {
            itemId: 99903,
            itemName: "Contract Blade",
            rawWinnerName: winner.name,
            characterId: winner.id,
            external: false,
            offspec: false,
          })
        ).ok,
      ).toBe(true);
    },
  }),
  updateLootAward: write({
    call: async (repo) => {
      const existing = (await repo.listLootAwards())[0].award;
      return expect(
        (
          await repo.updateLootAward(existing.id, {
            itemId: existing.itemId,
            itemName: existing.itemName,
            rawWinnerName: existing.rawWinnerName,
            characterId: existing.characterId,
            external: existing.external,
            offspec: !existing.offspec,
          })
        ).ok,
      ).toBe(true);
    },
  }),
  deleteLootAward: write({
    call: async (repo) => expect(await repo.deleteLootAward((await repo.listLootAwards())[0].award.id)).toBe(true),
  }),
  deleteRaidSession: write({
    call: async (repo) => expect((await repo.deleteRaidSession((await repo.listRaidSessions())[0].id)).ok).toBe(true),
  }),
  saveWclReport: write({
    call: async (repo) => expect((await repo.saveWclReport(REPORT, [fight({ actorName: "Pyrelia" })])).ok).toBe(true),
  }),
  deleteWclReport: write({
    setup: async (repo) => {
      await repo.saveWclReport(REPORT, [fight({ actorName: "Pyrelia" })]);
    },
    call: async (repo) => expect((await repo.deleteWclReport(REPORT.code)).ok).toBe(true),
  }),
  updateWclReportMeta: write({
    setup: async (repo) => {
      await repo.saveWclReport(REPORT, [fight({ actorName: "Pyrelia" })]);
    },
    call: async (repo) => expect((await repo.updateWclReportMeta(REPORT.code, { title: "Renamed" })).ok).toBe(true),
  }),
  setReportConsumablePrices: write({
    call: async (repo) => repo.setReportConsumablePrices(REPORT.code, { "Haste Potion": { gold: 42, charges: 1 } }),
  }),
  setReportPayback: write({
    call: async (repo) => repo.setReportPayback(REPORT.code, { marks: 12, markGold: 40, paid: { Thrainn: 200 } }),
  }),
  setSimProfile: write({
    call: async (repo) => repo.setSimProfile("Warrior", "Fury", '{"contract":true}'),
  }),
  addAbilities: write({
    call: async (repo) =>
      expect(await repo.addAbilities([{ kind: "spell", id: 99904, name: "Contract Shout" }])).toBe(1),
  }),
  setReportExcludedFights: write({
    setup: async (repo) => {
      await repo.saveWclReport(REPORT, [fight({ actorName: "Pyrelia" })]);
    },
    call: async (repo) => repo.setReportExcludedFights(REPORT.code, [1]),
  }),
  setReportConsumableAdjustments: write({
    call: async (repo) =>
      repo.setReportConsumableAdjustments(REPORT.code, [
        { actorName: "Thrainn", name: "Food", delta: 1, at: "2026-08-02T20:00:00.000Z" },
      ]),
  }),
  setAttendanceExemption: write({
    call: async (repo) => {
      const kazrak = (await repo.findCharacterByName("Kazrak"))!;
      return expect(await repo.setAttendanceExemption(kazrak.id, "2026-06-10", true)).toEqual({ ok: true });
    },
  }),
  addCharacterComment: write({
    call: async (repo) =>
      expect(
        (
          await repo.addCharacterComment({
            characterId: (await thrainn(repo)).id,
            category: "attendance",
            body: "Contract note",
          })
        ).ok,
      ).toBe(true),
  }),
  addItemComment: write({
    call: async (repo) =>
      expect((await repo.addItemComment({ itemId: 30900, voice: "officer", body: "Contract note" })).ok).toBe(true),
  }),
  deleteItemComment: write({
    setup: async (repo) => {
      const added = await repo.addItemComment({ itemId: 30900, voice: "officer", body: "Contract note" });
      if (!added.ok) throw new Error(added.error);
      return added.comment.id;
    },
    call: async (repo, id) => expect(await repo.deleteItemComment(id)).toBe(true),
  }),
  deleteCharacterComment: write({
    setup: async (repo) => {
      const added = await repo.addCharacterComment({
        characterId: (await thrainn(repo)).id,
        category: "attendance",
        body: "Contract note",
      });
      if (!added.ok) throw new Error(added.error);
      return added.comment.id;
    },
    call: async (repo, id) => expect(await repo.deleteCharacterComment(id)).toBe(true),
  }),
  addFeedback: write({
    call: async (repo) =>
      expect(
        (await repo.addFeedback({ body: "Contract report", route: "/logs", url: "http://localhost:3000/logs" })).ok,
      ).toBe(true),
  }),
  setFeedbackStatus: write({
    setup: async (repo) => {
      const added = await repo.addFeedback({ body: "Contract report", route: "/logs", url: "http://localhost:3000/logs" });
      if (!added.ok) throw new Error(added.error);
      return added.report.id;
    },
    call: async (repo, id) => expect(await repo.setFeedbackStatus(id, "resolved")).toBe(true),
  }),
  setFeedbackTriage: write({
    setup: async (repo) => {
      const added = await repo.addFeedback({ body: "Contract report", route: "/logs", url: "http://localhost:3000/logs" });
      if (!added.ok) throw new Error(added.error);
      return added.report.id;
    },
    call: async (repo, id) => expect(await repo.setFeedbackTriage(id, { priority: "major" })).toBe(true),
  }),
  deleteFeedback: write({
    setup: async (repo) => {
      const added = await repo.addFeedback({ body: "Contract report", route: "/logs", url: "http://localhost:3000/logs" });
      if (!added.ok) throw new Error(added.error);
      return added.report.id;
    },
    call: async (repo, id) => expect(await repo.deleteFeedback(id)).toBe(true),
  }),
  setSheetItemId: write({
    setup: async (repo) => {
      await repo.addItemsIfMissing([{ id: 99905, name: "Hammer of Judgement" }]);
    },
    call: async (repo) => expect((await repo.setSheetItemId("Hammer of Judgment", 99905)).ok).toBe(true),
  }),
  addItemsIfMissing: write({
    call: async (repo) => expect(await repo.addItemsIfMissing([{ id: 99906, name: "Contract Item" }])).toBe(1),
  }),
  saveResolvedItems: write({
    // Its return value counts *corrections*, not rows written — an id the cache
    // had never heard of was learned, not corrected — so the read is the proof.
    call: async (repo) => {
      await repo.saveResolvedItems([{ id: 99907, name: "Contract Item", quality: "epic" }]);
      expect((await repo.getItem(99907))!.name).toBe("Contract Item");
    },
  }),
  saveTokenRedemptions: write({
    call: async (repo) => expect(await repo.saveTokenRedemptions([{ pieceId: 30166, tokenId: 30242 }])).toBe(1),
  }),
  setItemCuration: write({
    call: async (repo) =>
      expect(await repo.setItemCuration(28830, { phase: 2, source: { zone: "Karazhan" } })).toEqual({ ok: true }),
  }),
  unverifyItem: write({
    setup: async (repo) => {
      await repo.saveResolvedItems([{ id: 99908, name: "Contract Item", quality: "epic" }]);
    },
    call: async (repo) => expect(await repo.unverifyItem(99908)).toEqual({ ok: true }),
  }),
  addEnchantNames: write({
    call: async (repo) => expect(await repo.addEnchantNames([{ id: 99909, name: "Contract Enchant" }])).toBe(1),
  }),
  recordRefusedItemNames: write({
    call: async (repo) => {
      const name = "Warglaive of Azzinoth (Main Hand)";
      return expect(
        await repo.recordRefusedItemNames([
          { nameKey: normalizeItemName(name), name, reason: "ambiguous", near: [] },
        ]),
      ).toBe(1);
    },
  }),
  clearRefusedItemNames: write({
    setup: async (repo) => {
      const name = "Warglaive of Azzinoth (Main Hand)";
      await repo.recordRefusedItemNames([{ nameKey: normalizeItemName(name), name, reason: "unknown", near: [] }]);
    },
    call: async (repo) => expect(await repo.clearRefusedItemNames()).toBe(1),
  }),
  harvestItemCache: write({
    // The icon on a logged pull's gear snapshot is the fact this digs out; no
    // other writer merges it, which is why the harvest exists at all.
    setup: async (repo) => {
      await repo.saveWclReport(REPORT, [
        fight({
          actorName: "Pyrelia",
          gear: [{ slot: 0, id: 99910, name: "Contract Crown", icon: "inv_helmet_01", gems: [] }],
        }),
      ]);
    },
    call: async (repo) => expect(await repo.harvestItemCache()).toBeGreaterThan(0),
  }),
  applyCuratedItemSources: write({
    // A row the resolver stripped: name confirmed, zone and phase gone. The
    // shipped list still knows where the real 28830 drops.
    setup: async (repo) => {
      await repo.saveResolvedItems([{ id: 28830, name: "Something Else Entirely", quality: "epic" }]);
    },
    call: async (repo) => expect(await repo.applyCuratedItemSources()).toBeGreaterThan(0),
  }),
  applySheetItemSources: write({
    setup: async (repo) => {
      await repo.addItemsIfMissing([{ id: 99911, name: SHEET_ITEM }]);
    },
    call: async (repo) => expect(await repo.applySheetItemSources()).toBe(1),
  }),
  repairPlaceholderAwardNames: write({
    setup: async (repo) => {
      await repo.createRaidSessionWithAwards({ date: "2026-06-11", zones: ["Karazhan"], source: "gargul" }, [
        {
          rawWinnerName: "Thrainn",
          itemId: 99912,
          itemName: "Item #99912",
          awardedAt: "2026-06-11T21:00:00",
          offspec: false,
        },
      ]);
      await repo.saveResolvedItems([{ id: 99912, name: "Contract Blade", quality: "epic" }]);
    },
    call: async (repo) => expect(await repo.repairPlaceholderAwardNames()).toBe(1),
  }),
  purgeDemoData: write({
    call: async (repo) => expect((await repo.purgeDemoData()).characters).toBeGreaterThan(0),
  }),
};

/* ------------------------------------------------------------------------ */

/**
 * The methods on `WriteRepo` that deliberately leave `data_version` alone.
 *
 * Two kinds, and only two. Anything else added here is a bug being written
 * down rather than an exception being made — the failure it hides is an
 * officer's save that the page keeps serving the old value for.
 */
const NO_BUMP: Record<string, { why: string; case: WriteCase<unknown> }> = {
  findCharacterByName: {
    why: "A read. It sits on WriteRepo because resolving a name is the first step of the write flows, not because it writes.",
    case: write({ call: async (repo) => expect((await repo.findCharacterByName("Thrainn"))!.name).toBe("Thrainn") }),
  },
  findExistingSet: {
    why: "A read — 'what would this import overwrite'. The answer is shown to the officer before anything is stored.",
    case: write({
      call: async (repo) =>
        expect(await repo.findExistingSet((await thrainn(repo)).id, "wishlist", 1)).toBeDefined(),
    }),
  },

  /*
   * The five board writes. The bump exists to rebuild the derived read model,
   * and nothing derived reads a board — every getter goes straight to the meta
   * table. A bump would rebuild every pull row of every report and change not
   * one byte of the result, while these autosave as an officer drags people
   * around, which turns that waste into lag. See the comment above
   * `setRaidBoard` in sqlite-repo.ts, and change-chains §3.
   *
   * If a board ever starts feeding something derived, the bump has to come
   * back and the entry has to move to BUMPS. That is the change this list is
   * here to make somebody notice.
   */
  setRaidBoard: {
    why: "Board write — nothing derived reads it, and it autosaves per drag.",
    case: write({
      call: async (repo) => {
        await repo.setRaidBoard("RPT1", { groups: [[{ name: "Pyrelia" }], [], [], [], [], [], [], []] });
        expect((await repo.getRaidBoard("RPT1")).groups[0]).toEqual([{ name: "Pyrelia" }]);
      },
    }),
  },
  setTemplateBoard: {
    why: "Board write — the planning template, read straight from meta.",
    case: write({
      call: async (repo) => {
        await repo.setTemplateBoard({ groups: [[{ name: "Pyrelia" }], [], [], [], [], [], [], []] });
        expect((await repo.getTemplateBoard()).groups[0]).toEqual([{ name: "Pyrelia" }]);
      },
    }),
  },
  createGuildRoster: {
    why: "Board write — a named roster is one meta row nothing derived consults.",
    case: write({
      call: async (repo) => {
        await repo.createGuildRoster({
          id: "gr_contract",
          name: "Contract roster",
          createdAt: "2026-06-11T19:00:00.000Z",
          prospects: [],
          board: emptyBoard(),
        });
        expect((await repo.listGuildRosters()).map((r) => r.id)).toContain("gr_contract");
      },
    }),
  },
  updateGuildRoster: {
    why: "Board write — a rename or a drag on a roster nothing derived consults.",
    case: write({
      setup: async (repo) => {
        await repo.createGuildRoster({
          id: "gr_contract",
          name: "Contract roster",
          createdAt: "2026-06-11T19:00:00.000Z",
          prospects: [],
          board: emptyBoard(),
        });
      },
      call: async (repo) => {
        await repo.updateGuildRoster("gr_contract", { name: "Renamed roster" });
        expect((await repo.listGuildRosters()).find((r) => r.id === "gr_contract")!.name).toBe("Renamed roster");
      },
    }),
  },
  deleteGuildRoster: {
    why: "Board write — unlike a raid night, a roster records nothing that happened.",
    case: write({
      setup: async (repo) => {
        await repo.createGuildRoster({
          id: "gr_contract",
          name: "Contract roster",
          createdAt: "2026-06-11T19:00:00.000Z",
          prospects: [],
          board: emptyBoard(),
        });
      },
      call: async (repo) => {
        await repo.deleteGuildRoster("gr_contract");
        expect((await repo.listGuildRosters()).map((r) => r.id)).not.toContain("gr_contract");
      },
    }),
  },
};

/* ------------------------------------------------------------------------ */

async function run(c: WriteCase<unknown>): Promise<{ before: number; after: number }> {
  const repo = freshRepo();
  const from = c.setup ? await c.setup(repo) : undefined;
  const before = getDataVersion(getDb());
  await c.call(repo, from);
  return { before, after: getDataVersion(getDb()) };
}

describe("every write bumps data_version", () => {
  it.each(Object.keys(BUMPS))("%s", async (name) => {
    const { before, after } = await run(BUMPS[name]);
    expect(
      after,
      `${name} changed the database and left data_version at ${before}. The in-memory read model ` +
        "is keyed on that number, so every page keeps serving what it built before this write — " +
        "silently, with nothing failing. End the transaction with bumpDataVersion(db), the way " +
        "its neighbours in sqlite-repo.ts do.",
    ).toBeGreaterThan(before);
  });
});

describe("the writes that deliberately do not", () => {
  it.each(Object.keys(NO_BUMP))("%s", async (name) => {
    const { before, after } = await run(NO_BUMP[name].case);
    expect(
      after,
      `${name} bumped data_version, which NO_BUMP says it must not: ${NO_BUMP[name].why} ` +
        "If that reason has lapsed — a board now feeds something derived, say — the bump is " +
        "right and the entry belongs in BUMPS instead.",
    ).toBe(before);
  });
});

/**
 * The reflective half: a new writer fails until somebody has decided which
 * table it belongs in.
 *
 * TypeScript interfaces do not exist at runtime, so this reads the source. The
 * same approach as `docs.test.ts` and `routes.test.ts`, and the same caveat —
 * it is a regex over a shape, so it is pinned by a count below to stop a parse
 * that silently matches nothing from passing.
 */
function declaredWriteMethods(): string[] {
  const source = readFileSync(path.resolve(__dirname, "./repo.ts"), "utf8");
  const start = source.indexOf("export interface WriteRepo extends Repo {");
  expect(start, "WriteRepo is no longer declared the way this test finds it").toBeGreaterThan(-1);
  // Block comments first: several methods carry a `foo(` inside their prose.
  const body = source.slice(start).replace(/\/\*[\s\S]*?\*\//g, "");
  // One indent level is the interface's own members; anything deeper is a
  // parameter or a nested type.
  return [...body.matchAll(/^ {2}([a-zA-Z_]\w*)[(<]/gm)].map((m) => m[1]);
}

describe("the tables above cover the interface", () => {
  const declared = declaredWriteMethods();
  const listed = new Set([...Object.keys(BUMPS), ...Object.keys(NO_BUMP)]);

  it("finds the interface at all, so an empty parse cannot pass", () => {
    expect(declared.length).toBeGreaterThan(50);
  });

  it("has a case for every method on WriteRepo", () => {
    const missing = declared.filter((m) => !listed.has(m)).sort();
    expect(
      missing,
      "A new method on WriteRepo with no case here is untested against invariant 3. Add it to " +
        "BUMPS with a call that really changes something, or — if it genuinely must not bump — " +
        "to NO_BUMP with the argument for why.",
    ).toEqual([]);
  });

  it("names no method that has been removed", () => {
    // A stale entry is a claim about an interface that no longer says it, and
    // the next reader believes it. Delete it when the method goes.
    const stale = [...listed].filter((m) => !declared.includes(m)).sort();
    expect(stale, "BUMPS or NO_BUMP names a method WriteRepo no longer declares").toEqual([]);
  });
});
