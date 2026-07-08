import {
  computeCompletion,
  computeStatDeltas,
  computeWishlistRows,
  matchAwardToWishlists,
} from "@/lib/analysis/wishlist";
import { computeItemContention } from "@/lib/analysis/contention";
import { computeFairness } from "@/lib/analysis/fairness";
import { resetWeekStart, summarizePerformance } from "@/lib/analysis/performance";
import { summarizeRaidReport } from "@/lib/analysis/raid-report";
import { summarizeComparison, type ComparisonInput } from "@/lib/analysis/comparison";
import { phaseForZones } from "@/lib/constants/wow";
import type {
  AttendanceExemption,
  AttendanceSummary,
  AwardWithContext,
  Character,
  CharacterBundle,
  CharacterComment,
  CharacterComparisonView,
  CharacterPerformance,
  CharacterSummary,
  ConsumablePrice,
  FairnessGroup,
  GearSet,
  Guild,
  Item,
  ItemDemand,
  LootAward,
  PerformanceReportView,
  Phase,
  PhaseWishlistView,
  RaidReportView,
  RaidSession,
  UntrackedLogPlayer,
  WclPlayerFight,
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
  raidSessions: RaidSession[];
  lootAwards: LootAward[];
  wclReports: WclReport[];
  wclPlayerFights: WclPlayerFight[];
  attendanceExemptions: AttendanceExemption[];
  characterComments: CharacterComment[];
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

export function createRepoFromStore(store: EntityStore): Repo {
  const { guild, roster, items, gearSets, raidSessions, lootAwards, wclReports, wclPlayerFights, attendanceExemptions, characterComments } = store;

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
  const gearSetsByCharacter = new Map<string, GearSet[]>();
  for (const set of gearSets) {
    const list = gearSetsByCharacter.get(set.characterId) ?? [];
    list.push(set);
    gearSetsByCharacter.set(set.characterId, list);
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

  function contentionFor(itemId: number) {
    return computeItemContention({
      itemId,
      item: itemsById.get(itemId),
      characters: roster,
      gearSetsByCharacter,
      awards: awardsWithContext,
      activePhase: guild.activePhase,
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
    const recent = tracked.slice(-10);
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
      .slice(-8);
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

  return {
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
            name: item?.name ?? c.awards[0]?.award.itemName ?? wishlistNames.get(itemId) ?? `Item #${itemId}`,
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
      });
    },

    // Per-report prices are persisted config, not entity-store data — the
    // in-memory/seed model has none, so gold falls back to code defaults. The
    // SQLite backend overrides this to read the raid's logged prices.
    async getReportConsumablePrices(): Promise<Record<string, ConsumablePrice>> {
      return {};
    },

    async getCharacterPerformance(slug: string): Promise<CharacterPerformance | null> {
      const character = charactersBySlug.get(slug.toLowerCase());
      if (!character) return null;
      const myRows = wclPlayerFights.filter((r) => wclRowCharacterId(r) === character.id);
      const reportPulls = pullsByReport();
      const reports: PerformanceReportView[] = [...wclReports]
        .sort((a, b) => b.startTime.localeCompare(a.startTime))
        .map((report): PerformanceReportView | undefined => {
          const rows = myRows
            .filter((r) => r.reportCode === report.code)
            .sort((a, b) => a.fightId - b.fightId);
          const summary = summarizePerformance(rows);
          return summary
            ? {
                report,
                session: report.raidSessionId ? sessionsById.get(report.raidSessionId) : undefined,
                rows,
                summary,
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
        career: summarizePerformance(chronological),
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
          // Attendance is inherently cross-week — always all-time, never per-log.
          attendance: computeAttendance(character.id),
          comments: commentsOf(character.id),
          loggedSpec: loggedSpecOf(character.id),
          mainCharacterName: mainNameOf(character),
        };
      });
      return summarizeComparison(inputs);
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
}
