import { WclError, wclQuery } from "@/lib/wcl/client";
import {
  FLASK_BUFF_IDS,
  PET_BUFF_IDS,
  SAPPER_CAST_NAMES,
  SCROLL_BUFF_IDS,
  SCROLL_CAST_IDS,
  TRACKED_CAST_IDS,
} from "@/lib/wcl/consumables";


import {
  APPLY_CAST_NAMES,
  BUFF_TRACK_NAMES,
  COOLDOWN_CAST_IDS,
  DEBUFF_TRACK_NAMES,
  SHAMAN_TOTEM_CASTS,
} from "@/lib/wcl/class-tracks";
import { normalizeWclReport, type NormalizedReport } from "@/lib/wcl/normalize";

/**
 * Fetch everything one report import needs — deliberately few requests so a
 * whole night costs roughly 7 calls plus one per pull that had a death (the free
 * tier allows thousands/hour):
 *   1. overview: meta + boss fights + actors (players AND NPCs, for naming
 *      upkeep targets like bosses/adds) + dps/hps/boss-damage parse rankings
 *   2. combatantinfo events (gear + auras at pull)            — paginated
 *   3. friendly death events                                  — paginated
 *   4. consumable + class-cooldown casts (tracked spell ids)  — paginated
 *   5. tracked debuffs on enemies (upkeep uptime)             — paginated, soft
 *   6. tracked buffs on friendlies (shouts, totems, Innervate) — paginated, soft
 *   7. every dispel in the report, boss pulls and trash alike — paginated, soft
 *   8. damage taken near each death, one call per pull with one — paginated, soft
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
      # Every fight, trash included — the boss list above deliberately isn't.
      # Trash is where most dispelling happens (432 of 492 in the probed MH+BT
      # night), and it can only be placed with the zone and the enemy list:
      # gameZone separates Hyjal trash from Black Temple trash on a night that
      # ran both, and a segment with no enemy NPC is world PvP the raid walked
      # past, not raid work. Same request, no extra call.
      allFights: fights {
        id encounterID startTime endTime
        gameZone { id name }
        enemyNPCs { id }
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
  dataType: "CombatantInfo" | "Deaths" | "Casts" | "Debuffs" | "Buffs" | "DamageTaken" | "Dispels",
  endTime: number,
  filter?: string,
  hostility: "Friendlies" | "Enemies" = "Friendlies",
  /** Report-relative start, for a fetch scoped to one pull rather than the night. */
  startTime = 0,
): Promise<unknown[]> {
  const all: unknown[] = [];
  let cursor = startTime;
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

  const [combatantInfo, deaths, casts, debuffs, buffs, dispels] = await Promise.all([
    fetchAllEvents(code, "CombatantInfo", reportDuration),
    fetchAllEvents(code, "Deaths", reportDuration),
    fetchAllEvents(
      code,
      "Casts",
      reportDuration,
      // Sappers and totems are matched by name — one entry covers every rank.
      // Scrolls ride along so a hunter buffing their PET is visible; a raider
      // scrolling themselves is already read off the auras at the pull.
      // APPLY_CAST_NAMES rides along too: for a shared debuff the cast stream
      // is the only record of who actually cast it (UptimeTrack.appliedBy).
      `ability.id IN (${[...TRACKED_CAST_IDS, ...SCROLL_CAST_IDS, ...COOLDOWN_CAST_IDS].join(", ")}) OR ability.name IN (${quoted([...SAPPER_CAST_NAMES, ...SHAMAN_TOTEM_CASTS, ...APPLY_CAST_NAMES])})`,
    ),
    soft(
      "Debuff-uptime tracking (curses, Thunder Clap…)",
      fetchAllEvents(code, "Debuffs", reportDuration, `ability.name IN (${quoted(DEBUFF_TRACK_NAMES)})`, "Enemies"),
    ),
    soft(
      "Buff-uptime tracking (shouts, totems, Innervate)",
      // The flask ids ride along because Warcraft Logs leaves those flasks out
      // of the pull's combatantinfo snapshot — the buff stream is the only
      // place they exist. See FLASK_BUFF_IDS.
      //
      // The scroll and pet-food ids are here for the same reason, one step
      // further out: there is no combatantinfo for a PET at all, so a pet's own
      // aura stream is the only place its consumables exist. See
      // SCROLL_BUFF_IDS and PET_BUFF_IDS.
      fetchAllEvents(
        code,
        "Buffs",
        reportDuration,
        `ability.name IN (${quoted(BUFF_TRACK_NAMES)}) OR ability.id IN (${[...FLASK_BUFF_IDS.keys(), ...SCROLL_BUFF_IDS.keys(), ...PET_BUFF_IDS.keys()].join(", ")})`,
      ),

    ),
    soft(
      "Dispel tracking (decurses, cleanses, purges)",
      // Unfiltered on purpose, and the only fetch in this file that is. WCL's
      // `Dispels` stream is already narrow (492 events across a full MH+BT
      // night), and every event names the spell that did the removing — so
      // storing the id lets `dispelAbilityOf` classify at READ time and a
      // newly curated dispel re-grades old reports without a refetch. A filter
      // here would trade that away for nothing.
      //
      // Friendlies is a source-side filter for this data type: it returned the
      // Spellsteals and Purges our raiders landed on bosses as well as the
      // cleanses they put on each other, and the eight events it left out were
      // all world PvP outside the instance.
      fetchAllEvents(code, "Dispels", reportDuration),
    ),
  ]);

  const damageTaken = await soft(
    "Death recaps (what killed each raider)",
    fetchDeathRecapWindows(code, rawReport, deaths),
  );

  const normalized = normalizeWclReport(rawReport, {
    combatantInfo,
    deaths,
    casts,
    debuffs,
    buffs,
    dispels,
    damageTaken,
  });
  normalized.warnings.push(...softWarnings);
  return normalized;
}

/**
 * How far back a death recap reaches. The council asked for "the last 10s".
 *
 * A plain const, not a policy field (§4b): it decides how much of a story the
 * page tells, and moves no loot verdict.
 */
export const DEATH_RECAP_MS = 10_000;

/**
 * Damage taken shortly before each death — one fetch per pull that had one.
 *
 * The granularity is the whole point. Per death is 97 queries on this guild's
 * quietest night, against a whole import that otherwise costs about seven. The
 * whole night unfiltered is worse in the other direction: probed at ~5,000 events
 * in the first page alone, ~1.3 MB, and paging further.
 *
 * So: one query per fight that had a death, filtered to the players who died in
 * *that* fight, over that fight's window. Probed at ~51 events for one player
 * across a whole Vashj pull, so a few hundred per fight — and roughly a dozen
 * extra calls for a raid night. `normalize` slices each death's own window out.
 *
 * Soft by construction: the caller wraps it, so a report still imports with
 * everything else if this fails.
 */
async function fetchDeathRecapWindows(
  code: string,
  rawReport: unknown,
  deaths: unknown[],
): Promise<unknown[]> {
  const report = rawReport as { fights?: { id: number; startTime: number; endTime: number }[] };
  const fightById = new Map((report.fights ?? []).map((f) => [f.id, f]));
  const actorNames = new Map(
    (
      (rawReport as { masterData?: { actors?: { id: number; name: string }[] } }).masterData?.actors ??
      []
    ).map((a) => [a.id, a.name]),
  );

  /** fightId → names that died in it. */
  const victims = new Map<number, Set<string>>();
  for (const raw of deaths) {
    const event = raw as { fight?: number; targetID?: number };
    const name = event.targetID === undefined ? undefined : actorNames.get(event.targetID);
    if (event.fight === undefined || !name || !fightById.has(event.fight)) continue;
    (victims.get(event.fight) ?? victims.set(event.fight, new Set()).get(event.fight)!).add(name);
  }

  const all: unknown[] = [];
  for (const [fightId, names] of victims) {
    const fight = fightById.get(fightId)!;
    // Quoted the same way the upkeep filters are — a single-quoted string
    // matches NOTHING in WCL's filter language and reports no error.
    const filter = `target.name IN (${[...names].map((n) => `"${n}"`).join(", ")})`;
    all.push(
      ...(await fetchAllEvents(
        code,
        "DamageTaken",
        fight.endTime,
        filter,
        "Friendlies",
        // Only as far back as the recap needs, not the whole pull.
        Math.max(0, fight.startTime - DEATH_RECAP_MS),
      )),
    );
  }
  return all;
}
