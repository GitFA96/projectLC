import { z } from "zod";
import {
  ENCHANTABLE_GEAR_SLOTS,
  WEAPON_GEAR_SLOTS,
  classifyAura,
  classifyCast,
  isNonConsumableAura,
} from "@/lib/wcl/consumables";
import {
  COOLDOWN_BY_ID,
  UPTIME_TRACK_BY_NAME,
  trackLabel,
  type UptimeTrack,
} from "@/lib/wcl/class-tracks";

/**
 * Pure normalization of raw Warcraft Logs v2 responses into the rows we
 * persist. Everything raw is parsed through loose zod schemas: WCL's JSON
 * blobs (rankings, events) aren't covered by the GraphQL schema, so unknown
 * extra fields must never break an import — missing expected fields degrade
 * to "metric unavailable" instead of failing.
 */

/* Raw shapes (tolerant) */

const rawActorSchema = z.looseObject({
  id: z.number(),
  name: z.string(),
  subType: z.string().optional(),
});

const rawFightSchema = z.looseObject({
  id: z.number(),
  encounterID: z.number().optional(),
  name: z.string().optional(),
  kill: z.boolean().nullish(),
  fightPercentage: z.number().nullish(),
  startTime: z.number(),
  endTime: z.number(),
});

const rawRankingCharacterSchema = z.looseObject({
  name: z.string(),
  class: z.string().optional(),
  spec: z.string().optional(),
  amount: z.number().optional(),
  rankPercent: z.number().nullish(),
  bracketPercent: z.number().nullish(),
});

const rawRankingRoleSchema = z.looseObject({
  characters: z.array(rawRankingCharacterSchema).optional(),
});

const rawRankingFightSchema = z.looseObject({
  fightID: z.number(),
  roles: z
    .looseObject({
      tanks: rawRankingRoleSchema.optional(),
      healers: rawRankingRoleSchema.optional(),
      dps: rawRankingRoleSchema.optional(),
    })
    .optional(),
});

const rawRankingsSchema = z.looseObject({
  data: z.array(rawRankingFightSchema).optional(),
});

export const rawReportSchema = z.looseObject({
  title: z.string().optional(),
  startTime: z.number(),
  endTime: z.number(),
  zone: z.looseObject({ name: z.string().optional() }).nullish(),
  masterData: z
    .looseObject({ actors: z.array(rawActorSchema).nullish() })
    .nullish(),
  fights: z.array(rawFightSchema).nullish(),
  dps: rawRankingsSchema.nullish(),
  hps: rawRankingsSchema.nullish(),
});
export type RawReport = z.infer<typeof rawReportSchema>;

/** Ability refs appear inline ({name, guid}) or as a bare abilityGameID. */
const rawAbilitySchema = z.looseObject({
  name: z.string().optional(),
  guid: z.number().optional(),
});

const rawGearItemSchema = z.looseObject({
  id: z.number().optional(),
  itemLevel: z.number().nullish(),
  permanentEnchant: z.number().nullish(),
  temporaryEnchant: z.number().nullish(),
  gems: z.array(z.looseObject({ id: z.number().optional() })).nullish(),
  name: z.string().nullish(),
  icon: z.string().nullish(),
});

const rawCombatantInfoEventSchema = z.looseObject({
  timestamp: z.number(),
  type: z.string(),
  /** WCL's own fight index — preferred over timestamp windows when present. */
  fight: z.number().optional(),
  sourceID: z.number().optional(),
  gear: z.array(rawGearItemSchema).nullish(),
  auras: z
    .array(z.looseObject({ name: z.string().optional(), ability: z.number().optional() }))
    .nullish(),
});

const rawCastEventSchema = z.looseObject({
  timestamp: z.number(),
  type: z.string(),
  fight: z.number().optional(),
  sourceID: z.number().optional(),
  abilityGameID: z.number().optional(),
  ability: rawAbilitySchema.nullish(),
});

const rawDeathEventSchema = z.looseObject({
  timestamp: z.number(),
  type: z.string().optional(),
  fight: z.number().optional(),
  targetID: z.number().optional(),
});

/** Buff/debuff apply/refresh/remove events feeding the upkeep computation. */
const rawAuraEventSchema = z.looseObject({
  timestamp: z.number(),
  type: z.string(),
  fight: z.number().optional(),
  sourceID: z.number().optional(),
  targetID: z.number().optional(),
  abilityGameID: z.number().optional(),
  ability: rawAbilitySchema.nullish(),
});

export const rawEventsSchema = z.array(z.unknown());

/* Normalized output */

export type WclRole = "tank" | "healer" | "dps";

/** One player × one boss pull, before roster matching / persistence identity. */
export interface NormalizedPlayerFight {
  fightId: number;
  encounterId: number;
  encounterName: string;
  kill: boolean;
  fightPercentage?: number;
  durationMs: number;
  actorName: string;
  className?: string;
  spec?: string;
  role: WclRole;
  parsePercent?: number;
  bracketPercent?: number;
  amount?: number;
  deaths: number;
  flask?: string;
  elixirs: string[];
  scrolls: string[];
  food: boolean;
  weaponBuff: boolean;
  prepot: boolean;
  potions: string[];
  /** Non-potion in-fight consumable casts (healthstones, runes, gems, seeds, drums). */
  otherCasts: string[];
  /** Off-slot consumable buffs at pull (alcohol, Bogling Root, …). */
  extras: string[];
  /** Major class cooldowns cast during the pull, one entry per use. */
  cooldowns: string[];
  /** Maintained debuff/buff uptimes, % of the pull, best target. */
  upkeep: { name: string; pct: number }[];
  /** Full worn-gear snapshot at the pull. */
  gear: NormalizedGearItem[];
  drums: number;
  runes: number;
  healthstones: number;
  sappers: number;
  missingEnchants: string[];
}

/** One worn item, slimmed for persistence (slot = WCL gear-array index). */
export interface NormalizedGearItem {
  slot: number;
  id: number;
  ilvl?: number;
  enchant?: number;
  temp?: number;
  gems: number[];
  name?: string;
  icon?: string;
}

/** One skipped combatant-info event, for the "inspect ignored" panel. */
export interface IgnoredCombatantInfo {
  player: string;
  /** ms into the report. */
  atMs: number;
  /** The consumable-relevant auras the event carried (capped). */
  auras: string[];
}

/** An aura at a boss pull the consumable tables don't recognize. */
export interface UnclassifiedAura {
  name: string;
  abilityId?: number;
  /** Player×pull occurrences across the report. */
  count: number;
}

export interface NormalizedReport {
  title: string;
  zone?: string;
  /** ISO timestamps (absolute). */
  startTime: string;
  endTime: string;
  rows: NormalizedPlayerFight[];
  /** Diagnostics for the import result panel. */
  warnings: string[];
  /** Combatant-info events outside boss pulls (trash combat), inspectable. */
  ignoredCombatantInfo: { total: number; players: number; sample: IgnoredCombatantInfo[] };
  /**
   * The curation data dump: every aura name+id seen at boss pulls that the
   * consumable tables didn't recognize, most frequent first. Pasting this back
   * into development is how the tables get tuned against real logs.
   */
  unclassifiedAuras: UnclassifiedAura[];
}

export interface RawEventInputs {
  combatantInfo: unknown[];
  deaths: unknown[];
  casts: unknown[];
  /** Tracked debuffs on enemies (uptime). Absent on older fetches. */
  debuffs?: unknown[];
  /** Tracked buffs on friendlies (shouts, Earth Shield). Absent on older fetches. */
  buffs?: unknown[];
}

function clampPct(v: number | null | undefined): number | undefined {
  if (v === null || v === undefined || Number.isNaN(v)) return undefined;
  return Math.min(100, Math.max(0, v));
}

export function normalizeWclReport(rawInput: unknown, events: RawEventInputs): NormalizedReport {
  const raw = rawReportSchema.parse(rawInput);
  const warnings: string[] = [];

  const actors = (raw.masterData?.actors ?? []).map((a) => rawActorSchema.parse(a));
  const actorById = new Map(actors.map((a) => [a.id, a]));

  // Boss pulls only; trash fights have no encounterID.
  const fights = (raw.fights ?? []).filter((f) => (f.encounterID ?? 0) > 0);
  const fightsById = new Map(fights.map((f) => [f.id, f]));
  if (fights.length === 0) warnings.push("The report contains no boss encounters (only trash?).");

  const fightOf = (timestamp: number) =>
    fights.find((f) => timestamp >= f.startTime && timestamp <= f.endTime);

  /**
   * Bucket an event into a boss pull: WCL's own fight index when the event
   * carries one (authoritative — a trash fight id simply matches no boss
   * pull), timestamp windows otherwise.
   */
  const bossFightOf = (event: { timestamp: number; fight?: number }) =>
    event.fight !== undefined ? fightsById.get(event.fight) : fightOf(event.timestamp);

  /* 1. Rows from rankings — they define who was in each pull and their role. */
  const rows = new Map<string, NormalizedPlayerFight>();
  const keyOf = (fightId: number, actorName: string) => `${fightId}|${actorName.toLowerCase()}`;

  const ensureRow = (fight: (typeof fights)[number], actorName: string): NormalizedPlayerFight => {
    const key = keyOf(fight.id, actorName);
    let row = rows.get(key);
    if (!row) {
      row = {
        fightId: fight.id,
        encounterId: fight.encounterID ?? 0,
        encounterName: fight.name ?? `Fight ${fight.id}`,
        kill: fight.kill === true,
        fightPercentage: fight.kill === true ? undefined : (fight.fightPercentage ?? undefined),
        durationMs: Math.max(0, fight.endTime - fight.startTime),
        actorName,
        role: "dps",
        deaths: 0,
        elixirs: [],
        scrolls: [],
        food: false,
        weaponBuff: false,
        prepot: false,
        potions: [],
        otherCasts: [],
        extras: [],
        cooldowns: [],
        upkeep: [],
        gear: [],
        drums: 0,
        runes: 0,
        healthstones: 0,
        sappers: 0,
        missingEnchants: [],
      };
      rows.set(key, row);
    }
    return row;
  };

  const applyRankings = (
    rankings: z.infer<typeof rawRankingsSchema> | null | undefined,
    pick: ("tanks" | "healers" | "dps")[],
    role: WclRole,
  ) => {
    for (const fightRanking of rankings?.data ?? []) {
      const fight = fightsById.get(fightRanking.fightID);
      if (!fight) continue;
      for (const section of pick) {
        for (const ch of fightRanking.roles?.[section]?.characters ?? []) {
          const row = ensureRow(fight, ch.name);
          row.role = role === "dps" && section === "tanks" ? "tank" : role;
          row.className = ch.class ?? row.className;
          row.spec = ch.spec ?? row.spec;
          row.amount = ch.amount ?? row.amount;
          row.parsePercent = clampPct(ch.rankPercent) ?? row.parsePercent;
          row.bracketPercent = clampPct(ch.bracketPercent) ?? row.bracketPercent;
        }
      }
    }
  };
  // Healers parse on HPS; tanks and dps parse on DPS (tanks in their own bracket).
  applyRankings(raw.dps, ["tanks", "dps"], "dps");
  applyRankings(raw.hps, ["healers"], "healer");
  if (rows.size === 0 && fights.length > 0) {
    warnings.push("No per-player rankings in the report yet — parses can lag a fresh upload; re-fetch later.");
  }

  /*
   * Upkeep accumulators: one per (fight, source, track, target). Intervals
   * open on apply/refresh and close on remove; whatever is still open at the
   * end of the fight counts to the end. A remove with nothing open means the
   * aura predates our first event — credited from the pull start.
   */
  interface UptimeAcc {
    fight: (typeof fights)[number];
    actorName: string;
    track: UptimeTrack;
    totalMs: number;
    openAt?: number;
  }
  const uptimeAccs = new Map<string, UptimeAcc>();
  const uptimeAcc = (
    fight: (typeof fights)[number],
    actorName: string,
    track: UptimeTrack,
    targetId: number,
  ): UptimeAcc => {
    const key = `${fight.id}|${actorName.toLowerCase()}|${track.name.toLowerCase()}|${targetId}`;
    let acc = uptimeAccs.get(key);
    if (!acc) {
      acc = { fight, actorName, track, totalMs: 0 };
      uptimeAccs.set(key, acc);
    }
    return acc;
  };

  /* 2. Combatant info at pull: consumable auras + gear audit. */
  const ignoredSample: IgnoredCombatantInfo[] = [];
  const ignoredPlayers = new Set<string>();
  const unclassified = new Map<string, UnclassifiedAura>();
  let orphanCombatantInfo = 0;
  for (const rawEvent of events.combatantInfo) {
    const parsed = rawCombatantInfoEventSchema.safeParse(rawEvent);
    if (!parsed.success) continue;
    const event = parsed.data;
    if (event.type !== "combatantinfo" || event.sourceID === undefined) continue;
    const fight = bossFightOf(event);
    const actor = actorById.get(event.sourceID);
    if (!fight || !actor) {
      orphanCombatantInfo++;
      const player = actor?.name ?? `actor #${event.sourceID}`;
      ignoredPlayers.add(player);
      if (ignoredSample.length < 12) {
        ignoredSample.push({
          player,
          atMs: event.timestamp,
          auras: (event.auras ?? [])
            .filter((a) => a.name !== undefined && classifyAura(a.name, a.ability) !== undefined)
            .map((a) => a.name as string)
            .slice(0, 8),
        });
      }
      continue;
    }
    const row = rows.get(keyOf(fight.id, actor.name)) ?? ensureRow(fight, actor.name);
    row.className ??= actor.subType;

    for (const aura of event.auras ?? []) {
      if (!aura.name) continue;
      const hit = classifyAura(aura.name, aura.ability);
      if (!hit) {
        // A maintained self-buff already up at the pull (shouts): open its
        // uptime interval at the pull start — without this, a long-lasting
        // shout with no events inside a short fight would read as 0%.
        const track = UPTIME_TRACK_BY_NAME.get(aura.name.toLowerCase());
        if (track?.kind === "selfbuff") {
          uptimeAcc(fight, actor.name, track, event.sourceID).openAt ??= fight.startTime;
        }
        if (track || isNonConsumableAura(aura.name, aura.ability)) continue;
        const key = `${aura.name.toLowerCase()}|${aura.ability ?? ""}`;
        const entry = unclassified.get(key);
        if (entry) entry.count++;
        else unclassified.set(key, { name: aura.name, abilityId: aura.ability, count: 1 });
        continue;
      }
      if (hit.category === "flask") row.flask = hit.label;
      else if (hit.category === "food") row.food = true;
      else if (hit.category === "potion") row.prepot = true;
      else if (hit.category === "scroll") {
        if (!row.scrolls.includes(hit.label)) row.scrolls.push(hit.label);
      } else if (hit.category === "misc") {
        if (!row.extras.includes(hit.label)) row.extras.push(hit.label);
      } else if (!row.elixirs.includes(hit.label)) row.elixirs.push(hit.label);
    }

    const gear = (event.gear ?? []).map((g) => rawGearItemSchema.parse(g));
    if (gear.length > 0) {
      row.weaponBuff = WEAPON_GEAR_SLOTS.some((i) => (gear[i]?.temporaryEnchant ?? 0) > 0);
      row.missingEnchants = ENCHANTABLE_GEAR_SLOTS.filter(({ index }) => {
        const item = gear[index];
        // Empty slot (id 0) = nothing equipped — not an enchant problem.
        return item !== undefined && (item.id ?? 0) > 0 && !item.permanentEnchant;
      }).map((s) => s.label);
      row.gear = gear.flatMap((item, slot): NormalizedGearItem[] => {
        if ((item.id ?? 0) <= 0) return [];
        return [{
          slot,
          id: item.id as number,
          ilvl: item.itemLevel ?? undefined,
          enchant: item.permanentEnchant ?? undefined,
          temp: item.temporaryEnchant ?? undefined,
          gems: (item.gems ?? []).flatMap((g) => (g.id !== undefined && g.id > 0 ? [g.id] : [])),
          name: item.name ?? undefined,
          icon: item.icon ?? undefined,
        }];
      });
    }
  }
  if (orphanCombatantInfo > 0) {
    warnings.push(
      `${orphanCombatantInfo} combatant-info event(s) were outside boss pulls — that's trash combat (WCL fires one per player per combat segment); only boss pulls feed the tracker. Inspect them below.`,
    );
  }

  /* 3. Friendly deaths, bucketed into pulls. */
  for (const rawEvent of events.deaths) {
    const parsed = rawDeathEventSchema.safeParse(rawEvent);
    if (!parsed.success || parsed.data.targetID === undefined) continue;
    const fight = bossFightOf(parsed.data);
    const actor = actorById.get(parsed.data.targetID);
    if (!fight || !actor) continue;
    const row = rows.get(keyOf(fight.id, actor.name));
    if (row) row.deaths++;
  }

  /* 4. In-fight consumable casts (server-filtered to the tracked spell ids). */
  for (const rawEvent of events.casts) {
    const parsed = rawCastEventSchema.safeParse(rawEvent);
    if (!parsed.success) continue;
    const event = parsed.data;
    if (event.type === "begincast" || event.sourceID === undefined) continue;
    const fight = bossFightOf(event);
    const actor = actorById.get(event.sourceID);
    if (!fight || !actor) continue;
    const row = rows.get(keyOf(fight.id, actor.name));
    if (!row) continue;
    const abilityId = event.ability?.guid ?? event.abilityGameID;
    const hit = classifyCast(abilityId, event.ability?.name);
    if (!hit) {
      // Not a consumable — maybe one of the tracked class cooldowns.
      const cooldown = abilityId !== undefined ? COOLDOWN_BY_ID.get(abilityId) : undefined;
      if (cooldown) row.cooldowns.push(cooldown.name);
      continue;
    }
    if (hit.category === "potion") {
      row.potions.push(hit.name);
      continue;
    }
    row.otherCasts.push(hit.name);
    if (hit.category === "drums") row.drums++;
    else if (hit.category === "rune") row.runes++;
    else if (hit.category === "healthstone") row.healthstones++;
    else if (hit.category === "sapper") row.sappers++;
  }

  /* 5. Upkeep: maintained debuff/buff uptime from apply/refresh/remove events. */
  const ingestUptime = (rawEvents: unknown[]) => {
    for (const rawEvent of rawEvents) {
      const parsed = rawAuraEventSchema.safeParse(rawEvent);
      if (!parsed.success) continue;
      const event = parsed.data;
      if (event.sourceID === undefined || event.targetID === undefined) continue;
      const name = event.ability?.name;
      if (!name) continue;
      const track = UPTIME_TRACK_BY_NAME.get(name.toLowerCase());
      if (!track) continue;
      if (track.kind === "selfbuff" && event.targetID !== event.sourceID) continue;
      const fight = bossFightOf(event);
      const source = actorById.get(event.sourceID);
      if (!fight || !source) continue;

      const ts = Math.min(Math.max(event.timestamp, fight.startTime), fight.endTime);
      const acc = uptimeAcc(fight, source.name, track, event.targetID);
      if (event.type === "removedebuff" || event.type === "removebuff") {
        if (acc.openAt !== undefined) {
          acc.totalMs += ts - acc.openAt;
          acc.openAt = undefined;
        } else if (acc.totalMs === 0) {
          // First sighting is a removal: the aura was up since the pull.
          acc.totalMs = ts - fight.startTime;
        }
      } else if (event.type.startsWith("apply") || event.type.startsWith("refresh")) {
        // Stack events imply the aura is active; they never close an interval.
        acc.openAt ??= ts;
      }
    }
  };
  ingestUptime(events.debuffs ?? []);
  ingestUptime(events.buffs ?? []);

  // Close intervals still open at the fight end, then keep each player's best
  // target per track (≈ the boss — adds with brief uptime never win).
  const bestUptime = new Map<string, { row: NormalizedPlayerFight; track: UptimeTrack; totalMs: number }>();
  for (const acc of uptimeAccs.values()) {
    if (acc.openAt !== undefined) {
      acc.totalMs += acc.fight.endTime - acc.openAt;
      acc.openAt = undefined;
    }
    const row = rows.get(keyOf(acc.fight.id, acc.actorName));
    if (!row) continue;
    const key = `${acc.fight.id}|${acc.actorName.toLowerCase()}|${acc.track.name.toLowerCase()}`;
    const best = bestUptime.get(key);
    if (!best || acc.totalMs > best.totalMs) bestUptime.set(key, { row, track: acc.track, totalMs: acc.totalMs });
  }
  for (const { row, track, totalMs } of bestUptime.values()) {
    const pct = Math.round(Math.min(100, (totalMs / Math.max(1, row.durationMs)) * 100));
    if (pct >= 1) row.upkeep.push({ name: trackLabel(track), pct });
  }
  for (const row of rows.values()) {
    row.upkeep.sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name));
  }

  // Stable order: pull order, then name.
  const allRows = [...rows.values()].sort(
    (a, b) => a.fightId - b.fightId || a.actorName.localeCompare(b.actorName),
  );

  return {
    title: raw.title?.trim() || "Untitled report",
    zone: raw.zone?.name ?? undefined,
    startTime: new Date(raw.startTime).toISOString(),
    endTime: new Date(raw.endTime).toISOString(),
    rows: allRows,
    warnings,
    ignoredCombatantInfo: {
      total: orphanCombatantInfo,
      players: ignoredPlayers.size,
      sample: ignoredSample,
    },
    unclassifiedAuras: [...unclassified.values()]
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 80),
  };
}
