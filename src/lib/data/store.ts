import {
  computeCompletion,
  computeStatDeltas,
  computeWishlistRows,
  matchAwardToWishlists,
} from "@/lib/analysis/wishlist";
import { computeItemContention } from "@/lib/analysis/contention";
import { computeFairness } from "@/lib/analysis/fairness";
import { summarizePerformance } from "@/lib/analysis/performance";
import { phaseForZones } from "@/lib/constants/wow";
import type {
  AwardWithContext,
  Character,
  CharacterBundle,
  CharacterPerformance,
  CharacterSummary,
  FairnessGroup,
  GearSet,
  Guild,
  Item,
  ItemDemand,
  LootAward,
  PerformanceReportView,
  Phase,
  PhaseWishlistView,
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
}

export function createRepoFromStore(store: EntityStore): Repo {
  const { guild, roster, items, gearSets, raidSessions, lootAwards, wclReports, wclPlayerFights } = store;

  /* Indexes */
  const charactersById = new Map(roster.map((c) => [c.id, c]));
  const charactersBySlug = new Map(roster.map((c) => [c.name.toLowerCase(), c]));
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
    return {
      character,
      completionByPhase,
      totalAwards: myAwards.length,
      activePhaseAwards: myAwards.filter((a) => a.sessionPhase === guild.activePhase).length,
      offspecAwards: myAwards.filter((a) => a.award.offspec).length,
      lastAwardAt: last,
      hasCurrentGear: current !== undefined,
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

    async getCharacterPerformance(slug: string): Promise<CharacterPerformance | null> {
      const character = charactersBySlug.get(slug.toLowerCase());
      if (!character) return null;
      const myRows = wclPlayerFights.filter((r) => wclRowCharacterId(r) === character.id);
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
              }
            : undefined;
        })
        .filter((v): v is PerformanceReportView => v !== undefined);
      // Career rollup in chronological order (oldest report first) so
      // "latest pull" facts like the enchant audit come from the newest data.
      const chronological = [...reports].reverse().flatMap((r) => r.rows);
      return { character, reports, career: summarizePerformance(chronological) };
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
