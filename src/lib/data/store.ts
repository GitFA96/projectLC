import {
  computeCompletion,
  computeStatDeltas,
  computeWishlistRows,
  matchAwardToWishlists,
} from "@/lib/analysis/wishlist";
import { computeItemContention } from "@/lib/analysis/contention";
import { computeFairness } from "@/lib/analysis/fairness";
import { phaseForZones } from "@/lib/constants/wow";
import type {
  AwardWithContext,
  Character,
  CharacterBundle,
  CharacterSummary,
  GearSet,
  Guild,
  Item,
  LootAward,
  PhaseWishlistView,
  RaidSession,
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
}

export function createRepoFromStore(store: EntityStore): Repo {
  const { guild, roster, items, gearSets, raidSessions, lootAwards } = store;

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

    async getDashboard() {
      const sessions = [...raidSessions].sort((a, b) => b.date.localeCompare(a.date));
      const summaries = roster.map(summarize);
      const activeCompletions = summaries
        .map((s) => s.completionByPhase.find((c) => c.phase === guild.activePhase)?.completion.pct)
        .filter((p): p is number => p !== undefined);

      const contested = [...wishlistedItemIds()]
        .map(contentionFor)
        .filter((c) => c.wishers.length >= 2)
        .sort((a, b) => b.openCount - a.openCount || b.wishers.length - a.wishers.length)
        .slice(0, 5);

      return {
        guild,
        rosterSize: roster.filter((c) => c.status !== "inactive").length,
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
        fairness: computeFairness(roster, awardsWithContext),
      };
    },
  };
}
