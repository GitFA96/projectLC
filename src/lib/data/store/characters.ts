import { computeCompletion, computeStatDeltas, computeWishlistRows } from "@/lib/analysis/wishlist";
import { buildRosterStanding } from "@/lib/analysis/standing";
import { parseTrend } from "@/lib/analysis/development";
import { offSpecGearSet } from "@/lib/analysis/current-gear";
import { summarizePerformance } from "@/lib/analysis/performance";
import { summarizeComparison, type ComparisonInput } from "@/lib/analysis/comparison";
import type {
  Character,
  CharacterBundle,
  CharacterComparisonView,
  CharacterPerformance,
  PerformanceReportView,
  PhaseWishlistView,
} from "@/lib/types";
import type { Repo } from "@/lib/data/repo";
import { compareText } from "@/lib/sort";
import type { StoreContext } from "./context";

/**
 * The roster, and everything measured about one raider.
 *
 * `getCharacterBundle` is the page an officer argues from, so it is the one to
 * read: it assembles the summary, the attendance, the gear, the awards and the
 * development series into a single answer, and every number in it comes from
 * `src/lib/analysis` rather than being computed here. This layer indexes and
 * joins; it never decides.
 */

export function characterViews(ctx: StoreContext) {
  const { config, awardsOf, awardsWithContext, careerRowsOf, charactersBySlug, commentsOf, computeAttendance, currentOf, developmentOf, gearSets, guild, importedCurrentOf, isExcusedPull, loggedSpecOf, mainNameOf, offOverridesOf, offPullOf, overridesOf, policy, pullsByReport, raiderMetricsOf, redemptions, roster, sessionsById, summarize, wclPlayerFights, wclReports, wclRowCharacterId, wishlistsOf } = ctx;
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

    async getDevelopment(characterId: string) {
      return developmentOf(characterId);
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

    async listGearSets() {
      return gearSets;
    },
  } satisfies Partial<Repo> & ThisType<Repo>;
}
