import { randomUUID } from "node:crypto";
import {
  addEnchantNames,
  bumpDataVersion,
  getDataVersion,
  deleteItemPriorityRule,
  getAllConsumableAdjustments,
  getAllExcludedFights,
  getDb,
  getEnchantNames,
  getReportConsumableAdjustments,
  setReportConsumableAdjustments,
  getItemPriorityRules,
  getPrioritySheets,
  getClassGuides,
  getWishlistAlternatives,
  setWishlistAlternative,
  deleteWishlistAlternative,
  setClassGuide,
  deleteClassGuide,
  setPrioritySheet,
  deletePrioritySheet,
  getGuildPolicy,
  setGuildPolicy,
  getGuildRoster,
  getRaidBoard,
  getReportConsumablePrices,
  getTemplateBoard,
  listGuildRosters,
  getSimProfile,
  listSimProfiles,
  listStrandedSimSettings,
  getAbilities,
  getReportExcludedFights,
  insertAttendanceExemption,
  insertCharacter,
  insertCharacterComment,
  insertItemComment,
  deleteItemComment,
  insertFeedback,
  insertCurrentGearOverride,
  insertGearSet,
  insertLootAward,
  insertRaidSession,
  insertWclPlayerFight,
  insertWclPlayerOffPull,
  insertWclReport,
  loadStore,
  mergeItems,
  mergeTokenRedemptions,
  setItemPriorityRule,
  setGuildRoster,
  updateGuildRoster,
  deleteGuildRoster,
  setRaidBoard,
  setReportConsumablePrices,
  setTemplateBoard,
  setSimProfile,
  addAbilities,
  setReportExcludedFights,
  withTx,
} from "@/lib/data/db";
import type { TokenRedemptionEdge } from "@/lib/items/tier-tokens";
import { createRepoFromStore } from "@/lib/data/store";
import { normalizeItemName, parsePrioritySheet } from "@/lib/loot/priority-sheet";
import { parsePriorityChain } from "@/lib/loot/priority-chain";
import { CLASS_SPECS, PHASE_IDS, WOW_CLASSES } from "@/lib/constants/wow";
import type { PolicyOverrides } from "@/lib/analysis/policy";
import { buildPolicyPreview } from "@/lib/analysis/policy-preview";
import { renumber, type WishlistAlternative } from "@/lib/analysis/wishlist-alternatives";
import { harvestItemFacts, isPlaceholderName } from "@/lib/items/item-data";
import { loadSeedStore } from "@/lib/data/seed-data";
import { TRACKED_AURA_NAMES } from "@/lib/wcl/class-tracks";
import {
  characterCommentSchema,
  itemCommentSchema,
  characterSchema,
  feedbackReportSchema,
  currentGearOverrideSchema,
  gearSetSchema,
  lootAwardSchema,
  phaseSchema,
  wclPlayerFightSchema,
  wclPlayerOffPullSchema,
  wclReportSchema,
} from "@/lib/import/schemas";
import type {
  AddCommentResult,
  AwardDraft,
  AwardEditInput,
  AwardResolution,
  AwardWriteResult,
  AddFeedbackResult,
  CharacterCommentDraft,
  ItemCommentDraft,
  AddItemCommentResult,
  FeedbackDraft,
  DeleteSessionResult,
  CharacterDraft,
  CharacterWriteResult,
  DeleteCharacterResult,
  GargulCommitResult,
  GearSetDraft,
  PurgeDemoResult,
  Repo,
  RaidSessionDraft,
  ResolveAwardResult,
  SetCurrentGearOverrideResult,
  SetCurrentGearOverridesResult,
  UpsertGearSetResult,
  WclPlayerFightDraft,
  WclPlayerOffPullDraft,
  WclReportDraft,
  WclSaveResult,
  WriteRepo,
} from "@/lib/data/repo";
import type {
  AwardDecision,
  Character,
  CharacterComment,
  ItemComment,
  FeedbackReport,
  FeedbackStatus,
  CurrentGearOverride,
  GearOverrideSource,
  GearSet,
  GearSpec,
  Item,
  LootAward,
  Phase,
  RaidSession,
  SlotId,
  SlotItem,
  WclPlayerFight,
  WclPlayerOffPull,
} from "@/lib/types";

/**
 * SQLite-backed repository. Reads go through the same derived read model as
 * the seed backend (createRepoFromStore); the model is rebuilt lazily whenever
 * the database's data_version changes, which every mutation bumps. At guild
 * scale a full rebuild is ~1ms, so correctness wins over cleverness.
 */

interface CachedModel {
  dbPath: string;
  version: number;
  repo: Repo;
  store: ReturnType<typeof loadStore>;
}

const globalCache = globalThis as unknown as { __projectlcModel?: CachedModel };

function readModel(): CachedModel {
  const db = getDb();
  const version = getDataVersion(db);
  const cached = globalCache.__projectlcModel;
  const dbPath = process.env.PROJECTLC_DB ?? "";
  if (cached && cached.version === version && cached.dbPath === dbPath) return cached;
  const store = loadStore(db);
  const model: CachedModel = {
    dbPath,
    version,
    repo: createRepoFromStore(store, {
      excludedFightsByCode: getAllExcludedFights(db),
      policy: getGuildPolicy(db),
      itemPriorityRules: getItemPriorityRules(db),
      prioritySheetsByPhase: getPrioritySheets(db),
      classGuides: getClassGuides(db),
      wishlistAlternatives: getWishlistAlternatives(db) as WishlistAlternative[],
      enchantNames: getEnchantNames(db),
      consumableAdjustmentsByCode: getAllConsumableAdjustments(db),
    }),
    store,
  };
  globalCache.__projectlcModel = model;
  return model;
}

function getGearSetById(setId: string): GearSet | undefined {
  return readModel().store.gearSets.find((s) => s.id === setId);
}

function findExisting(characterId: string, kind: GearSet["kind"], phase?: GearSet["phase"]): GearSet | undefined {
  return readModel().store.gearSets.find(
    (s) => s.characterId === characterId && s.kind === kind && (kind === "current" || s.phase === phase),
  );
}

function characterByName(name: string): Character | undefined {
  const lower = name.trim().toLowerCase();
  return readModel().store.roster.find((c) => c.name.toLowerCase() === lower);
}

function nameTaken(name: string, exceptId?: string): boolean {
  const existing = characterByName(name);
  return existing !== undefined && existing.id !== exceptId;
}

/** Shared shape check for a manual/edited award before it touches the database. */
function checkAwardInput(input: AwardEditInput): { ok: true } | { ok: false; error: string } {
  if (!Number.isInteger(input.itemId) || input.itemId <= 0) {
    return { ok: false, error: "Enter a valid item id." };
  }
  if (!input.itemName.trim()) return { ok: false, error: "An item name is required." };
  if (!input.rawWinnerName.trim()) return { ok: false, error: "A winner is required." };
  if (input.characterId !== null) {
    if (input.external) return { ok: false, error: "An award linked to a character can't also be off-roster." };
    if (!readModel().store.roster.some((c) => c.id === input.characterId)) {
      return { ok: false, error: "That character no longer exists." };
    }
  }
  return { ok: true };
}

/**
 * The board as it reads right now, for the winner about to be given the item.
 *
 * Returns undefined when there is nothing to freeze — the item was never
 * contested, or the winner wasn't on the board. Absent is honest: it says the
 * award didn't come from the ranking, which is a different fact from a low
 * score, and the ledger must never present it as one.
 */
async function captureDecision(
  itemId: number,
  characterId: string,
): Promise<AwardDecision | undefined> {
  const contention = await readModel().repo.getItemContention(itemId);
  const wisher = contention?.wishers.find((w) => w.character.id === characterId);
  if (!contention || !wisher) return undefined;

  const policy = await readModel().repo.getGuildPolicy();
  return {
    score: wisher.priority?.score,
    rank: wisher.rank,
    contenders: contention.wishers.filter((w) => !w.satisfied).length,
    factors: (wisher.priority?.factors ?? []).map((f) => ({
      label: f.label,
      score: f.score,
      weight: f.weight,
      detail: f.detail,
    })),
    adjustments: (wisher.priority?.adjustments ?? []).map((a) => ({
      label: a.label,
      multiplier: a.multiplier,
      note: a.note,
    })),
    chain: contention.priorityRule?.chain,
    tierLabel: wisher.priorityTierLabel,
    weights: policy.weights,
    capturedAt: new Date().toISOString(),
  };
}

const writeMethods: Omit<WriteRepo, keyof Repo> = {
  async findCharacterByName(name) {
    return characterByName(name);
  },

  async findExistingSet(characterId, kind, phase) {
    return findExisting(characterId, kind, phase);
  },

  async upsertGearSet(draft: GearSetDraft, opts: { replace: boolean }): Promise<UpsertGearSetResult> {
    const db = getDb();
    const set = gearSetSchema.parse({
      ...draft,
      id: `gs_${randomUUID()}`,
      importedAt: new Date().toISOString(),
    } satisfies GearSet);

    const existing = findExisting(draft.characterId, draft.kind, draft.phase);
    if (existing && !opts.replace) return { status: "exists", existing };

    withTx(db, () => {
      if (existing) db.prepare("DELETE FROM gear_sets WHERE id = ?").run(existing.id);
      insertGearSet(db, set);
      mergeItems(db, harvestItemFacts({ gearSets: [set], lootAwards: [], wclPlayerFights: [] }));
      bumpDataVersion(db);
    });
    return existing ? { status: "replaced", set, previous: existing } : { status: "created", set };
  },

  async deleteGearSet(setId: string): Promise<boolean> {
    const db = getDb();
    let deleted = false;
    withTx(db, () => {
      const result = db.prepare("DELETE FROM gear_sets WHERE id = ?").run(setId);
      deleted = result.changes > 0;
      if (deleted) bumpDataVersion(db);
    });
    return deleted;
  },

  async setCurrentGearOverride(
    characterId: string,
    item: SlotItem,
    source: GearOverrideSource,
    spec: GearSpec = "main",
  ): Promise<SetCurrentGearOverrideResult> {
    if (!readModel().store.roster.some((c) => c.id === characterId)) {
      return { ok: false, error: "Character not found." };
    }
    const parsed = currentGearOverrideSchema.safeParse({
      characterId,
      item,
      source,
      spec,
      setAt: new Date().toISOString(),
    } satisfies CurrentGearOverride);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid gear override." };
    }
    const db = getDb();
    withTx(db, () => {
      insertCurrentGearOverride(db, parsed.data);
      // The pinned item is now referenced by the profile — teach the cache
      // whatever name came with it, like any other import does.
      mergeItems(db, [{ id: item.itemId, name: item.itemName, slot: item.slot }]);
      bumpDataVersion(db);
    });
    return { ok: true, override: parsed.data };
  },

  async setCurrentGearOverrides(
    characterId: string,
    items: SlotItem[],
    source: GearOverrideSource,
    opts: { replace?: boolean; spec?: GearSpec } = {},
  ): Promise<SetCurrentGearOverridesResult> {
    if (!readModel().store.roster.some((c) => c.id === characterId)) {
      return { ok: false, error: "Character not found." };
    }
    const spec = opts.spec ?? "main";
    const alreadyPinned = new Set(
      readModel()
        .store.currentGearOverrides.filter((o) => o.characterId === characterId && o.spec === spec)
        .map((o) => o.item.slot),
    );
    const setAt = new Date().toISOString();
    const parsed: CurrentGearOverride[] = [];
    let kept = 0;
    for (const item of items) {
      // A slot an officer set by hand outranks a bulk pass — it's the more
      // deliberate statement of the two.
      if (!opts.replace && alreadyPinned.has(item.slot)) {
        kept++;
        continue;
      }
      const result = currentGearOverrideSchema.safeParse({
        characterId,
        item,
        source,
        spec,
        setAt,
      } satisfies CurrentGearOverride);
      if (!result.success) {
        return { ok: false, error: result.error.issues[0]?.message ?? "Invalid gear override." };
      }
      parsed.push(result.data);
    }
    if (parsed.length === 0) return { ok: true, written: 0, kept };

    const db = getDb();
    withTx(db, () => {
      for (const override of parsed) insertCurrentGearOverride(db, override);
      mergeItems(
        db,
        parsed.map((o) => ({ id: o.item.itemId, name: o.item.itemName, slot: o.item.slot })),
      );
      bumpDataVersion(db);
    });
    return { ok: true, written: parsed.length, kept };
  },

  async clearCurrentGearOverride(
    characterId: string,
    slot: SlotId,
    spec: GearSpec = "main",
  ): Promise<boolean> {
    const db = getDb();
    let cleared = false;
    withTx(db, () => {
      cleared = Number(
        db.prepare("DELETE FROM current_gear_overrides WHERE character_id = ? AND spec = ? AND slot = ?")
          .run(characterId, spec, slot).changes,
      ) > 0;
      if (cleared) bumpDataVersion(db);
    });
    return cleared;
  },

  async setActivePhase(phase: Phase) {
    const parsed = phaseSchema.safeParse(phase);
    if (!parsed.success) return { ok: false as const, error: "That isn't a phase this app knows." };
    const db = getDb();
    withTx(db, () => {
      db.prepare("UPDATE guild SET active_phase = ?").run(parsed.data);
      // Everything phase-scoped is derived, so the read model has to rebuild.
      bumpDataVersion(db);
    });
    return { ok: true as const };
  },

  async setGuildPolicy(overrides: PolicyOverrides) {
    // A weighting that is zero everywhere would divide by zero and rank nobody.
    // Every other field is clamped on write, so this is the only cross-field
    // rule the record has.
    const weights = overrides.weights;
    if (weights) {
      const given = Object.values(weights).filter((v) => typeof v === "number");
      if (given.length > 0 && given.every((v) => v === 0)) {
        return { ok: false as const, error: "At least one factor has to carry some weight." };
      }
    }
    const db = getDb();
    withTx(db, () => {
      setGuildPolicy(db, overrides);
      // The policy is baked into the read model — force a rebuild.
      bumpDataVersion(db);
    });
    return { ok: true as const };
  },

  async setItemPriorityRule(itemName: string, chain: string, note?: string) {
    const name = itemName.trim();
    if (!name) return { ok: false as const, error: "An item name is required." };
    const key = normalizeItemName(name);
    if (!key) return { ok: false as const, error: "That item name has nothing to match on." };

    const db = getDb();
    const trimmed = chain.trim();
    // An empty chain is how an officer says "use the guild's sheet again".
    if (!trimmed) {
      withTx(db, () => {
        if (deleteItemPriorityRule(db, key)) bumpDataVersion(db);
      });
      return { ok: true as const };
    }

    const parsed = parsePriorityChain(trimmed);
    if (parsed.tiers.length === 0) {
      return { ok: false as const, error: "Write the chain as “Hunter > DPS Warrior > MS > OS”." };
    }
    withTx(db, () => {
      setItemPriorityRule(db, key, { itemName: name, chain: trimmed, note: note?.trim() || undefined });
      bumpDataVersion(db);
    });
    return {
      ok: true as const,
      rule: {
        itemName: name,
        chain: trimmed,
        tiers: parsed.tiers,
        note: note?.trim() || undefined,
        origin: "officer" as const,
      },
    };
  },

  async setPrioritySheet(input: { phase: number; markdown: string; author?: string; note?: string }) {
    if (!PHASE_IDS.includes(input.phase as (typeof PHASE_IDS)[number])) {
      return { ok: false as const, error: `Phase ${input.phase} isn't a phase this app knows.` };
    }
    const markdown = input.markdown.trim();
    if (!markdown) {
      return { ok: false as const, error: "Paste the sheet's markdown, or reset the phase instead." };
    }
    // Parse before storing: a sheet that yields no rows is a paste that went
    // wrong (the wrong half of a document, a table without its pipes), and
    // storing it would replace a working sheet with silence.
    const rules = parsePrioritySheet(markdown);
    if (rules.length === 0) {
      return {
        ok: false as const,
        error:
          "Nothing in that text parses as a priority row. Rows need to look like " +
          "“| Item | Priority | Slot | Notes |”, under a ### heading for the boss.",
      };
    }
    const db = getDb();
    withTx(db, () => {
      setPrioritySheet(db, input.phase, {
        markdown,
        author: input.author?.trim() || undefined,
        note: input.note?.trim() || undefined,
      });
      // The sheet feeds every contested item's ranking through the read model.
      bumpDataVersion(db);
    });
    return { ok: true as const, ruleCount: rules.length };
  },

  async setWishlistAlternatives(input: {
    characterId: string;
    phase: number;
    slot: string;
    items: { itemId: number; itemName?: string; note?: string }[];
  }) {
    if (!readModel().store.roster.some((c) => c.id === input.characterId)) {
      return { ok: false as const, error: "That character no longer exists." };
    }
    if (!PHASE_IDS.includes(input.phase as (typeof PHASE_IDS)[number])) {
      return { ok: false as const, error: `Phase ${input.phase} isn't a phase this app knows.` };
    }
    const items = input.items.filter((i) => Number.isInteger(i.itemId) && i.itemId > 0);
    // The same item twice would give one slot two different ranks for it.
    const seen = new Set<number>();
    const unique = items.filter((i) => !seen.has(i.itemId) && seen.add(i.itemId));

    const db = getDb();
    withTx(db, () => {
      // Replace outright: the caller sends the whole list in order, so anything
      // no longer in it was removed. Renumbering keeps ranks dense — a gap
      // would make "2nd choice" mean nothing.
      for (const existing of getWishlistAlternatives(db)) {
        if (
          existing.characterId === input.characterId &&
          existing.phase === input.phase &&
          existing.slot === input.slot &&
          !unique.some((i) => i.itemId === existing.itemId)
        ) {
          deleteWishlistAlternative(db, input.characterId, input.phase, input.slot, existing.itemId);
        }
      }
      renumber(unique).forEach(({ itemId, rank }) => {
        const item = unique.find((i) => i.itemId === itemId)!;
        setWishlistAlternative(db, {
          characterId: input.characterId,
          phase: input.phase,
          slot: input.slot,
          itemId,
          itemName: item.itemName,
          rank,
          note: item.note,
        });
      });
      bumpDataVersion(db);
    });
    return { ok: true as const };
  },

  async setClassGuide(input: {
    wowClass: string;
    spec: string;
    body: string;
    sources: string[];
    author?: string;
  }) {
    if (!WOW_CLASSES.includes(input.wowClass as (typeof WOW_CLASSES)[number])) {
      return { ok: false as const, error: `${input.wowClass} isn't a class this app knows.` };
    }
    const spec = input.spec.trim();
    if (spec && !CLASS_SPECS[input.wowClass as (typeof WOW_CLASSES)[number]].includes(spec)) {
      return { ok: false as const, error: `${input.wowClass} has no spec called "${spec}".` };
    }
    const db = getDb();
    const body = input.body.trim();
    // An empty guide is deleted rather than stored: a blank body would read as
    // "we looked at this and had nothing to say", which is a different claim
    // from "nobody has written it yet".
    if (!body) {
      let deleted = false;
      withTx(db, () => {
        deleted = deleteClassGuide(db, input.wowClass, spec);
        if (deleted) bumpDataVersion(db);
      });
      return { ok: true as const, deleted };
    }
    withTx(db, () => {
      setClassGuide(db, {
        wowClass: input.wowClass,
        spec,
        body,
        sources: input.sources.map((x) => x.trim()).filter(Boolean),
        author: input.author?.trim() || undefined,
      });
      bumpDataVersion(db);
    });
    return { ok: true as const };
  },

  async deletePrioritySheet(phase: number) {
    const db = getDb();
    withTx(db, () => {
      if (deletePrioritySheet(db, phase)) bumpDataVersion(db);
    });
    return { ok: true as const };
  },

  async clearCurrentGearOverrides(characterId: string, spec: GearSpec = "main"): Promise<number> {
    const db = getDb();
    let cleared = 0;
    withTx(db, () => {
      cleared = Number(
        db.prepare("DELETE FROM current_gear_overrides WHERE character_id = ? AND spec = ?")
          .run(characterId, spec).changes,
      );
      if (cleared > 0) bumpDataVersion(db);
    });
    return cleared;
  },

  async createCharacter(draft: CharacterDraft): Promise<CharacterWriteResult> {
    if (nameTaken(draft.name)) {
      return { ok: false, error: `A character named “${draft.name.trim()}” already exists.` };
    }
    const db = getDb();
    const guild = readModel().store.guild;
    const parsed = characterSchema.safeParse({
      ...draft,
      mainCharacterId: draft.mainCharacterId ?? null,
      id: `chr_${randomUUID()}`,
      guildId: guild.id,
    } satisfies Character);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid character." };
    withTx(db, () => {
      insertCharacter(db, parsed.data);
      bumpDataVersion(db);
    });
    return { ok: true, character: parsed.data };
  },

  async updateCharacter(id: string, draft: CharacterDraft): Promise<CharacterWriteResult> {
    const current = readModel().store.roster.find((c) => c.id === id);
    if (!current) return { ok: false, error: "Character not found." };
    if (nameTaken(draft.name, id)) {
      return { ok: false, error: `A character named “${draft.name.trim()}” already exists.` };
    }
    const parsed = characterSchema.safeParse({
      ...draft,
      mainCharacterId: draft.mainCharacterId ?? null,
      id,
      guildId: current.guildId,
    } satisfies Character);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid character." };
    const db = getDb();
    withTx(db, () => {
      insertCharacter(db, parsed.data); // INSERT OR REPLACE keyed on id
      bumpDataVersion(db);
    });
    return { ok: true, character: parsed.data };
  },

  async deleteCharacter(id: string): Promise<DeleteCharacterResult> {
    const character = readModel().store.roster.find((c) => c.id === id);
    if (!character) return { ok: false, error: "Character not found." };
    const db = getDb();
    const result = { ok: true as const, unlinkedAwards: 0, unlinkedLogRows: 0, deletedGearSets: 0 };
    withTx(db, () => {
      result.unlinkedAwards = Number(
        db.prepare("UPDATE loot_awards SET character_id = NULL, external = 0 WHERE character_id = ?").run(id).changes,
      );
      result.unlinkedLogRows = Number(
        db.prepare("UPDATE wcl_player_fights SET character_id = NULL WHERE character_id = ?").run(id).changes,
      );
      db.prepare("UPDATE wcl_player_offpull SET character_id = NULL WHERE character_id = ?").run(id);
      result.deletedGearSets = Number(
        db.prepare("DELETE FROM gear_sets WHERE character_id = ?").run(id).changes,
      );
      // A note on an item is part of why a loot decision was made, so it is
      // unlinked rather than destroyed — invariant 6. It stops naming somebody
      // and stays readable.
      db.prepare("UPDATE item_comments SET character_id = NULL WHERE character_id = ?").run(id);
      // Comments, exemptions and pinned slots reference the character — they go with it.
      db.prepare("DELETE FROM character_comments WHERE character_id = ?").run(id);
      db.prepare("DELETE FROM attendance_exemptions WHERE character_id = ?").run(id);
      db.prepare("DELETE FROM current_gear_overrides WHERE character_id = ?").run(id);
      db.prepare("DELETE FROM characters WHERE id = ?").run(id);
      bumpDataVersion(db);
    });
    return result;
  },

  async createRaidSessionWithAwards(
    sessionDraft: RaidSessionDraft,
    awardDrafts: AwardDraft[],
  ): Promise<GargulCommitResult> {
    const db = getDb();
    const model = readModel();
    const session: RaidSession = {
      ...sessionDraft,
      id: `rs_${randomUUID()}`,
      guildId: model.store.guild.id,
    };

    const isDuplicate = db.prepare(
      "SELECT 1 FROM loot_awards WHERE item_id = ? AND raw_winner_name = ? COLLATE NOCASE AND awarded_at = ? LIMIT 1",
    );
    const seenInBatch = new Set<string>();
    const toInsert: LootAward[] = [];
    const unresolved = new Set<string>();
    let skippedDuplicates = 0;

    for (const draft of awardDrafts) {
      const key = `${draft.itemId}|${draft.rawWinnerName.toLowerCase()}|${draft.awardedAt}`;
      if (seenInBatch.has(key) || isDuplicate.get(draft.itemId, draft.rawWinnerName, draft.awardedAt)) {
        skippedDuplicates++;
        continue;
      }
      seenInBatch.add(key);
      const character = characterByName(draft.rawWinnerName);
      if (!character) unresolved.add(draft.rawWinnerName);
      toInsert.push({
        id: `la_${randomUUID()}`,
        raidSessionId: session.id,
        characterId: character?.id ?? null,
        external: false,
        rawWinnerName: draft.rawWinnerName,
        itemId: draft.itemId,
        itemName: draft.itemName,
        awardedAt: draft.awardedAt,
        offspec: draft.offspec,
        note: draft.note,
      });
    }

    if (toInsert.length === 0) {
      return { session: undefined, inserted: 0, skippedDuplicates, unresolved: [] };
    }

    withTx(db, () => {
      insertRaidSession(db, session);
      for (const award of toInsert) insertLootAward(db, award);
      // A paste that named its items teaches the cache those names; invented
      // "Item #30048" ones are filtered out by the harvest.
      mergeItems(db, harvestItemFacts({ gearSets: [], lootAwards: toInsert, wclPlayerFights: [] }));
      bumpDataVersion(db);
    });
    return {
      session,
      inserted: toInsert.length,
      skippedDuplicates,
      unresolved: [...unresolved].sort(),
    };
  },

  async resolveAward(awardId: string, resolution: AwardResolution): Promise<ResolveAwardResult> {
    const award = readModel().store.lootAwards.find((a) => a.id === awardId);
    if (!award) return { ok: false, error: "Award not found — it may have been removed." };

    let characterId: string | null = null;
    let external = false;
    if (resolution.kind === "character") {
      const character = readModel().store.roster.find((c) => c.id === resolution.characterId);
      if (!character) return { ok: false, error: "That character no longer exists." };
      characterId = character.id;
    } else if (resolution.kind === "external") {
      external = true;
    }

    const db = getDb();
    withTx(db, () => {
      db.prepare("UPDATE loot_awards SET character_id = ?, external = ? WHERE id = ?").run(
        characterId, external ? 1 : 0, awardId,
      );
      bumpDataVersion(db);
    });
    return { ok: true, award: { ...award, characterId, external } };
  },

  async addLootAward(raidSessionId: string, input: AwardEditInput): Promise<AwardWriteResult> {
    const session = readModel().store.raidSessions.find((s) => s.id === raidSessionId);
    if (!session) return { ok: false, error: "That raid session no longer exists." };
    const check = checkAwardInput(input);
    if (!check.ok) return check;

    // Freeze the board as it read at this moment. Computed HERE rather than
    // taken from the caller: a client-supplied score could be stale or simply
    // wrong, and the whole value of the snapshot is that it's the arithmetic
    // the app actually produced.
    const decision = input.characterId
      ? await captureDecision(input.itemId, input.characterId)
      : undefined;

    const parsed = lootAwardSchema.safeParse({
      id: `la_${randomUUID()}`,
      raidSessionId,
      characterId: input.characterId,
      external: input.external,
      rawWinnerName: input.rawWinnerName.trim(),
      itemId: input.itemId,
      itemName: input.itemName.trim(),
      // Manual awards have no Gargul timestamp — file them at noon on the raid date.
      awardedAt: `${session.date}T12:00:00`,
      offspec: input.offspec,
      note: input.note?.trim() || undefined,
      decision,
    } satisfies LootAward);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid award." };

    const db = getDb();
    withTx(db, () => {
      insertLootAward(db, parsed.data);
      bumpDataVersion(db);
    });
    return { ok: true, award: parsed.data };
  },

  async updateLootAward(awardId: string, input: AwardEditInput): Promise<AwardWriteResult> {
    const existing = readModel().store.lootAwards.find((a) => a.id === awardId);
    if (!existing) return { ok: false, error: "Award not found — it may have been removed." };
    const check = checkAwardInput(input);
    if (!check.ok) return check;

    const parsed = lootAwardSchema.safeParse({
      ...existing,
      characterId: input.characterId,
      external: input.external,
      rawWinnerName: input.rawWinnerName.trim(),
      itemId: input.itemId,
      itemName: input.itemName.trim(),
      offspec: input.offspec,
      note: input.note?.trim() || undefined,
    } satisfies LootAward);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid award." };
    const award = parsed.data;

    const db = getDb();
    withTx(db, () => {
      db.prepare(
        `UPDATE loot_awards
            SET character_id = ?, external = ?, raw_winner_name = ?, item_id = ?, item_name = ?, offspec = ?, note = ?
          WHERE id = ?`,
      ).run(
        award.characterId, award.external ? 1 : 0, award.rawWinnerName, award.itemId,
        award.itemName, award.offspec ? 1 : 0, award.note ?? null, awardId,
      );
      bumpDataVersion(db);
    });
    return { ok: true, award };
  },

  async deleteLootAward(awardId: string): Promise<boolean> {
    const db = getDb();
    let deleted = false;
    withTx(db, () => {
      deleted = Number(db.prepare("DELETE FROM loot_awards WHERE id = ?").run(awardId).changes) > 0;
      if (deleted) bumpDataVersion(db);
    });
    return deleted;
  },

  async deleteRaidSession(raidSessionId: string): Promise<DeleteSessionResult> {
    if (!readModel().store.raidSessions.some((s) => s.id === raidSessionId)) {
      return { ok: false, error: "Raid session not found — maybe already removed." };
    }
    const db = getDb();
    let deletedAwards = 0;
    let unlinkedReports = 0;
    withTx(db, () => {
      deletedAwards = Number(
        db.prepare("DELETE FROM loot_awards WHERE raid_session_id = ?").run(raidSessionId).changes,
      );
      // A linked Warcraft Logs report outlives the session — just cut the link.
      unlinkedReports = Number(
        db.prepare("UPDATE wcl_reports SET raid_session_id = NULL WHERE raid_session_id = ?").run(raidSessionId).changes,
      );
      db.prepare("DELETE FROM raid_sessions WHERE id = ?").run(raidSessionId);
      bumpDataVersion(db);
    });
    return { ok: true, deletedAwards, unlinkedReports };
  },

  async saveWclReport(
    reportDraft: WclReportDraft,
    rowDrafts: WclPlayerFightDraft[],
    offPullDrafts: WclPlayerOffPullDraft[] = [],
  ): Promise<WclSaveResult> {
    const model = readModel();
    if (reportDraft.raidSessionId && !model.store.raidSessions.some((s) => s.id === reportDraft.raidSessionId)) {
      return { ok: false, error: "The selected raid session no longer exists." };
    }
    if (rowDrafts.length === 0) {
      return { ok: false, error: "The report has no per-player boss data to import." };
    }

    const parsedReport = wclReportSchema.safeParse({
      ...reportDraft,
      fetchedAt: new Date().toISOString(),
      /*
       * Stamped here rather than by the fetcher: this is the one place every
       * import and refetch passes through, so the record can't drift from what
       * was actually stored. It's what lets a later reader tell "the raid never
       * had Blood Frenzy" from "this report predates the Blood Frenzy track".
       */
      upkeepTracks: TRACKED_AURA_NAMES,
      raidSessionId: reportDraft.raidSessionId ?? null,
    });
    if (!parsedReport.success) {
      return { ok: false, error: parsedReport.error.issues[0]?.message ?? "Invalid report." };
    }
    const report = parsedReport.data;

    const matched = new Set<string>();
    const unmatched = new Set<string>();
    const rows: WclPlayerFight[] = rowDrafts.map((draft) => {
      const character = characterByName(draft.actorName);
      (character ? matched : unmatched).add(draft.actorName);
      return wclPlayerFightSchema.parse({
        ...draft,
        id: `${report.code}:${draft.fightId}:${draft.actorName.toLowerCase()}`,
        reportCode: report.code,
        characterId: character?.id ?? null,
      } satisfies WclPlayerFight);
    });

    // Same name matching as the pulls, so a raider's trash potions land on the
    // same character their boss pulls did.
    const offPull = offPullDrafts.map((draft) =>
      wclPlayerOffPullSchema.parse({
        ...draft,
        id: `${report.code}:${draft.actorName.toLowerCase()}`,
        reportCode: report.code,
        characterId: characterByName(draft.actorName)?.id ?? null,
      } satisfies WclPlayerOffPull),
    );

    const db = getDb();
    const existed = model.store.wclReports.some((r) => r.code === report.code);
    withTx(db, () => {
      db.prepare("DELETE FROM wcl_player_fights WHERE report_code = ?").run(report.code);
      db.prepare("DELETE FROM wcl_player_offpull WHERE report_code = ?").run(report.code);
      insertWclReport(db, report); // INSERT OR REPLACE keyed on code
      for (const row of rows) insertWclPlayerFight(db, row);
      for (const off of offPull) insertWclPlayerOffPull(db, off);
      // Every logged pull carries a gear snapshot with icons (and sometimes
      // names) — the cheapest item data there is, so it lands in the cache
      // instead of staying buried in per-row JSON.
      mergeItems(db, harvestItemFacts({ gearSets: [], lootAwards: [], wclPlayerFights: rows }));
      bumpDataVersion(db);
    });
    return {
      ok: true,
      report,
      replaced: existed,
      fightCount: new Set(rows.map((r) => r.fightId)).size,
      matched: [...matched].sort(),
      unmatched: [...unmatched].sort(),
    };
  },

  async purgeDemoData(): Promise<PurgeDemoResult> {
    const db = getDb();
    // Seed-origin ids are recognizable: hyphenated prefixes (c-, rs-, la-) and
    // the SEED report code; everything created at runtime uses chr_/rs_/la_
    // UUID ids and real WCL codes. '%' after a literal hyphen is safe in LIKE.
    const removed: PurgeDemoResult = { characters: 0, raidSessions: 0, lootAwards: 0, gearSets: 0, wclReports: 0 };
    withTx(db, () => {
      // Seed WCL report (and its rows) go entirely.
      db.prepare("DELETE FROM wcl_player_fights WHERE report_code = 'SEEDsscProgress1'").run();
      db.prepare("DELETE FROM wcl_player_offpull WHERE report_code = 'SEEDsscProgress1'").run();
      removed.wclReports = Number(db.prepare("DELETE FROM wcl_reports WHERE code = 'SEEDsscProgress1'").run().changes);
      // Real reports/rows that point at demo rows get unlinked, never deleted.
      db.prepare("UPDATE wcl_player_fights SET character_id = NULL WHERE character_id LIKE 'c-%'").run();
      db.prepare("UPDATE wcl_player_offpull SET character_id = NULL WHERE character_id LIKE 'c-%'").run();
      db.prepare("UPDATE wcl_reports SET raid_session_id = NULL WHERE raid_session_id LIKE 'rs-%'").run();
      // Demo awards: the seeded ones and anything inside a demo session.
      removed.lootAwards = Number(
        db.prepare("DELETE FROM loot_awards WHERE id LIKE 'la-%' OR raid_session_id LIKE 'rs-%'").run().changes,
      );
      // Real awards manually resolved to a demo character reopen as unresolved.
      db.prepare("UPDATE loot_awards SET character_id = NULL, external = 0 WHERE character_id LIKE 'c-%'").run();
      // Gear sets follow their character — covers seeded sets and test imports onto demo characters.
      removed.gearSets = Number(db.prepare("DELETE FROM gear_sets WHERE character_id LIKE 'c-%'").run().changes);
      db.prepare("UPDATE item_comments SET character_id = NULL WHERE character_id LIKE 'c-%'").run();
      // Comments, exemptions and pinned slots on demo characters go too (they'd dangle otherwise).
      db.prepare("DELETE FROM character_comments WHERE character_id LIKE 'c-%'").run();
      db.prepare("DELETE FROM attendance_exemptions WHERE character_id LIKE 'c-%'").run();
      db.prepare("DELETE FROM current_gear_overrides WHERE character_id LIKE 'c-%'").run();
      removed.raidSessions = Number(db.prepare("DELETE FROM raid_sessions WHERE id LIKE 'rs-%'").run().changes);
      removed.characters = Number(db.prepare("DELETE FROM characters WHERE id LIKE 'c-%'").run().changes);
      bumpDataVersion(db);
    });
    return removed;
  },

  async updateWclReportMeta(code: string, meta: { title?: string; zone?: string }) {
    if (!readModel().store.wclReports.some((r) => r.code === code)) {
      return { ok: false as const, error: "Report not found — maybe removed." };
    }
    const title = meta.title?.trim();
    const zone = meta.zone?.trim();
    const db = getDb();
    withTx(db, () => {
      if (title) db.prepare("UPDATE wcl_reports SET title = ? WHERE code = ?").run(title, code);
      if (meta.zone !== undefined) {
        db.prepare("UPDATE wcl_reports SET zone = ? WHERE code = ?").run(zone || null, code);
      }
      bumpDataVersion(db);
    });
    return { ok: true as const };
  },

  async deleteWclReport(code: string) {
    const exists = readModel().store.wclReports.some((r) => r.code === code);
    if (!exists) return { ok: false as const, error: "Report not found — maybe already removed." };
    const db = getDb();
    let rowsRemoved = 0;
    withTx(db, () => {
      rowsRemoved = Number(db.prepare("DELETE FROM wcl_player_fights WHERE report_code = ?").run(code).changes);
      db.prepare("DELETE FROM wcl_player_offpull WHERE report_code = ?").run(code);
      db.prepare("DELETE FROM wcl_reports WHERE code = ?").run(code);
      bumpDataVersion(db);
    });
    return { ok: true as const, rowsRemoved };
  },

  async setAttendanceExemption(characterId: string, weekStart: string, excused: boolean, note?: string) {
    if (!readModel().store.roster.some((c) => c.id === characterId)) {
      return { ok: false as const, error: "Character not found." };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      return { ok: false as const, error: "Invalid reset-week date." };
    }
    const db = getDb();
    withTx(db, () => {
      if (excused) {
        insertAttendanceExemption(db, { characterId, weekStart, note: note?.trim() || undefined });
      } else {
        db.prepare("DELETE FROM attendance_exemptions WHERE character_id = ? AND week_start = ?").run(
          characterId,
          weekStart,
        );
      }
      bumpDataVersion(db);
    });
    return { ok: true as const };
  },

  async addCharacterComment(draft: CharacterCommentDraft): Promise<AddCommentResult> {
    if (!readModel().store.roster.some((c) => c.id === draft.characterId)) {
      return { ok: false, error: "Character not found." };
    }
    const parsed = characterCommentSchema.safeParse({
      ...draft,
      id: `cm_${randomUUID()}`,
      createdAt: new Date().toISOString(),
    } satisfies CharacterComment);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid comment." };
    }
    const db = getDb();
    withTx(db, () => {
      insertCharacterComment(db, parsed.data);
      bumpDataVersion(db);
    });
    return { ok: true, comment: parsed.data };
  },

  async deleteCharacterComment(id: string): Promise<boolean> {
    const db = getDb();
    let deleted = false;
    withTx(db, () => {
      deleted = Number(db.prepare("DELETE FROM character_comments WHERE id = ?").run(id).changes) > 0;
      if (deleted) bumpDataVersion(db);
    });
    return deleted;
  },

  async addItemComment(draft: ItemCommentDraft): Promise<AddItemCommentResult> {
    // A comment can name a raider, and if it does, that raider has to exist —
    // an orphaned "2nd choice for someone" is worse than no note. The item
    // itself is deliberately NOT checked: officers discuss drops the cache
    // hasn't seen yet, and a note is how they record that.
    if (draft.characterId !== undefined && !readModel().store.roster.some((c) => c.id === draft.characterId)) {
      return { ok: false, error: "Character not found." };
    }
    const parsed = itemCommentSchema.safeParse({
      ...draft,
      id: `ic_${randomUUID()}`,
      createdAt: new Date().toISOString(),
    } satisfies ItemComment);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid comment." };
    }
    const db = getDb();
    withTx(db, () => {
      insertItemComment(db, parsed.data);
      bumpDataVersion(db);
    });
    return { ok: true, comment: parsed.data };
  },

  async deleteItemComment(id: string): Promise<boolean> {
    const db = getDb();
    let deleted = false;
    withTx(db, () => {
      deleted = deleteItemComment(db, id);
      if (deleted) bumpDataVersion(db);
    });
    return deleted;
  },

  async addFeedback(draft: FeedbackDraft): Promise<AddFeedbackResult> {
    const parsed = feedbackReportSchema.safeParse({
      ...draft,
      // Resolved here rather than leaning on the schema default, so the
      // `satisfies` below still checks this object against the whole entity.
      kind: draft.kind ?? "bug",
      id: `fb_${randomUUID()}`,
      status: "open",
      // Filed, not yet triaged. Only an officer sets these.
      priority: "unset",
      adminNote: undefined,
      createdAt: new Date().toISOString(),
    } satisfies FeedbackReport);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid report." };
    }
    const db = getDb();
    withTx(db, () => {
      insertFeedback(db, parsed.data);
      bumpDataVersion(db);
    });
    return { ok: true, report: parsed.data };
  },

  async setFeedbackStatus(id: string, status: FeedbackStatus): Promise<boolean> {
    const db = getDb();
    let changed = false;
    withTx(db, () => {
      changed =
        Number(db.prepare("UPDATE feedback SET status = ? WHERE id = ?").run(status, id).changes) > 0;
      if (changed) bumpDataVersion(db);
    });
    return changed;
  },

  async setFeedbackTriage(id, triage) {
    // Built from the fields actually present: a caller setting only a priority
    // must not blank the note somebody else wrote in the same sitting.
    const sets: string[] = [];
    const values: (string | null)[] = [];
    if (triage.status !== undefined) {
      sets.push("status = ?");
      values.push(triage.status);
    }
    if (triage.priority !== undefined) {
      sets.push("priority = ?");
      values.push(triage.priority);
    }
    if (triage.adminNote !== undefined) {
      sets.push("admin_note = ?");
      values.push(triage.adminNote.trim() || null);
    }
    if (sets.length === 0) return false;
    const db = getDb();
    let changed = false;
    withTx(db, () => {
      changed =
        Number(
          db
            .prepare(`UPDATE feedback SET ${sets.join(", ")} WHERE id = ?`)
            .run(...values, id).changes,
        ) > 0;
      if (changed) bumpDataVersion(db);
    });
    return changed;
  },

  async deleteFeedback(id: string): Promise<boolean> {
    const db = getDb();
    let deleted = false;
    withTx(db, () => {
      deleted = Number(db.prepare("DELETE FROM feedback WHERE id = ?").run(id).changes) > 0;
      if (deleted) bumpDataVersion(db);
    });
    return deleted;
  },

  async addItemsIfMissing(items: Item[]): Promise<number> {
    if (items.length === 0) return 0;
    const db = getDb();
    let learned = 0;
    withTx(db, () => {
      learned = mergeItems(db, items);
      if (learned > 0) bumpDataVersion(db);
    });
    return learned;
  },

  async saveResolvedItems(items: Item[]): Promise<number> {
    if (items.length === 0) return 0;
    const db = getDb();

    // Read before writing: the write stamps every row it is handed, so "did
    // this row change" is a question only the old values can answer. What the
    // officer wants counted is disagreement — the cache said one thing and the
    // authority said another — not the bookkeeping flip that always happens.
    const before = new Map(readModel().store.items.map((i) => [i.id, i]));
    const disagrees = (item: Item): boolean => {
      const prev = before.get(item.id);
      // An id the cache had never heard of was learned, not corrected.
      if (prev === undefined) return false;
      return (
        (item.name !== undefined && prev.name !== undefined && item.name !== prev.name) ||
        (item.quality !== undefined && prev.quality !== undefined && item.quality !== prev.quality) ||
        (item.icon !== undefined && prev.icon !== undefined && item.icon !== prev.icon) ||
        (item.slot !== undefined && prev.slot != null && item.slot !== prev.slot)
      );
    };
    const corrected = items.filter(disagrees).length;

    withTx(db, () => {
      mergeItems(db, items, { authoritative: true });
      // Always: even an unchanged row just became verified, and the read model
      // has to see that or the resolver keeps offering it up forever.
      bumpDataVersion(db);
    });
    return corrected;
  },

  async saveTokenRedemptions(edges: TokenRedemptionEdge[]): Promise<number> {
    if (edges.length === 0) return 0;
    const db = getDb();
    let written = 0;
    withTx(db, () => {
      written = mergeTokenRedemptions(db, edges);
      // Always, even when the page said what the cache already held: the read
      // model is what turns an edge into a satisfied wishlist row, and it only
      // reloads on the version counter.
      if (written > 0) bumpDataVersion(db);
    });
    return written;
  },

  async setItemCuration(
    itemId: number,
    curation: { phase: Phase | null; source: { zone: string; boss?: string } | null },
  ) {
    if (!Number.isInteger(itemId) || itemId <= 0) {
      return { ok: false as const, error: "That isn't an item id." };
    }
    const { phase, source } = curation;
    if (phase !== null && !phaseSchema.safeParse(phase).success) {
      return { ok: false as const, error: "That isn't a phase this app knows." };
    }
    if (source !== null && !source.zone.trim()) {
      return { ok: false as const, error: "Name the zone it drops in, or clear it." };
    }
    const sourceJson = source
      ? JSON.stringify({ zone: source.zone.trim(), ...(source.boss?.trim() ? { boss: source.boss.trim() } : {}) })
      : null;
    const db = getDb();
    withTx(db, () => {
      db.prepare(
        `INSERT INTO items (id, phase, source_json) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET phase = excluded.phase, source_json = excluded.source_json`,
      ).run(itemId, phase, sourceJson);
      // Phase feeds gem grading; zone is what the loot plan groups a raid by.
      bumpDataVersion(db);
    });
    return { ok: true as const };
  },

  async applyCuratedItemSources(): Promise<number> {
    // Gap-filling merge: `source_json` and `phase` are COALESCEd onto rows that
    // have none, so this can be pressed repeatedly and can never overwrite an
    // officer's answer with the shipped one.
    return this.addItemsIfMissing(loadSeedStore().items);
  },

  async harvestItemCache(): Promise<number> {
    const { store } = readModel();
    return this.addItemsIfMissing(harvestItemFacts(store));
  },

  async addEnchantNames(names: { id: number; name: string }[]): Promise<number> {
    if (names.length === 0) return 0;
    const db = getDb();
    let written = 0;
    withTx(db, () => {
      written = addEnchantNames(db, names);
      // The names are baked into the read model's enchant reference.
      if (written > 0) bumpDataVersion(db);
    });
    return written;
  },

  async repairPlaceholderAwardNames(): Promise<number> {
    const db = getDb();
    const byId = new Map(readModel().store.items.map((i) => [i.id, i]));
    const stale = readModel().store.lootAwards.filter(
      (a) => isPlaceholderName(a.itemName) && byId.get(a.itemId)?.name !== undefined,
    );
    if (stale.length === 0) return 0;
    withTx(db, () => {
      const stmt = db.prepare("UPDATE loot_awards SET item_name = ? WHERE id = ?");
      for (const award of stale) stmt.run(byId.get(award.itemId)!.name as string, award.id);
      bumpDataVersion(db);
    });
    return stale.length;
  },

  async setReportConsumablePrices(code, prices) {
    const db = getDb();
    withTx(db, () => {
      setReportConsumablePrices(db, code, prices);
      bumpDataVersion(db);
    });
  },

  /*
   * The board writes are the only ones here that deliberately do NOT call
   * bumpDataVersion, and the reason is worth stating because every neighbour
   * does (change-chains §4).
   *
   * That bump exists to rebuild the derived read model. Nothing derived reads a
   * board — every getter goes straight to the meta table, exactly like
   * consumable prices — so a bump would rebuild the whole model (every pull row
   * of every report) and change not one byte of the result. These boards
   * autosave as an officer drags people around, which turns that from waste
   * into lag.
   *
   * If a board ever starts feeding something derived, this stops being
   * true and the bump has to come back.
   */
  async setRaidBoard(code, board) {
    const db = getDb();
    withTx(db, () => setRaidBoard(db, code, board));
  },

  async setTemplateBoard(board) {
    const db = getDb();
    withTx(db, () => setTemplateBoard(db, board));
  },

  async createGuildRoster(board) {
    const db = getDb();
    withTx(db, () => setGuildRoster(db, board));
  },

  /* Read-modify-write, inside the transaction: three controls edit three
     different parts of one row. See updateGuildRoster in db.ts. */
  async updateGuildRoster(id, patch) {
    const db = getDb();
    withTx(db, () => updateGuildRoster(db, id, patch));
  },

  async deleteGuildRoster(id) {
    const db = getDb();
    withTx(db, () => deleteGuildRoster(db, id));
  },

  async addAbilities(abilities) {
    const db = getDb();
    let written = 0;
    withTx(db, () => {
      written = addAbilities(db, abilities);
      if (written > 0) bumpDataVersion(db);
    });
    return written;
  },

  async setSimProfile(wowClass, spec, json) {
    const db = getDb();
    withTx(db, () => {
      setSimProfile(db, wowClass, spec, json);
      bumpDataVersion(db);
    });
  },

  async setReportExcludedFights(code, fightIds) {
    const db = getDb();
    withTx(db, () => {
      setReportExcludedFights(db, code, fightIds);
      // The read model bakes the filter in — the bump forces it to rebuild.
      bumpDataVersion(db);
    });
  },

  async setReportConsumableAdjustments(code, adjustments) {
    const db = getDb();
    withTx(db, () => {
      setReportConsumableAdjustments(db, code, adjustments);
      // Career gold reads these, and it's baked into the model.
      bumpDataVersion(db);
    });
  },
};

export function getSqliteRepo(): WriteRepo {
  // Delegate reads to the (possibly rebuilt) derived model on every call.
  const readDelegate: Repo = {
    getGuild: () => readModel().repo.getGuild(),
    listCharacters: () => readModel().repo.listCharacters(),
    getCharacterBundle: (slug) => readModel().repo.getCharacterBundle(slug),
    listRaidSessions: () => readModel().repo.listRaidSessions(),
    listLootAwards: () => readModel().repo.listLootAwards(),
    getItem: (id) => readModel().repo.getItem(id),
    listItems: () => readModel().repo.listItems(),
    getItemContention: (itemId) => readModel().repo.getItemContention(itemId),
    listItemDemand: () => readModel().repo.listItemDemand(),
    listFeedback: () => readModel().repo.listFeedback(),
    getDashboard: () => readModel().repo.getDashboard(),
    listWclReports: () => readModel().repo.listWclReports(),
    getCharacterPerformance: (slug) => readModel().repo.getCharacterPerformance(slug),
    getRaidReport: (code) => readModel().repo.getRaidReport(code),
    getComparison: (slugs, reportFilter) => readModel().repo.getComparison(slugs, reportFilter),
    listUntrackedLogPlayers: () => readModel().repo.listUntrackedLogPlayers(),
    // Prices live in the meta table, not the derived model — read them directly.
    getReportConsumablePrices: async (code) => getReportConsumablePrices(getDb(), code),
    getRaidBoard: async (code) => getRaidBoard(getDb(), code),
    getTemplateBoard: async () => getTemplateBoard(getDb()),
    listGuildRosters: async () => listGuildRosters(getDb()),
    getGuildRoster: async (id) => getGuildRoster(getDb(), id),
    getReportExcludedFights: async (code) => getReportExcludedFights(getDb(), code),
    /*
     * The spec index is counted off the pull rows in the read model; whether a
     * setup is saved for a spec lives in the meta table. Neither knows about the
     * other, so the two are joined here — and a spec with a saved setup but no
     * logged kills still has to appear, or a link pasted for a spec nobody has
     * raided yet would vanish without explanation.
     */
    listSimSpecs: async () => {
      const specs = await readModel().repo.listSimSpecs();
      const saved = listSimProfiles(getDb());
      const byKey = new Map(specs.map((s) => [`${s.wowClass}|${s.spec}`, s]));
      for (const p of saved) {
        const hit = byKey.get(`${p.wowClass}|${p.spec}`);
        if (hit) hit.hasProfile = true;
        else
          byKey.set(`${p.wowClass}|${p.spec}`, {
            wowClass: p.wowClass,
            spec: p.spec,
            hasProfile: true,
            kills: 0,
            raiders: [],
          });
      }
      return [...byKey.values()].sort(
        (a, b) => a.wowClass.localeCompare(b.wowClass) || a.spec.localeCompare(b.spec),
      );
    },
    getSimSpec: async (wowClass, spec) => {
      const db = getDb();
      const profile = getSimProfile(db, wowClass, spec);
      const detail = await readModel().repo.getSimSpec(wowClass, spec);
      // A saved setup keeps its page reachable even before anyone raids the spec.
      const base = detail ?? {
        wowClass,
        spec,
        pulls: [],
        fingerprints: [],
        stranded: [],
      };
      if (!detail && profile === undefined) return null;
      return {
        ...base,
        profile,
        /*
         * Setups from before spec profiles that no migration could place, shown
         * on every spec their build has ever been called so the officer can
         * adopt one where it belongs.
         *
         * One that IS already this profile drops out — the common case is the
         * setup the migration promoted, and offering to adopt what is already
         * saved reads as an unfinished step that can never be finished.
         */
        stranded: listStrandedSimSettings(db).filter(
          (s) =>
            s.wowClass === wowClass &&
            s.json !== profile &&
            (s.specs.length === 0 || s.specs.includes(spec)),
        ),
      };
    },
    listPullRows: (code, fightId) => readModel().repo.listPullRows(code, fightId),
    listAbilities: async () => getAbilities(getDb()),
    listEncounterNames: () => readModel().repo.listEncounterNames(),
    listUnmatchedSheetNames: () => readModel().repo.listUnmatchedSheetNames(),
    getReportConsumableAdjustments: async (code) => getReportConsumableAdjustments(getDb(), code),
    listUnresolvedItemIds: () => readModel().repo.listUnresolvedItemIds(),
    listTokenBackfill: () => readModel().repo.listTokenBackfill(),
    getEnchantReference: () => readModel().repo.getEnchantReference(),
    listUnnamedEnchantIds: () => readModel().repo.listUnnamedEnchantIds(),
    getLootPriorityWeights: () => readModel().repo.getLootPriorityWeights(),
    getItemPriorityRule: (itemId, ...names) => readModel().repo.getItemPriorityRule(itemId, ...names),
    getPrioritySheet: (phase) => readModel().repo.getPrioritySheet(phase),
    getGuildPolicy: () => readModel().repo.getGuildPolicy(),
    getLootPlan: (zone: string) => readModel().repo.getLootPlan(zone),
    getRosterStanding: () => readModel().repo.getRosterStanding(),
    getDevelopment: (characterId: string) => readModel().repo.getDevelopment(characterId),
    listGearSets: () => readModel().repo.listGearSets(),
    listClassGuides: () => readModel().repo.listClassGuides(),
    listItemComments: (itemId: number) => readModel().repo.listItemComments(itemId),
    countItemComments: () => readModel().repo.countItemComments(),
    listWishlistAlternatives: () => readModel().repo.listWishlistAlternatives(),
    measureRoster: () => readModel().repo.measureRoster(),

    /**
     * Measure the roster twice: once as it stands, once under the proposed
     * policy. The second model is built and thrown away — nothing is stored,
     * which is the whole point of a preview.
     *
     * A full rebuild per preview is deliberate. It is the same code path the
     * real read model uses, so the preview cannot drift from what saving would
     * actually do — and at guild scale the rebuild is cheap.
     */
    async previewGuildPolicy(overrides: PolicyOverrides) {
      const db = getDb();
      const current = getGuildPolicy(db) as PolicyOverrides;
      const merged: PolicyOverrides = { ...current };
      for (const [key, value] of Object.entries(overrides) as [keyof PolicyOverrides, object][]) {
        merged[key] = { ...(current[key] as object), ...value } as never;
      }

      const before = await readModel().repo.measureRoster();
      const proposed = createRepoFromStore(loadStore(db), {
        excludedFightsByCode: getAllExcludedFights(db),
        policy: merged,
        itemPriorityRules: getItemPriorityRules(db),
        prioritySheetsByPhase: getPrioritySheets(db),
        classGuides: getClassGuides(db),
        enchantNames: getEnchantNames(db),
        consumableAdjustmentsByCode: getAllConsumableAdjustments(db),
      });
      const after = await proposed.measureRoster();
      const afterByName = new Map(after.map((r) => [r.name, r]));

      return buildPolicyPreview(
        before.map((row) => ({
          ...row,
          preparedAfter: afterByName.get(row.name)?.preparedAfter,
          attendanceAfter: afterByName.get(row.name)?.attendanceAfter,
        })),
      );
    },
  };
  return { ...readDelegate, ...writeMethods };
}

export { getGearSetById };
