import type { EnchantReference } from "@/lib/analysis/enchants";
import type {
  AwardWithContext,
  Character,
  CharacterBundle,
  CharacterComment,
  CharacterComparisonView,
  CharacterPerformance,
  CharacterSummary,
  ConsumablePrice,
  CurrentGearOverride,
  DashboardData,
  GearOverrideSource,
  GearSet,
  Guild,
  Item,
  ItemContention,
  ItemDemand,
  LootAward,
  RaidReportView,
  RaidSession,
  SlotId,
  SlotItem,
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
   * reportFilter (slug → report codes) scopes the log-derived metrics to chosen
   * raid nights per character; omit it (or pass no codes) for all-time.
   */
  getComparison(slugs: string[], reportFilter?: Record<string, string[]>): Promise<CharacterComparisonView>;
  /** Names seen in imported logs that match no tracked character, most pulls first. */
  listUntrackedLogPlayers(): Promise<UntrackedLogPlayer[]>;
  /**
   * A raid's logged consumable prices (name → gold/charges), for the gold-spent
   * view. Empty means the raid hasn't set prices and the code defaults apply.
   */
  getReportConsumablePrices(code: string): Promise<Record<string, ConsumablePrice>>;
  /**
   * The pulls an officer excluded from a report's rollups (fight ids). Empty
   * means the whole night counts — see WriteRepo.setReportExcludedFights.
   */
  getReportExcludedFights(code: string): Promise<number[]>;
  /**
   * Items the UI has to render as a bare id: referenced by loot, a wishlist or
   * the cache itself, but still missing a name or an icon. The (bounded) work
   * list for the Wowhead resolver, most-referenced first.
   */
  listUnresolvedItemIds(): Promise<number[]>;
  /**
   * What the guild's imported sets know about enchants: id → name (a
   * dictionary that works on every raider's logs) and the enchant each class's
   * wishlists pick per slot. The only source that names the enchantment ids
   * logs carry — see lib/analysis/enchants.
   */
  getEnchantReference(): Promise<EnchantReference>;
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

export type SetCurrentGearOverrideResult =
  | { ok: true; override: CurrentGearOverride }
  | { ok: false; error: string };

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

/**
 * Every editable field of one award. The winner is already resolved to a
 * concrete link: characterId set (a roster character), external true (a
 * deliberate off-roster winner), or both empty/false (unresolved). The server
 * action translates the picker choice into these before calling the repo.
 */
export interface AwardEditInput {
  itemId: number;
  itemName: string;
  rawWinnerName: string;
  characterId: string | null;
  external: boolean;
  offspec: boolean;
  note?: string;
}

export type AwardWriteResult =
  | { ok: true; award: LootAward }
  | { ok: false; error: string };

export type DeleteSessionResult =
  | { ok: true; deletedAwards: number; unlinkedReports: number }
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
  /**
   * Pin one slot of a character's current gear to a specific item, overriding
   * whatever their imported set says (and standing alone when there is none).
   * The slot is `item.slot`; pinning it again replaces the previous pin.
   */
  setCurrentGearOverride(
    characterId: string,
    item: SlotItem,
    source: GearOverrideSource,
  ): Promise<SetCurrentGearOverrideResult>;
  /** Hand one slot back to the imported set. False when nothing was pinned there. */
  clearCurrentGearOverride(characterId: string, slot: SlotId): Promise<boolean>;
  /** Unpin every slot for a character — back to the imported set wholesale. */
  clearCurrentGearOverrides(characterId: string): Promise<number>;
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
  /** Add one award to an existing session (manual entry, not from a paste). */
  addLootAward(raidSessionId: string, input: AwardEditInput): Promise<AwardWriteResult>;
  /** Edit one award's item, winner, off-spec flag and note (date/session stay put). */
  updateLootAward(awardId: string, input: AwardEditInput): Promise<AwardWriteResult>;
  /** Remove one award outright. Returns false when it didn't exist. */
  deleteLootAward(awardId: string): Promise<boolean>;
  /**
   * Delete a whole raid session (one Gargul import): its awards are removed and
   * any Warcraft Logs report linked to it is unlinked (the report itself stays).
   */
  deleteRaidSession(raidSessionId: string): Promise<DeleteSessionResult>;
  /**
   * Persist one fetched Warcraft Logs report. Players are matched to roster
   * characters by name (like Gargul winners); re-saving the same report code
   * replaces it wholesale, so refetching is the update flow.
   */
  saveWclReport(report: WclReportDraft, rows: WclPlayerFightDraft[]): Promise<WclSaveResult>;
  /** Remove one fetched report and all its per-player rows (wrongful import). */
  deleteWclReport(code: string): Promise<{ ok: true; rowsRemoved: number } | { ok: false; error: string }>;
  /**
   * Rename a report and/or relabel its raid (zone) — display metadata only,
   * nothing derived changes. Empty zone clears back to "no zone".
   */
  updateWclReportMeta(
    code: string,
    meta: { title?: string; zone?: string },
  ): Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * Log this raid night's consumable prices (name → gold/charges). Replaces the
   * whole set for the report; an empty map clears it back to code defaults.
   */
  setReportConsumablePrices(code: string, prices: Record<string, ConsumablePrice>): Promise<void>;
  /**
   * Choose which of a report's pulls feed its rollups: the given fight ids are
   * excluded from preparation coverage, consumable/cooldown counts, uptime and
   * the improvement list. Replaces the whole set; an empty list counts the
   * whole night again.
   */
  setReportExcludedFights(code: string, fightIds: number[]): Promise<void>;
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
  /**
   * Fill the item cache from an import. Fields are merged per id — a row only
   * ever gains what it was missing, so curated entries are never overwritten.
   * Returns how many items were created or learned something.
   */
  addItemsIfMissing(items: Item[]): Promise<number>;
  /**
   * Harvest item data out of records already imported: names from wishlists
   * and loot pastes, icons from the gear snapshot on every logged pull. No
   * network — this is data the database already holds, buried in per-row JSON.
   */
  harvestItemCache(): Promise<number>;
  /**
   * Replace the invented "Item #30048" names frozen into old loot rows with
   * the real name, once the cache knows it. Returns rows repaired.
   */
  repairPlaceholderAwardNames(): Promise<number>;
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
