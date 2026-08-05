import { z } from "zod";
import { WclError, wclQuery } from "@/lib/wcl/client";
import { SAPPER_CAST_NAMES, TRACKED_CAST_IDS, classifyAura, classifyCast } from "@/lib/wcl/consumables";
import { COOLDOWN_BY_ID, COOLDOWN_CAST_IDS } from "@/lib/wcl/class-tracks";

/**
 * On-demand per-player fight graph: the DPS-over-time series for one pull,
 * with the moments that explain it — class-cooldown and consumable casts, and
 * every buff window the player gained (trinket procs, weapon procs, item
 * procs, class CDs, externals like Heroism). Fetched live from WCL when the
 * fight-graph tab asks for it — nothing here is persisted, so it works for
 * every already-imported report without a re-import.
 */

export interface FightGraphCast {
  /** ms from the fight start. */
  t: number;
  name: string;
  kind: "cooldown" | "consumable";
}

export interface FightGraphBuff {
  name: string;
  /** % of the fight the buff was up. */
  pct: number;
  /** Times gained. */
  uses: number;
  /** [startMs, endMs] pairs relative to the fight start. */
  segments: [number, number][];
}

export interface FightGraphView {
  encounterName: string;
  kill: boolean;
  durationMs: number;
  /** Width of one DPS bucket, ms. */
  bucketMs: number;
  /** DPS per bucket; bucket i covers [i·bucketMs, (i+1)·bucketMs). */
  dps: number[];
  casts: FightGraphCast[];
  /** Alphabetical; prep auras, static raid buffs and incoming heals dropped. */
  buffs: FightGraphBuff[];
  /** Boss health % over the fight, [tMs, pct] — absent when no boss resolves. */
  bossHealth?: [number, number][];
  bossName?: string;
  /** The boss's max hit points — absolute HP at time t ≈ pct/100 × this. */
  bossMaxHp?: number;
}

/** How the API layer reports a fight-graph fetch to the client components. */
export type FightGraphResult =
  | { status: "ok"; data: FightGraphView }
  | { status: "not-configured" }
  | { status: "error"; message: string };

const OVERVIEW_QUERY = `
query FightGraphOverview($code: String!) {
  reportData {
    report(code: $code) {
      masterData { actors { id name type subType } abilities { gameID name } }
      fights { id name kill startTime endTime enemyNPCs { id } }
    }
  }
}`;

const BOSS_HEALTH_QUERY = `
query FightGraphBossHealth($code: String!, $start: Float!, $end: Float!, $bossId: Int!) {
  reportData {
    report(code: $code) {
      graph(dataType: Resources, startTime: $start, endTime: $end, sourceID: $bossId, abilityID: 1000, hostilityType: Enemies)
      events(
        dataType: DamageTaken
        hostilityType: Enemies
        sourceID: $bossId
        startTime: $start
        endTime: $end
        includeResources: true
        limit: 20
      ) { data }
    }
  }
}`;

const DATA_QUERY = `
query FightGraphData($code: String!, $start: Float!, $end: Float!, $sourceId: Int!, $castFilter: String!) {
  reportData {
    report(code: $code) {
      graph(dataType: DamageDone, startTime: $start, endTime: $end, sourceID: $sourceId)
      events(
        dataType: Casts
        startTime: $start
        endTime: $end
        sourceID: $sourceId
        filterExpression: $castFilter
        useAbilityIDs: false
        limit: 10000
      ) { data }
      table(dataType: Buffs, startTime: $start, endTime: $end, sourceID: $sourceId)
    }
  }
}`;

/* Tolerant shapes for WCL's untyped JSON blobs. */
const overviewSchema = z.looseObject({
  reportData: z.looseObject({
    report: z
      .looseObject({
        masterData: z
          .looseObject({
            actors: z
              .array(
                z.looseObject({
                  id: z.number(),
                  name: z.string(),
                  type: z.string().optional(),
                  subType: z.string().optional(),
                }),
              )
              .nullish(),
            abilities: z
              .array(z.looseObject({ gameID: z.number().optional(), name: z.string().optional() }))
              .nullish(),
          })
          .nullish(),
        fights: z
          .array(
            z.looseObject({
              id: z.number(),
              name: z.string().optional(),
              kill: z.boolean().nullish(),
              startTime: z.number(),
              endTime: z.number(),
              enemyNPCs: z.array(z.looseObject({ id: z.number() })).nullish(),
            }),
          )
          .nullish(),
      })
      .nullish(),
  }),
});

const graphSchema = z.looseObject({
  series: z
    .array(
      z.looseObject({
        name: z.string().optional(),
        pointStart: z.number().optional(),
        pointInterval: z.number().optional(),
        data: z.array(z.unknown()).optional(),
      }),
    )
    .optional(),
});

const castEventSchema = z.looseObject({
  timestamp: z.number(),
  type: z.string(),
  abilityGameID: z.number().optional(),
  ability: z.looseObject({ name: z.string().optional(), guid: z.number().optional() }).nullish(),
});

const buffsTableSchema = z.looseObject({
  auras: z
    .array(
      z.looseObject({
        name: z.string(),
        guid: z.number().optional(),
        totalUptime: z.number().optional(),
        totalUses: z.number().optional(),
        bands: z.array(z.looseObject({ startTime: z.number(), endTime: z.number() })).nullish(),
      }),
    )
    .nullish(),
});

/** Incoming heals/absorbs — real buff windows, but noise on a damage graph. */
const EXCLUDED_BUFFS = new Set([
  "Renew",
  "Rejuvenation",
  "Regrowth",
  "Lifebloom",
  "Prayer of Mending",
  "Inspiration",
  "Thorns",
  "Power Word: Shield",
  "Earth Shield",
  "Blessing of Protection",
  "Blessing of Sacrifice",
]);

/**
 * Static one-cast raid buffs and toggles — a flat 100% band that explains
 * nothing about a damage window. Flickering party auras (Leader of the Pack,
 * Ferocious Inspiration, totem buffs) deliberately stay in, whatever their
 * uptime — gaps in those ARE the story.
 */
const STATIC_BUFF_PATTERNS: (string | RegExp)[] = [
  /^greater blessing of /i,
  /^blessing of (might|wisdom|kings|light|salvation|sanctuary)/i,
  /^prayer of /i,
  "power word: fortitude",
  "divine spirit",
  "arcane intellect",
  "arcane brilliance",
  "mark of the wild",
  "gift of the wild",
  "shadow protection",
  /stance$/i,
  /aspect of the /i,
];

function isStaticBuff(name: string): boolean {
  const lower = name.toLowerCase();
  return STATIC_BUFF_PATTERNS.some((p) => (typeof p === "string" ? lower === p : p.test(name)));
}

/**
 * Fight graphs are historical (a logged fight never changes), so views cache
 * forever in-process, bounded FIFO. Repeat views — flipping between fights or
 * several officers reading the same pull — cost zero WCL calls.
 */
const CACHE_MAX = 300;
const globalCache = globalThis as unknown as {
  __projectlcFightGraphCache?: Map<string, FightGraphView>;
  __projectlcFightOverviewCache?: Map<string, z.infer<typeof overviewSchema>>;
};
function cacheOf(): Map<string, FightGraphView> {
  return (globalCache.__projectlcFightGraphCache ??= new Map());
}

/**
 * The overview (actor list + fight times) is identical for every player and
 * fight in a report, and reports are immutable once logged — so one fetch per
 * report serves every instance, saving a whole WCL round trip on each
 * subsequent graph in the same raid.
 */
async function fetchOverview(code: string): Promise<z.infer<typeof overviewSchema>> {
  const cache = (globalCache.__projectlcFightOverviewCache ??= new Map());
  const cached = cache.get(code);
  if (cached) return cached;
  const overview = overviewSchema.parse(await wclQuery<unknown>(OVERVIEW_QUERY, { code }));

  /*
   * Refuse to cache a report that came back without fights.
   *
   * Every field here is nullish, because WCL's shape varies — which means a
   * degraded response (`report: null`, an empty fight list under load) PARSES,
   * and used to be cached forever. Every later lookup then reported "Fight 63
   * was not found in report X" about a fight that plainly exists, and stayed
   * wrong until the server restarted. A failed fetch has to look like a failed
   * fetch, not like missing data.
   */
  const fights = overview.reportData.report?.fights;
  if (!fights || fights.length === 0) {
    throw new WclError(
      `Warcraft Logs returned no fights for report ${code} — it may be rate-limiting or still processing. Try again in a moment.`,
    );
  }

  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(code, overview);
  return overview;
}

/**
 * Every ability named anywhere in a report: spell id → name.
 *
 * A simulation reports spell ids and this app reports names, so comparing the
 * two needs a dictionary. The report already carries one — over a thousand
 * entries for a raid night — and it rides on the overview fetch that's cached
 * per report, so it costs nothing extra. An id the report never saw stays
 * unnamed rather than being guessed at.
 */
export async function fetchReportAbilities(code: string): Promise<Record<number, string>> {
  const overview = await fetchOverview(code);
  const out: Record<number, string> = {};
  for (const ability of overview.reportData.report?.masterData?.abilities ?? []) {
    if (ability.gameID !== undefined && ability.name) out[ability.gameID] ??= ability.name;
  }
  return out;
}

/** One pull and one player inside it, resolved against the cached overview. */
export interface ResolvedFightActor {
  fightStart: number;
  fightEnd: number;
  durationMs: number;
  actorId: number;
  encounterName: string;
  kill: boolean;
}

/**
 * Locate a (pull, player) pair in a report. Shared with the rotation fetch so
 * both features pay for the overview once per report rather than once each.
 */
export async function resolveFightActor(
  code: string,
  fightId: number,
  actorName: string,
): Promise<ResolvedFightActor> {
  const overview = await fetchOverview(code);
  const report = overview.reportData.report;
  const fight = (report?.fights ?? []).find((f) => f.id === fightId);
  // Reached only when the report really has no such fight: an incomplete
  // fetch is rejected in fetchOverview rather than reaching here.
  if (!fight)
    throw new WclError(
      `Fight ${fightId} is not in report ${code} any more — the log was probably re-uploaded, which renumbers its fights. Refetch the report.`,
    );
  const actor = (report?.masterData?.actors ?? []).find(
    (a) => (a.type === undefined || a.type === "Player") && a.name.toLowerCase() === actorName.toLowerCase(),
  );
  if (!actor) throw new WclError(`"${actorName}" is not in this report's player list.`);
  return {
    fightStart: fight.startTime,
    fightEnd: fight.endTime,
    durationMs: Math.max(1, fight.endTime - fight.startTime),
    actorId: actor.id,
    encounterName: fight.name ?? `Fight ${fightId}`,
    kill: fight.kill === true,
  };
}

export async function fetchFightGraph(code: string, fightId: number, actorName: string): Promise<FightGraphView> {
  const cacheKey = `${code}|${fightId}|${actorName.toLowerCase()}`;
  const cache = cacheOf();
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const overview = await fetchOverview(code);
  const report = overview.reportData.report;
  const fight = (report?.fights ?? []).find((f) => f.id === fightId);
  // Reached only when the report really has no such fight: an incomplete
  // fetch is rejected in fetchOverview rather than reaching here.
  if (!fight)
    throw new WclError(
      `Fight ${fightId} is not in report ${code} any more — the log was probably re-uploaded, which renumbers its fights. Refetch the report.`,
    );
  const actors = report?.masterData?.actors ?? [];
  const actor = actors.find((a) => (a.type === undefined || a.type === "Player") && a.name.toLowerCase() === actorName.toLowerCase());
  if (!actor) throw new WclError(`"${actorName}" is not in this report's player list.`);

  // The encounter boss among this fight's enemies: prefer the one named like
  // the fight, else the first WCL marks subType "Boss".
  const enemyIds = new Set((fight.enemyNPCs ?? []).map((e) => e.id));
  const bossActors = actors.filter((a) => enemyIds.has(a.id) && a.subType === "Boss");
  const boss = bossActors.find((a) => a.name === fight.name) ?? bossActors[0];

  const durationMs = Math.max(1, fight.endTime - fight.startTime);
  const quoted = (names: string[]) => names.map((n) => `"${n}"`).join(", ");
  const castFilter = `ability.id IN (${[...TRACKED_CAST_IDS, ...COOLDOWN_CAST_IDS].join(", ")}) OR ability.name IN (${quoted(SAPPER_CAST_NAMES)})`;

  const [dataRaw, bossRaw] = await Promise.all([
    wclQuery<{
      reportData?: { report?: { graph?: unknown; events?: { data?: unknown[] | null } | null; table?: unknown } | null } | null;
    }>(DATA_QUERY, { code, start: fight.startTime, end: fight.endTime, sourceId: actor.id, castFilter }),
    boss
      ? wclQuery<{
          reportData?: { report?: { graph?: unknown; events?: { data?: unknown[] | null } | null } | null } | null;
        }>(BOSS_HEALTH_QUERY, {
          code,
          start: fight.startTime,
          end: fight.endTime,
          bossId: boss.id,
        }).catch(() => undefined) // health strip is optional garnish — never fail the graph over it
      : Promise.resolve(undefined),
  ]);
  const reportBlob = dataRaw.reportData?.report;

  /* DPS series: the "Total" series, values are per-second rates per bucket. */
  const graphBlob = (reportBlob?.graph ?? {}) as { data?: unknown };
  const graph = graphSchema.parse(graphBlob.data ?? graphBlob);
  const total =
    (graph.series ?? []).find((s) => s.name === "Total") ??
    (graph.series ?? []).find((s) => (s.data ?? []).length > 0);
  const dps = (total?.data ?? []).map((v) => (typeof v === "number" && Number.isFinite(v) ? v : 0));
  const bucketMs = total?.pointInterval && total.pointInterval > 0 ? total.pointInterval : durationMs / Math.max(1, dps.length);

  /* Cooldown + consumable casts, as fight-relative moments. */
  const casts: FightGraphCast[] = [];
  for (const rawEvent of reportBlob?.events?.data ?? []) {
    const parsed = castEventSchema.safeParse(rawEvent);
    if (!parsed.success || parsed.data.type === "begincast") continue;
    const event = parsed.data;
    const abilityId = event.ability?.guid ?? event.abilityGameID;
    const t = Math.min(Math.max(event.timestamp - fight.startTime, 0), durationMs);
    const cooldown = abilityId !== undefined ? COOLDOWN_BY_ID.get(abilityId) : undefined;
    if (cooldown) {
      casts.push({ t, name: cooldown.name, kind: "cooldown" });
      continue;
    }
    const hit = classifyCast(abilityId, event.ability?.name);
    if (hit) casts.push({ t, name: hit.name, kind: "consumable" });
  }
  casts.sort((a, b) => a.t - b.t);

  /* Buff windows gained by the player (procs, trinkets, CDs, externals). */
  const tableBlob = (reportBlob?.table ?? {}) as { data?: unknown };
  const buffsTable = buffsTableSchema.parse(tableBlob.data ?? tableBlob);
  const buffs: FightGraphBuff[] = (buffsTable.auras ?? [])
    // Filter by NATURE, not by uptime: consumable prep auras (flask, food,
    // scrolls, potion buffs — the classifier knows them), static raid buffs
    // and toggles, and incoming heals go; every remaining aura stays at any
    // uptime — a 97% Leader of the Pack with 17 gaps is exactly the point.
    .filter(
      (aura) =>
        !EXCLUDED_BUFFS.has(aura.name) &&
        !isStaticBuff(aura.name) &&
        classifyAura(aura.name, aura.guid) === undefined,
    )
    .map((aura) => {
      const segments: [number, number][] = (aura.bands ?? []).map((b) => [
        Math.max(0, b.startTime - fight.startTime),
        Math.min(durationMs, b.endTime - fight.startTime),
      ]);
      const upMs = aura.totalUptime ?? segments.reduce((s, [a, b]) => s + (b - a), 0);
      return {
        name: aura.name,
        pct: Math.round(Math.min(100, (upMs / durationMs) * 100)),
        uses: aura.totalUses ?? segments.length,
        segments,
      };
    })
    .filter((b) => b.segments.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 24);

  /* Boss health %: Resources graph, series data is [timestamp, pct] pairs.
   * Max HP is constant, so a handful of damage events (includeResources)
   * riding the same request yields the absolute scale for free. */
  let bossHealth: [number, number][] | undefined;
  let bossMaxHp: number | undefined;
  if (bossRaw) {
    for (const rawEvent of bossRaw.reportData?.report?.events?.data ?? []) {
      const maxHp = (rawEvent as { maxHitPoints?: unknown }).maxHitPoints;
      if (typeof maxHp === "number" && maxHp > 0) {
        bossMaxHp = maxHp;
        break;
      }
    }
    const bossGraphBlob = (bossRaw.reportData?.report?.graph ?? {}) as { data?: unknown };
    const bossGraph = graphSchema.parse(bossGraphBlob.data ?? bossGraphBlob);
    const points = (bossGraph.series?.[0]?.data ?? []).flatMap((p): [number, number][] => {
      if (!Array.isArray(p) || p.length < 2) return [];
      const [ts, pct] = p;
      if (typeof ts !== "number" || typeof pct !== "number") return [];
      return [[Math.min(Math.max(ts - fight.startTime, 0), durationMs), Math.min(100, Math.max(0, pct))]];
    });
    if (points.length > 1) bossHealth = points;
  }

  const view: FightGraphView = {
    encounterName: fight.name ?? `Fight ${fightId}`,
    kill: fight.kill === true,
    durationMs,
    bucketMs,
    dps,
    casts,
    buffs,
    bossHealth,
    bossName: bossHealth ? boss?.name : undefined,
    bossMaxHp: bossHealth ? bossMaxHp : undefined,
  };
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(cacheKey, view);
  return view;
}
