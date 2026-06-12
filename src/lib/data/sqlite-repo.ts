import { randomUUID } from "node:crypto";
import {
  bumpDataVersion,
  getDataVersion,
  getDb,
  insertCharacter,
  insertGearSet,
  insertItem,
  insertLootAward,
  insertRaidSession,
  insertWclPlayerFight,
  insertWclReport,
  loadStore,
  withTx,
} from "@/lib/data/db";
import { createRepoFromStore } from "@/lib/data/store";
import { characterSchema, gearSetSchema, wclPlayerFightSchema, wclReportSchema } from "@/lib/import/schemas";
import type {
  AwardDraft,
  AwardResolution,
  CharacterDraft,
  CharacterWriteResult,
  DeleteCharacterResult,
  GargulCommitResult,
  GearSetDraft,
  PurgeDemoResult,
  Repo,
  RaidSessionDraft,
  ResolveAwardResult,
  UpsertGearSetResult,
  WclPlayerFightDraft,
  WclReportDraft,
  WclSaveResult,
  WriteRepo,
} from "@/lib/data/repo";
import type { Character, GearSet, Item, LootAward, RaidSession, WclPlayerFight } from "@/lib/types";

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
  const model: CachedModel = { dbPath, version, repo: createRepoFromStore(store), store };
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

  async createCharacter(draft: CharacterDraft): Promise<CharacterWriteResult> {
    if (nameTaken(draft.name)) {
      return { ok: false, error: `A character named “${draft.name.trim()}” already exists.` };
    }
    const db = getDb();
    const guild = readModel().store.guild;
    const parsed = characterSchema.safeParse({
      ...draft,
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
    const parsed = characterSchema.safeParse({ ...draft, id, guildId: current.guildId } satisfies Character);
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
      result.deletedGearSets = Number(
        db.prepare("DELETE FROM gear_sets WHERE character_id = ?").run(id).changes,
      );
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

  async saveWclReport(reportDraft: WclReportDraft, rowDrafts: WclPlayerFightDraft[]): Promise<WclSaveResult> {
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

    const db = getDb();
    const existed = model.store.wclReports.some((r) => r.code === report.code);
    withTx(db, () => {
      db.prepare("DELETE FROM wcl_player_fights WHERE report_code = ?").run(report.code);
      insertWclReport(db, report); // INSERT OR REPLACE keyed on code
      for (const row of rows) insertWclPlayerFight(db, row);
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
      removed.wclReports = Number(db.prepare("DELETE FROM wcl_reports WHERE code = 'SEEDsscProgress1'").run().changes);
      // Real reports/rows that point at demo rows get unlinked, never deleted.
      db.prepare("UPDATE wcl_player_fights SET character_id = NULL WHERE character_id LIKE 'c-%'").run();
      db.prepare("UPDATE wcl_reports SET raid_session_id = NULL WHERE raid_session_id LIKE 'rs-%'").run();
      // Demo awards: the seeded ones and anything inside a demo session.
      removed.lootAwards = Number(
        db.prepare("DELETE FROM loot_awards WHERE id LIKE 'la-%' OR raid_session_id LIKE 'rs-%'").run().changes,
      );
      // Real awards manually resolved to a demo character reopen as unresolved.
      db.prepare("UPDATE loot_awards SET character_id = NULL, external = 0 WHERE character_id LIKE 'c-%'").run();
      // Gear sets follow their character — covers seeded sets and test imports onto demo characters.
      removed.gearSets = Number(db.prepare("DELETE FROM gear_sets WHERE character_id LIKE 'c-%'").run().changes);
      removed.raidSessions = Number(db.prepare("DELETE FROM raid_sessions WHERE id LIKE 'rs-%'").run().changes);
      removed.characters = Number(db.prepare("DELETE FROM characters WHERE id LIKE 'c-%'").run().changes);
      bumpDataVersion(db);
    });
    return removed;
  },

  async deleteWclReport(code: string) {
    const exists = readModel().store.wclReports.some((r) => r.code === code);
    if (!exists) return { ok: false as const, error: "Report not found — maybe already removed." };
    const db = getDb();
    let rowsRemoved = 0;
    withTx(db, () => {
      rowsRemoved = Number(db.prepare("DELETE FROM wcl_player_fights WHERE report_code = ?").run(code).changes);
      db.prepare("DELETE FROM wcl_reports WHERE code = ?").run(code);
      bumpDataVersion(db);
    });
    return { ok: true as const, rowsRemoved };
  },

  async addItemsIfMissing(items: Item[]): Promise<number> {
    const db = getDb();
    const known = new Set(readModel().store.items.map((i) => i.id));
    const fresh = items.filter((i) => !known.has(i.id));
    if (fresh.length === 0) return 0;
    withTx(db, () => {
      for (const item of fresh) insertItem(db, item);
      bumpDataVersion(db);
    });
    return fresh.length;
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
    getDashboard: () => readModel().repo.getDashboard(),
    listWclReports: () => readModel().repo.listWclReports(),
    getCharacterPerformance: (slug) => readModel().repo.getCharacterPerformance(slug),
    listUntrackedLogPlayers: () => readModel().repo.listUntrackedLogPlayers(),
  };
  return { ...readDelegate, ...writeMethods };
}

export { getGearSetById };
