import { computeFairness } from "@/lib/analysis/fairness";
import { dayOf, inLootWindow, lootWindowRange } from "@/lib/analysis/loot-recency";
import { itemDisplayName } from "@/lib/items/item-data";
import type { FairnessGroup, Phase } from "@/lib/types";
import type { Repo } from "@/lib/data/repo";
import { compareText } from "@/lib/sort";
import type { StoreContext } from "./context";

/**
 * The front page: one read that touches nearly every other domain.
 *
 * It is here alone because that breadth is the whole shape of it. Everything it
 * shows is already computed elsewhere in this directory — this assembles, ranks
 * and truncates. If a number on the dashboard disagrees with the page it links
 * to, the bug is here, not there.
 *
 * Memoized for the life of the read model (`MEMOIZED_VIEWS` in `store.ts`), so
 * the cost is paid once per model rather than per request.
 */

export function dashboardView(ctx: StoreContext) {
  const { awardsWithContext, contentionFor, guild, lootAwards, raidSessions, roster, summarize, unresolvedAwards, wishlistedItemIds } = ctx;
  return {
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
  } satisfies Partial<Repo> & ThisType<Repo>;
}
