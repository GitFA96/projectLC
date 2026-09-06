import type { PolicyOverrides } from "@/lib/analysis/policy";
import type { Guide } from "@/lib/guides";
import type { WishlistAlternative } from "@/lib/analysis/wishlist-alternatives";
import type {
  AttendanceExemption,
  Character,
  CharacterComment,
  ItemComment,
  BossComment,
  BossDrop,
  GuildBossDrop,
  FeedbackReport,
  GuildAuditEntry,
  GuildInvite,
  GuildRole,
  Membership,
  ConsumableAdjustment,
  CurrentGearOverride,
  GearSet,
  Guild,
  Item,
  LootAward,
  RaidSession,
  WclPlayerFight,
  WclPlayerOffPull,
  WclReport,
} from "@/lib/types";
import type { Repo } from "@/lib/data/repo";
import { buildContext } from "./store/context";
import { characterViews } from "./store/characters";
import { dashboardView } from "./store/dashboard";
import { dropViews } from "./store/drops";
import { governanceViews } from "./store/governance";
import { itemViews } from "./store/items";
import { logViews } from "./store/logs";
import { lootViews } from "./store/loot";
import { settingViews } from "./store/settings";

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
export const MEMOIZED_VIEWS = ["listCharacters", "listItemDemand", "listWclReports", "getDashboard"] as const;

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

/**
 * Every derived number this app shows, built once from the plain entities a
 * backend loaded — so the read-only seed demo answers every query exactly as
 * SQLite does. Neither backend may compute a summary of its own.
 *
 * The work is in `store/`: `buildContext` makes the indexes and caches the
 * views share, and one file per domain turns them into methods. This composes
 * and memoizes, and does nothing else. Nothing outside `store/` may import
 * those files — a domain on its own is a fraction of a repo.
 *
 * **A number that encodes a judgement does not belong anywhere in here.** It
 * belongs in `analysis/policy.ts`, where the guild edits it, and reaches this
 * layer through `config.policy` (root AGENTS.md invariant 5).
 */
export function createRepoFromStore(store: EntityStore, config: StoreConfig = {}): Repo {
  const ctx = buildContext(store, config);
  const repo: Repo = {
    ...characterViews(ctx),
    ...lootViews(ctx),
    ...dropViews(ctx),
    ...itemViews(ctx),
    ...logViews(ctx),
    ...governanceViews(ctx),
    ...dashboardView(ctx),
    ...settingViews(ctx),
  };
  return memoizeViews(repo);
}
