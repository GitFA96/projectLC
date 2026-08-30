import { buildMembersView, type MembersView } from "@/lib/analysis/members";
import { buildPublicProfile, type GuildVisibility, type PublicProfile } from "@/lib/analysis/public-profile";
import { clampWindows, successionState, type SuccessionState } from "@/lib/auth/succession";
import {
  computeCompletion,
  computeStatDeltas,
  computeWishlistRows,
  matchAwardToWishlists,
} from "@/lib/analysis/wishlist";
import { emptyBoard, type Board, type GuildRoster } from "@/lib/analysis/raid-planner";
import { computeItemContention } from "@/lib/analysis/contention";
import { tokenRedemptions } from "@/lib/items/tier-tokens";
import { buildRosterStanding } from "@/lib/analysis/standing";
import { buildDevelopmentSeries, parseTrend } from "@/lib/analysis/development";
import { buildLootPlan, type LootPlanEntry, type LootPlanSheetDrop } from "@/lib/analysis/loot-plan";
import { bossCommentKey } from "@/lib/loot/boss-notes";
import {
  dropKey,
  mergeDropTable,
  resolveDropNames,
  type BossDropDraft,
  type MergedDrop,
} from "@/lib/loot/drop-table";
import { applyCurrentGearOverrides, offSpecGearSet } from "@/lib/analysis/current-gear";
import { buildEnchantReference, type EnchantReference } from "@/lib/analysis/enchants";
import { computeFairness } from "@/lib/analysis/fairness";
import { dayOf, inLootWindow, lootWindowRange } from "@/lib/analysis/loot-recency";
import { resetWeekStart, summarizePerformance } from "@/lib/analysis/performance";
import { summarizeRaidReport } from "@/lib/analysis/raid-report";
import { goldPerRaid, summarizeComparison, type ComparisonInput } from "@/lib/analysis/comparison";
import { LOOT_PRIORITY_SHEET_MD, LOOT_PRIORITY_SHEET_PHASE } from "@/data/seed/loot-priority-p3";
import {
  buildPrioritySheetView,
  indexRules,
  normalizeItemName,
  parsePrioritySheet,
  type PrioritySheetRule,
} from "@/lib/loot/priority-sheet";
import { sheetSectionSource } from "@/lib/loot/sheet-sources";
import { parsePriorityChain } from "@/lib/loot/priority-chain";
import { resolvePolicy, type PolicyOverrides } from "@/lib/analysis/policy";
import { buildPolicyPreview } from "@/lib/analysis/policy-preview";
import type { Guide } from "@/lib/guides";
import type { WishlistAlternative } from "@/lib/analysis/wishlist-alternatives";
import { PHASE_IDS, bossKey, phaseForZones, raidOfBoss } from "@/lib/constants/wow";
import { itemDisplayName } from "@/lib/items/item-data";
import { fingerprintRows, specFingerprints, specOfPull } from "@/lib/sim/profile";
import type {
  AttendanceExemption,
  AttendanceSummary,
  AwardWithContext,
  Character,
  CharacterBundle,
  CharacterComment,
  ItemComment,
  BossComment,
  BossDrop,
  GuildBossDrop,
  CharacterComparisonView,
  FeedbackReport,
  GuildAuditEntry,
  GuildInvite,
  GuildRole,
  Membership,
  CharacterPerformance,
  CharacterSummary,
  ConsumableAdjustment,
  ConsumablePrice,
  CurrentGearOverride,
  FairnessGroup,
  GearSet,
  Guild,
  Item,
  ItemDemand,
  ItemPriorityRule,
  LootAward,
  LootPriorityWeights,
  PerformanceReportView,
  Phase,
  PhaseWishlistView,
  RaidReportView,
  RaidSession,
  RaiderMetrics,
  SimPullView,
  SimSpecDetail,
  SimSpecView,
  UntrackedLogPlayer,
  WclPlayerFight,
  WclPlayerOffPull,
  WclReport,
  WclReportView,
  RefusedNameView,
} from "@/lib/types";
import type { Repo, TokenBackfillQueue } from "@/lib/data/repo";

import { compareText } from "@/lib/sort";

/**
 * The plain entities a backend loads (seed JSON or SQLite rows). All derived
 * data — summaries, contention, wishlist matching — is computed here so every
 * backend answers queries identically.
 */
export interface EntityStore {
  guild: Guild;
  roster: Character[];
  items: Item[];
  gearSets: GearSet[];
  /** Officer-pinned current-gear slots, applied over the imported set on read. */
  currentGearOverrides: CurrentGearOverride[];
  raidSessions: RaidSession[];
  lootAwards: LootAward[];
  wclReports: WclReport[];
  wclPlayerFights: WclPlayerFight[];
  /** Consumables used away from the boss pulls, one record per player per report. */
  wclPlayerOffPull: WclPlayerOffPull[];
  attendanceExemptions: AttendanceExemption[];
  characterComments: CharacterComment[];
  /** Notes on an item — raider's or officer's. Never scored; see repo.listItemComments. */
  itemComments: ItemComment[];
  bossComments: BossComment[];
  bossDrops: BossDrop[];
  guildBossDrops: GuildBossDrop[];
  /**
   * Bug reports filed from the app. Not guild data and not derived from
   * anything — it rides along here so both backends answer `listFeedback`
   * identically, and so the read model is the single place pages read from.
   */
  feedback: FeedbackReport[];
  /**
   * Identity, as far as the read model is concerned.
   *
   * `accounts` and `auth_sessions` are deliberately **absent**: they are not
   * guild data, they change on every login, and a session write that bumped
   * `data_version` would rebuild this entire model each time somebody signed
   * in. Those two are read straight from SQLite; everything here is guild data
   * that changes rarely and belongs in the cache like anything else.
   */
  memberships: Membership[];
  guildRoles: GuildRole[];
  guildInvites: GuildInvite[];
  /** What the guild is entitled to know happened to it — newest first. */
  guildAudit: GuildAuditEntry[];
}

/** Referential integrity — hard errors; these always indicate a broken data source. */
export function validateStore(store: EntityStore, sourceLabel: string): void {
  const charIds = new Set(store.roster.map((c) => c.id));
  const sessionIds = new Set(store.raidSessions.map((s) => s.id));
  for (const set of store.gearSets) {
    if (!charIds.has(set.characterId)) {
      throw new Error(`${sourceLabel}: gear set ${set.id} references unknown characterId ${set.characterId}`);
    }
  }
  for (const override of store.currentGearOverrides) {
    if (!charIds.has(override.characterId)) {
      throw new Error(
        `${sourceLabel}: current-gear override for ${override.item.slot} references unknown characterId ${override.characterId}`,
      );
    }
  }
  for (const award of store.lootAwards) {
    if (!sessionIds.has(award.raidSessionId)) {
      throw new Error(`${sourceLabel}: award ${award.id} references unknown raidSessionId ${award.raidSessionId}`);
    }
    if (award.characterId !== null && !charIds.has(award.characterId)) {
      throw new Error(`${sourceLabel}: award ${award.id} references unknown characterId ${award.characterId}`);
    }
  }
  /*
   * Identity. A dangling claim is the failure that matters here: a character
   * pointing at a membership that no longer exists would read as "claimed by
   * nobody", which is a different and much more confusing state than unclaimed.
   * Invariant 6 says deleting a membership UNLINKS its characters — so if one
   * still points at a missing membership, the unlink was skipped.
   */
  const membershipIds = new Set(store.memberships.map((m) => m.id));
  const roleGuild = new Map(store.guildRoles.map((r) => [r.id, r.guildId]));
  for (const character of store.roster) {
    if (character.membershipId !== null && !membershipIds.has(character.membershipId)) {
      throw new Error(
        `${sourceLabel}: character ${character.name} is claimed by unknown membershipId ${character.membershipId}`,
      );
    }
  }
  for (const membership of store.memberships) {
    for (const roleId of membership.roleIds) {
      const owner = roleGuild.get(roleId);
      if (owner === undefined) {
        throw new Error(`${sourceLabel}: membership ${membership.id} holds unknown roleId ${roleId}`);
      }
      // A role from another guild would be capabilities crossing a boundary,
      // which §3 says never happens. `resolve.ts` filters by guild and so would
      // not grant it — but a store that can express the state at all is a store
      // where some future reader forgets to filter.
      if (owner !== membership.guildId) {
        throw new Error(
          `${sourceLabel}: membership ${membership.id} holds roleId ${roleId} from another guild`,
        );
      }
    }
  }
  for (const invite of store.guildInvites) {
    if (!charIds.has(invite.characterId)) {
      throw new Error(`${sourceLabel}: invite ${invite.id} references unknown characterId ${invite.characterId}`);
    }
  }

  const reportCodes = new Set(store.wclReports.map((r) => r.code));
  for (const report of store.wclReports) {
    if (report.raidSessionId !== null && !sessionIds.has(report.raidSessionId)) {
      throw new Error(`${sourceLabel}: WCL report ${report.code} references unknown raidSessionId ${report.raidSessionId}`);
    }
  }
  for (const row of store.wclPlayerFights) {
    if (!reportCodes.has(row.reportCode)) {
      throw new Error(`${sourceLabel}: WCL player fight ${row.id} references unknown reportCode ${row.reportCode}`);
    }
    if (row.characterId !== null && !charIds.has(row.characterId)) {
      throw new Error(`${sourceLabel}: WCL player fight ${row.id} references unknown characterId ${row.characterId}`);
    }
  }
  for (const row of store.wclPlayerOffPull) {
    if (!reportCodes.has(row.reportCode)) {
      throw new Error(`${sourceLabel}: off-pull record ${row.id} references unknown reportCode ${row.reportCode}`);
    }
    if (row.characterId !== null && !charIds.has(row.characterId)) {
      throw new Error(`${sourceLabel}: off-pull record ${row.id} references unknown characterId ${row.characterId}`);
    }
  }
  for (const exemption of store.attendanceExemptions) {
    if (!charIds.has(exemption.characterId)) {
      throw new Error(`${sourceLabel}: attendance exemption references unknown characterId ${exemption.characterId}`);
    }
  }
  for (const comment of store.characterComments) {
    if (!charIds.has(comment.characterId)) {
      throw new Error(`${sourceLabel}: character comment ${comment.id} references unknown characterId ${comment.characterId}`);
    }
  }
  for (const comment of store.itemComments) {
    // Unset means "about the item" or "about somebody since deleted". Set has
    // to resolve, because deleting a character unlinks these rather than
    // dropping them.
    if (comment.characterId !== undefined && !charIds.has(comment.characterId)) {
      throw new Error(`${sourceLabel}: item comment ${comment.id} references unknown characterId ${comment.characterId}`);
    }
  }
  // A main link must resolve to another character (a real, non-self target).
  for (const character of store.roster) {
    if (character.mainCharacterId !== null) {
      if (character.mainCharacterId === character.id) {
        throw new Error(`${sourceLabel}: character ${character.id} lists itself as its main`);
      }
      if (!charIds.has(character.mainCharacterId)) {
        throw new Error(`${sourceLabel}: character ${character.id} lists unknown main ${character.mainCharacterId}`);
      }
    }
  }
}

/**
 * Persisted per-report config that isn't entity data: the pulls an officer
 * excluded from a report's rollups, keyed by report code. The seed backend has
 * none; the SQLite backend reads it from the meta table when it builds the
 * model (every write bumps the data version, so the model picks edits up).
 */
export interface StoreConfig {
  excludedFightsByCode?: Record<string, number[]>;
  /**
   * membershipId → when that person was last actually here.
   *
   * Supplied by the backend rather than read from the store: `accounts` is
   * outside the read model on purpose (a login must not rebuild it), so this is
   * the one identity fact the store cannot look up for itself.
   */
  membershipLastSeen?: Record<string, string | null>;
  /**
   * The council's policy — every number that encodes a judgement. Anything
   * unset falls back to the code defaults, so an empty record behaves exactly
   * as the app did before the record existed.
   */
  policy?: PolicyOverrides;
  /**
   * Officer edits to the seeded priority sheet, by phase and then normalized
   * item name. A chain belongs to the sheet it was written against — see the
   * `item_priority_rules` phase key.
   */
  itemPriorityRules?: Record<number, Record<string, { itemName: string; chain: string; note?: string }>>;
  /**
   * Item ids an officer pinned to a sheet name the cache can't match, keyed by
   * the normalized name. Consulted before the cache, because a person who
   * pinned an id has already answered the question the lookup is guessing at.
   */
  sheetItemIds?: Record<string, number>;
  /**
   * Sheets an officer has pasted, keyed by phase. A phase with none falls back
   * to the seeded sheet (phase 3) or to nothing at all.
   */
  prioritySheetsByPhase?: Record<
    number,
    { markdown: string; author?: string; note?: string; updatedAt: string }
  >;
  /** The guild's own class/spec guides, as written by its officers. */
  guides?: Guide[];
  /** Per-slot fallbacks a raider will take when their BiS doesn't drop. */
  wishlistAlternatives?: WishlistAlternative[];
  /** Enchant ids resolved from the enchantment table, for the gear panel. */
  enchantNames?: Record<number, string>;
  /**
   * Names taken to Wowhead and refused, by normalized name.
   *
   * The lookup queues are built from what the cache cannot match, so without
   * this a name already declined looks exactly like one nobody has asked about.
   * They are different jobs — one is a press, the other is a person reading a
   * near-miss — and the import card now says which is which.
   */
  refusedItemNames?: { nameKey: string; name: string; reason: string; near: string[]; checkedAt: string }[];
  /** Officer corrections to consumable counts, keyed by report code. */
  consumableAdjustmentsByCode?: Record<string, ConsumableAdjustment[]>;
}

/**
 * The markdown in force for a phase: what an officer pasted, else the seeded
 * sheet for the one phase that ships with one, else nothing.
 *
 * Deleting a stored sheet is therefore how a phase reverts to the seed —
 * the same shape as clearing an item rule to hand that item back to the sheet.
 */
function sheetMarkdownFor(phase: number, stored: StoreConfig["prioritySheetsByPhase"]): string {
  const pasted = stored?.[phase]?.markdown;
  if (pasted !== undefined) return pasted;
  return phase === LOOT_PRIORITY_SHEET_PHASE ? LOOT_PRIORITY_SHEET_MD : "";
}

/**
 * The zero-argument views, memoized for the life of one read model.
 *
 * These are pure functions of an immutable store, and they are not cheap:
 * `listCharacters` re-derives a summary per roster character and
 * `listItemDemand` re-walks every wishlist. Both ran on every request even
 * though a read model is discarded and rebuilt the moment `data_version`
 * changes — and the nav calls `listItemDemand` on every page, so the cost was
 * paid site-wide rather than on the pages that wanted the data.
 *
 * Only zero-argument readers belong here: with no arguments there is nothing
 * to key a cache on, so "this read model" is the entire cache key. Add a
 * method that takes arguments and the cache would return one caller's answer
 * to another.
 *
 * The cached value is shared rather than copied — which is what `listItems`
 * and `listLootAwards` already did. Callers must not mutate what they get.
 */
const MEMOIZED_VIEWS = ["listCharacters", "listItemDemand", "listWclReports", "getDashboard"] as const;

function memoizeViews(repo: Repo): Repo {
  const wrapped: Repo = { ...repo };
  for (const key of MEMOIZED_VIEWS) {
    const compute = repo[key].bind(repo) as () => Promise<unknown>;
    // The promise is cached, not the value, so two concurrent callers on a
    // cold model share one computation instead of both doing it.
    let pending: Promise<unknown> | undefined;
    (wrapped as unknown as Record<string, unknown>)[key] = () => (pending ??= compute());
  }
  return wrapped;
}

export function createRepoFromStore(store: EntityStore, config: StoreConfig = {}): Repo {
  const { guild, roster, items, gearSets, currentGearOverrides, raidSessions, lootAwards, wclReports, wclPlayerFights, wclPlayerOffPull, attendanceExemptions, characterComments, itemComments, bossComments, bossDrops, guildBossDrops, feedback } = store;

  /*
   * Sheets parsed per READ MODEL, never per process.
   *
   * This used to be a module-level singleton, on the reasoning that a seed
   * module never changes at runtime. Now that a sheet can be pasted, that cache
   * would outlive the write that replaced it: `data_version` rebuilds the read
   * model but cannot reach a module-scope variable, so the first paste would
   * have reported success and changed nothing until the process restarted.
   * Keeping it here means the cache dies with the model that owns it.
   */
  const parsedSheets = new Map<number, PrioritySheetRule[]>();
  function rulesForPhase(phase: number): PrioritySheetRule[] {
    let rules = parsedSheets.get(phase);
    if (!rules) {
      rules = parsePrioritySheet(sheetMarkdownFor(phase, config.prioritySheetsByPhase));
      parsedSheets.set(phase, rules);
    }
    return rules;
  }
  const indexedSheets = new Map<number, Map<string, PrioritySheetRule>>();
  function sheetForPhase(phase: number): Map<string, PrioritySheetRule> {
    let index = indexedSheets.get(phase);
    if (!index) {
      index = indexRules(rulesForPhase(phase));
      indexedSheets.set(phase, index);
    }
    return index;
  }

  /**
   * Which item id a name on the council's sheet refers to.
   *
   * Three readers need this and they must not disagree: the sheet page (so a
   * row renders with an icon), the drop-source pass (so the item learns which
   * boss drops it) and the loot plan (so a drop is not listed twice, once as a
   * real item and once as bare text).
   *
   * **The officer's pin wins over the name match**, because they set it exactly
   * when the name could not be matched or matched the wrong thing. The sheet
   * says "Hammer of Judgment" and the item is "Hammer of Judgement"; the exact-
   * name rule that keeps a misspelling from resolving to a plausible wrong item
   * is also what leaves this one unmatched, and the pin is the way back.
   *
   * This lived inline in `getPrioritySheet` and nowhere else, which is how two
   * newer readers came to match on name alone — and why a pinned drop appeared
   * on the loot plan as unlinkable text beside the very item it was pinned to.
   */
  const itemIdByName = new Map<string, number>();
  for (const item of items) {
    if (item.name) itemIdByName.set(normalizeItemName(item.name), item.id);
  }
  function sheetItemIdFor(itemName: string): number | undefined {
    const key = normalizeItemName(itemName);
    return config.sheetItemIds?.[key] ?? itemIdByName.get(key);
  }

  /** The policy in force, resolved once — every score below reads it. */
  const policy = resolvePolicy(config.policy);

  /* Indexes */
  const charactersById = new Map(roster.map((c) => [c.id, c]));
  const charactersBySlug = new Map(roster.map((c) => [c.name.toLowerCase(), c]));
  // Reverse main→alts: only links that resolve to a real other character.
  const altNamesByMain = new Map<string, string[]>();
  for (const c of roster) {
    if (c.mainCharacterId && c.mainCharacterId !== c.id && charactersById.has(c.mainCharacterId)) {
      const list = altNamesByMain.get(c.mainCharacterId) ?? [];
      list.push(c.name);
      altNamesByMain.set(c.mainCharacterId, list);
    }
  }
  const exemptWeeksByCharacter = new Map<string, Set<string>>();
  for (const e of attendanceExemptions) {
    const set = exemptWeeksByCharacter.get(e.characterId) ?? new Set<string>();
    set.add(e.weekStart);
    exemptWeeksByCharacter.set(e.characterId, set);
  }
  // Officer comments per character, newest first.
  const commentsByCharacter = new Map<string, CharacterComment[]>();
  for (const c of [...characterComments].sort((a, b) => compareText(b.createdAt, a.createdAt))) {
    const list = commentsByCharacter.get(c.characterId) ?? [];
    list.push(c);
    commentsByCharacter.set(c.characterId, list);
  }
  const commentsOf = (characterId: string): CharacterComment[] =>
    commentsByCharacter.get(characterId) ?? [];
  // Item notes, newest first, keyed by item. Both kinds live together: a note
  // about one raider's claim and a note about the item itself belong on the
  // same page, and the council reads them as one thread.
  // Keyed `zone|bossKey`: trash is a drop source in every raid, so a boss key
  // alone would pool Hyjal's trash notes with Black Temple's.
  const bossCommentsByBoss = new Map<string, BossComment[]>();
  for (const c of [...bossComments].sort((a, b) => compareText(b.createdAt, a.createdAt))) {
    const key = bossCommentKey(c.zone, c.bossKey);
    bossCommentsByBoss.set(key, [...(bossCommentsByBoss.get(key) ?? []), c]);
  }

  const itemCommentsByItem = new Map<number, ItemComment[]>();
  for (const c of [...itemComments].sort((a, b) => compareText(b.createdAt, a.createdAt))) {
    const list = itemCommentsByItem.get(c.itemId) ?? [];
    list.push(c);
    itemCommentsByItem.set(c.itemId, list);
  }
  const itemsById = new Map(items.map((i) => [i.id, i]));
  // Which armor token buys which tier piece. Read once here and handed to
  // every reader that has to treat a token win as the piece it buys — see
  // lib/items/tier-tokens for why the edge is stored on the piece.
  const redemptions = tokenRedemptions(items);
  const sessionsById = new Map(raidSessions.map((s) => [s.id, s]));
  // Pinned slots, per character, in canonical slot order — split by which kit
  // they belong to. Only the main-spec pins reach the derived read model:
  // everything downstream (wishlist "Currently", completion, contention, loot
  // priority) judges a raider in the spec they're ranked in.
  const overridesByCharacter = new Map<string, CurrentGearOverride[]>();
  const offOverridesByCharacter = new Map<string, CurrentGearOverride[]>();
  for (const override of currentGearOverrides) {
    const target = override.spec === "off" ? offOverridesByCharacter : overridesByCharacter;
    const list = target.get(override.characterId) ?? [];
    list.push(override);
    target.set(override.characterId, list);
  }
  const overridesOf = (characterId: string): CurrentGearOverride[] =>
    overridesByCharacter.get(characterId) ?? [];
  const offOverridesOf = (characterId: string): CurrentGearOverride[] =>
    offOverridesByCharacter.get(characterId) ?? [];

  /** The imported current set, exactly as exported — before any pinning. */
  function importedCurrentOf(characterId: string): GearSet | undefined {
    return gearSets.find((s) => s.characterId === characterId && s.kind === "current");
  }

  // Every derived answer reads this map, and the "current" set in it already
  // has the pinned slots applied — so an override counts for wishlist status,
  // completion and contention alike, with no second code path to keep in sync.
  const gearSetsByCharacter = new Map<string, GearSet[]>();
  for (const set of gearSets) {
    const list = gearSetsByCharacter.get(set.characterId) ?? [];
    list.push(set.kind === "current" ? (applyCurrentGearOverrides(set, overridesOf(set.characterId)) ?? set) : set);
    gearSetsByCharacter.set(set.characterId, list);
  }
  // Pins for a character who never imported a current set stand on their own.
  for (const [characterId, overrides] of overridesByCharacter) {
    if (importedCurrentOf(characterId)) continue;
    const synthesised = applyCurrentGearOverrides(undefined, overrides);
    if (!synthesised) continue;
    const list = gearSetsByCharacter.get(characterId) ?? [];
    list.push(synthesised);
    gearSetsByCharacter.set(characterId, list);
  }

  function wishlistsOf(characterId: string): GearSet[] {
    return (gearSetsByCharacter.get(characterId) ?? [])
      .filter((s) => s.kind === "wishlist")
      .sort((a, b) => (a.phase ?? 0) - (b.phase ?? 0));
  }

  function currentOf(characterId: string): GearSet | undefined {
    return (gearSetsByCharacter.get(characterId) ?? []).find((s) => s.kind === "current");
  }

  const awardsWithContext: AwardWithContext[] = lootAwards
    .map((award) => {
      const session = sessionsById.get(award.raidSessionId)!;
      const character = award.characterId ? charactersById.get(award.characterId) : undefined;
      return {
        award,
        session,
        sessionPhase: phaseForZones(session.zones),
        character,
        item: itemsById.get(award.itemId),
        wishlist: character
          ? matchAwardToWishlists(award, wishlistsOf(character.id), redemptions)
          : { matched: false, phases: [] },
      } satisfies AwardWithContext;
    })
    .sort((a, b) => compareText(b.award.awardedAt, a.award.awardedAt));

  function awardsOf(characterId: string) {
    return lootAwards.filter((a) => a.characterId === characterId);
  }

  function summarize(character: Character): CharacterSummary {
    const current = currentOf(character.id);
    const myAwards = awardsWithContext.filter((a) => a.award.characterId === character.id);
    const completionByPhase = wishlistsOf(character.id).map((set) => ({
      phase: set.phase!,
      completion: computeCompletion(
        computeWishlistRows(set, current, awardsOf(character.id), [], redemptions),
      ),
    }));
    const last = myAwards[0]?.award.awardedAt;
    // Resolve the alt→main link to a display name (only when it's a valid link).
    const main =
      character.mainCharacterId && character.mainCharacterId !== character.id
        ? charactersById.get(character.mainCharacterId)
        : undefined;
    const altNames = altNamesByMain.get(character.id);
    return {
      character,
      completionByPhase,
      totalAwards: myAwards.length,
      activePhaseAwards: myAwards.filter((a) => a.sessionPhase === guild.activePhase).length,
      offspecAwards: myAwards.filter((a) => a.award.offspec).length,
      lastAwardAt: last,
      hasCurrentGear: current !== undefined,
      attendance: computeAttendance(character.id),
      loggedSpec: loggedSpecOf(character.id),
      mainCharacterName: character.status === "alt" ? main?.name : undefined,
      altNames: altNames && altNames.length > 0 ? [...altNames].sort() : undefined,
    };
  }

  /** Every item id that appears on at least one wishlist (contention candidates). */
  function wishlistedItemIds(): Set<number> {
    const ids = new Set<number>();
    for (const set of gearSets) {
      if (set.kind !== "wishlist") continue;
      for (const slot of set.slots) ids.add(slot.itemId);
    }
    return ids;
  }

  /**
   * The raiding record every loot-priority score reads from. Built once for
   * the whole roster on first use and reused for every item afterwards — the
   * contention view is asked for one item at a time, but the demand index asks
   * for all of them.
   */
  let metricsByCharacter: Map<string, RaiderMetrics> | undefined;
  function raiderMetricsOf(characterId: string): RaiderMetrics | undefined {
    if (!metricsByCharacter) {
      metricsByCharacter = new Map();
      for (const character of roster) {
        const rows = careerRowsOf(character.id);
        metricsByCharacter.set(character.id, {
          attendance: computeAttendance(character.id),
          career: summarizePerformance(rows, policy),
          goldPerRaid: goldPerRaid(
            rows,
            offPullOf(character.id),
            config.consumableAdjustmentsByCode ?? {},
          ),
        } satisfies RaiderMetrics);
      }
    }
    return metricsByCharacter.get(characterId);
  }

  /**
   * Which sheets to consult for one item, and in what order: the active phase
   * first, then every other phase, newest back to oldest.
   *
   * Not just the active phase's. An item does not stop existing when the guild
   * moves on — a P3 boss still drops P3 loot while the roster farms it in P4,
   * and the council's chain for that item is still the chain. Scoping the
   * lookup to the active phase silently strips every older item of its priority
   * the day a new sheet is pasted.
   */
  const lookupPhases = [
    guild.activePhase,
    ...[...PHASE_IDS].sort((a, b) => b - a).filter((p) => p !== guild.activePhase),
  ];

  /**
   * The council's spec priority for one item: an officer's edit if there is
   * one, else whichever sheet lists it. Matching is by NAME — a sheet lists
   * every drop a boss has, most of which the item cache has never seen — so any
   * name the app knows for the item is worth trying.
   */
  function priorityRuleFor(...names: (string | undefined)[]): ItemPriorityRule | undefined {
    const keys = names
      .filter((n): n is string => n !== undefined && n.trim() !== "")
      .map(normalizeItemName);
    for (const key of keys) {
      // The same phase order the sheets are consulted in, and for the same
      // reason: an officer's chain for a P3 drop is still their chain while the
      // guild farms P2, so scoping this to the active phase would silently
      // strip it. The phase only decides which sheet PAGE lists the chain.
      const editedPhase = lookupPhases.find((phase) => config.itemPriorityRules?.[phase]?.[key]);
      const edited = editedPhase === undefined ? undefined : config.itemPriorityRules?.[editedPhase]?.[key];
      if (edited) {
        return {
          itemName: edited.itemName,
          chain: edited.chain,
          tiers: parsePriorityChain(edited.chain).tiers,
          note: edited.note,
          origin: "officer",
          phase: editedPhase,
        };
      }
    }
    for (const key of keys) {
      const seeded = lookupPhases.reduce<PrioritySheetRule | undefined>(
        (found, phase) => found ?? sheetForPhase(phase).get(key),
        undefined,
      );
      if (seeded) {
        return {
          itemName: seeded.itemName,
          chain: seeded.chain.source,
          tiers: seeded.chain.tiers,
          note: seeded.note,
          origin: "sheet",
          source: seeded.source,
        };
      }
    }
    return undefined;
  }

  function contentionFor(itemId: number) {
    const item = itemsById.get(itemId);
    return computeItemContention({
      itemId,
      item,
      characters: roster,
      gearSetsByCharacter,
      awards: awardsWithContext,
      activePhase: guild.activePhase,
      metricsOf: raiderMetricsOf,
      alternatives: config.wishlistAlternatives,
      redemptions,
      priorityRule: priorityRuleFor(
        item?.name,
        lootAwards.find((a) => a.itemId === itemId)?.itemName,
        gearSets.flatMap((s) => s.slots).find((s) => s.itemId === itemId)?.itemName,
      ),
      policy,
    });
  }

  /** Winner is neither a roster character nor deliberately off-roster. */
  function unresolvedAwards(): LootAward[] {
    return lootAwards.filter((a) => a.characterId === null && !a.external);
  }

  /**
   * Effective character for a log row: the persisted match, with a read-time
   * name fallback — so characters added AFTER a report was fetched (a tracked
   * pug, a renamed raider) pick up their log history without a re-fetch.
   */
  function wclRowCharacterId(row: WclPlayerFight): string | null {
    if (row.characterId !== null) return row.characterId;
    return charactersBySlug.get(row.actorName.toLowerCase())?.id ?? null;
  }

  /*
   * The sim section works spec-first, so both of its reads start by asking each
   * pull which spec it was.
   *
   * That is not simply `row.spec`: Warcraft Logs leaves rows unlabelled, and
   * dropping those would hide real kills from the picker for no reason an
   * officer could see. The build recovers them, using only the naming the logs
   * themselves supplied on other pulls — see lib/sim/profile.ts.
   */

  const reportStartByCode = new Map(wclReports.map((r) => [r.code, r.startTime]));

  /**
   * Which tier each report was, read off the bosses actually pulled in it.
   *
   * **Not** off `report.zone`. That column looks like a zone and isn't: it
   * carries whatever the raid leader typed — "SSC+TK Wednesday", "ssc/tk",
   * "SSC/TK - gruul" — so matching it against zone names finds nothing at all,
   * silently, and every week reads as an unknown tier. The encounter names come
   * from the log itself and `raidOfBoss` already maps them, which makes this the
   * one source that cannot drift from what was raided.
   *
   * A night that touched two tiers takes the higher, the same rule awards and
   * sessions use via `phaseForZones`.
   */
  const zonesByReport = new Map<string, Set<string>>();
  for (const row of wclPlayerFights) {
    const raid = raidOfBoss(row.encounterName);
    if (!raid) continue;
    const zones = zonesByReport.get(row.reportCode) ?? new Set<string>();
    zones.add(raid.name);
    zonesByReport.set(row.reportCode, zones);
  }
  const phaseByReport = new Map<string, Phase>();
  for (const [code, zones] of zonesByReport) {
    const phase = phaseForZones([...zones]);
    if (phase !== undefined) phaseByReport.set(code, phase);
  }

  /** Kills only: a wipe has no comparable number, and the sim never wipes. */
  function simKills(): WclPlayerFight[] {
    return wclPlayerFights.filter((r) => r.kill && r.className);
  }

  function simSpecs(): SimSpecView[] {
    const fingerprints = specFingerprints(wclPlayerFights);
    const byKey = new Map<string, SimSpecView>();
    for (const row of simKills()) {
      const { spec } = specOfPull(row, fingerprints);
      if (!spec) continue;
      const key = `${row.className}|${spec}`;
      const view =
        byKey.get(key) ??
        ({ wowClass: row.className!, spec, hasProfile: false, kills: 0, raiders: [] } as SimSpecView);
      view.kills += 1;
      const raider = view.raiders.find((r) => r.actorName === row.actorName);
      if (raider) raider.kills += 1;
      else {
        const character = charactersById.get(wclRowCharacterId(row) ?? "");
        view.raiders.push({
          actorName: row.actorName,
          slug: character?.name.toLowerCase(),
          kills: 1,
        });
      }
      const at = reportStartByCode.get(row.reportCode);
      if (at && (!view.lastKillAt || at > view.lastKillAt)) view.lastKillAt = at;
      byKey.set(key, view);
    }
    for (const view of byKey.values()) {
      view.raiders.sort((a, b) => b.kills - a.kills || compareText(a.actorName, b.actorName));
    }
    return [...byKey.values()].sort(
      (a, b) => compareText(a.wowClass, b.wowClass) || compareText(a.spec, b.spec),
    );
  }

  function simPullsOf(
    wowClass: string,
    spec: string,
    fingerprints: ReturnType<typeof specFingerprints>,
  ): SimPullView[] {
    const out: SimPullView[] = [];
    for (const row of simKills()) {
      if (row.className !== wowClass) continue;
      const resolved = specOfPull(row, fingerprints);
      if (resolved.spec !== spec) continue;
      out.push({
        reportCode: row.reportCode,
        fightId: row.fightId,
        actorName: row.actorName,
        encounterName: row.encounterName,
        durationMs: row.durationMs,
        parsePercent: row.parsePercent,
        raidDate: reportStartByCode.get(row.reportCode) ?? "",
        className: row.className,
        spec: resolved.spec,
        specInferred: resolved.inferred,
        talents: row.talents,
        sappers: row.sappers,
      });
    }
    return out.sort((a, b) => compareText(b.raidDate, a.raidDate) || a.fightId - b.fightId);
  }

  /** Boss pulls per report (across all players) — the attendance denominator. */
  function pullsByReport(): Map<string, number> {
    const pulls = new Map<string, Set<number>>();
    for (const row of wclPlayerFights) {
      const set = pulls.get(row.reportCode) ?? new Set<number>();
      set.add(row.fightId);
      pulls.set(row.reportCode, set);
    }
    return new Map([...pulls].map(([code, set]) => [code, set.size]));
  }

  /**
   * Every distinct flask, elixir and scroll name the imported logs carry.
   *
   * Ingest stores these as canonical item NAMES, because a name is all
   * Warcraft Logs gives it — an aura, matched against the curated list. Any
   * icon, quality colour or Wowhead tooltip needs an item id instead, so this
   * is the list of names to go and find ids for.
   */
  function consumableNames(): string[] {
    const names = new Map<string, string>();
    const add = (name: string | undefined) => {
      if (name === undefined) return;
      const key = normalizeItemName(name);
      if (key.length > 0 && !names.has(key)) names.set(key, name);
    };
    for (const row of wclPlayerFights) {
      for (const name of [row.flask, ...row.elixirs, ...row.scrolls]) add(name);
    }
    // Pet food and pet scrolls too — they render in the preparedness table
    // beside the raider's own, and want the same icon and tooltip.
    for (const off of wclPlayerOffPull) {
      for (const applied of off.petConsumables) add(applied.name);
      // Sightings render in the same cell as the casts and want the same icon.
      for (const seen of off.petBuffsSeen) add(seen.name);
    }

    return [...names.values()].sort((a, b) => compareText(a, b));
  }

  function computeAttendance(characterId: string): AttendanceSummary | undefined {
    if (wclReports.length === 0) return undefined;
    const myRows = wclPlayerFights.filter((r) => wclRowCharacterId(r) === characterId);
    const attended = new Set(myRows.map((r) => r.reportCode));
    const exemptWeeks = exemptWeeksByCharacter.get(characterId) ?? new Set<string>();
    const pct = (part: number, total: number) => (total === 0 ? 0 : Math.round((part / total) * 100));

    // Fair denominator: only raids since their first logged appearance count.
    const chronological = [...wclReports].sort((a, b) => compareText(a.startTime, b.startTime));
    const firstIdx = chronological.findIndex((r) => attended.has(r.code));
    const since = firstIdx === -1 ? [] : chronological.slice(firstIdx);
    // Excused weeks drop out of the raid-level markup entirely (not counted as
    // missed); they still surface in the weekly dots so officers see the gap.
    const tracked = since.filter((r) => !exemptWeeks.has(resetWeekStart(r.startTime)));
    const recent = tracked.slice(-policy.attendance.recentRaids);
    const recentAttended = recent.filter((r) => attended.has(r.code)).length;
    const attendedTracked = tracked.filter((r) => attended.has(r.code)).length;

    // Per-reset check: bucket raids since first-seen into reset weeks (only
    // weeks where the guild logged at all exist — a guild break is nobody's
    // absence). Excused weeks are shown but excluded from the markup.
    const weekBuckets = new Map<
      string,
      { reports: number; attended: boolean; phases: Set<Phase> }
    >();
    for (const report of since) {
      const start = resetWeekStart(report.startTime);
      const bucket = weekBuckets.get(start) ?? { reports: 0, attended: false, phases: new Set() };
      bucket.reports++;
      if (attended.has(report.code)) bucket.attended = true;
      // The tier this week was raided in, from the bosses the logs recorded.
      const phase = phaseByReport.get(report.code);
      if (phase !== undefined) bucket.phases.add(phase);
      weekBuckets.set(start, bucket);
    }
    // The whole record, then the recent window as a slice of it. Both are kept:
    // the profile shows every week, while the loot table's dot strip has to
    // stay a fixed width no matter how long somebody has raided here.
    const allWeeks = [...weekBuckets]
      .sort((a, b) => compareText(a[0], b[0]))
      .map(([start, b]) => ({
        start,
        attended: b.attended,
        reports: b.reports,
        excused: exemptWeeks.has(start),
        phase: b.phases.size === 0 ? undefined : (Math.max(...b.phases) as Phase),
      }));
    const countedAllWeeks = allWeeks.filter((w) => !w.excused);
    const weeks = allWeeks.slice(-policy.attendance.weeks);
    const countedWeeks = weeks.filter((w) => !w.excused);

    const reportPulls = pullsByReport();
    const pullsTotal = [...attended].reduce((sum, code) => sum + (reportPulls.get(code) ?? 0), 0);
    return {
      raidsTotal: wclReports.length,
      raidsAttended: attendedTracked,
      raidsTracked: tracked.length,
      raidPct: pct(attendedTracked, tracked.length),
      firstSeenAt: firstIdx === -1 ? undefined : chronological[firstIdx].startTime,
      recentAttended,
      recentTotal: recent.length,
      recentPct: pct(recentAttended, recent.length),
      pullsAttended: myRows.length,
      pullsTotal,
      pullPct: pct(myRows.length, pullsTotal),
      weeks,
      weeksAttended: countedWeeks.filter((w) => w.attended).length,
      weeksTracked: countedWeeks.length,
      weeksExcused: weeks.length - countedWeeks.length,
      allWeeks,
      allWeeksAttended: countedAllWeeks.filter((w) => w.attended).length,
      allWeeksTracked: countedAllWeeks.length,
      // Resolved here, once, so no page has to pick a denominator for itself.
      // The scorers read `policy.attendance.basis` directly rather than this,
      // because the policy preview has to be able to score a policy the guild
      // has not adopted yet — same rule, applied to a different policy object.
      ...(() => {
        const week = policy.attendance.basis === "week";
        const attendedCount = week ? countedAllWeeks.filter((w) => w.attended).length : attendedTracked;
        const trackedCount = week ? countedAllWeeks.length : tracked.length;
        return {
          scoreBasis: policy.attendance.basis,
          scorePct: trackedCount === 0 ? undefined : pct(attendedCount, trackedCount),
          scoreAttended: attendedCount,
          scoreTracked: trackedCount,
        };
      })(),
    };
  }

  /**
   * A character's off-pull records. Matched by roster link where the import
   * made one, else by name — the same two-step the pulls use, so a raider
   * imported before they were on the roster still lines up.
   */
  function offPullOf(characterId: string): WclPlayerOffPull[] {
    const character = charactersById.get(characterId);
    if (!character) return [];
    const slug = character.name.toLowerCase();
    return wclPlayerOffPull.filter(
      (o) => o.characterId === characterId || (o.characterId === null && o.actorName.toLowerCase() === slug),
    );
  }

  /** Every logged pull for a character, oldest report first then by pull order. */
  // Night by night, cached per character. Every raider's series is built the
  // same way the standing board's trend column needs it, so the two can't
  // disagree about which way somebody is going.
  const developmentByCharacter = new Map<string, ReturnType<typeof buildDevelopmentSeries>>();
  function developmentOf(characterId: string) {
    const cached = developmentByCharacter.get(characterId);
    if (cached) return cached;
    const series = buildDevelopmentSeries(careerRowsOf(characterId), wclReports, policy);
    developmentByCharacter.set(characterId, series);
    return series;
  }

  /**
   * Is this pull one the officer took out of the count?
   *
   * The excluded set is per report and is edited on the raid page. It used to
   * reach `getRaidReport` and nothing else, which meant excusing the farm boss
   * cleaned up that night's numbers and left the same pulls scoring against
   * every raider on their own page, on the standing board and in the loot
   * score. One switch, one meaning: everything derived from a pull reads this.
   */
  function isExcusedPull(row: WclPlayerFight): boolean {
    return config.excludedFightsByCode?.[row.reportCode]?.includes(row.fightId) ?? false;
  }

  function careerRowsOf(characterId: string): WclPlayerFight[] {
    const chronologicalReports = [...wclReports].sort((a, b) => compareText(a.startTime, b.startTime));
    const mine = wclPlayerFights.filter(
      (r) => wclRowCharacterId(r) === characterId && !isExcusedPull(r),
    );
    return chronologicalReports.flatMap((report) =>
      mine.filter((r) => r.reportCode === report.code).sort((a, b) => a.fightId - b.fightId),
    );
  }

  /** The display name of a character's main, when it's a valid alt link. */
  function mainNameOf(character: Character): string | undefined {
    if (character.status !== "alt") return undefined;
    if (!character.mainCharacterId || character.mainCharacterId === character.id) return undefined;
    return charactersById.get(character.mainCharacterId)?.name;
  }

  /** Spec from the character's most recent logged pulls (newest report first). */
  function loggedSpecOf(characterId: string): string | undefined {
    const newestFirst = [...wclReports].sort((a, b) => compareText(b.startTime, a.startTime));
    for (const report of newestFirst) {
      for (const row of wclPlayerFights) {
        if (row.reportCode !== report.code || wclRowCharacterId(row) !== characterId) continue;
        if (row.spec) return row.spec;
      }
    }
    return undefined;
  }

  const repo: Repo = {
    async getGuild() {
      return guild;
    },

    async listCharacters() {
      return roster.map(summarize);
    },

    async getCharacterBundle(slug: string): Promise<CharacterBundle | null> {
      const character = charactersBySlug.get(slug.toLowerCase());
      if (!character) return null;
      const current = currentOf(character.id);
      const myAwards = awardsOf(character.id);
      const wishlists: PhaseWishlistView[] = wishlistsOf(character.id).map((set) => {
        const rows = computeWishlistRows(
          set,
          current,
          myAwards,
          (config.wishlistAlternatives ?? []).filter(
            (a) => a.characterId === character.id && a.phase === set.phase,
          ),
          redemptions,
        );
        return {
          phase: set.phase!,
          set,
          rows,
          completion: computeCompletion(rows),
          statDeltas: computeStatDeltas(current?.stats, set.stats),
        };
      });
      return {
        character,
        current,
        wishlists,
        awards: awardsWithContext.filter((a) => a.award.characterId === character.id),
        summary: summarize(character),
        comments: commentsOf(character.id),
        currentOverrides: overridesOf(character.id),
        importedCurrent: importedCurrentOf(character.id),
        offSpecOverrides: offOverridesOf(character.id),
        offSpecCurrent: offSpecGearSet(character.id, offOverridesOf(character.id)),
      };
    },

    async listRaidSessions() {
      return [...raidSessions].sort((a, b) => compareText(b.date, a.date));
    },

    async listLootAwards() {
      return awardsWithContext;
    },

    async getItem(id: number) {
      return itemsById.get(id);
    },

    async listItems() {
      return items;
    },

    async getItemContention(itemId: number) {
      const contention = contentionFor(itemId);
      if (!contention.item && contention.awards.length === 0 && contention.wishers.length === 0) {
        return null;
      }
      return contention;
    },

    /**
     * The guild seen as people rather than characters.
     *
     * `lastSeen` comes in through `config` because it lives on `accounts`,
     * which is deliberately outside the read model: a login must not rebuild
     * the store. The seed backend simply has none, and every member reads as
     * never having signed in — which, for a demo with no accounts, is true.
     */
    /**
     * The face this guild shows the world.
     *
     * The mapping below is the entire public surface — a field that is not
     * copied here cannot reach a stranger, whatever gets added to `Character`
     * or `RaidSession` later. `status` is copied deliberately *nowhere*: main,
     * alt, trial and pug are the guild's opinion of a person, and "who is on
     * trial" is not something Warcraft Logs publishes. See §6.
     */
    /**
     * What has happened to this guild, newest first.
     *
     * Every governance write lands here — the claim, invitations, role changes,
     * ownership, character links, and every use of an operator's break-glass.
     * Until this reader existed the table was **write-only**, which quietly made
     * the argument for break-glass untrue: "an override the guild cannot see is
     * a back door" is only a safeguard if the guild can, in fact, see it.
     */
    async listGuildAudit(): Promise<GuildAuditEntry[]> {
      return [...store.guildAudit].sort((a, b) => compareText(b.at, a.at));
    },

    async getPublicProfile(visibility?: GuildVisibility): Promise<PublicProfile> {
      return buildPublicProfile({
        guild: { name: guild.name, realm: guild.realm, faction: guild.faction, activePhase: guild.activePhase },
        roster: roster
          // Pugs are somebody else's raiders who came once. Publishing them as
          // "our roster" is wrong twice over: it overstates the guild to a
          // recruit, and it publishes another guild's members under this
          // guild's name. Filtered here, where `status` is still in scope —
          // the projection below never receives it, because "who is on trial"
          // is a judgement and not a thing Warcraft Logs prints.
          .filter((c) => c.status !== "pug")
          .map((c) => ({ name: c.name, wowClass: c.class, spec: c.spec, role: c.role })),
        raidNights: raidSessions.map((s) => ({ date: s.date, zones: s.zones })),
        // Overridable so the permissions preview can show all three presets
        // without touching the guild's setting. Read-only by construction:
        // there is no path from here to a write.
        visibility: visibility ?? guild.visibility,
      });
    },

    /**
     * Where this guild stands if its owners go quiet.
     *
     * Built on top of `getMembersView` rather than beside it: that view already
     * expands each member's effective capabilities, and the administrative tier
     * is defined by holding one. Computing them twice from different code is
     * how the banner and the claim button end up disagreeing about who is
     * eligible.
     */
    async getSuccessionState(now?: string): Promise<SuccessionState> {
      const view = await this.getMembersView(now);
      return successionState(
        view.members.map((m) => ({
          membershipId: m.membershipId,
          displayName: m.displayName,
          isOwner: m.isGuildMaster,
          // An owner's capability list is empty by construction (they hold
          // everything implicitly), and owners are excluded from every tier
          // anyway — succession is about a guild with nobody home, not about
          // one owner replacing another.
          capabilities: m.capabilities,
          lastSeenAt: m.lastSeenAt,
        })),
        new Date(now ?? Date.now()),
        clampWindows({
          administrativeDays: guild.successionAdminDays,
          memberDays: guild.successionMemberDays,
        }),
      );
    },

    async getMembersView(now?: string): Promise<MembersView> {
      return buildMembersView(
        {
          memberships: store.memberships,
          roles: store.guildRoles,
          roster,
          invites: store.guildInvites,
          lastSeen: config.membershipLastSeen,
        },
        now ?? new Date().toISOString(),
      );
    },

    async listFeedback(): Promise<FeedbackReport[]> {
      /*
       * Open first, then by how much it matters, then newest.
       *
       * Triage reads top-down, and closed reports are kept only so a fixed bug
       * can be told apart from one nobody looked at. Within the open ones,
       * "major" outranks "minor" — but an untriaged report sits between them
       * rather than at the bottom: it is the one thing on the page that still
       * needs a judgement, and burying it under everything already judged is
       * how a list like this stops being read.
       */
      const rank: Record<FeedbackReport["priority"], number> = { major: 0, unset: 1, minor: 2 };
      return [...feedback].sort((a, b) => {
        if (a.status !== b.status) return a.status === "open" ? -1 : 1;
        if (rank[a.priority] !== rank[b.priority]) return rank[a.priority] - rank[b.priority];
        return compareText(b.createdAt, a.createdAt);
      });
    },

    async listItemDemand(): Promise<ItemDemand[]> {
      // Names for wishlisted items missing from the cache (denormalized on slots).
      const wishlistNames = new Map<number, string>();
      const ids = new Set<number>(itemsById.keys());
      for (const set of gearSets) {
        if (set.kind !== "wishlist") continue;
        for (const slot of set.slots) {
          ids.add(slot.itemId);
          if (!wishlistNames.has(slot.itemId)) wishlistNames.set(slot.itemId, slot.itemName);
        }
      }
      for (const award of lootAwards) ids.add(award.itemId);

      return [...ids]
        .map((itemId): ItemDemand => {
          const item = itemsById.get(itemId);
          const c = contentionFor(itemId);
          return {
            itemId,
            name: itemDisplayName(itemId, item?.name, c.awards[0]?.award.itemName, wishlistNames.get(itemId)),
            quality: item?.quality,
            icon: item?.icon,
            slot: item?.slot,
            source: item?.source,
            phase: item?.phase,
            wisherCount: c.wishers.length,
            openCount: c.openCount,
            awardCount: c.awards.length,
            lastAwardedAt: c.awards[0]?.award.awardedAt,
          };
        })
        .sort(
          (a, b) =>
            b.openCount - a.openCount ||
            b.wisherCount - a.wisherCount ||
            b.awardCount - a.awardCount ||
            compareText(a.name, b.name),
        );
    },

    async listWclReports(): Promise<WclReportView[]> {
      return [...wclReports]
        .sort((a, b) => compareText(b.startTime, a.startTime))
        .map((report) => {
          const rows = wclPlayerFights.filter((r) => r.reportCode === report.code);
          return {
            report,
            session: report.raidSessionId ? sessionsById.get(report.raidSessionId) : undefined,
            playerCount: new Set(rows.map((r) => r.actorName.toLowerCase())).size,
            encounterCount: new Set(rows.map((r) => r.encounterId)).size,
            killCount: new Set(rows.filter((r) => r.kill).map((r) => r.fightId)).size,
          };
        });
    },

    async getRaidReport(code?: string): Promise<RaidReportView | null> {
      if (wclReports.length === 0) return null;
      const sorted = [...wclReports].sort((a, b) => compareText(b.startTime, a.startTime));
      const report = (code ? sorted.find((r) => r.code === code) : undefined) ?? sorted[0];
      const rows = wclPlayerFights.filter((r) => r.reportCode === report.code);
      if (rows.length === 0) return null;
      // Resolve logged names to roster slugs (read-time match included).
      const slugByActor = new Map<string, string>();
      for (const row of rows) {
        const id = wclRowCharacterId(row);
        const character = id ? charactersById.get(id) : undefined;
        if (character) slugByActor.set(row.actorName.toLowerCase(), character.name.toLowerCase());
      }
      return summarizeRaidReport({
        report,
        // Where anything put on a pet lives — one record per player per report.
        offPull: wclPlayerOffPull.filter((o) => o.reportCode === report.code),
        session: report.raidSessionId ? sessionsById.get(report.raidSessionId) : undefined,
        rows,
        reportPulls: pullsByReport().get(report.code) ?? new Set(rows.map((r) => r.fightId)).size,
        slugByActor,
        excludedFightIds: config.excludedFightsByCode?.[report.code],
        policy,
      });
    },

    async listUnmatchedConsumableNames(): Promise<string[]> {
      const known = new Set<string>();
      for (const item of items) {
        if (item.name) known.add(normalizeItemName(item.name));
      }
      for (const r of config.refusedItemNames ?? []) known.add(r.nameKey);
      return consumableNames().filter((name) => !known.has(normalizeItemName(name)));
    },

    async listRefusedItemNames(): Promise<RefusedNameView[]> {
      /*
       * Only the refusals that still matter.
       *
       * A refusal is a fact about a name, and names stop being used: a sheet row
       * is corrected, a curated consumable label is moved onto the item it
       * actually is. Listing a verdict on a name nothing references any more
       * would leave the officer a chore that finished itself.
       */
      const live = new Set<string>();
      for (const name of consumableNames()) live.add(normalizeItemName(name));
      for (const phase of PHASE_IDS) {
        for (const rule of rulesForPhase(phase)) live.add(normalizeItemName(rule.itemName));
      }
      /*
       * Settled by any route, not just by a matching cache name.
       *
       * A pin is the other one, and it does NOT put the name in the cache: an
       * officer pinning "Warglaive of Azzinoth (Main Hand)" — an annotation
       * that is nobody's item name — attaches it to an id whose real name is
       * something else. Checking only the cache leaves the finished job on the
       * list forever, which is the failure this whole record exists to avoid.
       */
      const settled = new Set<string>(Object.keys(config.sheetItemIds ?? {}));
      for (const item of items) {
        if (item.name) settled.add(normalizeItemName(item.name));
      }
      return (config.refusedItemNames ?? [])
        .filter((r) => live.has(r.nameKey) && !settled.has(r.nameKey))
        .sort((a, b) => compareText(a.name, b.name));
    },

    async listConsumableItems(): Promise<Item[]> {
      const wanted = new Set(consumableNames().map(normalizeItemName));
      return items.filter(
        (item) => item.name !== undefined && wanted.has(normalizeItemName(item.name)),
      );
    },

    async listUnmatchedSheetNames(): Promise<string[]> {
      const known = new Set<string>(Object.keys(config.sheetItemIds ?? {}));
      for (const item of items) {
        if (item.name) known.add(normalizeItemName(item.name));
      }
      // Already asked and declined: a person's job now, not another press.
      for (const r of config.refusedItemNames ?? []) known.add(r.nameKey);
      const missing = new Map<string, string>();
      // Every phase, not just the active one: a sheet the guild wrote for next
      // tier is exactly the one nobody has wishlisted out of yet, so it is the
      // one with the most unmatched rows.
      for (const phase of PHASE_IDS) {
        for (const rule of rulesForPhase(phase)) {
          const key = normalizeItemName(rule.itemName);
          if (!known.has(key) && !missing.has(key)) missing.set(key, rule.itemName);
        }
      }
      return [...missing.values()].sort((a, b) => compareText(a, b));
    },

    /**
     * Drops the council's sheet can place and the cache cannot.
     *
     * The sheet is written boss by boss, so its headings already say where 64
     * of this guild's own Phase 3 items come from — three whole Black Temple
     * bosses' worth. The cache learned those ids from wishlists, which carry a
     * name and nothing else, so they have no zone; and `items.source.zone` is
     * the only thing that puts a drop on a raid's loot plan. They were invisible
     * there while sitting in plain sight on the priority page.
     *
     * Only rows with **no source at all** are offered. A row that already has
     * one is either Wowhead's answer or an officer's, and both outrank a section
     * heading — the gap-filling writer would refuse it anyway, so proposing it
     * would only inflate the count the officer is shown.
     */
    async listSheetDropSources(): Promise<{ id: number; source: { zone: string; boss: string } }[]> {
      const out: { id: number; source: { zone: string; boss: string } }[] = [];
      const seen = new Set<number>();
      // Driven from the sheet's rows, not from the cache's names, so an
      // officer's pin is honoured: the sheet's "Hammer of Judgment" and the
      // cache's "Hammer of Judgement" are the same drop only because somebody
      // said so, and matching on the name alone silently missed it.
      //
      // Every phase, like the name lookup beside it: a sheet written for a tier
      // nobody has raided yet is exactly the one the cache knows least about.
      for (const phase of PHASE_IDS) {
        for (const rule of rulesForPhase(phase)) {
          const id = sheetItemIdFor(rule.itemName);
          if (id === undefined || seen.has(id)) continue;
          // Only rows with no source at all. One that has one was answered by
          // Wowhead or by an officer, and both outrank a section heading.
          if (itemsById.get(id)?.source?.zone) continue;
          const source = sheetSectionSource(rule.source);
          if (!source) continue;
          seen.add(id);
          out.push({ id, source });
        }
      }
      return out;
    },

    async listEncounterNames(): Promise<string[]> {
      return [...new Set(wclPlayerFights.map((r) => r.encounterName))].sort((a, b) =>
        compareText(a, b),
      );
    },

    async getReportExcludedFights(code: string): Promise<number[]> {
      return config.excludedFightsByCode?.[code] ?? [];
    },

    async getLootPriorityWeights(): Promise<LootPriorityWeights> {
      return policy.weights;
    },

    async getGuildPolicy() {
      return policy;
    },

    async getDevelopment(characterId: string) {
      return developmentOf(characterId);
    },

    async getLootPlan(zone: string) {
      const target = zone.toLowerCase();

      // The drop table first — foundational rows with this guild's overlay
      // applied. Where it names a boss for a drop, it wins: that is what makes
      // it the drop table rather than a second opinion. `items.source.boss`
      // stays the fallback for anything nobody has told it about.
      const table = await this.getDropTable(zone);
      const bossByItemId = new Map<number, string>();
      const bossByItemKey = new Map<string, string>();
      // What the table calls a drop, for the rows where that says more than the
      // item's own name does — see `LootPlanEntry.displayName`.
      const nameByItemId = new Map<number, string>();
      for (const drop of table) {
        if (drop.itemId !== undefined) {
          bossByItemId.set(drop.itemId, drop.boss);
          if (drop.resolvedName) nameByItemId.set(drop.itemId, drop.itemName);
        }
        if (!bossByItemKey.has(drop.itemKey)) bossByItemKey.set(drop.itemKey, drop.boss);
      }

      // A hide is the one overlay action that has to REMOVE something, and
      // `getDropTable` has already applied it to the table's own rows. It still
      // has to be applied to drops that reach the plan from the ITEM CACHE
      // instead, or a hidden drop reappears by the other door.
      //
      // Keyed on the pair, through the table's own `dropKey`: keying on the
      // item alone also hid the copy a guild had just re-added under a
      // different boss, which is exactly how a move between bosses is written.
      const hidden = new Set(
        guildBossDrops
          .filter(
            (d) => d.guildId === guild.id && d.zone.toLowerCase() === target && d.action === "hide",
          )
          .map((d) => dropKey(d.bossKey, d.itemKey)),
      );

      // Which pairs this guild added themselves, so the plan can say so on a
      // row that would otherwise look like everybody else's.
      const guildAdded = new Set(
        guildBossDrops
          .filter(
            (d) => d.guildId === guild.id && d.zone.toLowerCase() === target && d.action === "add",
          )
          .map((d) => dropKey(d.bossKey, d.itemKey)),
      );

      // What they have taken off a boss. Not on the plan by definition, and
      // carried anyway: a hidden drop has no row to un-hide from.
      const hiddenDrops = guildBossDrops
        .filter(
          (d) => d.guildId === guild.id && d.zone.toLowerCase() === target && d.action === "hide",
        )
        .map((d) => ({ itemName: d.itemName, itemId: d.itemId, boss: d.boss }));

      const entries: LootPlanEntry[] = [];
      const covered = new Set<string>();
      const claim = (name: string | undefined): string | undefined => {
        if (!name) return undefined;
        const key = normalizeItemName(name);
        if (covered.has(key)) return undefined;
        covered.add(key);
        return key;
      };

      // 1. Cached items the zone drops. Still first: they carry the contention,
      //    the icon and the id, and nothing here is allowed to lose them.
      for (const item of items) {
        if ((item.source?.zone ?? "").toLowerCase() !== target) continue;
        const key = item.name ? normalizeItemName(item.name) : undefined;
        const boss = bossByItemId.get(item.id) ?? (key ? bossByItemKey.get(key) : undefined);
        // The pair the guild would have hidden is this item under whichever
        // boss the plan is about to file it under — the table's answer if it has
        // one, the cache's otherwise.
        const under = boss ?? item.source?.boss;
        if (key && under && hidden.has(dropKey(bossKey(under), key))) continue;
        if (key) covered.add(key);
        entries.push({
          item,
          contention: contentionFor(item.id),
          boss,
          guildAdded: guildAdded.has(dropKey(bossKey(under ?? ""), key ?? "")),
          displayName: nameByItemId.get(item.id),
        });
      }

      // 2. Drops the table knows an id for that the cache has not attributed to
      //    this zone. This is the table earning its keep: an operator says
      //    Supremus drops it and it appears, without anyone curating the item.
      for (const drop of table) {
        // No hide check: `getDropTable` already applied the overlay to these.
        if (drop.itemId === undefined) continue;
        const item = itemsById.get(drop.itemId);
        if (!item || !claim(item.name ?? drop.itemName)) continue;
        entries.push({
          item,
          contention: contentionFor(item.id),
          boss: drop.boss,
          guildAdded: drop.origin === "guild",
          displayName: nameByItemId.get(item.id),
        });
      }

      // 3. Drops the table names but nothing has an id for. Rendered by name,
      //    with no icon and nothing to click — see `sheetOnly`.
      const sheetDrops: LootPlanSheetDrop[] = [];
      for (const drop of table) {
        if (drop.itemId !== undefined) continue;
        if (!claim(drop.itemName)) continue;
        sheetDrops.push({
          itemName: drop.itemName,
          boss: drop.boss,
          chain: priorityRuleFor(drop.itemName)?.chain,
          slotLabel: drop.slotLabel,
          guildAdded: drop.origin === "guild",
        });
      }

      // 4. Finally the council's own sheet, for anything still unaccounted for.
      //    This is what carries a zone whose drop table nobody has seeded yet —
      //    without it, switching the plan to the table would have emptied every
      //    page until an operator pressed a button.
      for (const phase of PHASE_IDS) {
        for (const rule of rulesForPhase(phase)) {
          const key = normalizeItemName(rule.itemName);
          if (covered.has(key)) continue;
          // `sheetItemIdFor`, not a name match: a pinned row HAS an item, and
          // listing it here too put it on the plan twice — once as the real
          // drop and once as bare text that could not be clicked.
          if (sheetItemIdFor(rule.itemName) !== undefined) continue;
          const source = sheetSectionSource(rule.source);
          if (!source || source.zone.toLowerCase() !== target) continue;
          if (hidden.has(dropKey(bossKey(source.boss), key))) continue;
          covered.add(key);
          sheetDrops.push({
            itemName: rule.itemName,
            boss: source.boss,
            // Through the same lookup every other view uses, so an officer's
            // edited chain shows here too — a plan quoting the seeded sheet
            // while the item page quoted the edit would be worse than no chain.
            chain: priorityRuleFor(rule.itemName)?.chain,
            slotLabel: rule.slotLabel,
          });
        }
      }

      return buildLootPlan(zone, entries, sheetDrops, hiddenDrops);
    },

    async getRosterStanding() {
      // Pugs are in neither board: they are not the guild, and including them
      // moves everybody's percentile.
      return buildRosterStanding(
        roster
          .filter((c) => c.status !== "pug")
          .map((c) => ({
            characterId: c.id,
            name: c.name,
            status: c.status,
            metrics: raiderMetricsOf(c.id),
            parseTrend: parseTrend(developmentOf(c.id)),
          })),
        policy,
      );
    },

    /**
     * The drop table this guild reads for one zone: the foundational one with
     * their own additions and removals laid over it.
     *
     * The overlay is filtered to THIS guild here rather than in the merge, so
     * the pure layer never has to know which guild is asking — and so a bug in
     * the filter is a bug in one place rather than in every caller.
     */
    async getDropTable(zone: string): Promise<MergedDrop[]> {
      const target = zone.toLowerCase();
      const merged = mergeDropTable(
        bossDrops.filter((d) => d.zone.toLowerCase() === target),
        guildBossDrops.filter((d) => d.guildId === guild.id && d.zone.toLowerCase() === target),
      );
      // The drop table records how a drop was WRITTEN; the item cache is what
      // it is CALLED. Reading the name back off the item is what stops the two
      // being a second copy that can rot — a Wowhead correction reaches the
      // plan, the boss page and the sheet at once, without anybody retyping.
      return resolveDropNames(merged, (id) => {
        const item = itemsById.get(id);
        return item && { name: item.name, quality: item.quality, icon: item.icon };
      });
    },

    /**
     * Everything this deployment already knows about which boss drops what,
     * gathered as drafts for the foundational table.
     *
     * Two sources, in this order:
     *
     *   1. **Every priority sheet's boss sections.** This is where Mount Hyjal
     *      and Black Temple come from — a complete drop table the guild wrote
     *      without anyone reading it as one.
     *   2. **The item cache's own attributions**, for the tiers no sheet covers:
     *      Karazhan, SSC and Tempest Keep, learned from Wowhead one item at a
     *      time. Second, so a sheet's wording wins where both know a drop.
     *
     * It lives here because parsing sheets is the read model's job — doing it
     * in a backend would be a second parser to keep in step with this one.
     */
    async listKnownDropSources(): Promise<{
      drafts: BossDropDraft[];
      fromSheets: number;
      fromCache: number;
    }> {
      const drafts: BossDropDraft[] = [];
      const seen = new Set<string>();
      /**
       * Claim a drop, deduping on the ITEM where one is known and on the name
       * only where it is not.
       *
       * Keying on the name alone let the same item in twice under one boss: the
       * sheet pass writes "Hammer of Judgment" and the cache pass writes
       * "Hammer of Judgement", which normalize differently and are the same
       * drop. Three of this guild's rows were duplicated exactly that way.
       *
       * Both keys are claimed on every successful push, so whichever pass runs
       * second is blocked by either half.
       */
      const push = (zone: string, boss: string, itemName: string, extra: Partial<BossDropDraft>) => {
        const at = `${zone.toLowerCase()}|${bossKey(boss)}`;
        const nameKey = `${at}|${normalizeItemName(itemName)}`;
        const idKey = extra.itemId === undefined ? undefined : `${at}|#${extra.itemId}`;
        if (seen.has(nameKey) || (idKey !== undefined && seen.has(idKey))) return false;
        seen.add(nameKey);
        if (idKey !== undefined) seen.add(idKey);
        drafts.push({ zone, boss, itemName, ...extra });
        return true;
      };

      let fromSheets = 0;
      for (const phase of PHASE_IDS) {
        for (const rule of rulesForPhase(phase)) {
          const source = sheetSectionSource(rule.source);
          if (!source) continue;
          // The pin matters here for the same reason it did on the loot plan:
          // the sheet's "Hammer of Judgment" and the cache's "Hammer of
          // Judgement" are one drop only because an officer said so.
          const id = sheetItemIdFor(rule.itemName);
          if (push(source.zone, source.boss, rule.itemName, { slotLabel: rule.slotLabel, itemId: id })) {
            fromSheets += 1;
          }
        }
      }

      let fromCache = 0;
      for (const item of items) {
        const zone = item.source?.zone;
        const boss = item.source?.boss;
        if (!zone || !boss || !item.name) continue;
        if (push(zone, boss, item.name, { itemId: item.id })) fromCache += 1;
      }

      return { drafts, fromSheets, fromCache };
    },

    /**
     * Foundational rows that list one item twice under one boss.
     *
     * They cannot heal themselves: the table's key is (zone, boss, item NAME),
     * so two spellings of one item are two legitimate-looking rows and an
     * upsert will never collapse them. Returns the rows to delete, never the
     * one to keep.
     *
     * Which one survives, in order: **the spelling a priority sheet uses**,
     * because the sheet references the table and its wording may be carrying a
     * distinction the item name cannot ("(Main Hand)" on a Warglaive); then the
     * spelling matching the resolved item; then the first, so the answer is
     * deterministic rather than whatever the database happened to return.
     */
    async listDuplicateDrops(): Promise<{ zone: string; boss: string; itemName: string }[]> {
      const sheetNames = new Set<string>();
      for (const phase of PHASE_IDS) {
        for (const rule of rulesForPhase(phase)) sheetNames.add(normalizeItemName(rule.itemName));
      }
      const groups = new Map<string, BossDrop[]>();
      for (const drop of bossDrops) {
        if (drop.itemId === undefined) continue;
        const key = `${drop.zone.toLowerCase()}|${drop.bossKey}|${drop.itemId}`;
        groups.set(key, [...(groups.get(key) ?? []), drop]);
      }
      const doomed: { zone: string; boss: string; itemName: string }[] = [];
      for (const rows of groups.values()) {
        if (rows.length < 2) continue;
        const score = (d: BossDrop): number => {
          if (sheetNames.has(d.itemKey)) return 0;
          const real = itemsById.get(d.itemId!)?.name;
          if (real && normalizeItemName(real) === d.itemKey) return 1;
          return 2;
        };
        const ordered = [...rows].sort(
          (a, b) => score(a) - score(b) || compareText(a.itemKey, b.itemKey),
        );
        for (const drop of ordered.slice(1)) {
          doomed.push({ zone: drop.zone, boss: drop.boss, itemName: drop.itemName });
        }
      }
      return doomed;
    },

    /**
     * The foundational table alone, for whoever is editing it.
     *
     * Deliberately separate from `getDropTable`: an operator correcting a name
     * must see what they own, not what one guild's overlay has made of it.
     */
    async listFoundationalDrops(zone?: string): Promise<BossDrop[]> {
      const target = zone?.toLowerCase();
      return bossDrops.filter((d) => target === undefined || d.zone.toLowerCase() === target);
    },

    /**
     * The same rows, with each drop's item resolved — icon, quality, and the
     * name the cache actually has for it.
     *
     * No guild overlay: this is the shared table as its owner sees it. The
     * resolution is what makes the page useful for correcting: `writtenName`
     * says what somebody typed and `itemName` what the item is really called,
     * which is the difference an operator came here to close.
     */
    async getFoundationalDropTable(zone: string): Promise<MergedDrop[]> {
      const target = zone.toLowerCase();
      const merged = mergeDropTable(
        bossDrops.filter((d) => d.zone.toLowerCase() === target),
        [],
      );
      return resolveDropNames(merged, (id) => {
        const item = itemsById.get(id);
        return item && { name: item.name, quality: item.quality, icon: item.icon };
      });
    },

    async listGuildDropOverrides(zone?: string): Promise<GuildBossDrop[]> {
      const target = zone?.toLowerCase();
      return guildBossDrops.filter(
        (d) => d.guildId === guild.id && (target === undefined || d.zone.toLowerCase() === target),
      );
    },

    /**
     * The council's notes for one zone, by boss key.
     *
     * A map rather than a per-boss call: the loot plan renders every boss at
     * once, and asking per boss would be one query per card for data already
     * held in memory.
     */
    async listBossComments(zone: string): Promise<Map<string, BossComment[]>> {
      const target = zone.toLowerCase();
      const out = new Map<string, BossComment[]>();
      for (const [, list] of bossCommentsByBoss) {
        for (const c of list) {
          if (c.zone.toLowerCase() !== target) continue;
          out.set(c.bossKey, [...(out.get(c.bossKey) ?? []), c]);
        }
      }
      return out;
    },

    async listItemComments(itemId: number) {
      return itemCommentsByItem.get(itemId) ?? [];
    },
    async countItemComments() {
      return new Map([...itemCommentsByItem].map(([id, list]) => [id, list.length]));
    },
    async listGearSets() {
      return gearSets;
    },

    async listGuides() {
      return config.guides ?? [];
    },

    async listWishlistAlternatives() {
      return config.wishlistAlternatives ?? [];
    },

    /**
     * Previewing a policy needs TWO read models, so it can't live here — a
     * model only knows its own policy. The SQLite backend builds the second
     * one and diffs; the seed backend is read-only and has no policy to change.
     */
    async previewGuildPolicy() {
      return buildPolicyPreview(await this.measureRoster());
    },

    /**
     * The figures a policy change can move, per roster raider, under whatever
     * policy THIS read model was built with. The preview compares two of these.
     */
    async measureRoster() {
      return roster
        // Trials are measured like anyone else — deciding whether to keep one
        // is exactly what this board is for.
        .filter((c) => c.status === "main" || c.status === "trial" || c.status === "alt")
        .map((character) => {
          const rows = careerRowsOf(character.id);
          const career = summarizePerformance(rows, policy);
          const attendance = computeAttendance(character.id);
          return {
            name: character.name,
            slug: character.name.toLowerCase(),
            className: character.class,
            preparedBefore: career?.preparedPct,
            preparedAfter: career?.preparedPct,
            attendanceBefore: attendance?.recentPct,
            attendanceAfter: attendance?.recentPct,
          };
        });
    },

    async getPrioritySheet(phase?: number) {
      const forPhase = phase ?? guild.activePhase;
      const stored = config.prioritySheetsByPhase?.[forPhase];
      const view = buildPrioritySheetView({
        rules: rulesForPhase(forPhase),
        // This phase's chains only. A chain an officer wrote against another
        // tier's sheet still applies to its drop (priorityRuleFor walks every
        // phase), but listing it here put both Warglaives on the phase 2 page.
        overrides: config.itemPriorityRules?.[forPhase] ?? {},
        // Shared with the loot plan and the drop-source pass — see
        // `sheetItemIdFor`. The builder stays pure and only ever sees names.
        itemIdFor: sheetItemIdFor,
      });
      // Icon and quality for the rows whose name the cache matched, so the
      // sheet renders items the way every other list does. Done here, not in
      // the builder: the builder is pure and only ever sees names.
      const withItem = <T extends { itemId?: number }>(row: T): T => {
        const item = row.itemId === undefined ? undefined : itemsById.get(row.itemId);
        return item ? { ...row, quality: item.quality, icon: item.icon, itemPhase: item.phase } : row;
      };
      return {
        ...view,
        sections: view.sections.map((s) => ({ ...s, rows: s.rows.map(withItem) })),
        unlisted: view.unlisted.map(withItem),
        phase: forPhase,
        origin: stored
          ? ("pasted" as const)
          : forPhase === LOOT_PRIORITY_SHEET_PHASE
            ? ("seed" as const)
            : ("none" as const),
        updatedAt: stored?.updatedAt,
        author: stored?.author,
        sheetNote: stored?.note,
        markdown: sheetMarkdownFor(forPhase, config.prioritySheetsByPhase),
      };
    },

    async getItemPriorityRule(itemId: number, ...names: (string | undefined)[]) {
      const item = itemsById.get(itemId);
      return priorityRuleFor(
        ...names,
        item?.name,
        lootAwards.find((a) => a.itemId === itemId)?.itemName,
        gearSets.flatMap((s) => s.slots).find((s) => s.itemId === itemId)?.itemName,
      );
    },

    async getEnchantReference(): Promise<EnchantReference> {
      return buildEnchantReference(
        gearSets,
        (characterId) => {
          const owner = charactersById.get(characterId);
          return owner ? { class: owner.class, role: owner.role } : undefined;
        },
        config.enchantNames,
      );
    },

    async listUnnamedEnchantIds(): Promise<number[]> {
      // Every enchant id ever logged that no imported set and no earlier
      // lookup names, commonest first — a backfill run is capped, so the
      // ordering decides which raiders stop seeing a bare id soonest.
      const named = new Set<number>();
      for (const set of gearSets) {
        for (const slot of set.slots) if (slot.enchant?.id) named.add(slot.enchant.id);
      }
      for (const id of Object.keys(config.enchantNames ?? {})) named.add(Number(id));
      const counts = new Map<number, number>();
      const want = (id: number | undefined) => id !== undefined && id > 0 && !named.has(id);
      for (const row of wclPlayerFights) {
        for (const item of row.gear) {
          if (want(item.enchant)) {
            counts.set(item.enchant!, (counts.get(item.enchant!) ?? 0) + 1);
          }
          /*
           * Temporary enchants too — the oils, stones and poisons the raid
           * page's weapon-buff column reports.
           *
           * They were never queued, so that column could only ever say "a
           * temporary enchant was present". The same dictionary names them:
           * every one of this guild's sixteen resolved on the first run, most
           * to an item name outright ("Superior Wizard Oil"), the sharpening
           * stones to their effect text.
           */
          if (want(item.temp)) {
            counts.set(item.temp!, (counts.get(item.temp!) ?? 0) + 1);
          }
        }
      }
      return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([id]) => id);
    },

    async listTokenBackfill(): Promise<TokenBackfillQueue> {
      // An armor token is the one drop that isn't the thing anyone wants, and
      // the cache can't tell one apart from a name. Wowhead can — it files
      // them under a subclass of their own — so this is two queues, in the
      // order the two Wowhead calls have to happen:
      //
      //   unchecked          ids that might be tokens; one cheap XML each.
      //   tokensWithoutPieces  known tokens; one page each, for the vendor list.
      //
      // Candidates are every row Wowhead has confirmed that no gear set names.
      // That test is structural rather than a guess about names: a token can't
      // be equipped, so nothing that exports a gear set can ever name one, and
      // an id somebody wishlisted is provably not a token. A row nothing has
      // verified belongs to the item resolver's queue first.
      //
      // Deliberately NOT "has no slot", though a token has none. The shipped
      // seed invented slots for a dozen of them, and a queue that trusted the
      // slot skipped exactly the rows that were wrong.
      const buysSomething = new Set<number>();
      for (const item of items) {
        if (item.redeemsFrom !== undefined) buysSomething.add(item.redeemsFrom);
      }
      // Order decides what a capped press spends itself on, so: loot the guild
      // actually won first (a token in the ledger has awards waiting on it),
      // then the rows with no slot (what a token looks like when the seed
      // didn't touch it), then everything else. The tail is mostly gems and
      // consumables — each costs one lookup, once, and is then answered
      // forever, so leaving it undrained costs nothing.
      const awarded = new Set(lootAwards.map((a) => a.itemId));
      const rank = (id: number): number =>
        awarded.has(id) ? 0 : itemsById.get(id)?.slot == null ? 1 : 2;
      const byLikelihoodThenId = (a: number, b: number): number => rank(a) - rank(b) || a - b;

      const equippable = new Set<number>();
      for (const set of gearSets) for (const slot of set.slots) equippable.add(slot.itemId);

      const unchecked: number[] = [];
      const tokensWithoutPieces: number[] = [];
      for (const item of items) {
        if (item.armorToken === true) {
          if (!buysSomething.has(item.id)) tokensWithoutPieces.push(item.id);
        } else if (item.armorToken === undefined && item.verified && !equippable.has(item.id)) {
          unchecked.push(item.id);
        }
      }
      return {
        unchecked: unchecked.sort(byLikelihoodThenId),
        tokensWithoutPieces: tokensWithoutPieces.sort(byLikelihoodThenId),
      };
    },

    async listUnresolvedItemIds(): Promise<number[]> {
      // Ordered by how much a person is looking at them: loot history and
      // wishlists first (they carry the ledger), then anything else the cache
      // half-knows — mostly gear ids harvested from logs, which have an icon
      // but no name. Callers resolve a capped slice per run, so the ordering
      // decides what gets fixed first, not what gets fixed at all.
      const LEDGER_WEIGHT = 100;
      const references = new Map<number, number>();
      const bump = (id: number, weight: number) =>
        references.set(id, (references.get(id) ?? 0) + weight);
      for (const award of lootAwards) bump(award.itemId, LEDGER_WEIGHT);
      for (const set of gearSets) for (const slot of set.slots) bump(slot.itemId, LEDGER_WEIGHT);
      // A pinned slot is read off a log, so it often arrives with an icon but
      // no name — exactly what the resolver exists for.
      for (const override of currentGearOverrides) bump(override.item.itemId, LEDGER_WEIGHT);
      // Gems show on the gear panel by icon; only their name needs looking up.
      for (const row of wclPlayerFights) {
        for (const item of row.gear) for (const gem of item.gems) bump(gem.id, 1);
      }
      // Every cached row is a candidate, because "has an icon" and "has the
      // right icon" are different claims — see `needsResolving` below.
      for (const item of items) bump(item.id, 1);

      // A row with a hole in it reads as broken; a row Wowhead has never
      // confirmed only *might* be wrong. Both need the same lookup, so the
      // tier decides which the officer's next press spends itself on.
      const INCOMPLETE = 1;
      const UNVERIFIED = 0;
      /*
       * Verified, complete, and confirmed before the phase was read off
       * Wowhead's answer.
       *
       * The XML carried the phase all along and it was thrown away, so every
       * row resolved before that has a hole nothing else would ever ask about
       * again. Keyed on `phaseChecked` rather than on the phase being missing:
       * plenty of items have no phase tag, and queueing on the hole itself
       * would re-ask about them every press for ever.
       *
       * Lowest tier on purpose — it is a nicety, and must never spend a capped
       * run that a row with no name at all is waiting on.
       */
      const STALE_PHASE = -1;
      const tierOf = (id: number): number | undefined => {
        const item = itemsById.get(id);
        if (item === undefined || item.name === undefined || item.icon === undefined) {
          return INCOMPLETE;
        }
        if (!item.verified) return UNVERIFIED;
        return item.phaseChecked ? undefined : STALE_PHASE;
      };

      return [...references]
        .map(([id, weight]) => ({ id, weight, tier: tierOf(id) }))
        .filter((c): c is { id: number; weight: number; tier: number } => c.tier !== undefined)
        .sort((a, b) => b.tier - a.tier || b.weight - a.weight || a.id - b.id)
        .map((c) => c.id);
    },

    // Per-report prices are persisted config, not entity-store data — the
    // in-memory/seed model has none, so gold falls back to code defaults. The
    // SQLite backend overrides this to read the raid's logged prices.
    async getReportConsumablePrices(): Promise<Record<string, ConsumablePrice>> {
      return {};
    },

    // Same: a board is something an officer wrote down, not something the
    // pull rows imply, so the read-only demo has none and offers an empty board.
    async getRaidBoard(): Promise<Board> {
      return emptyBoard();
    },

    async getTemplateBoard(): Promise<Board> {
      return emptyBoard();
    },

    // Guild boards are officer-authored too, and there is no seed file for
    // them: the demo has no rosters until somebody makes one, and it can't.
    async listGuildRosters(): Promise<GuildRoster[]> {
      return [];
    },

    async getGuildRoster(): Promise<GuildRoster | undefined> {
      return undefined;
    },

    /*
     * The sim section's two reads. Both are one pass over the pull rows, which
     * are already fully in memory — a spec index that queried per raider would
     * be dozens of round trips for a page that is mostly counting.
     *
     * Saved setups live in the meta table, not here, so the seed backend reports
     * every spec as having none. The SQLite backend layers the profiles on.
     */
    async listSimSpecs(): Promise<SimSpecView[]> {
      return simSpecs();
    },

    async getSimSpec(wowClass: string, spec: string): Promise<SimSpecDetail | null> {
      const fingerprints = specFingerprints(wclPlayerFights);
      const known = simSpecs().some((s) => s.wowClass === wowClass && s.spec === spec);
      if (!known) return null;
      return {
        wowClass,
        spec,
        pulls: simPullsOf(wowClass, spec, fingerprints),
        fingerprints: fingerprintRows(fingerprints).filter((f) => f.wowClass === wowClass),
        stranded: [],
      };
    },

    async getReportConsumableAdjustments(code: string): Promise<ConsumableAdjustment[]> {
      return config.consumableAdjustmentsByCode?.[code] ?? [];
    },

    async listConsumableAdjustments(): Promise<Record<string, ConsumableAdjustment[]>> {
      return config.consumableAdjustmentsByCode ?? {};
    },

    // Resolved abilities are persisted config like prices; the seed model has none.
    async listAbilities() {
      return [];
    },

    async listPullRows(reportCode: string, fightId: number): Promise<WclPlayerFight[]> {
      return wclPlayerFights.filter((r) => r.reportCode === reportCode && r.fightId === fightId);
    },

    async getCharacterPerformance(slug: string): Promise<CharacterPerformance | null> {
      const character = charactersBySlug.get(slug.toLowerCase());
      if (!character) return null;
      const myRows = wclPlayerFights.filter((r) => wclRowCharacterId(r) === character.id);
      const reportPulls = pullsByReport();
      const myOffPull = offPullOf(character.id);
      const reports: PerformanceReportView[] = [...wclReports]
        .sort((a, b) => compareText(b.startTime, a.startTime))
        .map((report): PerformanceReportView | undefined => {
          const rows = myRows
            .filter((r) => r.reportCode === report.code)
            .sort((a, b) => a.fightId - b.fightId);
          // Excused pulls stay in `rows` — the table shows them, greyed — but
          // never reach the summary, which is the figure the raider argues with.
          const counted = rows.filter((r) => !isExcusedPull(r));
          const summary = summarizePerformance(counted, policy);
          return summary
            ? {
                report,
                session: report.raidSessionId ? sessionsById.get(report.raidSessionId) : undefined,
                rows,
                excusedFightIds: rows.filter(isExcusedPull).map((r) => r.fightId),
                summary,
                offPull: myOffPull.find((o) => o.reportCode === report.code),
                reportPulls: reportPulls.get(report.code) ?? rows.length,
              }
            : undefined;
        })
        .filter((v): v is PerformanceReportView => v !== undefined);
      // Career rollup in chronological order (oldest report first) so
      // "latest pull" facts like the enchant audit come from the newest data.
      const chronological = [...reports]
        .reverse()
        .flatMap((r) => r.rows.filter((row) => !isExcusedPull(row)));
      return {
        character,
        reports,
        career: summarizePerformance(chronological, policy),
        offPull: myOffPull,
        attendance: computeAttendance(character.id),
      };
    },

    async getComparison(
      slugs: string[],
      reportFilter?: Record<string, string[]>,
    ): Promise<CharacterComparisonView> {
      // Resolve to known characters, dedupe, preserve the requested order, cap at 4.
      const seen = new Set<string>();
      const chosen: Character[] = [];
      for (const slug of slugs) {
        const character = charactersBySlug.get(slug.toLowerCase());
        if (character && !seen.has(character.id)) {
          seen.add(character.id);
          chosen.push(character);
        }
        if (chosen.length >= 4) break;
      }
      const inputs: ComparisonInput[] = chosen.map((character) => {
        const careerRows = careerRowsOf(character.id);
        // Reports the character appears in, newest first — the log-picker options.
        const codesForChar = new Set(careerRows.map((r) => r.reportCode));
        const availableReports = [...wclReports]
          .filter((r) => codesForChar.has(r.code))
          .sort((a, b) => compareText(b.startTime, a.startTime))
          .map((r) => ({ code: r.code, title: r.title, zone: r.zone, startTime: r.startTime }));
        // Apply the per-character log filter; an empty/unknown selection falls
        // back to all logs so a column is never accidentally blank.
        const allCodes = availableReports.map((r) => r.code);
        const requested = reportFilter?.[character.name.toLowerCase()];
        const picked = requested && requested.length > 0
          ? allCodes.filter((c) => requested.includes(c))
          : allCodes;
        const selected = picked.length > 0 ? picked : allCodes;
        const rows = careerRows.filter((r) => selected.includes(r.reportCode));
        return {
          character,
          rows,
          availableReports,
          // Scoped to the reports actually being compared, so gold matches the
          // pulls shown rather than the whole career.
          offPull: offPullOf(character.id).filter((o) =>
            rows.some((r) => r.reportCode === o.reportCode),
          ),
          adjustmentsByCode: config.consumableAdjustmentsByCode ?? {},
          // Attendance is inherently cross-week — always all-time, never per-log.
          attendance: computeAttendance(character.id),
          comments: commentsOf(character.id),
          loggedSpec: loggedSpecOf(character.id),
          mainCharacterName: mainNameOf(character),
        };
      });
      return summarizeComparison(inputs, policy);
    },

    async listUntrackedLogPlayers(): Promise<UntrackedLogPlayer[]> {
      const reportStart = new Map(wclReports.map((r) => [r.code, r.startTime]));
      const byName = new Map<string, UntrackedLogPlayer>();
      const codesByName = new Map<string, Set<string>>();
      for (const row of wclPlayerFights) {
        if (wclRowCharacterId(row) !== null) continue;
        const key = row.actorName.toLowerCase();
        const seen = reportStart.get(row.reportCode) ?? "";
        const codes = codesByName.get(key) ?? new Set<string>();
        codes.add(row.reportCode);
        codesByName.set(key, codes);
        const entry = byName.get(key);
        if (!entry) {
          byName.set(key, {
            name: row.actorName,
            className: row.className,
            spec: row.spec,
            role: row.role,
            appearances: 1,
            reportCount: codes.size,
            lastSeen: seen,
          });
        } else {
          entry.appearances++;
          entry.reportCount = codes.size;
          entry.className ??= row.className;
          entry.spec ??= row.spec;
          if (seen > entry.lastSeen) entry.lastSeen = seen;
        }
      }
      return [...byName.values()].sort(
        (a, b) => b.appearances - a.appearances || compareText(a.name, b.name),
      );
    },

    async getDashboard() {
      const sessions = [...raidSessions].sort((a, b) => compareText(b.date, a.date));
      // Guild KPIs describe the guild — known pugs stay out of all of them.
      const summaries = roster.filter((c) => c.status !== "pug").map(summarize);
      const activeCompletions = summaries
        .map((s) => s.completionByPhase.find((c) => c.phase === guild.activePhase)?.completion.pct)
        .filter((p): p is number => p !== undefined);

      // Enough rows that the list answers "what are we going to argue about
      // this tier", rather than naming the top few and stopping just as it
      // gets interesting. Still a summary — /items is the whole set.
      const CONTESTED_SHOWN = 12;
      /**
       * Which tier an item drops in decides whether the argument over it is
       * this month's or next year's, so the list reads by phase with the one
       * being raided first. Demand still *chooses* the rows: sorting by phase
       * before the slice would fill the summary with the active tier and hide
       * every other contested item, so the phase only reorders what demand
       * already picked. Sorts are stable, so the demand order survives inside
       * each phase. An item nobody has placed in a phase sorts last.
       */
      const phaseRank = (phase: Phase | undefined) =>
        phase === undefined ? Number.MAX_SAFE_INTEGER : phase === guild.activePhase ? 0 : phase;
      const contested = [...wishlistedItemIds()]
        .map(contentionFor)
        .filter((c) => c.wishers.length >= 2)
        .sort((a, b) => b.openCount - a.openCount || b.wishers.length - a.wishers.length)
        .slice(0, CONTESTED_SHOWN)
        .sort((a, b) => phaseRank(a.item?.phase) - phaseRank(b.item?.phase));

      // "All raids" plus one tab per phase that actually has awards.
      const phasesWithAwards = [...new Set(
        awardsWithContext.map((a) => a.sessionPhase).filter((p): p is Phase => p !== undefined),
      )].sort((a, b) => a - b);
      const fairness: FairnessGroup[] = [
        { phase: "all", entries: computeFairness(roster, awardsWithContext) },
        ...phasesWithAwards.map((phase) => ({
          phase,
          entries: computeFairness(roster, awardsWithContext, phase),
        })),
      ];

      /*
       * Wishlist hits from the most recent raid week.
       *
       * The window comes from `analysis/loot-recency.ts` because the ledger
       * filters by the same rule — a card that lists rows its own link does not
       * show is the failure worth designing against, and nothing else would
       * catch it.
       *
       * `matched` is already computed per award against the winner's wishlists,
       * token redemptions included, so a tier token that buys a wishlisted
       * piece counts exactly as the piece would. Off-spec wins stay in and are
       * marked: an off-spec set is still a list the raider wrote.
       */
      const BIS_SHOWN = 8;
      // Anchored to the newest AWARD, not the newest session: a raid that
      // dropped nothing (or whose Gargul export hasn't landed) would otherwise
      // anchor the week to itself and hide the loot of the week before it.
      // `awardsWithContext` is already sorted newest first.
      const newestLootDay = awardsWithContext[0]
        ? dayOf(awardsWithContext[0].award.awardedAt)
        : undefined;
      const bisWindow = lootWindowRange("week", newestLootDay, dayOf(new Date().toISOString()));
      const bisMatched = awardsWithContext.filter(
        (a) => a.wishlist.matched && inLootWindow(a.award.awardedAt, bisWindow),
      );

      return {
        guild,
        rosterSize: roster.filter((c) => c.status !== "inactive" && c.status !== "pug").length,
        activePhaseAwards: awardsWithContext.filter((a) => a.sessionPhase === guild.activePhase).length,
        avgActivePhaseCompletion:
          activeCompletions.length > 0
            ? Math.round(activeCompletions.reduce((a, b) => a + b, 0) / activeCompletions.length)
            : undefined,
        lastRaid: sessions[0],
        recentSessions: sessions.map((session) => ({
          session,
          awardCount: lootAwards.filter((a) => a.raidSessionId === session.id).length,
        })),
        contestedItems: contested,
        bisWins: {
          from: bisWindow?.from,
          to: bisWindow?.to,
          total: bisMatched.length,
          wins: bisMatched.slice(0, BIS_SHOWN).map((a) => ({
            awardId: a.award.id,
            itemId: a.award.itemId,
            itemName: itemDisplayName(a.award.itemId, a.item?.name, a.award.itemName),
            item: a.item,
            winnerName: a.character?.name ?? a.award.rawWinnerName,
            winnerClass: a.character?.class,
            winnerSlug: a.character?.name.toLowerCase(),
            offspec: a.award.offspec,
            redeemsTo: a.wishlist.redeemsTo,
          })),
        },
        fairness,
        unresolvedCount: unresolvedAwards().length,
      };
    },
  };

  return memoizeViews(repo);
}
