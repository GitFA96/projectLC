import {
  getRefusedItemNames,
  getDataVersion,
  getAllConsumableAdjustments,
  getAllExcludedFights,
  getDb,
  getEnchantNames,
  getItemPriorityRules,
  getSheetItemIds,
  getPrioritySheets,
  getGuides,
  type StoredGuide,
  getWishlistAlternatives,
  getGuildPolicy,
  loadStore,
} from "@/lib/data/db";
import { createRepoFromStore } from "@/lib/data/store";
import type { Guide, GuideKind } from "@/lib/guides";
import type { WishlistAlternative } from "@/lib/analysis/wishlist-alternatives";
import type { Repo, WriteRepo } from "@/lib/data/repo";
import type { Character, GearSet } from "@/lib/types";

/**
 * The derived read model every method in this directory reads through.
 *
 * One cache, held on `globalThis`, keyed on the database's `data_version`
 * **and** its path. The version is why a write that forgets `bumpDataVersion`
 * commits to disk and stays invisible until restart (change-chains §4); the
 * path is why a test that repoints `PROJECTLC_DB` does not read the previous
 * database's roster back.
 *
 * The lookups below answer what a write asks before it writes — does this
 * character exist, is the name taken, is there already a set of this kind. They
 * read the model rather than the database on purpose: a write decides against
 * the same view the page showed the officer.
 */

export interface CachedModel {
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
export function asGuides(rows: StoredGuide[]): Guide[] {
  const kinds = new Set<string>(["class", "raid"]);
  return rows.flatMap((r) => (kinds.has(r.kind) ? [{ ...r, kind: r.kind as GuideKind }] : []));
}

export function readModel(): CachedModel {
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

export function findExisting(characterId: string, kind: GearSet["kind"], phase?: GearSet["phase"]): GearSet | undefined {
  return readModel().store.gearSets.find(
    (s) => s.characterId === characterId && s.kind === kind && (kind === "current" || s.phase === phase),
  );
}

export function characterByName(name: string): Character | undefined {
  const lower = name.trim().toLowerCase();
  return readModel().store.roster.find((c) => c.name.toLowerCase() === lower);
}

export function nameTaken(name: string, exceptId?: string): boolean {
  const existing = characterByName(name);
  return existing !== undefined && existing.id !== exceptId;
}

export type Writes = Omit<WriteRepo, keyof Repo>;
