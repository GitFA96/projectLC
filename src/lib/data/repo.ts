import type {
  AwardWithContext,
  Character,
  CharacterBundle,
  CharacterComment,
  CharacterComparisonView,
  CharacterPerformance,
  CharacterSummary,
  DashboardData,
  GearSet,
  Guild,
  Item,
  ItemContention,
  ItemDemand,
  LootAward,
  RaidReportView,
  RaidSession,
  UntrackedLogPlayer,
  WclPlayerFight,
  WclReport,
  WclReportView,
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
  /** Every known item (cache ∪ wishlists ∪ awards) with demand counts, most contested first. */
  listItemDemand(): Promise<ItemDemand[]>;
  getDashboard(): Promise<DashboardData>;
  /** Fetched Warcraft Logs reports, newest first. */
  listWclReports(): Promise<WclReportView[]>;
  /** Per-report performance + career rollup for one character (null = unknown character). */
  getCharacterPerformance(slug: string): Promise<CharacterPerformance | null>;
  /** Raid-wide rollup of one report (defaults to the latest); null when no reports. */
  getRaidReport(code?: string): Promise<RaidReportView | null>;
  /**
   * Side-by-side comparison of up to 4 characters (by slug): contribution
   * metrics + the comment log. Unknown slugs are dropped; order is preserved.
   */
  getComparison(slugs: string[]): Promise<CharacterComparisonView>;
  /** Names seen in imported logs that match no tracked character, most pulls first. */
  listUntrackedLogPlayers(): Promise<UntrackedLogPlayer[]>;
}

/* Write-side inputs: entities minus the fields the repo generates. */
export type GearSetDraft = Omit<GearSet, "id" | "importedAt">;
/** mainCharacterId is optional on input — omitting it defaults to no link. */
export type CharacterDraft = Omit<Character, "id" | "guildId" | "mainCharacterId"> & {
  mainCharacterId?: string | null;
};
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

export type DeleteCharacterResult =
  | {
      ok: true;
      /** Awards reopened as unresolved (raw winner name kept). */
      unlinkedAwards: number;
      /** Log rows detached — the name reappears under untracked log players. */
      unlinkedLogRows: number;
      deletedGearSets: number;
    }
  | { ok: false; error: string };

export interface GargulCommitResult {
  /** Undefined when every award was a duplicate — no empty sessions are created. */
  session?: RaidSession;
  inserted: number;
  skippedDuplicates: number;
  /** Distinct winner names that didn't match any roster character (recorded with characterId null). */
  unresolved: string[];
}

/** How the council settles an award whose winner didn't auto-match the roster. */
export type AwardResolution =
  /** Link the award to a roster character (typo / rename / late roster add). */
  | { kind: "character"; characterId: string }
  /** The winner is deliberately off-roster: disenchanted, banked, or a PUG. */
  | { kind: "external" }
  /** Undo — put the award back in the needs-attention queue. */
  | { kind: "unresolved" };

export type ResolveAwardResult =
  | { ok: true; award: LootAward }
  | { ok: false; error: string };

/** A fetched report ready to persist: identity fields are derived at save time. */
export type WclReportDraft = Omit<WclReport, "fetchedAt" | "raidSessionId"> & {
  raidSessionId?: string | null;
};
export type WclPlayerFightDraft = Omit<WclPlayerFight, "id" | "reportCode" | "characterId">;

export type WclSaveResult =
  | {
      ok: true;
      report: WclReport;
      /** True when this code had been fetched before (rows were replaced). */
      replaced: boolean;
      fightCount: number;
      /** Distinct player names matched to roster characters / left unmatched. */
      matched: string[];
      unmatched: string[];
    }
  | { ok: false; error: string };

/** A new officer comment: identity + timestamp are generated at save time. */
export type CharacterCommentDraft = Omit<CharacterComment, "id" | "createdAt">;

export type AddCommentResult =
  | { ok: true; comment: CharacterComment }
  | { ok: false; error: string };

/** What "Remove demo data" deleted, for the confirmation message. */
export interface PurgeDemoResult {
  characters: number;
  raidSessions: number;
  lootAwards: number;
  gearSets: number;
  wclReports: number;
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
  /**
   * Delete a character outright. Loot stays in the ledger under the raw
   * Gargul name (reopened as unresolved) and log rows go back to untracked —
   * history is unlinked, never destroyed. Prefer status "pug"/"inactive"
   * unless the entry really shouldn't exist.
   */
  deleteCharacter(id: string): Promise<DeleteCharacterResult>;
  /** Commit one Gargul paste: resolves winners by name, skips already-recorded awards. */
  createRaidSessionWithAwards(session: RaidSessionDraft, awards: AwardDraft[]): Promise<GargulCommitResult>;
  /** Settle (or reopen) the winner of one award — see AwardResolution. */
  resolveAward(awardId: string, resolution: AwardResolution): Promise<ResolveAwardResult>;
  /**
   * Persist one fetched Warcraft Logs report. Players are matched to roster
   * characters by name (like Gargul winners); re-saving the same report code
   * replaces it wholesale, so refetching is the update flow.
   */
  saveWclReport(report: WclReportDraft, rows: WclPlayerFightDraft[]): Promise<WclSaveResult>;
  /** Remove one fetched report and all its per-player rows (wrongful import). */
  deleteWclReport(code: string): Promise<{ ok: true; rowsRemoved: number } | { ok: false; error: string }>;
  /**
   * Mark (or clear) one reset week as an excused absence for a character, so it
   * doesn't count toward their attendance markup. weekStart is the reset-week
   * Wednesday (resetWeekStart). Idempotent.
   */
  setAttendanceExemption(
    characterId: string,
    weekStart: string,
    excused: boolean,
    note?: string,
  ): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Append one officer comment to a character's log. */
  addCharacterComment(draft: CharacterCommentDraft): Promise<AddCommentResult>;
  /** Remove one comment by id. Returns false when it didn't exist. */
  deleteCharacterComment(id: string): Promise<boolean>;
  /** Cache items learned from imports (insert-only — never overwrites curated entries). */
  addItemsIfMissing(items: Item[]): Promise<number>;
  /**
   * Remove the demo content a fresh database was seeded with (fictional
   * characters, their sessions/awards/gear sets and the seed WCL report),
   * keeping everything imported since. The item cache stays — it's real TBC
   * data. Anything real that pointed at demo rows is unlinked, not deleted.
   */
  purgeDemoData(): Promise<PurgeDemoResult>;
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
