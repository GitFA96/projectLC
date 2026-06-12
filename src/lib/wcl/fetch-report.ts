import { WclError, wclQuery } from "@/lib/wcl/client";
import { TRACKED_CAST_IDS } from "@/lib/wcl/consumables";
import { normalizeWclReport, type NormalizedReport } from "@/lib/wcl/normalize";

/**
 * Fetch everything one report import needs — deliberately few requests so a
 * whole night costs ~5 API calls (the free tier allows thousands/hour):
 *   1. overview: meta + boss fights + actors + dps/hps parse rankings
 *   2. combatantinfo events (gear + auras at pull)        — paginated
 *   3. friendly death events                              — paginated
 *   4. consumable cast events (tracked spell ids only)    — paginated
 */

const OVERVIEW_QUERY = `
query ReportOverview($code: String!) {
  reportData {
    report(code: $code) {
      title
      startTime
      endTime
      zone { name }
      masterData { actors(type: "Player") { id name subType } }
      fights(killType: Encounters) {
        id encounterID name kill fightPercentage startTime endTime
      }
      dps: rankings(playerMetric: dps, compare: Parses)
      hps: rankings(playerMetric: hps, compare: Parses)
    }
  }
}`;

const EVENTS_QUERY = `
query ReportEvents($code: String!, $dataType: EventDataType!, $startTime: Float!, $endTime: Float!, $filter: String) {
  reportData {
    report(code: $code) {
      events(
        dataType: $dataType
        startTime: $startTime
        endTime: $endTime
        filterExpression: $filter
        hostilityType: Friendlies
        useAbilityIDs: false
        limit: 10000
      ) {
        data
        nextPageTimestamp
      }
    }
  }
}`;

interface OverviewResponse {
  reportData?: { report?: unknown | null } | null;
}

interface EventsResponse {
  reportData?: {
    report?: { events?: { data?: unknown[] | null; nextPageTimestamp?: number | null } | null } | null;
  } | null;
}

async function fetchAllEvents(
  code: string,
  dataType: "CombatantInfo" | "Deaths" | "Casts",
  endTime: number,
  filter?: string,
): Promise<unknown[]> {
  const all: unknown[] = [];
  let cursor = 0;
  for (let page = 0; page < 20; page++) {
    const res = await wclQuery<EventsResponse>(EVENTS_QUERY, {
      code,
      dataType,
      startTime: cursor,
      endTime,
      filter: filter ?? null,
    });
    const events = res.reportData?.report?.events;
    all.push(...(events?.data ?? []));
    if (events?.nextPageTimestamp === null || events?.nextPageTimestamp === undefined) break;
    cursor = events.nextPageTimestamp;
  }
  return all;
}

export async function fetchWclReport(code: string): Promise<NormalizedReport> {
  const overview = await wclQuery<OverviewResponse>(OVERVIEW_QUERY, { code });
  const rawReport = overview.reportData?.report;
  if (!rawReport) {
    throw new WclError(`Report "${code}" was not found — is the code right, and is the report visible (not private)?`);
  }

  // Event times are relative to report start.
  const { startTime, endTime } = rawReport as { startTime?: number; endTime?: number };
  if (typeof startTime !== "number" || typeof endTime !== "number") {
    throw new WclError("Report has no start/end time — unexpected API response.");
  }
  const reportDuration = endTime - startTime;

  const [combatantInfo, deaths, casts] = await Promise.all([
    fetchAllEvents(code, "CombatantInfo", reportDuration),
    fetchAllEvents(code, "Deaths", reportDuration),
    fetchAllEvents(code, "Casts", reportDuration, `ability.id IN (${TRACKED_CAST_IDS.join(", ")})`),
  ]);

  return normalizeWclReport(rawReport, { combatantInfo, deaths, casts });
}
