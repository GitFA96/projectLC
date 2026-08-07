import {
  computeCompletion,
  computeStatDeltas,
  computeWishlistRows,
  matchAwardToWishlists,
} from "@/lib/analysis/wishlist";
import { emptyBoard, type Board, type GuildRoster } from "@/lib/analysis/raid-planner";
import { computeItemContention } from "@/lib/analysis/contention";
import { applyCurrentGearOverrides, offSpecGearSet } from "@/lib/analysis/current-gear";
import { buildEnchantReference, type EnchantReference } from "@/lib/analysis/enchants";
import { computeFairness } from "@/lib/analysis/fairness";
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
import { parsePriorityChain } from "@/lib/loot/priority-chain";
import { resolvePolicy, type PolicyOverrides } from "@/lib/analysis/policy";
import { PHASE_IDS, phaseForZones } from "@/lib/constants/wow";
import { itemDisplayName } from "@/lib/items/item-data";
import { fingerprintRows, specFingerprints, specOfPull } from "@/lib/sim/profile";
import type {
  AttendanceExemption,
  AttendanceSummary,
  AwardWithContext,
  Character,
  CharacterBundle,
  CharacterComment,
  CharacterComparisonView,
  FeedbackReport,
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
} from "@/lib/types";
import type { Repo } from "@/lib/data/repo";

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
  /**
   * Bug reports filed from the app. Not guild data and not derived from
   * anything — it rides along here so both backends answer `listFeedback`
   * identically, and so the read model is the single place pages read from.
   */
  feedback: FeedbackReport[];
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
   * The council's policy — every number that encodes a judgement. Anything
   * unset falls back to the code defaults, so an empty record behaves exactly
   * as the app did before the record existed.
   */
  policy?: PolicyOverrides;
  /** Officer edits to the seeded priority sheet, keyed by normalized item name. */
  itemPriorityRules?: Record<string, { itemName: string; chain: string; note?: string }>;
  /**
   * Sheets an officer has pasted, keyed by phase. A phase with none falls back
   * to the seeded sheet (phase 3) or to nothing at all.
   */
  prioritySheetsByPhase?: Record<
    number,
    { markdown: string; author?: string; note?: string; updatedAt: string }
  >;
  /** Enchant ids resolved from the enchantment table, for the gear panel. */
  enchantNames?: Record<number, string>;
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
  const { guild, roster, items, gearSets, currentGearOverrides, raidSessions, lootAwards, wclReports, wclPlayerFights, wclPlayerOffPull, attendanceExemptions, characterComments, feedback } = store;

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
  for (const c of [...characterComments].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const list = commentsByCharacter.get(c.characterId) ?? [];
    list.push(c);
    commentsByCharacter.set(c.characterId, list);
  }
  const commentsOf = (characterId: string): CharacterComment[] =>
    commentsByCharacter.get(characterId) ?? [];
  const itemsById = new Map(items.map((i) => [i.id, i]));
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
          ? matchAwardToWishlists(award, wishlistsOf(character.id))
          : { matched: false, phases: [] },
      } satisfies AwardWithContext;
    })
    .sort((a, b) => b.award.awardedAt.localeCompare(a.award.awardedAt));

  function awardsOf(characterId: string) {
    return lootAwards.filter((a) => a.characterId === characterId);
  }

  function summarize(character: Character): CharacterSummary {
    const current = currentOf(character.id);
    const myAwards = awardsWithContext.filter((a) => a.award.characterId === character.id);
    const completionByPhase = wishlistsOf(character.id).map((set) => ({
      phase: set.phase!,
      completion: computeCompletion(computeWishlistRows(set, current, awardsOf(character.id))),
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
  function priorityRuleFor(itemId: number, ...names: (string | undefined)[]): ItemPriorityRule | undefined {
    const keys = names
      .filter((n): n is string => n !== undefined && n.trim() !== "")
      .map(normalizeItemName);
    for (const key of keys) {
      const edited = config.itemPriorityRules?.[key];
      if (edited) {
        return {
          itemName: edited.itemName,
          chain: edited.chain,
          tiers: parsePriorityChain(edited.chain).tiers,
          note: edited.note,
          origin: "officer",
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
    void itemId;
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
      priorityRule: priorityRuleFor(
        itemId,
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
      view.raiders.sort((a, b) => b.kills - a.kills || a.actorName.localeCompare(b.actorName));
    }
    return [...byKey.values()].sort(
      (a, b) => a.wowClass.localeCompare(b.wowClass) || a.spec.localeCompare(b.spec),
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
    return out.sort((a, b) => b.raidDate.localeCompare(a.raidDate) || a.fightId - b.fightId);
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

  function computeAttendance(characterId: string): AttendanceSummary | undefined {
    if (wclReports.length === 0) return undefined;
    const myRows = wclPlayerFights.filter((r) => wclRowCharacterId(r) === characterId);
    const attended = new Set(myRows.map((r) => r.reportCode));
    const exemptWeeks = exemptWeeksByCharacter.get(characterId) ?? new Set<string>();
    const pct = (part: number, total: number) => (total === 0 ? 0 : Math.round((part / total) * 100));

    // Fair denominator: only raids since their first logged appearance count.
    const chronological = [...wclReports].sort((a, b) => a.startTime.localeCompare(b.startTime));
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
    const weekBuckets = new Map<string, { reports: number; attended: boolean }>();
    for (const report of since) {
      const start = resetWeekStart(report.startTime);
      const bucket = weekBuckets.get(start) ?? { reports: 0, attended: false };
      bucket.reports++;
      if (attended.has(report.code)) bucket.attended = true;
      weekBuckets.set(start, bucket);
    }
    const weeks = [...weekBuckets]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([start, b]) => ({ start, attended: b.attended, reports: b.reports, excused: exemptWeeks.has(start) }))
      .slice(-policy.attendance.weeks);
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
  function careerRowsOf(characterId: string): WclPlayerFight[] {
    const chronologicalReports = [...wclReports].sort((a, b) => a.startTime.localeCompare(b.startTime));
    const mine = wclPlayerFights.filter((r) => wclRowCharacterId(r) === characterId);
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
    const newestFirst = [...wclReports].sort((a, b) => b.startTime.localeCompare(a.startTime));
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
        const rows = computeWishlistRows(set, current, myAwards);
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
      return [...raidSessions].sort((a, b) => b.date.localeCompare(a.date));
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

    async listFeedback(): Promise<FeedbackReport[]> {
      // Open first, then newest — triage reads top-down and closed reports are
      // kept only so a fixed bug can be told apart from one nobody looked at.
      return [...feedback].sort((a, b) =>
        a.status === b.status
          ? b.createdAt.localeCompare(a.createdAt)
          : a.status === "open"
            ? -1
            : 1,
      );
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
            a.name.localeCompare(b.name),
        );
    },

    async listWclReports(): Promise<WclReportView[]> {
      return [...wclReports]
        .sort((a, b) => b.startTime.localeCompare(a.startTime))
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
      const sorted = [...wclReports].sort((a, b) => b.startTime.localeCompare(a.startTime));
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
        session: report.raidSessionId ? sessionsById.get(report.raidSessionId) : undefined,
        rows,
        reportPulls: pullsByReport().get(report.code) ?? new Set(rows.map((r) => r.fightId)).size,
        slugByActor,
        excludedFightIds: config.excludedFightsByCode?.[report.code],
        policy,
      });
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

    async getPrioritySheet(phase?: number) {
      const forPhase = phase ?? guild.activePhase;
      // Every name the cache knows, so a sheet row can link to its item. Built
      // here rather than in the view builder: which names an item goes by is a
      // read-model fact, and the builder stays pure.
      const idByName = new Map<string, number>();
      for (const item of items) {
        if (item.name) idByName.set(normalizeItemName(item.name), item.id);
      }
      const stored = config.prioritySheetsByPhase?.[forPhase];
      const view = buildPrioritySheetView({
        rules: rulesForPhase(forPhase),
        // Item rules are guild-wide rather than per phase — an officer's chain
        // for an item is their chain for it, whichever sheet lists it.
        overrides: config.itemPriorityRules ?? {},
        itemIdFor: (name) => idByName.get(normalizeItemName(name)),
      });
      return {
        ...view,
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
        itemId,
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
      for (const row of wclPlayerFights) {
        for (const item of row.gear) {
          if (item.enchant === undefined || named.has(item.enchant)) continue;
          counts.set(item.enchant, (counts.get(item.enchant) ?? 0) + 1);
        }
      }
      return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([id]) => id);
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
      for (const item of items) {
        if (item.name === undefined || item.icon === undefined) bump(item.id, 1);
      }
      return [...references]
        .filter(([id]) => {
          const item = itemsById.get(id);
          return item?.name === undefined || item.icon === undefined;
        })
        .sort((a, b) => b[1] - a[1] || a[0] - b[0])
        .map(([id]) => id);
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
        .sort((a, b) => b.startTime.localeCompare(a.startTime))
        .map((report): PerformanceReportView | undefined => {
          const rows = myRows
            .filter((r) => r.reportCode === report.code)
            .sort((a, b) => a.fightId - b.fightId);
          const summary = summarizePerformance(rows, policy);
          return summary
            ? {
                report,
                session: report.raidSessionId ? sessionsById.get(report.raidSessionId) : undefined,
                rows,
                summary,
                offPull: myOffPull.find((o) => o.reportCode === report.code),
                reportPulls: reportPulls.get(report.code) ?? rows.length,
              }
            : undefined;
        })
        .filter((v): v is PerformanceReportView => v !== undefined);
      // Career rollup in chronological order (oldest report first) so
      // "latest pull" facts like the enchant audit come from the newest data.
      const chronological = [...reports].reverse().flatMap((r) => r.rows);
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
          .sort((a, b) => b.startTime.localeCompare(a.startTime))
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
        (a, b) => b.appearances - a.appearances || a.name.localeCompare(b.name),
      );
    },

    async getDashboard() {
      const sessions = [...raidSessions].sort((a, b) => b.date.localeCompare(a.date));
      // Guild KPIs describe the guild — known pugs stay out of all of them.
      const summaries = roster.filter((c) => c.status !== "pug").map(summarize);
      const activeCompletions = summaries
        .map((s) => s.completionByPhase.find((c) => c.phase === guild.activePhase)?.completion.pct)
        .filter((p): p is number => p !== undefined);

      const contested = [...wishlistedItemIds()]
        .map(contentionFor)
        .filter((c) => c.wishers.length >= 2)
        .sort((a, b) => b.openCount - a.openCount || b.wishers.length - a.wishers.length)
        .slice(0, 5);

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
        fairness,
        unresolvedCount: unresolvedAwards().length,
      };
    },
  };

  return memoizeViews(repo);
}
