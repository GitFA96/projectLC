import { WclError, wclQuery } from "@/lib/wcl/client";
import { SAPPER_CAST_NAMES, SCROLL_CAST_IDS, TRACKED_CAST_IDS } from "@/lib/wcl/consumables";
import {
  BUFF_TRACK_NAMES,
  COOLDOWN_CAST_IDS,
  DEBUFF_TRACK_NAMES,
  SHAMAN_TOTEM_CASTS,
} from "@/lib/wcl/class-tracks";
import { normalizeWclReport, type NormalizedReport } from "@/lib/wcl/normalize";

/**
 * Fetch everything one report import needs — deliberately few requests so a
 * whole night costs ~7 API calls (the free tier allows thousands/hour):
 *   1. overview: meta + boss fights + actors (players AND NPCs, for naming
 *      upkeep targets like bosses/adds) + dps/hps/boss-damage parse rankings
 *   2. combatantinfo events (gear + auras at pull)            — paginated
 *   3. friendly death events                                  — paginated
 *   4. consumable + class-cooldown casts (tracked spell ids)  — paginated
 *   5. tracked debuffs on enemies (upkeep uptime)             — paginated, soft
 *   6. tracked buffs on friendlies (shouts, totems, Innervate) — paginated, soft
 * "Soft" fetches degrade to a warning instead of failing the import.
 */

const OVERVIEW_QUERY = `
query ReportOverview($code: String!) {
  reportData {
    report(code: $code) {
      title
      startTime
      endTime
      zone { name }
      masterData { actors { id name type subType petOwner } }
      fights(killType: Encounters) {
        id encounterID name kill fightPercentage startTime endTime
      }
      dps: rankings(playerMetric: dps, compare: Parses)
      hps: rankings(playerMetric: hps, compare: Parses)
      bossdps: rankings(playerMetric: bossdps, compare: Parses)
    }
  }
}`;

const EVENTS_QUERY = `
query ReportEvents($code: String!, $dataType: EventDataType!, $startTime: Float!, $endTime: Float!, $filter: String, $hostility: HostilityType) {
  reportData {
    report(code: $code) {
      events(
        dataType: $dataType
        startTime: $startTime
        endTime: $endTime
        filterExpression: $filter
        hostilityType: $hostility
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
  dataType: "CombatantInfo" | "Deaths" | "Casts" | "Debuffs" | "Buffs",
  endTime: number,
  filter?: string,
  hostility: "Friendlies" | "Enemies" = "Friendlies",
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
      hostility,
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

  // Upkeep tracks match by ability NAME so one entry covers every spell rank.
  const quoted = (names: string[]) => names.map((n) => `"${n}"`).join(", ");
  const softWarnings: string[] = [];
  const soft = (label: string, p: Promise<unknown[]>): Promise<unknown[]> =>
    p.catch((e) => {
      softWarnings.push(`${label} skipped: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    });

  const [combatantInfo, deaths, casts, debuffs, buffs] = await Promise.all([
    fetchAllEvents(code, "CombatantInfo", reportDuration),
    fetchAllEvents(code, "Deaths", reportDuration),
    fetchAllEvents(
      code,
      "Casts",
      reportDuration,
      // Sappers and totems are matched by name — one entry covers every rank.
      // Scrolls ride along so a hunter buffing their PET is visible; a raider
      // scrolling themselves is already read off the auras at the pull.
      `ability.id IN (${[...TRACKED_CAST_IDS, ...SCROLL_CAST_IDS, ...COOLDOWN_CAST_IDS].join(", ")}) OR ability.name IN (${quoted([...SAPPER_CAST_NAMES, ...SHAMAN_TOTEM_CASTS])})`,
    ),
    soft(
      "Debuff-uptime tracking (curses, Thunder Clap…)",
      fetchAllEvents(code, "Debuffs", reportDuration, `ability.name IN (${quoted(DEBUFF_TRACK_NAMES)})`, "Enemies"),
    ),
    soft(
      "Buff-uptime tracking (shouts, totems, Innervate)",
      fetchAllEvents(code, "Buffs", reportDuration, `ability.name IN (${quoted(BUFF_TRACK_NAMES)})`),
    ),
  ]);

  const normalized = normalizeWclReport(rawReport, { combatantInfo, deaths, casts, debuffs, buffs });
  normalized.warnings.push(...softWarnings);
  return normalized;
}
