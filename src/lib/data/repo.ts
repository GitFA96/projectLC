import type { Board, GuildRoster } from "@/lib/analysis/raid-planner";
import type { EnchantReference } from "@/lib/analysis/enchants";
import type { PrioritySheetDocument } from "@/lib/loot/priority-sheet";
import type { GuildPolicy, PolicyOverrides } from "@/lib/analysis/policy";
import type { ClassGuide } from "@/lib/guides";
import type { WishlistAlternative } from "@/lib/analysis/wishlist-alternatives";
import type { PolicyPreview, PolicyPreviewRow } from "@/lib/analysis/policy-preview";
import type { AbilityInfo } from "@/lib/items/ability-data";
import type { TokenRedemptionEdge } from "@/lib/items/tier-tokens";
import type { RosterStanding } from "@/lib/analysis/standing";
import type { LootPlan } from "@/lib/analysis/loot-plan";
import type { DevelopmentSeries } from "@/lib/analysis/development";
import type {
  AwardWithContext,
  Character,
  CharacterBundle,
  CharacterComment,
  ItemComment,
  CharacterComparisonView,
  CharacterPerformance,
  CharacterSummary,
  ConsumableAdjustment,
  ConsumablePrice,
  CurrentGearOverride,
  DashboardData,
  FeedbackKind,
  FeedbackPriority,
  FeedbackReport,
  FeedbackStatus,
  GearOverrideSource,
  GearSet,
  GearSpec,
  Guild,
  Item,
  ItemContention,
  ItemDemand,
  ItemPriorityRule,
  LootAward,
  LootPriorityWeights,
  Phase,
  RaidReportView,
  RaidSession,
  SimSpecDetail,
  SimSpecView,
  SlotId,
  SlotItem,
  UntrackedLogPlayer,
  WclPlayerFight,
  WclPlayerOffPull,
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
/** The two work lists behind tier-token mapping — see `listTokenBackfill`. */
export interface TokenBackfillQueue {
  /** Cached ids that could be armor tokens, most-awarded first. */
  unchecked: number[];
  /** Known tokens whose vendor listing hasn't been read yet. */
  tokensWithoutPieces: number[];
}

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
  /** Bug reports filed from the app: open ones first, newest first within each. */
  listFeedback(): Promise<FeedbackReport[]>;
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
   * The groups an officer laid a raid night out in. An empty board means nobody
   * has recorded them — it is never derived, because Warcraft Logs doesn't
   * record group assignments at all.
   */
  getRaidBoard(code: string): Promise<Board>;
  /**
   * The template's board — one per guild, kept apart from every raid's.
   * Empty means nobody has planned one yet.
   */
  getTemplateBoard(): Promise<Board>;
  /**
   * The guild's own named boards — its main roster, a split's second team, next
   * week's Wednesday. As many as the officers want; empty until they make one.
   */
  listGuildRosters(): Promise<GuildRoster[]>;
  getGuildRoster(id: string): Promise<GuildRoster | undefined>;
  /**
   * Every class+spec this guild has raided as, with whether a wowsims setup is
   * saved for it — the sim section's index.
   */
  listSimSpecs(): Promise<SimSpecView[]>;
  /**
   * One spec's workbench: its saved setup, the kills available to compare
   * against, and what this guild's logs call each build. Null when nobody has
   * logged a pull as that spec and no setup exists for it either.
   */
  getSimSpec(wowClass: string, spec: string): Promise<SimSpecDetail | null>;
  /**
   * Every player's row for one boss pull.
   *
   * getCharacterPerformance answers "how did this raider do" and returns only
   * their rows — which cannot answer "did the raid have Misery up", because a
   * debuff is recorded against whoever applied it. Anything raid-wide about a
   * single pull needs all of them.
   */
  listPullRows(reportCode: string, fightId: number): Promise<WclPlayerFight[]>;
  /** Every ability resolved from Wowhead so far (spells and items both). */
  listAbilities(): Promise<AbilityInfo[]>;
  /**
   * Item names the priority sheets use that the cache can't match to an id.
   *
   * A council writes its sheet in names; everything else here is keyed by id,
   * so these are the rows that render as plain text with no icon and no
   * Wowhead hover. Feeding them to `resolveItemIdsByName` is what closes that
   * gap — see the item resolver on the import page.
   */
  listUnmatchedSheetNames(): Promise<string[]>;
  /**
   * Every boss the imported logs have seen, alphabetically.
   *
   * The council excuses content by name (policy.preparation.excusedEncounters),
   * and a list typed by hand is a list with a misspelling in it — so the choice
   * is made from what the logs actually contain.
   */
  listEncounterNames(): Promise<string[]>;
  /**
   * The pulls an officer excluded from a report's rollups (fight ids). Empty
   * means the whole night counts — see WriteRepo.setReportExcludedFights.
   */
  getReportExcludedFights(code: string): Promise<number[]>;
  /**
   * An officer's corrections to what one raid's logs say each raider used —
   * the counts, not the prices. Empty when nobody has changed anything.
   */
  getReportConsumableAdjustments(code: string): Promise<ConsumableAdjustment[]>;
  /**
   * Items the UI has to render as a bare id: referenced by loot, a wishlist or
   * the cache itself, but still missing a name or an icon. The (bounded) work
   * list for the Wowhead resolver, most-referenced first.
   */
  listUnresolvedItemIds(): Promise<number[]>;
  /**
   * The two (bounded) work lists behind tier-token mapping, in the order the
   * Wowhead calls have to happen: ids that might be armor tokens and nobody
   * has asked about, then known tokens whose vendor listing hasn't been read.
   * Both empty once the cache has been asked about everything it holds.
   */
  listTokenBackfill(): Promise<TokenBackfillQueue>;
  /**
   * What the guild's imported sets know about enchants: id → name (a
   * dictionary that works on every raider's logs) and the enchant each class's
   * wishlists pick per slot. The only source that names the enchantment ids
   * logs carry — see lib/analysis/enchants.
   */
  getEnchantReference(): Promise<EnchantReference>;
  /**
   * Enchant ids the gear panel can only render as a number: worn in a logged
   * pull, named by no imported set and no earlier lookup. The work list for
   * the enchant-name resolver, commonest first.
   */
  listUnnamedEnchantIds(): Promise<number[]>;
  /** The council's factor weighting, with unset factors filled from the defaults. */
  getLootPriorityWeights(): Promise<LootPriorityWeights>;
  /** The whole policy in force — defaults where the council has set nothing. */
  getGuildPolicy(): Promise<GuildPolicy>;
  /** The guild's class/spec guides. Empty until officers write them. */
  /**
   * Where each raider stands against the rest of the roster — attendance,
   * parse and preparation, each as a placing within the guild rather than
   * against a threshold the app invented.
   *
   * Two boards: mains against mains, alts and inactives against each other.
   * Pooling them lets an occasional alt lift every regular's placing. Pugs are
   * in neither.
   */
  /**
   * The night's drops with who should get them, per boss — decided before the
   * raid rather than in front of a corpse. Assembles the item cache, the
   * wishlists and contention; re-scores nothing.
   */
  getLootPlan(zone: string): Promise<LootPlan>;
  getRosterStanding(): Promise<RosterStanding>;
  /**
   * One raider night by night, with the recent window measured against
   * everything before it — "which way is this going", which no single career
   * number can answer.
   */
  getDevelopment(characterId: string): Promise<DevelopmentSeries>;
  /**
   * Every imported or hand-built gear set. Used by the manual set builder to
   * offer an existing list as a starting point — nothing else needs the whole
   * lot, since a character's own sets ride along in their bundle.
   */
  listGearSets(): Promise<GearSet[]>;
  listClassGuides(): Promise<ClassGuide[]>;
  /**
   * Notes on one item, newest first — a raider's about their own claim, an
   * officer's about the council's. Nothing here feeds a score: the council
   * decided the BiS-versus-second-choice call is too situational to automate,
   * so this carries the situation instead.
   */
  listItemComments(itemId: number): Promise<ItemComment[]>;
  /** How many notes each commented item has, for a badge on a board. */
  countItemComments(): Promise<Map<number, number>>;
  /**
   * Every stored wishlist fallback. The imported set still names the BiS; these
   * are what a raider said they'd take instead, in their order.
   */
  listWishlistAlternatives(): Promise<WishlistAlternative[]>;
  /**
   * What a policy change would do, without storing it: the roster measured
   * under the current policy and under the proposed one.
   */
  previewGuildPolicy(overrides: PolicyOverrides): Promise<PolicyPreview>;
  /**
   * Each roster raider's policy-sensitive figures, under whatever policy THIS
   * read model was built with. On its own it just restates the roster; its
   * purpose is to be run against two models and diffed — see
   * `previewGuildPolicy`, which is the only caller that should exist.
   */
  measureRoster(): Promise<PolicyPreviewRow[]>;
  /**
   * The spec priority chain for one item — an officer's edit when there is
   * one, else the seeded sheet. Names are matched loosely; pass every name the
   * caller knows for the item.
   */
  getItemPriorityRule(itemId: number, ...names: (string | undefined)[]): Promise<ItemPriorityRule | undefined>;
  /**
   * The whole priority sheet as one document, officer edits folded in — what
   * `getItemPriorityRule` answers one drop at a time. Defaults to the active
   * phase.
   */
  getPrioritySheet(phase?: number): Promise<PrioritySheetDocument>;
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

export type SetCurrentGearOverridesResult =
  | {
      ok: true;
      /** Slots written. */
      written: number;
      /** Slots left alone because they were already set by hand (replace: false). */
      kept: number;
    }
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

/**
 * A fetched report ready to persist: identity fields are derived at save time.
 * `upkeepTracks` is stamped there too — the fetcher shouldn't have to remember
 * to state what it asked for, and a drifting record would be worse than none.
 */
export type WclReportDraft = Omit<WclReport, "fetchedAt" | "raidSessionId" | "upkeepTracks"> & {
  raidSessionId?: string | null;
};
export type WclPlayerFightDraft = Omit<WclPlayerFight, "id" | "reportCode" | "characterId">;
/** One player's off-pull consumables, before identity/roster matching. */
export type WclPlayerOffPullDraft = Omit<WclPlayerOffPull, "id" | "reportCode" | "characterId">;

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
export type ItemCommentDraft = Omit<ItemComment, "id" | "createdAt">;
export type AddItemCommentResult =
  | { ok: true; comment: ItemComment }
  | { ok: false; error: string };

export type AddCommentResult =
  | { ok: true; comment: CharacterComment }
  | { ok: false; error: string };

/**
 * A new report: identity, timestamp and status are assigned at save time.
 * `kind` is optional because the schema defaults it to `bug` — the same default
 * that gives pre-`kind` rows their meaning.
 */
export type FeedbackDraft = Omit<
  FeedbackReport,
  "id" | "createdAt" | "status" | "kind" | "priority" | "adminNote"
> & {
  kind?: FeedbackKind;
};

/**
 * What a triager can change about a report. The reporter's own words aren't
 * here: `body`, `route`, `url` and `context` are the record of what they saw,
 * and a triage tool that could rewrite them would make the record worthless.
 *
 * Every field is optional and only the ones present are written, so setting a
 * priority never clears a note somebody else just left.
 */
export interface FeedbackTriage {
  status?: FeedbackStatus;
  priority?: FeedbackPriority;
  /** Empty string clears the note; undefined leaves it alone. */
  adminNote?: string;
  /** Who is writing it. Stamped with the note, and cleared with it. */
  adminNoteAuthor?: string;
}

export type AddFeedbackResult =
  | { ok: true; report: FeedbackReport }
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
   *
   * `spec` picks which kit is being edited — the off-spec one is a parallel set
   * of pins that never touches the main-spec answer.
   */
  setCurrentGearOverride(
    characterId: string,
    item: SlotItem,
    source: GearOverrideSource,
    spec?: GearSpec,
  ): Promise<SetCurrentGearOverrideResult>;
  /**
   * Pin many slots at once — one transaction, one cache-invalidation. With
   * `replace` false a slot an officer already set by hand is left alone, which
   * is what a bulk "fill this in from the logs" pass wants.
   */
  setCurrentGearOverrides(
    characterId: string,
    items: SlotItem[],
    source: GearOverrideSource,
    opts?: { replace?: boolean; spec?: GearSpec },
  ): Promise<SetCurrentGearOverridesResult>;
  /** Hand one slot back to the imported set. False when nothing was pinned there. */
  clearCurrentGearOverride(characterId: string, slot: SlotId, spec?: GearSpec): Promise<boolean>;
  /** Unpin every slot of one kit — back to the imported set wholesale. */
  clearCurrentGearOverrides(characterId: string, spec?: GearSpec): Promise<number>;
  /**
   * Set the council's factor weighting. Values are percentages; they need not
   * sum to 100 (the score is a weighted mean, so only ratios matter).
   */
  /**
   * Replace the council's policy. Partial: anything unnamed keeps whatever the
   * record already says, and anything the record never said falls back to the
   * code defaults.
   */
  setGuildPolicy(overrides: PolicyOverrides): Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * Which phase the guild is raiding. Not cosmetic: it decides whether a rare
   * gem is acceptable or behind the tier, which phase the loot sheet and the
   * fairness panel open on, and what "current" means to every view that asks.
   * Changing it re-reads all of those, which is exactly why it is worth being
   * able to change and put back.
   */
  setActivePhase(phase: Phase): Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * Override one item's spec priority chain, keyed by item name so it covers
   * drops the item cache has never seen. An empty chain clears the override and
   * hands the item back to the seeded sheet.
   */
  setItemPriorityRule(
    itemName: string,
    chain: string,
    note?: string,
  ): Promise<{ ok: true; rule?: ItemPriorityRule } | { ok: false; error: string }>;
  /**
   * Replace a phase's priority sheet with pasted markdown. The text is stored
   * verbatim and parsed on read, so the stored sheet stays something an officer
   * can read back and diff — the same reason the seeded one is markdown.
   */
  setPrioritySheet(input: {
    phase: number;
    markdown: string;
    author?: string;
    note?: string;
  }): Promise<{ ok: true; ruleCount: number } | { ok: false; error: string }>;
  /** Drop a pasted sheet, reverting the phase to the seed (or to empty). */
  deletePrioritySheet(phase: number): Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * Replace a slot's fallbacks outright, in the order given. Ranks are
   * renumbered densely, so a caller never has to reason about gaps.
   */
  setWishlistAlternatives(input: {
    characterId: string;
    phase: number;
    slot: string;
    items: { itemId: number; itemName?: string; note?: string }[];
  }): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Write one class or spec guide. An empty body deletes it. */
  setClassGuide(input: {
    wowClass: string;
    /** Empty for the class-level guide. */
    spec: string;
    body: string;
    sources: string[];
    author?: string;
  }): Promise<{ ok: true; deleted?: boolean } | { ok: false; error: string }>;
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
  saveWclReport(
    report: WclReportDraft,
    rows: WclPlayerFightDraft[],
    /** Consumables used away from the boss pulls, per player. */
    offPull?: WclPlayerOffPullDraft[],
  ): Promise<WclSaveResult>;
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
   * Record which groups a raid night was run in. Replaces the whole board; a
   * board with nobody on it clears the record entirely.
   */
  setRaidBoard(code: string, board: Board): Promise<void>;
  /** Save the template's board. An empty board clears it. */
  setTemplateBoard(board: Board): Promise<void>;
  /** Make a new guild roster. The caller mints the id. */
  createGuildRoster(board: GuildRoster): Promise<void>;
  /**
   * Change part of a board — its name, its prospects, or its board —
   * leaving the rest as it was. A board that no longer exists is not recreated.
   */
  updateGuildRoster(
    id: string,
    patch: Partial<Pick<GuildRoster, "name" | "prospects" | "board">>,
  ): Promise<void>;
  /** Throw a guild roster away. Unlike a raid night, it records nothing that happened. */
  deleteGuildRoster(id: string): Promise<void>;
  /** Save one spec's decoded wowsims setup; undefined clears it. */
  setSimProfile(wowClass: string, spec: string, json: string | undefined): Promise<void>;
  /** Record abilities resolved from Wowhead. Refs already known are left alone. */
  addAbilities(abilities: AbilityInfo[]): Promise<number>;
  /**
   * Choose which of a report's pulls feed its rollups: the given fight ids are
   * excluded from preparation coverage, consumable/cooldown counts, uptime and
   * the improvement list. Replaces the whole set; an empty list counts the
   * whole night again.
   */
  setReportExcludedFights(code: string, fightIds: number[]): Promise<void>;
  /**
   * Replace a raid's hand corrections to consumable counts. Each entry adds or
   * removes uses for one raider and one consumable; an empty list hands the
   * night back to exactly what the log said.
   */
  setReportConsumableAdjustments(code: string, adjustments: ConsumableAdjustment[]): Promise<void>;
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
  addItemComment(draft: ItemCommentDraft): Promise<AddItemCommentResult>;
  deleteItemComment(id: string): Promise<boolean>;
  /** Remove one comment by id. Returns false when it didn't exist. */
  deleteCharacterComment(id: string): Promise<boolean>;
  /** File one bug report. The id and timestamp are assigned here, not by the caller. */
  addFeedback(draft: FeedbackDraft): Promise<AddFeedbackResult>;
  /** Open or close one report. Returns false when the id didn't exist. */
  setFeedbackStatus(id: string, status: FeedbackStatus): Promise<boolean>;
  /**
   * Triage one report — status, priority, the officer's note, in any
   * combination. Returns false when the id didn't exist.
   */
  setFeedbackTriage(id: string, triage: FeedbackTriage): Promise<boolean>;
  /**
   * Pin a priority-sheet name to an item id, or unpin it with `undefined`.
   *
   * The escape hatch for names no lookup can settle — two items sharing a name
   * exactly (the Warglaives), or a sheet spelling nobody wants to change. Keyed
   * by the normalized name so it survives the sheet being re-pasted.
   */
  setSheetItemId(itemName: string, itemId?: number): Promise<{ ok: boolean; error?: string }>;
  /** Remove one report for good. Returns false when it didn't exist. */
  deleteFeedback(id: string): Promise<boolean>;
  /**
   * Fill the item cache from an import. Fields are merged per id — a row only
   * ever gains what it was missing, so curated entries are never overwritten.
   * Returns how many items were created or learned something.
   */
  addItemsIfMissing(items: Item[]): Promise<number>;
  /**
   * Write what Wowhead itself said about these ids, overwriting the name,
   * quality, icon and slot already cached and marking them verified.
   *
   * The counterpart to `addItemsIfMissing`, and the only writer allowed to
   * overwrite: every other source is a guess, and a guess that outranks the
   * authority is how a wrong icon becomes permanent. Zone, boss and phase go
   * the other way — filled when empty, never overwritten — so an officer's
   * curation outlives every backfill.
   */
  saveResolvedItems(items: Item[]): Promise<number>;
  /**
   * Record which armor token buys which tier piece, and mark those tokens as
   * tokens. Overwrites: Wowhead's vendor listing is the only source for the
   * edge, so an existing value is an older reading of the same page rather
   * than an answer of the guild's to protect. Returns edges written.
   */
  saveTokenRedemptions(edges: TokenRedemptionEdge[]): Promise<number>;
  /**
   * The two things about an item only the guild can say: where it drops, and
   * which tier that makes it. Wowhead has no opinion on either, so nothing can
   * derive them and nothing may overwrite them.
   *
   * `null` on a field clears it, which is a real answer rather than a gap —
   * the curated list shipped with 44 entries written against the wrong item id,
   * and their zone and phase described something else entirely. No source
   * reads better than a confident wrong one, and this is how it gets put back.
   *
   * Upserts, because the id on screen may be one the cache has never held —
   * an officer looking at a bare id is exactly who needs to say what it is.
   */
  setItemCuration(
    itemId: number,
    curation: { phase: Phase | null; source: { zone: string; boss?: string } | null },
  ): Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * Record enchant ids resolved to names. Ids already named are left alone;
   * returns how many rows were written.
   */
  addEnchantNames(names: { id: number; name: string }[]): Promise<number>;
  /**
   * Harvest item data out of records already imported: names from wishlists
   * and loot pastes, icons from the gear snapshot on every logged pull. No
   * network — this is data the database already holds, buried in per-row JSON.
   */
  harvestItemCache(): Promise<number>;
  /**
   * Re-apply the shipped drop table — zone, boss and phase — to cached items
   * that have none. Gap-filling, so an officer's own curation always wins and
   * nothing already answered is touched.
   *
   * It exists because the shipped list is the only place that knowledge lives,
   * and a database seeded before it was corrected never sees an update to it.
   * Wowhead can never supply this: it knows what an item is, not which tier
   * this guild counts it as.
   */
  applyCuratedItemSources(): Promise<number>;
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
