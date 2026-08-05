import { z } from "zod";
import { wclQuery } from "@/lib/wcl/client";
import { resolveFightActor } from "@/lib/wcl/fight-graph";
import type { CastEvent } from "@/lib/analysis/rotation";

/**
 * Every cast one player made during one pull — the rotation itself, which is
 * what a sim comparison is actually about.
 *
 * The import path deliberately filters casts to a curated id list, so stored
 * rows carry cooldowns and consumables and nothing else. This fetch is
 * unfiltered and runs live, the way the fight graph does, which means it works
 * on reports imported long before this feature existed. **No re-import.**
 *
 * Nothing here is persisted. A logged fight never changes, so the in-process
 * cache is valid forever.
 */

export interface FightCasts {
  encounterName: string;
  kill: boolean;
  durationMs: number;
  /** Every cast, fight-relative, in order. */
  casts: CastEvent[];
  /**
   * Spell id → ability name, harvested from this pull's own events.
   *
   * A simulation reports spell ids and Warcraft Logs reports names, so a
   * comparison needs a dictionary between them. The log carries both on every
   * cast, which means the pull being compared against supplies exactly the
   * names that comparison needs — no curated spell table to maintain, and no
   * guessing at labels the way a hand-written list would.
   */
  spellNames: Record<number, string>;
  /**
   * Damage done per ability over the pull, by ability NAME.
   *
   * Keyed by name rather than id deliberately: WCL's damage table reports a
   * different Execute rank (20647) than its own cast stream does, so joining on
   * ids would drop the row. The name is what both sides agree on, and it's what
   * the comparison already keys abilities by.
   */
  damageByName: Record<string, number>;
  /**
   * When each ability LANDED, fight-relative ms, for abilities the cast stream
   * doesn't carry. Execute produces no cast events at all, so without this it
   * had a row in the table and not one mark on the timeline.
   */
  damageTimes: Record<string, number[]>;
  /** Every hit in order — the raw material for the event log. */
  damageEvents: { tMs: number; name: string; amount: number }[];
  /**
   * Landed hits per ability, from the same table.
   *
   * Needed because Warcraft Logs does not emit a `cast` event for every
   * ability: on a real pull Execute did 35k damage over 17 hits and produced
   * ZERO cast events, so a cast-only view reported "never pressed" about an
   * ability the raider used all through execute range. Where the casts are
   * missing, hits are the honest stand-in.
   */
  hitsByName: Record<string, number>;
  /**
   * Time from the first cast to the last. A pull's wall-clock length includes
   * whatever the raid spent not attacking; this is the window the player was
   * actually working in, and it's the honest denominator on a fight with
   * phases. Equals durationMs on a patchwerk.
   */
  activeMs: number;
}

const CASTS_QUERY = `
query FightCasts($code: String!, $start: Float!, $end: Float!, $sourceId: Int!) {
  reportData {
    report(code: $code) {
      events(
        dataType: Casts
        startTime: $start
        endTime: $end
        sourceID: $sourceId
        useAbilityIDs: false
        limit: 10000
      ) { data nextPageTimestamp }
    }
  }
}`;

const DAMAGE_QUERY = `
query FightDamage($code: String!, $start: Float!, $end: Float!, $sourceId: Int!) {
  reportData {
    report(code: $code) {
      table(dataType: DamageDone, startTime: $start, endTime: $end, sourceID: $sourceId)
    }
  }
}`;

const DAMAGE_EVENTS_QUERY = `
query FightDamageEvents($code: String!, $start: Float!, $end: Float!, $sourceId: Int!) {
  reportData {
    report(code: $code) {
      events(
        dataType: DamageDone
        startTime: $start
        endTime: $end
        sourceID: $sourceId
        useAbilityIDs: false
        limit: 10000
      ) { data nextPageTimestamp }
    }
  }
}`;

const damageEventSchema = z.looseObject({
  timestamp: z.number(),
  amount: z.number().optional(),
  ability: z.looseObject({ name: z.string().optional() }).nullish(),
});

const damageTableSchema = z.looseObject({
  reportData: z.looseObject({
    report: z
      .looseObject({
        table: z
          .looseObject({
            data: z
              .looseObject({
                entries: z
                  .array(
                    z.looseObject({
                      name: z.string().optional(),
                      total: z.number().optional(),
                      hitCount: z.number().optional(),
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

const castEventSchema = z.looseObject({
  timestamp: z.number(),
  type: z.string(),
  ability: z.looseObject({ name: z.string().optional(), guid: z.number().optional() }).nullish(),
});

interface CastsResponse {
  reportData?: {
    report?: { events?: { data?: unknown[] | null; nextPageTimestamp?: number | null } | null } | null;
  } | null;
}

const CACHE_MAX = 200;
const globalCache = globalThis as unknown as { __projectlcFightCastsCache?: Map<string, FightCasts> };
function cacheOf(): Map<string, FightCasts> {
  return (globalCache.__projectlcFightCastsCache ??= new Map());
}

export async function fetchFightCasts(
  code: string,
  fightId: number,
  actorName: string,
): Promise<FightCasts> {
  const cacheKey = `${code}|${fightId}|${actorName.toLowerCase()}`;
  const cache = cacheOf();
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const at = await resolveFightActor(code, fightId, actorName);

  /*
   * Damage per ability, alongside the casts.
   *
   * Cast counts alone rank a rotation by button presses, which flatters
   * whatever is spammed — 27 Heroic Strikes over 8 Bloodthirsts, when the
   * Bloodthirsts hit far harder each. Same fight, same actor, so it rides on
   * the same resolve and the same cache entry.
   */
  const damagePromise = wclQuery<unknown>(DAMAGE_QUERY, {
    code,
    start: at.fightStart,
    end: at.fightEnd,
    sourceId: at.actorId,
  })
    .then((raw) => damageTableSchema.parse(raw))
    .catch(() => undefined);

  /*
   * Damage EVENTS as well as the table: the table says Execute did 35k, and
   * only the events say when. Abilities the cast stream does carry are read
   * from casts — a Bloodthirst that hits three times is one decision.
   */
  const damageEventsPromise = (async () => {
    const rows: unknown[] = [];
    let cursor = at.fightStart;
    for (let page = 0; page < 6; page++) {
      const res = await wclQuery<CastsResponse>(DAMAGE_EVENTS_QUERY, {
        code,
        start: cursor,
        end: at.fightEnd,
        sourceId: at.actorId,
      });
      const events = res.reportData?.report?.events;
      rows.push(...(events?.data ?? []));
      if (events?.nextPageTimestamp === null || events?.nextPageTimestamp === undefined) break;
      cursor = events.nextPageTimestamp;
    }
    return rows;
  })().catch(() => [] as unknown[]);

  const raw: unknown[] = [];
  let cursor = at.fightStart;
  for (let page = 0; page < 10; page++) {
    const res = await wclQuery<CastsResponse>(CASTS_QUERY, {
      code,
      start: cursor,
      end: at.fightEnd,
      sourceId: at.actorId,
    });
    const events = res.reportData?.report?.events;
    raw.push(...(events?.data ?? []));
    if (events?.nextPageTimestamp === null || events?.nextPageTimestamp === undefined) break;
    cursor = events.nextPageTimestamp;
  }

  const casts: CastEvent[] = [];
  const spellNames: Record<number, string> = {};
  for (const rawEvent of raw) {
    const parsed = castEventSchema.safeParse(rawEvent);
    if (!parsed.success) continue;
    const event = parsed.data;
    // "begincast" pairs with the "cast" that follows; counting both would
    // double every ability with a cast time.
    if (event.type !== "cast") continue;
    const name = event.ability?.name;
    if (!name) continue;
    const abilityId = event.ability?.guid;
    if (abilityId !== undefined && spellNames[abilityId] === undefined) spellNames[abilityId] = name;
    casts.push({
      tMs: Math.min(Math.max(event.timestamp - at.fightStart, 0), at.durationMs),
      name,
      abilityId,
    });
  }
  casts.sort((a, b) => a.tMs - b.tMs);

  const damageByName: Record<string, number> = {};
  const hitsByName: Record<string, number> = {};
  for (const entry of (await damagePromise)?.reportData?.report?.table?.data?.entries ?? []) {
    if (!entry.name) continue;
    /*
     * "Whirlwind Off-Hand" is the off-hand half of one Whirlwind. The sim
     * reports both halves under the ability itself, so leaving them apart puts
     * a third of the damage on a row the sim will never have.
     */
    const name = entry.name.replace(/ (Off-Hand|Off Hand)$/i, "");
    if (entry.total) damageByName[name] = (damageByName[name] ?? 0) + entry.total;
    if (entry.hitCount) hitsByName[name] = (hitsByName[name] ?? 0) + entry.hitCount;
  }

  const damageTimes: Record<string, number[]> = {};
  const damageEvents: { tMs: number; name: string; amount: number }[] = [];
  for (const rawEvent of await damageEventsPromise) {
    const parsed = damageEventSchema.safeParse(rawEvent);
    if (!parsed.success) continue;
    const name = parsed.data.ability?.name?.replace(/ (Off-Hand|Off Hand)$/i, "");
    if (!name) continue;
    const tMs = Math.min(Math.max(parsed.data.timestamp - at.fightStart, 0), at.durationMs);
    (damageTimes[name] ??= []).push(tMs);
    damageEvents.push({ tMs, name, amount: parsed.data.amount ?? 0 });
  }
  damageEvents.sort((x, y) => x.tMs - y.tMs);
  for (const times of Object.values(damageTimes)) times.sort((x, y) => x - y);

  const view: FightCasts = {
    encounterName: at.encounterName,
    kill: at.kill,
    durationMs: at.durationMs,
    casts,
    spellNames,
    damageByName,
    damageTimes,
    damageEvents,
    hitsByName,
    activeMs: casts.length > 1 ? casts[casts.length - 1].tMs - casts[0].tMs : at.durationMs,
  };
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(cacheKey, view);
  return view;
}
