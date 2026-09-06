import { summarizeRaidReport } from "@/lib/analysis/raid-report";
import { normalizeItemName } from "@/lib/loot/priority-sheet";
import { fingerprintRows, specFingerprints } from "@/lib/sim/profile";
import type {
  Profession,
  RaidReportView,
  SimSpecDetail,
  SimSpecView,
  UntrackedLogPlayer,
  WclPlayerFight,
  WclReportView,
} from "@/lib/types";
import type { Repo } from "@/lib/data/repo";
import { compareText } from "@/lib/sort";
import type { StoreContext } from "./context";

/**
 * What the logs say — reports, pulls, and the two sim reads.
 *
 * A log carries names, not characters, so every row here is joined to the
 * roster by name and a row that will not join stays unlinked. That is why
 * `listUntrackedLogPlayers` exists: an unmatched raider has to be visible,
 * because the alternative to showing them is silently leaving them out of
 * somebody's attendance.
 *
 * The sim reads are one pass over the same pull rows. Saved setups live in the
 * `meta` table rather than here, so this backend reports every spec as having
 * none and the SQLite one layers the profiles on.
 */

export function logViews(ctx: StoreContext) {
  const { config, charactersById, consumableNames, items, policy, pullsByReport, sessionsById, simPullsOf, simSpecs, wclPlayerFights, wclPlayerOffPull, wclReports, wclRowCharacterId } = ctx;
  return {
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
      // ...and, off the same match, what the roster records them as knowing.
      // The log never says; only a matched character can answer it, so an
      // unmatched raider is simply absent rather than an engineer of no
      // professions.
      const professionsByActor = new Map<string, readonly Profession[]>();
      for (const row of rows) {
        const id = wclRowCharacterId(row);
        const character = id ? charactersById.get(id) : undefined;
        if (character) {
          slugByActor.set(row.actorName.toLowerCase(), character.name.toLowerCase());
          professionsByActor.set(row.actorName.toLowerCase(), character.professions);
        }
      }
      return summarizeRaidReport({
        report,
        // Where anything put on a pet lives — one record per player per report.
        offPull: wclPlayerOffPull.filter((o) => o.reportCode === report.code),
        session: report.raidSessionId ? sessionsById.get(report.raidSessionId) : undefined,
        rows,
        reportPulls: pullsByReport().get(report.code) ?? new Set(rows.map((r) => r.fightId)).size,
        slugByActor,
        professionsByActor,
        excludedFightIds: config.excludedFightsByCode?.[report.code],
        policy,
      });
    },

    async listPullRows(reportCode: string, fightId: number): Promise<WclPlayerFight[]> {
      return wclPlayerFights.filter((r) => r.reportCode === reportCode && r.fightId === fightId);
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

    async listEncounterNames(): Promise<string[]> {
      return [...new Set(wclPlayerFights.map((r) => r.encounterName))].sort((a, b) =>
        compareText(a, b),
      );
    },

    async listUnmatchedConsumableNames(): Promise<string[]> {
      const known = new Set<string>();
      for (const item of items) {
        if (item.name) known.add(normalizeItemName(item.name));
      }
      for (const r of config.refusedItemNames ?? []) known.add(r.nameKey);
      return consumableNames().filter((name) => !known.has(normalizeItemName(name)));
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
  } satisfies Partial<Repo> & ThisType<Repo>;
}
