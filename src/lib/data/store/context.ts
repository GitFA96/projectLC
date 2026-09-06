import {
  computeCompletion,
  computeWishlistRows,
  matchAwardToWishlists,
} from "@/lib/analysis/wishlist";
import { computeItemContention } from "@/lib/analysis/contention";
import { tokenRedemptions } from "@/lib/items/tier-tokens";
import { buildDevelopmentSeries } from "@/lib/analysis/development";
import { bossCommentKey } from "@/lib/loot/boss-notes";
import { applyCurrentGearOverrides } from "@/lib/analysis/current-gear";
import { resetWeekStart, summarizePerformance } from "@/lib/analysis/performance";
import { explosiveThrows, professionGap } from "@/lib/analysis/professions";
import { goldPerRaid } from "@/lib/analysis/comparison";
import { LOOT_PRIORITY_SHEET_MD, LOOT_PRIORITY_SHEET_PHASE } from "@/data/seed/loot-priority-p3";
import {
  indexRules,
  normalizeItemName,
  parsePrioritySheet,
  type PrioritySheetRule,
} from "@/lib/loot/priority-sheet";
import { parsePriorityChain } from "@/lib/loot/priority-chain";
import { resolvePolicy } from "@/lib/analysis/policy";
import { PHASE_IDS, phaseForZones, raidOfBoss } from "@/lib/constants/wow";
import { specFingerprints, specOfPull } from "@/lib/sim/profile";
import type {
  AttendanceSummary,
  AwardWithContext,
  Character,
  CharacterComment,
  ItemComment,
  BossComment,
  CharacterSummary,
  CurrentGearOverride,
  GearSet,
  ItemPriorityRule,
  LootAward,
  Phase,
  RaiderMetrics,
  SimPullView,
  SimSpecView,
  WclPlayerFight,
  WclPlayerOffPull,
} from "@/lib/types";
import { compareText } from "@/lib/sort";
import type { EntityStore, StoreConfig } from "@/lib/data/store";

/**
 * The markdown in force for a phase: what an officer pasted, else the seeded
 * sheet for the one phase that ships with one, else nothing.
 *
 * Deleting a stored sheet is therefore how a phase reverts to the seed —
 * the same shape as clearing an item rule to hand that item back to the sheet.
 */
export function sheetMarkdownFor(phase: number, stored: StoreConfig["prioritySheetsByPhase"]): string {
  const pasted = stored?.[phase]?.markdown;
  if (pasted !== undefined) return pasted;
  return phase === LOOT_PRIORITY_SHEET_PHASE ? LOOT_PRIORITY_SHEET_MD : "";
}

/**
 * Everything the views share: the indexes, the lookups, and the caches that
 * make a read model cheap enough to throw away.
 *
 * This is one file rather than several on purpose. The declarations below are a
 * dependency graph, not a list — `summarize` reaches attendance, attendance
 * reaches the pull rows, the metrics cache is read by three unrelated views —
 * and splitting it would mean threading partial contexts between builders,
 * which is exactly where a change that alters a verdict without changing a test
 * would hide.
 *
 * **Built once per read model, and the read model is rebuilt whenever
 * `data_version` moves.** That is what licenses the three lazy caches here
 * (`metricsByCharacter`, `explosivesByCharacter`, `developmentByCharacter`) and
 * the parsed-sheet cache: their entire key is "this model", so there is nothing
 * to invalidate and nothing to get wrong. A cache with a longer life than the
 * model would be a bug, which is why the priority sheet's parse had to move in
 * here the day sheets became pasteable.
 *
 * Only what a view actually names is returned. The rest stay closures — a
 * helper that no view calls is plumbing between two other helpers, and putting
 * it on the context would invite a view to reach for it.
 */

export function buildContext(store: EntityStore, config: StoreConfig) {
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
      professionGap: professionGap(character.professions, {
        explosives: explosiveThrowsOf(character.id),
      }),
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

  /**
   * Engineering explosives thrown per character — the only profession evidence
   * a log carries.
   *
   * One pass over every pull and every off-pull record, built on first use and
   * kept for the life of the read model, because `summarize()` asks this for
   * the whole roster at once and a per-character scan of the fight table would
   * make the roster page quadratic in the raid's log history.
   *
   * Counted off the cast NAMES rather than the stored `sappers` column, because
   * that column is sapper charges alone and an Arcane Bomb is equally proof
   * (`analysis/professions.ts`). It also means a newly curated explosive
   * re-grades reports already imported.
   *
   * Excused pulls are excluded, like everything else derived from a pull
   * (`isExcusedPull`). It can in principle silence the hint — the one throw was
   * on the pull the officer took out — and that is the safe direction: this
   * only ever makes a positive claim, so losing evidence loses the prompt, and
   * never invents a wrong one.
   */
  let explosivesByCharacter: Map<string, number> | undefined;
  function explosiveThrowsOf(characterId: string): number {
    if (!explosivesByCharacter) {
      const tally = new Map<string, number>();
      const add = (id: string | null | undefined, n: number) => {
        if (!id || n <= 0) return;
        tally.set(id, (tally.get(id) ?? 0) + n);
      };
      for (const row of wclPlayerFights) {
        if (isExcusedPull(row)) continue;
        add(wclRowCharacterId(row), explosiveThrows([row]));
      }
      for (const character of roster) {
        add(character.id, explosiveThrows([], offPullOf(character.id)));
      }
      explosivesByCharacter = tally;
    }
    return explosivesByCharacter.get(characterId) ?? 0;
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

  return {
    store,
    config,
    awardsOf,
    awardsWithContext,
    bossCommentsByBoss,
    bossDrops,
    careerRowsOf,
    charactersById,
    charactersBySlug,
    commentsOf,
    computeAttendance,
    consumableNames,
    contentionFor,
    currentGearOverrides,
    currentOf,
    developmentOf,
    feedback,
    gearSets,
    guild,
    guildBossDrops,
    importedCurrentOf,
    isExcusedPull,
    itemCommentsByItem,
    items,
    itemsById,
    loggedSpecOf,
    lootAwards,
    mainNameOf,
    offOverridesOf,
    offPullOf,
    overridesOf,
    policy,
    priorityRuleFor,
    pullsByReport,
    raidSessions,
    raiderMetricsOf,
    redemptions,
    roster,
    rulesForPhase,
    sessionsById,
    sheetItemIdFor,
    simPullsOf,
    simSpecs,
    summarize,
    unresolvedAwards,
    wclPlayerFights,
    wclPlayerOffPull,
    wclReports,
    wclRowCharacterId,
    wishlistedItemIds,
    wishlistsOf,
  };
}

/** Everything a view builder is handed. Inferred, so adding a member is one edit. */
export type StoreContext = ReturnType<typeof buildContext>;
