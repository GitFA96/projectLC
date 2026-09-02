import { randomUUID } from "node:crypto";
import {
  addEnchantNames,
  clearRefusedItemNames,
  getRefusedItemNames,
  recordRefusedItemNames,
  bumpDataVersion,
  getDataVersion,
  deleteItemPriorityRule,
  getAllConsumableAdjustments,
  getAllExcludedFights,
  getDb,
  getEnchantNames,
  getReportConsumableAdjustments,
  setReportConsumableAdjustments,
  getItemPriorityRuleAt,
  getItemPriorityRules,
  getSheetItemIds,
  setSheetItemId,
  getPrioritySheets,
  getGuides,
  type StoredGuide,
  getWishlistAlternatives,
  setWishlistAlternative,
  deleteWishlistAlternative,
  setGuide,
  deleteGuide,
  setPrioritySheet,
  deletePrioritySheet,
  getGuildPolicy,
  setGuildPolicy,
  getGuildRoster,
  getRaidBoard,
  getReportConsumablePrices,
  getReportPayback,
  getTemplateBoard,
  listGuildRosters,
  getSimProfile,
  listSimProfiles,
  listStrandedSimSettings,
  getAbilities,
  getReportExcludedFights,
  insertAttendanceExemption,
  insertCharacter,
  getCharacterMembershipId,
  membershipLastSeenByGuild,
  insertCharacterComment,
  insertItemComment,
  deleteItemComment,
  insertBossComment,
  deleteBossComment,
  upsertBossDrops,
  deleteBossDrop,
  upsertGuildBossDrop,
  deleteGuildBossDrop,
  insertFeedback,
  insertCurrentGearOverride,
  insertGearSet,
  insertGuildAuditEntry,
  insertLootAward,
  insertRaidSession,
  insertWclPlayerFight,
  insertWclPlayerOffPull,
  insertWclReport,
  loadStore,
  mergeItems,
  mergeTokenRedemptions,
  moveItemPriorityRule,
  setItemPriorityRule,
  unverifyItem,
  setGuildRoster,
  updateGuildRoster,
  deleteGuildRoster,
  setRaidBoard,
  setReportConsumablePrices,
  setReportPayback,
  setTemplateBoard,
  setSimProfile,
  addAbilities,
  setReportExcludedFights,
  withTx,
} from "@/lib/data/db";
import type { TokenRedemptionEdge } from "@/lib/items/tier-tokens";
import { createRepoFromStore } from "@/lib/data/store";
import type { Guide, GuideKind } from "@/lib/guides";
import type { BossDropDraft } from "@/lib/loot/drop-table";
import { normalizeItemName, parsePrioritySheet } from "@/lib/loot/priority-sheet";
import { parsePriorityChain } from "@/lib/loot/priority-chain";
import { CLASS_SPECS, PHASE_IDS, WOW_CLASSES, bossKey } from "@/lib/constants/wow";
import type { PolicyOverrides } from "@/lib/analysis/policy";
import { buildPolicyPreview } from "@/lib/analysis/policy-preview";
import { renumber, type WishlistAlternative } from "@/lib/analysis/wishlist-alternatives";
import { harvestItemFacts, isPlaceholderName } from "@/lib/items/item-data";
import { loadSeedStore } from "@/lib/data/seed-data";
import { TRACKED_AURA_NAMES } from "@/lib/wcl/class-tracks";
import {
  characterCommentSchema,
  itemCommentSchema,
  bossCommentSchema,
  bossDropSchema,
  guildBossDropSchema,
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
  AwardAuditActor,
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
  BossComment,
  BossDrop,
  GuildBossDrop,
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

import { compareText } from "@/lib/sort";

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

/**
 * Widen stored guides into the app's type.
 *
 * The column is TEXT, so a row written by a future version — or edited by hand
 * — can carry a kind this build has never heard of. Those are dropped rather
 * than cast: a guide filed under an unknown kind has no page to appear on, and
 * pretending otherwise puts it somewhere it does not belong.
 */
function asGuides(rows: StoredGuide[]): Guide[] {
  const kinds = new Set<string>(["class", "raid"]);
  return rows.flatMap((r) => (kinds.has(r.kind) ? [{ ...r, kind: r.kind as GuideKind }] : []));
}

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
      sheetItemIds: getSheetItemIds(db),
      guides: asGuides(getGuides(db)),
      wishlistAlternatives: getWishlistAlternatives(db) as WishlistAlternative[],
      enchantNames: getEnchantNames(db),
      refusedItemNames: getRefusedItemNames(db),
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

/** The day part of a stored award timestamp — what an officer means by "the date". */
function awardDay(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * What the guild is told about an amendment, in the words a member would use.
 *
 * Only what moved. The log is read months later by somebody reconstructing a
 * decision — "Thrainn, off-spec → main spec" answers that; a dump of every
 * field, most of them unchanged, does not.
 */
function describeAwardEdit(before: LootAward, after: LootAward): string[] {
  const changes: string[] = [];
  if (before.itemId !== after.itemId) {
    changes.push(`item ${before.itemName} → ${after.itemName}`);
  }
  if (awardDay(before.awardedAt) !== awardDay(after.awardedAt)) {
    changes.push(`won ${awardDay(before.awardedAt)} → ${awardDay(after.awardedAt)}`);
  }
  if (before.rawWinnerName !== after.rawWinnerName || before.characterId !== after.characterId) {
    changes.push(`winner ${before.rawWinnerName} → ${after.rawWinnerName}`);
  }
  if (before.offspec !== after.offspec) {
    changes.push(after.offspec ? "main spec → off-spec" : "off-spec → main spec");
  }
  if ((before.note ?? "") !== (after.note ?? "")) changes.push("note changed");
  return changes;
}

/**
 * Write what an officer did to the ledger, in the transaction that did it.
 *
 * Same table the guild reads its governance from, under `loot.*` kinds so the
 * audit page can keep the two streams apart — an award being re-dated is not
 * the same kind of fact as somebody being given a role, and merging them would
 * blur a line that page draws on purpose.
 *
 * Silent without an actor: the repo is also driven by tests and imports, and a
 * line reading "an officer" for a Gargul paste would be a lie in the record.
 */
function auditAward(
  db: ReturnType<typeof getDb>,
  audit: AwardAuditActor | undefined,
  kind: string,
  detail: string,
): void {
  if (!audit) return;
  insertGuildAuditEntry(db, {
    id: `aud_${randomUUID().slice(0, 12)}`,
    guildId: audit.guildId,
    kind,
    actor: audit.actor,
    detail: detail.slice(0, 1000),
    at: new Date().toISOString(),
  });
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

  async moveItemPriorityRule(input: { itemName: string; fromPhase: number; toPhase: number }) {
    const { itemName, fromPhase, toPhase } = input;
    const key = normalizeItemName(itemName.trim());
    if (!key) return { ok: false as const, error: "That item name has nothing to match on." };
    if (!PHASE_IDS.includes(toPhase as Phase)) {
      return { ok: false as const, error: `Phase ${toPhase} isn't a phase this guild raids.` };
    }
    if (fromPhase === toPhase) return { ok: true as const };

    const db = getDb();
    if (!getItemPriorityRuleAt(db, key, fromPhase)) {
      return { ok: false as const, error: `No chain filed under phase ${fromPhase} for that item.` };
    }
    // Refuse rather than overwrite: a chain already filed against the target is
    // a separate ruling, and this button must never be how one disappears.
    if (getItemPriorityRuleAt(db, key, toPhase)) {
      return {
        ok: false as const,
        error: `The phase ${toPhase} sheet already has a chain for that item — clear it there first.`,
      };
    }
    withTx(db, () => {
      moveItemPriorityRule(db, key, fromPhase, toPhase);
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

  async setItemPriorityRule(input: { itemName: string; phase: number; chain: string; note?: string }) {
    const { itemName, phase, chain, note } = input;
    const name = itemName.trim();
    if (!name) return { ok: false as const, error: "An item name is required." };
    const key = normalizeItemName(name);
    if (!key) return { ok: false as const, error: "That item name has nothing to match on." };
    if (!PHASE_IDS.includes(phase as Phase)) {
      return { ok: false as const, error: `Phase ${phase} isn't a phase this guild raids.` };
    }

    const db = getDb();
    const trimmed = chain.trim();
    // An empty chain is how an officer says "use the guild's sheet again" — for
    // this phase. Another phase's chain for the same item is a separate ruling.
    if (!trimmed) {
      withTx(db, () => {
        if (deleteItemPriorityRule(db, key, phase)) bumpDataVersion(db);
      });
      return { ok: true as const };
    }

    const parsed = parsePriorityChain(trimmed);
    if (parsed.tiers.length === 0) {
      return { ok: false as const, error: "Write the chain as “Hunter > DPS Warrior > MS > OS”." };
    }
    withTx(db, () => {
      setItemPriorityRule(db, key, phase, { itemName: name, chain: trimmed, note: note?.trim() || undefined });
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
        phase,
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

  async setGuide(input: {
    kind: GuideKind;
    subject: string;
    section: string;
    owner: string;
    body: string;
    sources: string[];
    author?: string;
  }) {
    const section = input.section.trim();
    // A class guide's subject and section are a closed set, so a typo is a
    // refusal rather than a row nobody will ever find. A raid guide's are not:
    // the boss list gains rows, and an operator writing about something the
    // table has not heard of yet is the same judgement call as a note on a
    // drop source nobody has named. See `addBossComment`.
    if (input.kind === "class") {
      if (!WOW_CLASSES.includes(input.subject as (typeof WOW_CLASSES)[number])) {
        return { ok: false as const, error: `${input.subject} isn't a class this app knows.` };
      }
      if (section && !CLASS_SPECS[input.subject as (typeof WOW_CLASSES)[number]].includes(section)) {
        return { ok: false as const, error: `${input.subject} has no spec called "${section}".` };
      }
    }
    if (!input.subject.trim()) {
      return { ok: false as const, error: "A guide needs a subject." };
    }
    if (!input.owner.trim()) {
      return { ok: false as const, error: "A guide needs an owner." };
    }
    const db = getDb();
    const body = input.body.trim();
    // An empty guide is deleted rather than stored: a blank body would read as
    // "we looked at this and had nothing to say", which is a different claim
    // from "nobody has written it yet".
    if (!body) {
      let deleted = false;
      withTx(db, () => {
        deleted = deleteGuide(db, input.kind, input.subject, section, input.owner);
        if (deleted) bumpDataVersion(db);
      });
      return { ok: true as const, deleted };
    }
    withTx(db, () => {
      setGuide(db, {
        kind: input.kind,
        subject: input.subject,
        section,
        owner: input.owner,
        body,
        sources: input.sources.map((x) => x.trim()).filter(Boolean),
        author: input.author?.trim() || undefined,
      });
      bumpDataVersion(db);
    });
    return { ok: true as const, deleted: false };
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
      professions: draft.professions ?? [],
      id: `chr_${randomUUID()}`,
      guildId: guild.id,
      // A character is created unclaimed. An account claims one by redeeming an
      // invite, or an officer links it — never as a side effect of adding it.
      membershipId: null,
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
      professions: draft.professions ?? [],
      id,
      guildId: current.guildId,
      // Carried across, never read off the draft. insertCharacter is INSERT OR
      // REPLACE over a fixed column list, so a claim omitted here is a claim
      // deleted — silently, on every spec change an officer makes. Claiming is
      // members.manage and has its own writer; this is roster.edit.
      //
      // Read from the row rather than from `current`, which comes off the read
      // model: if that model has not caught up with a claim made moments ago,
      // preserving it from there preserves a null.
      membershipId: getCharacterMembershipId(getDb(), id),
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

  async updateLootAward(
    awardId: string,
    input: AwardEditInput,
    audit?: AwardAuditActor,
  ): Promise<AwardWriteResult> {
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
      // Absent leaves the stored timestamp alone — an edit that doesn't touch
      // the date must not quietly re-stamp it (a Gargul import's time of day is
      // real information, and noon-on-the-day would throw it away).
      awardedAt: input.awardedAt ?? existing.awardedAt,
    } satisfies LootAward);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid award." };
    const award = parsed.data;
    const changes = describeAwardEdit(existing, award);

    const db = getDb();
    withTx(db, () => {
      db.prepare(
        `UPDATE loot_awards
            SET character_id = ?, external = ?, raw_winner_name = ?, item_id = ?, item_name = ?, offspec = ?, note = ?, awarded_at = ?
          WHERE id = ?`,
      ).run(
        award.characterId, award.external ? 1 : 0, award.rawWinnerName, award.itemId,
        award.itemName, award.offspec ? 1 : 0, award.note ?? null, award.awardedAt, awardId,
      );
      // Nothing moved, nothing to tell the guild — an officer opening the
      // editor and saving unchanged is not an event.
      if (changes.length > 0) {
        auditAward(db, audit, "loot.amended", `${award.itemName} — ${changes.join("; ")}.`);
      }
      bumpDataVersion(db);
    });
    return { ok: true, award };
  },

  async deleteLootAward(awardId: string, audit?: AwardAuditActor): Promise<boolean> {
    const existing = readModel().store.lootAwards.find((a) => a.id === awardId);
    const db = getDb();
    let deleted = false;
    withTx(db, () => {
      deleted = Number(db.prepare("DELETE FROM loot_awards WHERE id = ?").run(awardId).changes) > 0;
      if (deleted) {
        // The row is gone; the record of it going is the only thing left that
        // can explain why a raider's history is one item shorter.
        if (existing) {
          auditAward(
            db,
            audit,
            "loot.removed",
            `${existing.itemName} — ${existing.rawWinnerName}, won ${awardDay(existing.awardedAt)} — removed from the ledger.`,
          );
        }
        bumpDataVersion(db);
      }
    });
    return deleted;
  },

  async deleteRaidSession(raidSessionId: string, audit?: AwardAuditActor): Promise<DeleteSessionResult> {
    const session = readModel().store.raidSessions.find((s) => s.id === raidSessionId);
    if (!session) {
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
      // Deleting the import is the other way awards leave the ledger, and it
      // takes several at once. Recording only the single-award path would
      // leave the bigger act as the unwatched one.
      if (deletedAwards > 0) {
        auditAward(
          db,
          audit,
          "loot.removed",
          `${session.date} ${session.zones.join(" + ")} — import deleted, ${deletedAwards} award${deletedAwards === 1 ? "" : "s"} removed.`,
        );
      }
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

  async upsertBossDrops(drafts: BossDropDraft[]): Promise<number> {
    if (drafts.length === 0) return 0;
    const now = new Date().toISOString();
    // Normalization happens once, here, on the way in. Every reader then
    // compares stored keys directly — see the note on `rowKey` in drop-table.ts
    // for why a second normalizer is the thing to avoid.
    const rows = drafts.flatMap((d) => {
      const parsed = bossDropSchema.safeParse({
        zone: d.zone.trim(),
        bossKey: bossKey(d.boss),
        boss: d.boss.trim(),
        itemKey: normalizeItemName(d.itemName),
        itemName: d.itemName.trim(),
        itemId: d.itemId,
        slotLabel: d.slotLabel?.trim() || undefined,
        note: d.note?.trim() || undefined,
        author: d.author?.trim() || undefined,
        updatedAt: now,
      } satisfies BossDrop);
      return parsed.success ? [parsed.data] : [];
    });
    const db = getDb();
    let written = 0;
    withTx(db, () => {
      written = upsertBossDrops(db, rows);
      // The drop table feeds the loot plan, so a write nobody rebuilds for is a
      // write that stays invisible until restart.
      if (written > 0) bumpDataVersion(db);
    });
    return written;
  },

  async deleteBossDrop(zone: string, boss: string, itemName: string): Promise<boolean> {
    const db = getDb();
    let deleted = false;
    withTx(db, () => {
      deleted = deleteBossDrop(db, zone, bossKey(boss), normalizeItemName(itemName));
      if (deleted) bumpDataVersion(db);
    });
    return deleted;
  },

  async seedFoundationalDrops(): Promise<{
    fromSheets: number;
    fromCache: number;
    deduped: number;
  }> {
    // The read model does the gathering and the parsing; this only writes.
    const { drafts, fromSheets, fromCache } = await readModel().repo.listKnownDropSources();
    await this.upsertBossDrops(drafts);

    // Then clear any row listing one item twice under one boss. An earlier
    // version of the gather keyed only on the written name, so the sheet's
    // spelling and the item's own spelling each produced a row; the table's key
    // is that name, so an upsert can never collapse them afterwards.
    const doomed = await readModel().repo.listDuplicateDrops();
    let deduped = 0;
    for (const row of doomed) {
      if (await this.deleteBossDrop(row.zone, row.boss, row.itemName)) deduped += 1;
    }
    return { fromSheets, fromCache, deduped };
  },

  async setGuildDropOverride(input: {
    zone: string;
    boss: string;
    itemName: string;
    itemId?: number;
    action: "add" | "hide";
    note?: string;
    author?: string;
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    const parsed = guildBossDropSchema.safeParse({
      guildId: readModel().store.guild.id,
      zone: input.zone.trim(),
      bossKey: bossKey(input.boss),
      boss: input.boss.trim(),
      itemKey: normalizeItemName(input.itemName),
      itemName: input.itemName.trim(),
      itemId: input.itemId,
      action: input.action,
      note: input.note?.trim() || undefined,
      author: input.author?.trim() || undefined,
      updatedAt: new Date().toISOString(),
    } satisfies GuildBossDrop);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid override." };
    }
    const db = getDb();
    withTx(db, () => {
      upsertGuildBossDrop(db, parsed.data);
      bumpDataVersion(db);
    });
    return { ok: true };
  },

  async clearGuildDropOverride(zone: string, boss: string, itemName: string): Promise<boolean> {
    const db = getDb();
    let deleted = false;
    withTx(db, () => {
      deleted = deleteGuildBossDrop(
        db, readModel().store.guild.id, zone, bossKey(boss), normalizeItemName(itemName),
      );
      if (deleted) bumpDataVersion(db);
    });
    return deleted;
  },

  async addBossComment(input: {
    zone: string;
    boss: string;
    body: string;
    author?: string;
  }): Promise<{ ok: true; comment: BossComment } | { ok: false; error: string }> {
    // The boss is deliberately NOT checked against the raid table. Officers
    // write notes about drop sources the table has never named — a rare spawn,
    // a trash pack worth stopping for — and the same reasoning applies as to an
    // item comment on a drop the cache has not seen: a note is how that gets
    // recorded, not something to refuse until the table catches up.
    const parsed = bossCommentSchema.safeParse({
      zone: input.zone.trim(),
      // Stored both ways on purpose: the key is what a reader looks up by, the
      // label is what they recognise. See the table comment in db.ts.
      bossKey: bossKey(input.boss),
      boss: input.boss.trim(),
      body: input.body.trim(),
      author: input.author?.trim() || undefined,
      id: `bc_${randomUUID()}`,
      createdAt: new Date().toISOString(),
    } satisfies BossComment);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid note." };
    }
    const db = getDb();
    withTx(db, () => {
      insertBossComment(db, parsed.data);
      bumpDataVersion(db);
    });
    return { ok: true, comment: parsed.data };
  },

  async deleteBossComment(id: string): Promise<boolean> {
    const db = getDb();
    let deleted = false;
    withTx(db, () => {
      deleted = deleteBossComment(db, id);
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

  async setFeedbackStatus(id: string, status: FeedbackStatus, by?: string): Promise<boolean> {
    const db = getDb();
    let changed = false;
    withTx(db, () => {
      // Closing signs the decision; reopening unsigns it. Both in one statement
      // so a report can never be resolved with no record of who resolved it.
      const resolving = status === "resolved";
      changed =
        Number(
          db
            .prepare("UPDATE feedback SET status = ?, resolved_by = ?, resolved_at = ? WHERE id = ?")
            .run(
              status,
              resolving ? by?.trim() || null : null,
              resolving ? new Date().toISOString() : null,
              id,
            ).changes,
        ) > 0;
      if (changed) bumpDataVersion(db);
    });
    return changed;
  },

  async setSheetItemId(itemName, itemId) {
    const key = normalizeItemName(itemName);
    if (!key) return { ok: false as const, error: "That name is empty." };
    const db = getDb();
    withTx(db, () => {
      setSheetItemId(db, key, itemId);
      // A pinned id the cache has never seen would render as nothing at all.
      // Seeding a bare row puts it in front of the item resolver, which fills
      // in the name and icon on the next backfill.
      if (itemId !== undefined) mergeItems(db, [{ id: itemId }]);
      bumpDataVersion(db);
    });
    return { ok: true as const };
  },

  async setFeedbackTriage(id, triage) {
    // Built from the fields actually present: a caller setting only a priority
    // must not blank the note somebody else wrote in the same sitting.
    const sets: string[] = [];
    const values: (string | null)[] = [];
    if (triage.status !== undefined) {
      sets.push("status = ?");
      values.push(triage.status);
      // Same signing rule as setFeedbackStatus — triage is the other door to
      // closing a report, and a report closed through this one must not come out
      // unsigned. The author falls back to whoever signed the note in the same
      // call, since that is the person doing the triage.
      const resolving = triage.status === "resolved";
      sets.push("resolved_by = ?");
      values.push(resolving ? triage.resolvedBy?.trim() || triage.adminNoteAuthor?.trim() || null : null);
      sets.push("resolved_at = ?");
      values.push(resolving ? new Date().toISOString() : null);
    }
    if (triage.priority !== undefined) {
      sets.push("priority = ?");
      values.push(triage.priority);
    }
    if (triage.adminNote !== undefined) {
      const note = triage.adminNote.trim() || null;
      sets.push("admin_note = ?");
      values.push(note);
      // Author and time go with the note, and are cleared with it — a signature
      // left behind on a note somebody deleted attributes nothing to anybody.
      sets.push("admin_note_author = ?");
      values.push(note ? triage.adminNoteAuthor?.trim() || null : null);
      sets.push("admin_note_at = ?");
      values.push(note ? new Date().toISOString() : null);
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

  async unverifyItem(itemId: number) {
    if (!Number.isInteger(itemId) || itemId <= 0) {
      return { ok: false as const, error: "That isn't an item id." };
    }
    const db = getDb();
    let changed = false;
    withTx(db, () => {
      changed = unverifyItem(db, itemId);
      // The resolver queue is derived, so the read model has to rebuild before
      // the next backfill press can see this row waiting in it.
      if (changed) bumpDataVersion(db);
    });
    return changed
      ? { ok: true as const }
      : { ok: false as const, error: "The cache has no row for that item." };
  },

  async applyCuratedItemSources(): Promise<number> {
    // Gap-filling merge: `source_json` and `phase` are COALESCEd onto rows that
    // have none, so this can be pressed repeatedly and can never overwrite an
    // officer's answer with the shipped one.
    return this.addItemsIfMissing(loadSeedStore().items);
  },

  async applySheetItemSources(): Promise<number> {
    // The read model has already done the judgement — matched sheet names to
    // cached rows and turned each section heading into a zone and boss — so
    // this is the same gap-filling merge as its neighbour, with a different
    // source of answers. `id` and `source` only: naming any other field here
    // would let a section heading fill in a name or an icon, which it has no
    // standing to do.
    const proposals = await readModel().repo.listSheetDropSources();
    return this.addItemsIfMissing(proposals.map(({ id, source }) => ({ id, source })));
  },

  async harvestItemCache(): Promise<number> {
    const { store } = readModel();
    return this.addItemsIfMissing(harvestItemFacts(store));
  },

  async recordRefusedItemNames(
    refused: { nameKey: string; name: string; reason: string; near: string[] }[],
  ): Promise<number> {
    if (refused.length === 0) return 0;
    const db = getDb();
    let written = 0;
    withTx(db, () => {
      written = recordRefusedItemNames(db, refused);
      // The lookup queues are part of the read model, and they filter on these.
      if (written > 0) bumpDataVersion(db);
    });
    return written;
  },

  async clearRefusedItemNames(nameKeys?: string[]): Promise<number> {
    const db = getDb();
    let removed = 0;
    withTx(db, () => {
      removed = clearRefusedItemNames(db, nameKeys);
      if (removed > 0) bumpDataVersion(db);
    });
    return removed;
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

  async setReportPayback(code, payback) {
    const db = getDb();
    withTx(db, () => {
      setReportPayback(db, code, payback);
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
    /*
     * Rebuilt per call rather than served from the cached model.
     *
     * Two things here are outside the read model and would otherwise be stale:
     * `last_seen_at` (a login must not bump `data_version`) and the clock that
     * decides whether an invitation has lapsed. Both are cheap; the view is one
     * officer screen, not a hot path.
     */
    getPublicProfile: (visibility) => readModel().repo.getPublicProfile(visibility),
    listGuildAudit: () => readModel().repo.listGuildAudit(),
    getMembersView: async (now) => {
      const model = readModel();
      return createRepoFromStore(model.store, {
        membershipLastSeen: membershipLastSeenByGuild(getDb(), model.store.guild.id),
      }).getMembersView(now);
    },
    // Same treatment, and for the same two reasons: last-seen is outside the
    // read model, and "how long have they been quiet" is a question about now.
    getSuccessionState: async (now) => {
      const model = readModel();
      return createRepoFromStore(model.store, {
        membershipLastSeen: membershipLastSeenByGuild(getDb(), model.store.guild.id),
      }).getSuccessionState(now);
    },
    getDashboard: () => readModel().repo.getDashboard(),
    listWclReports: () => readModel().repo.listWclReports(),
    getCharacterPerformance: (slug) => readModel().repo.getCharacterPerformance(slug),
    getRaidReport: (code) => readModel().repo.getRaidReport(code),
    getComparison: (slugs, reportFilter) => readModel().repo.getComparison(slugs, reportFilter),
    listUntrackedLogPlayers: () => readModel().repo.listUntrackedLogPlayers(),
    // Prices live in the meta table, not the derived model — read them directly.
    getReportConsumablePrices: async (code) => getReportConsumablePrices(getDb(), code),
    getReportPayback: async (code) => getReportPayback(getDb(), code),
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
        (a, b) => compareText(a.wowClass, b.wowClass) || compareText(a.spec, b.spec),
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
    listUnmatchedConsumableNames: () => readModel().repo.listUnmatchedConsumableNames(),
    listRefusedItemNames: () => readModel().repo.listRefusedItemNames(),
    listConsumableItems: () => readModel().repo.listConsumableItems(),
    listBossComments: (zone: string) => readModel().repo.listBossComments(zone),
    listGuides: () => readModel().repo.listGuides(),
    getDropTable: (zone: string) => readModel().repo.getDropTable(zone),
    listFoundationalDrops: (zone?: string) => readModel().repo.listFoundationalDrops(zone),
    getFoundationalDropTable: (zone: string) => readModel().repo.getFoundationalDropTable(zone),
    listGuildDropOverrides: (zone?: string) => readModel().repo.listGuildDropOverrides(zone),
    listDuplicateDrops: () => readModel().repo.listDuplicateDrops(),
    listKnownDropSources: () => readModel().repo.listKnownDropSources(),
    listSheetDropSources: () => readModel().repo.listSheetDropSources(),
    getReportConsumableAdjustments: async (code) => getReportConsumableAdjustments(getDb(), code),
    listConsumableAdjustments: async () => getAllConsumableAdjustments(getDb()),
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
        sheetItemIds: getSheetItemIds(db),
        guides: asGuides(getGuides(db)),
        enchantNames: getEnchantNames(db),
      refusedItemNames: getRefusedItemNames(db),
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
