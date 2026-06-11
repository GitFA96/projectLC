import type {
  AwardWithContext,
  Character,
  CharacterBundle,
  CharacterSummary,
  DashboardData,
  GearSet,
  Guild,
  Item,
  ItemContention,
  RaidSession,
} from "@/lib/types";

/**
 * The data-access boundary. Pages and server actions only ever talk to these
 * interfaces; the backend is chosen by DATA_BACKEND:
 *  - "sqlite" (default): node:sqlite database, seeded from src/data/seed on
 *    first boot, with full write support.
 *  - "seed": read-only in-memory demo serving the seed JSON directly.
 */
export interface Repo {
  getGuild(): Promise<Guild>;
  listCharacters(): Promise<CharacterSummary[]>;
  getCharacterBundle(slug: string): Promise<CharacterBundle | null>;
  listRaidSessions(): Promise<RaidSession[]>;
  listLootAwards(): Promise<AwardWithContext[]>;
  getItem(id: number): Promise<Item | undefined>;
  listItems(): Promise<Item[]>;
  getItemContention(itemId: number): Promise<ItemContention | null>;
  getDashboard(): Promise<DashboardData>;
}

/* Write-side inputs: entities minus the fields the repo generates. */
export type GearSetDraft = Omit<GearSet, "id" | "importedAt">;
export type CharacterDraft = Omit<Character, "id" | "guildId">;
export type RaidSessionDraft = Omit<RaidSession, "id" | "guildId">;
export interface AwardDraft {
  rawWinnerName: string;
  itemId: number;
  itemName: string;
  awardedAt: string;
  offspec: boolean;
  note?: string;
}

export type UpsertGearSetResult =
  /** No set of this kind/phase existed — imported fresh. */
  | { status: "created"; set: GearSet }
  /** Caller confirmed the update — the previous set was replaced. */
  | { status: "replaced"; set: GearSet; previous: GearSet }
  /** A set already exists and replace wasn't confirmed — nothing written. */
  | { status: "exists"; existing: GearSet };

export type CharacterWriteResult =
  | { ok: true; character: Character }
  | { ok: false; error: string };

export interface GargulCommitResult {
  /** Undefined when every award was a duplicate — no empty sessions are created. */
  session?: RaidSession;
  inserted: number;
  skippedDuplicates: number;
  /** Distinct winner names that didn't match any roster character (recorded with characterId null). */
  unresolved: string[];
}

export interface WriteRepo extends Repo {
  findCharacterByName(name: string): Promise<Character | undefined>;
  /** The set an import would overwrite, if any (kind "current", or wishlist for the given phase). */
  findExistingSet(characterId: string, kind: GearSet["kind"], phase?: GearSet["phase"]): Promise<GearSet | undefined>;
  /**
   * The character wishlist/current-gear update flow: one current set per
   * character and one wishlist per phase. When a matching set exists, nothing
   * is written unless `replace` is true — callers surface the existing set and
   * ask for confirmation first.
   */
  upsertGearSet(draft: GearSetDraft, opts: { replace: boolean }): Promise<UpsertGearSetResult>;
  deleteGearSet(setId: string): Promise<boolean>;
  createCharacter(draft: CharacterDraft): Promise<CharacterWriteResult>;
  updateCharacter(id: string, draft: CharacterDraft): Promise<CharacterWriteResult>;
  /** Commit one Gargul paste: resolves winners by name, skips already-recorded awards. */
  createRaidSessionWithAwards(session: RaidSessionDraft, awards: AwardDraft[]): Promise<GargulCommitResult>;
  /** Cache items learned from imports (insert-only — never overwrites curated entries). */
  addItemsIfMissing(items: Item[]): Promise<number>;
}

function backend(): "seed" | "sqlite" {
  return process.env.DATA_BACKEND === "seed" ? "seed" : "sqlite";
}

export async function getRepo(): Promise<Repo> {
  if (backend() === "seed") {
    const { seedRepo } = await import("@/lib/data/seed-repo");
    return seedRepo;
  }
  const { getSqliteRepo } = await import("@/lib/data/sqlite-repo");
  return getSqliteRepo();
}

export async function getWriteRepo(): Promise<WriteRepo> {
  if (backend() === "seed") {
    throw new Error("DATA_BACKEND=seed is read-only — unset it (or set DATA_BACKEND=sqlite) to enable imports and edits.");
  }
  const { getSqliteRepo } = await import("@/lib/data/sqlite-repo");
  return getSqliteRepo();
}
