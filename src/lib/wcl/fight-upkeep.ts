import { z } from "zod";
import { wclQuery } from "@/lib/wcl/client";
import { resolveFightActor } from "@/lib/wcl/fight-graph";

import { compareText } from "@/lib/sort";

/**
 * Who kept which debuff on the boss during one pull, fetched live.
 *
 * The import path only asks Warcraft Logs for the curated track list, so a
 * debuff added to that list is invisible in every report fetched before it —
 * see docs/change-chains.md §1. This asks for whatever it's given, for one
 * pull, at the moment somebody looks. That means a new question can be answered
 * about raid nights from months ago **without a refetch**, which is the same
 * bargain fight-casts.ts makes and for the same reason.
 *
 * Nothing here is persisted. A logged fight never changes, so the in-process
 * cache is valid forever.
 */

const QUERY = `
query FightUpkeep($code: String!, $fight: Int!, $filter: String!) {
  reportData {
    report(code: $code) {
      fights(fightIDs: [$fight]) { startTime endTime }
      masterData { actors { id name type subType } }
      events(
        dataType: Debuffs
        startTime: 0
        endTime: 99999999999
        fightIDs: [$fight]
        hostilityType: Enemies
        useAbilityIDs: false
        filterExpression: $filter
        limit: 10000
      ) { data }
    }
  }
}`;

const actorSchema = z.looseObject({
  id: z.number(),
  name: z.string(),
  type: z.string().optional(),
  subType: z.string().optional(),
});

const eventSchema = z.looseObject({
  timestamp: z.number(),
  type: z.string(),
  sourceID: z.number().optional(),
  targetID: z.number().optional(),
  targetInstance: z.number().optional(),
  ability: z.looseObject({ name: z.string().optional() }).nullish(),
});

const responseSchema = z.looseObject({
  reportData: z.looseObject({
    report: z.looseObject({
      fights: z.array(z.looseObject({ startTime: z.number(), endTime: z.number() })),
      masterData: z.looseObject({ actors: z.array(actorSchema) }),
      events: z.looseObject({ data: z.array(z.unknown()).nullish() }),
    }),
  }),
});

/** One player's best uptime for one debuff, on the enemy they held it on longest. */
export interface DebuffUpkeep {
  /** Player who applied it. */
  source: string;
  ability: string;
  /** Percent of the pull, on their best target (≈ the boss). */
  pct: number;
}

const CACHE_MAX = 200;
const globalCache = globalThis as unknown as { __projectlcFightUpkeepCache?: Map<string, DebuffUpkeep[]> };
function cacheOf(): Map<string, DebuffUpkeep[]> {
  return (globalCache.__projectlcFightUpkeepCache ??= new Map());
}

export async function fetchFightDebuffUptime(
  code: string,
  fightId: number,
  abilityNames: string[],
): Promise<DebuffUpkeep[]> {
  if (abilityNames.length === 0) return [];
  const key = `${code}|${fightId}|${[...abilityNames].sort().join(",")}`;
  const cache = cacheOf();
  const cached = cache.get(key);
  if (cached) return cached;

  // Double quotes, not single: WCL's filter language matches NOTHING for a
  // single-quoted string and reports no error, so the wrong quote reads as
  // "the raid never did this".
  const filter = `ability.name IN (${abilityNames.map((n) => `"${n}"`).join(", ")})`;
  const parsed = responseSchema.parse(await wclQuery(QUERY, { code, fight: fightId, filter }));
  const report = parsed.reportData.report;
  const fight = report.fights[0];
  if (!fight) return [];
  const durationMs = Math.max(1, fight.endTime - fight.startTime);
  const actorById = new Map(report.masterData.actors.map((a) => [a.id, a]));

  /*
   * Same interval rules the import uses: an apply/refresh opens a window, a
   * remove closes it, a remove with nothing open means the aura predates our
   * first event, and whatever is still open at the end runs to the end.
   */
  interface Acc { open?: number; total: number }
  const accs = new Map<string, Acc>();
  for (const raw of report.events.data ?? []) {
    const e = eventSchema.safeParse(raw);
    if (!e.success) continue;
    const { sourceID, targetID, ability, type, timestamp } = e.data;
    if (sourceID === undefined || targetID === undefined) continue;
    const source = actorById.get(sourceID);
    const target = actorById.get(targetID);
    const name = ability?.name;
    // Players only: many NPCs have an ability sharing a player ability's name.
    if (!name || source?.type !== "Player" || target?.type === "Player") continue;

    const at = Math.min(Math.max(timestamp, fight.startTime), fight.endTime);
    const acc = accs.get(`${source.name}|${name}|${targetID}|${e.data.targetInstance ?? 0}`) ?? { total: 0 };
    if (type.startsWith("remove")) {
      if (acc.open !== undefined) {
        acc.total += at - acc.open;
        acc.open = undefined;
      } else if (acc.total === 0) {
        acc.total = at - fight.startTime;
      }
    } else if (type.startsWith("apply") || type.startsWith("refresh")) {
      acc.open ??= at;
    }
    accs.set(`${source.name}|${name}|${targetID}|${e.data.targetInstance ?? 0}`, acc);
  }

  const best = new Map<string, DebuffUpkeep>();
  for (const [key2, acc] of accs) {
    const total = acc.total + (acc.open !== undefined ? fight.endTime - acc.open : 0);
    const [source, ability] = key2.split("|");
    const pct = Math.round(Math.min(100, (total / durationMs) * 100));
    const hit = best.get(`${source}|${ability}`);
    // Best single target, not the sum: an add held for ten seconds must never
    // add to what was kept on the boss.
    if (!hit || hit.pct < pct) best.set(`${source}|${ability}`, { source, ability, pct });
  }

  const out = [...best.values()].sort((a, b) => b.pct - a.pct || compareText(a.source, b.source));
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, out);
  return out;
}

const BUFF_TABLE_QUERY = `
query FightBuffs($code: String!, $start: Float!, $end: Float!, $sourceId: Int!) {
  reportData {
    report(code: $code) {
      table(dataType: Buffs, startTime: $start, endTime: $end, sourceID: $sourceId)
    }
  }
}`;

const buffTableSchema = z.looseObject({
  reportData: z.looseObject({
    report: z
      .looseObject({
        table: z
          .looseObject({
            data: z
              .looseObject({
                auras: z
                  .array(
                    z.looseObject({
                      name: z.string(),
                      totalUptime: z.number().optional(),
                      totalUses: z.number().optional(),
                    }),
                  )
                  .nullish(),
              })
              .nullish(),
          })
          .nullish(),
      })
      .nullish(),
  }),
});

/** One aura the player carried during a pull. */
export interface PlayerAura {
  /** Percent of the pull it was up. */
  pct: number;
  /** Times gained. */
  uses: number;
}

const globalBuffCache = globalThis as unknown as {
  __projectlcPlayerAuraCache?: Map<string, Record<string, PlayerAura>>;
};

/**
 * Every buff one player actually had during a pull, by aura name.
 *
 * This answers what the stored upkeep tracks cannot: the curated track list
 * covers auras raiders are RESPONSIBLE for, so a blessing or a drum landing on
 * someone is nowhere in it, and the audit had to report a dozen of the sim's
 * assumptions as "not tracked by this app". Warcraft Logs has all of it — the
 * buff table lists every aura on the player with its uptime — and one query per
 * pull turns those into real answers.
 *
 * Live, so it works on every already-imported report. No refetch.
 */
export async function fetchPlayerAuras(
  code: string,
  fightId: number,
  actorName: string,
): Promise<Record<string, PlayerAura>> {
  const key = `${code}|${fightId}|${actorName.toLowerCase()}`;
  const cache = (globalBuffCache.__projectlcPlayerAuraCache ??= new Map());
  const cached = cache.get(key);
  if (cached) return cached;

  const at = await resolveFightActor(code, fightId, actorName);
  const parsed = buffTableSchema.parse(
    await wclQuery(BUFF_TABLE_QUERY, {
      code,
      start: at.fightStart,
      end: at.fightEnd,
      sourceId: at.actorId,
    }),
  );

  const out: Record<string, PlayerAura> = {};
  for (const aura of parsed.reportData.report?.table?.data?.auras ?? []) {
    const pct = Math.round(Math.min(100, ((aura.totalUptime ?? 0) / at.durationMs) * 100));
    const hit = out[aura.name];
    // Ranks share a name; keep the best window rather than summing overlaps.
    if (!hit || hit.pct < pct) out[aura.name] = { pct, uses: aura.totalUses ?? 0 };
  }

  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, out);
  return out;
}
