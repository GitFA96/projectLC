import { z } from "zod";
import {
  ENCHANTABLE_GEAR_SLOTS,
  FLASK_BUFF_IDS,
  WEAPON_GEAR_SLOTS,
  classifyAura,
  classifyCast,
  isNonConsumableAura,
  scrollCastName,
} from "@/lib/wcl/consumables";
import { normalizeIcon, qualityFromId } from "@/lib/items/item-data";
import type { Quality } from "@/lib/types";
import {
  COOLDOWN_BY_ID,
  TOTEM_CAST_BY_NAME,
  UPTIME_TRACK_BY_NAME,
  trackLabel,
  type UptimeTrack,
} from "@/lib/wcl/class-tracks";

import { compareText } from "@/lib/sort";

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
  /** "Player" | "Pet" | "NPC" — absent on pre-NPC fetches (players only). */
  type: z.string().optional(),
  subType: z.string().optional(),
  /** Owner actor id for pets — totems included, which is how totem buffs get credited to the shaman. */
  petOwner: z.number().nullish(),
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

const rawReportSchema = z.looseObject({
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
  bossdps: rawRankingsSchema.nullish(),
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
  /** Wowhead's 0–5 scale — free quality colouring, no lookup needed. */
  quality: z.number().nullish(),
  permanentEnchant: z.number().nullish(),
  temporaryEnchant: z.number().nullish(),
  /** Each gem carries its own icon; only its NAME needs resolving later. */
  gems: z
    .array(z.looseObject({ id: z.number().optional(), icon: z.string().nullish() }))
    .nullish(),
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
  /**
   * Points spent per talent tree, in the game's tree order (Warrior:
   * Arms/Fury/Protection). Verified against a real report — WCL ships one entry
   * per tree with the tree's point total in `id`, and repeats the class icon in
   * every entry, so only `id` is worth keeping.
   */
  talents: z.array(z.looseObject({ id: z.number().optional() })).nullish(),
  auras: z
    .array(
      z.looseObject({
        name: z.string().optional(),
        ability: z.number().optional(),
        /** Actor that applied the aura — present on most logs, absent on older ones. */
        source: z.number().optional(),
      }),
    )
    .nullish(),
});

const rawCastEventSchema = z.looseObject({
  timestamp: z.number(),
  type: z.string(),
  fight: z.number().optional(),
  sourceID: z.number().optional(),
  /** Friendly target of a targeted cooldown (Innervate, Misdirection). */
  targetID: z.number().optional(),
  abilityGameID: z.number().optional(),
  ability: rawAbilitySchema.nullish(),
});

/**
 * A friendly death. `killerID` and `killingAbility` were always in the payload
 * and were always dropped — probed on a real report, all 97 death events carried
 * both, and because the events fetch already asks with `useAbilityIDs: false`
 * the ability arrives fully named ("Arcing Smash", or "Melee" for a swing).
 *
 * The event's own `ability` is "Unknown Ability" with guid 0 on every death and
 * means nothing; the killing blow is the one on `killingAbility`.
 */
const rawDeathEventSchema = z.looseObject({
  timestamp: z.number(),
  type: z.string().optional(),
  fight: z.number().optional(),
  targetID: z.number().optional(),
  killerID: z.number().optional(),
  killingAbility: rawAbilitySchema.nullish(),
});

/**
 * One hit a friendly took. Probed: the ability arrives named (the events fetch
 * asks with `useAbilityIDs: false`), `amount` is what landed after mitigation,
 * and `absorbed` is what a shield ate.
 */
const rawDamageEventSchema = z.looseObject({
  timestamp: z.number(),
  type: z.string().optional(),
  fight: z.number().optional(),
  sourceID: z.number().optional(),
  targetID: z.number().optional(),
  amount: z.number().optional(),
  absorbed: z.number().optional(),
  ability: rawAbilitySchema.nullish(),
});

/** Buff/debuff apply/refresh/remove events feeding the upkeep computation. */
const rawAuraEventSchema = z.looseObject({
  timestamp: z.number(),
  type: z.string(),
  fight: z.number().optional(),
  sourceID: z.number().optional(),
  targetID: z.number().optional(),
  /** Which copy of the NPC, when several share one actor id (adds). */
  targetInstance: z.number().optional(),
  /** Stack count AFTER the event. Only applydebuffstack/applybuffstack carry it. */
  stack: z.number().optional(),
  abilityGameID: z.number().optional(),
  ability: rawAbilitySchema.nullish(),
});

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
  /** Fight start, ms from report start (absolute clock times derive from it). */
  fightStartMs: number;
  actorName: string;
  className?: string;
  spec?: string;
  role: WclRole;
  parsePercent?: number;
  bracketPercent?: number;
  amount?: number;
  /** Parse percentile on damage to the boss only (absent for healers). */
  bossParsePercent?: number;
  /** Boss-only dps behind `bossParsePercent`. */
  bossAmount?: number;
  deaths: number;
  /** Each death and what landed it — see `wclPlayerFightSchema.deathTimes`. */
  deathTimes: {
    atMs: number;
    killer?: string;
    ability?: string;
    recap?: { atMs: number; ability: string; source?: string; amount: number; absorbed?: number }[];
  }[];
  flask?: string;
  elixirs: string[];
  scrolls: string[];
  food: boolean;
  weaponBuff: boolean;
  prepot: boolean;
  prepotLabel?: string;
  potions: string[];
  /** Non-potion in-fight consumable casts (healthstones, runes, gems, seeds, drums). */
  otherCasts: string[];
  /** Off-slot consumable buffs at pull (alcohol, Bogling Root, …). */
  extras: string[];
  /** Major class cooldowns cast during the pull, one entry per use. */
  cooldowns: string[];
  /**
   * When the tracked cooldowns and totem drops happened — ms from the pull
   * start, in cast order, with the friendly target for the ones aimed at
   * someone else (Innervate, Misdirection, Power Infusion). This is what turns
   * "Innervate ×3" into a timeline.
   */
  castTimes: NormalizedCastMoment[];
  /** Maintained debuff/buff uptimes, % of the pull, best target; `targets` breaks it down per victim with up-intervals. */
  upkeep: {
    name: string;
    pct: number;
    targets?: NormalizedUpkeepTarget[];
  }[];
  /** Full worn-gear snapshot at the pull. */
  gear: NormalizedGearItem[];
  /**
   * Points per talent tree at the pull, in the game's tree order — the build
   * as actually played. Empty when the log didn't carry it.
   *
   * This is an opaque fingerprint, deliberately: two raiders are comparable
   * when their arrays match and aren't when they don't. Do NOT derive "which
   * abilities were available" from it — that needs the talent tree's real
   * layout, which this app has no business guessing (a 33/28/0 warrior turned
   * out to have Death Wish when a plausible reading said otherwise).
   */
  talents: number[];
  drums: number;
  runes: number;
  healthstones: number;
  sappers: number;
  missingEnchants: string[];
}

/** One tracked cooldown or totem drop, placed inside the pull. */
export interface NormalizedCastMoment {
  name: string;
  /** ms from the pull start. */
  atMs: number;
  /** Friendly target, when it wasn't the caster themself. */
  target?: string;
  /** A shaman totem drop rather than a class cooldown. */
  totem?: boolean;
}

/** One victim of a maintained debuff/buff during a pull, with its up-intervals. */
export interface NormalizedUpkeepTarget {
  /** Target name as logged (NPC or friendly player). */
  target: string;
  /** WCL instance number when several copies of the NPC exist. */
  instance?: number;
  /** True when the target is the encounter boss (WCL subType "Boss"). */
  boss: boolean;
  /** True when the target is a friendly player — the "uptime by player" side of raid buffs. */
  player?: boolean;
  pct: number;
  /** [startMs, endMs] pairs relative to the fight start. */
  segments: [number, number][];
  /** ≈ times the aura was applied/refreshed (stacking spam like Sunder Armor counts each landed cast). */
  applications: number;
  /**
   * The two halves of `applications` for a stacking debuff, and the stack values
   * the log reported. Absent for auras that never carried a stack — see
   * `wclPlayerFightSchema.upkeep` for what each one answers.
   */
  stackUps?: number;
  refreshes?: number;
  stackPoints?: [number, number][];
}

/** One socketed gem: the log gives its id and icon, never its name. */
export interface NormalizedGem {
  id: number;
  icon?: string;
}

/** One worn item, slimmed for persistence (slot = WCL gear-array index). */
export interface NormalizedGearItem {
  slot: number;
  id: number;
  ilvl?: number;
  quality?: Quality;
  enchant?: number;
  temp?: number;
  gems: NormalizedGem[];
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

/**
 * What one player did with consumables away from the boss pulls.
 *
 * A raid night is mostly not boss pulls: trash, running back, buffing up. A
 * potion drunk clearing to Vashj costs the same gold as one drunk on her, and
 * pet food is a twenty-minute buff nobody applies mid-pull — so scoping
 * consumable tracking to encounter windows quietly under-counted both.
 *
 * One record per player per report rather than per pull, because there are no
 * pulls to hang it on: "what did they get through tonight" is the question
 * this answers.
 */
export interface NormalizedPlayerOffPull {
  actorName: string;
  className?: string;
  /** Combat potions drunk outside a boss pull. */
  potions: string[];
  /** Other consumable casts outside a boss pull (runes, healthstones, drums…). */
  otherCasts: string[];
  drums: number;
  runes: number;
  healthstones: number;
  sappers: number;
  /**
   * Consumables put on their PET — food and scrolls, whenever they were fed.
   * Kept whole rather than split by window: a hunter feeds the pet once for
   * the night, and which side of a pull it landed on says nothing useful.
   */
  petConsumables: string[];
}

export interface NormalizedReport {
  title: string;
  zone?: string;
  /** ISO timestamps (absolute). */
  startTime: string;
  endTime: string;
  rows: NormalizedPlayerFight[];
  /** Per-player consumable use away from the boss pulls. */
  offPull: NormalizedPlayerOffPull[];
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
  /** Damage taken near each death, for the recap. Absent on older fetches. */
  damageTaken?: unknown[];
}

function clampPct(v: number | null | undefined): number | undefined {
  if (v === null || v === undefined || Number.isNaN(v)) return undefined;
  return Math.min(100, Math.max(0, v));
}

export function normalizeWclReport(rawInput: unknown, events: RawEventInputs): NormalizedReport {
  const raw = rawReportSchema.parse(rawInput);
  const warnings: string[] = [];

  const actors = (raw.masterData?.actors ?? []).map((a) => rawActorSchema.parse(a));
  // Friendly-source lookups stay player-only (pets/NPCs must not claim casts);
  // missing `type` means a pre-NPC fetch that only contained players anyway.
  const actorById = new Map(
    actors.filter((a) => a.type === undefined || a.type === "Player").map((a) => [a.id, a]),
  );
  // Every actor incl. NPCs — resolves upkeep targets (boss, adds, friendlies).
  const anyActorById = new Map(actors.map((a) => [a.id, a]));
  /**
   * The player behind an aura source. A totem is a pet actor of the shaman who
   * dropped it, and totem buffs are sourced from the totem — without this the
   * whole shaman totem suite would go uncredited.
   */
  const sourcePlayerOf = (actorId: number) => {
    const direct = actorById.get(actorId);
    if (direct) return direct;
    const owner = anyActorById.get(actorId)?.petOwner;
    return owner !== null && owner !== undefined ? actorById.get(owner) : undefined;
  };

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
        fightStartMs: fight.startTime,
        actorName,
        role: "dps",
        deaths: 0,
        deathTimes: [],
        elixirs: [],
        scrolls: [],
        food: false,
        weaponBuff: false,
        prepot: false,
        potions: [],
        otherCasts: [],
        extras: [],
        cooldowns: [],
        castTimes: [],
        upkeep: [],
        gear: [],
        talents: [],
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
  /*
   * Boss-damage parses are the same players ranked on damage to the boss
   * alone — no adds, no cleave padding. They never create a row or touch a
   * role: a player missing from the dps/hps rankings isn't in this report's
   * roster either. Healers are skipped; WCL ranks them here at 0 damage.
   */
  for (const fightRanking of raw.bossdps?.data ?? []) {
    const fight = fightsById.get(fightRanking.fightID);
    if (!fight) continue;
    for (const section of ["tanks", "dps"] as const) {
      for (const ch of fightRanking.roles?.[section]?.characters ?? []) {
        const row = rows.get(keyOf(fight.id, ch.name));
        if (!row) continue;
        row.bossParsePercent = clampPct(ch.rankPercent) ?? row.bossParsePercent;
        row.bossAmount = ch.amount ?? row.bossAmount;
      }
    }
  }
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
    targetId: number;
    targetInstance?: number;
    totalMs: number;
    /** Closed up-intervals, [startMs, endMs] relative to the fight start. */
    segments: [number, number][];
    openAt?: number;
    /** Apply/refresh events at distinct timestamps — one landed cast can emit
     * an applydebuffstack AND a refreshdebuff at the same ms (Sunder spam). */
    applications: number;
    lastApplicationTs?: number;
    /**
     * The same landed casts split by what they did: raised the stack, or only
     * renewed the duration. Counted per distinct timestamp like `applications`,
     * and a timestamp that emitted both counts as a stack-up — the stack moving
     * is the more specific fact about that cast.
     */
    stackUps: number;
    lastStackUpTs?: number;
    /** [msFromPullStart, stack] each time this source moved the stack. */
    stackPoints: [number, number][];
  }
  const uptimeAccs = new Map<string, UptimeAcc>();
  const uptimeAcc = (
    fight: (typeof fights)[number],
    actorName: string,
    track: UptimeTrack,
    targetId: number,
    targetInstance?: number,
  ): UptimeAcc => {
    /*
     * Keyed by the target's NAME and instance, not its actor id.
     *
     * Warcraft Logs does not use one id per mob here: probed on a real Vashj
     * pull, a Sunder Armor `applydebuff` on Enchanted Elemental instance 24
     * carried targetID 161, while every applydebuffstack, refreshdebuff and
     * removedebuff for that same mob carried 163. Keying on the raw id split one
     * debuff across two accumulators, and the half holding the `applydebuff`
     * never saw its `removedebuff` — so it stayed open and was credited to the
     * end of the fight.
     *
     * That is not a rounding error. It gave one warrior a 71% Sunder Armor
     * headline off a single application on an add that lived twelve seconds,
     * because `bestPct` takes the best single target and a phantom window beats
     * every real one. Name + instance is the mob's real identity — instance is
     * exactly what separates two mobs sharing a name — so the halves rejoin.
     */
    const target = anyActorById.get(targetId);
    const identity = `${(target?.name ?? `#${targetId}`).toLowerCase()}|${targetInstance ?? 0}`;
    const key = `${fight.id}|${actorName.toLowerCase()}|${track.name.toLowerCase()}|${identity}`;
    let acc = uptimeAccs.get(key);
    if (!acc) {
      acc = {
        fight,
        actorName,
        track,
        targetId,
        targetInstance,
        totalMs: 0,
        segments: [],
        applications: 0,
        stackUps: 0,
            stackPoints: [],
      };
      uptimeAccs.set(key, acc);
    }
    return acc;
  };
  /** Close an open interval at `endAbs` (report-relative ms), recording the segment. */
  const closeInterval = (acc: UptimeAcc, endAbs: number) => {
    if (acc.openAt === undefined) return;
    acc.totalMs += endAbs - acc.openAt;
    acc.segments.push([acc.openAt - acc.fight.startTime, endAbs - acc.fight.startTime]);
    acc.openAt = undefined;
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
        // A tracked buff already up at the pull: open its uptime interval at
        // the pull start — without this, a shout or totem cast before the pull
        // with no events inside a short fight would read as 0%.
        const track = UPTIME_TRACK_BY_NAME.get(aura.name.toLowerCase());
        if (track && track.kind !== "debuff") {
          // The log usually names who applied it (a totem resolves to its
          // shaman); when it doesn't, only a class-matching recipient can be
          // assumed to have buffed themself — guessing a provider would put
          // someone else's totem on a raider's own name.
          const provider =
            aura.source !== undefined
              ? sourcePlayerOf(aura.source)
              : actor.subType === track.wowClass
                ? actor
                : undefined;
          if (provider && (track.kind !== "selfbuff" || provider.id === event.sourceID)) {
            uptimeAcc(fight, provider.name, track, event.sourceID).openAt ??= fight.startTime;
          }
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
      else if (hit.category === "potion") {
        row.prepot = true;
        // classifyAura knew which potion all along; it used to be thrown away,
        // which made "potions used" un-priceable for anyone who opens potted.
        row.prepotLabel ??= hit.label;
      }
      else if (hit.category === "scroll") {
        if (!row.scrolls.includes(hit.label)) row.scrolls.push(hit.label);
      } else if (hit.category === "misc") {
        if (!row.extras.includes(hit.label)) row.extras.push(hit.label);
      } else if (!row.elixirs.includes(hit.label)) row.elixirs.push(hit.label);
    }

    // Points per tree. Trees with 0 points are still listed, so an all-zero
    // array means "logged but unspent" and an empty one means "not logged" —
    // keep the difference rather than collapsing both to nothing.
    const talents = (event.talents ?? []).map((t) => t.id ?? 0);
    if (talents.length > 0) row.talents = talents;

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
          quality: qualityFromId(item.quality),
          enchant: item.permanentEnchant ?? undefined,
          temp: item.temporaryEnchant ?? undefined,
          // Each gem's own icon rides along; the log never names them.
          gems: (item.gems ?? []).flatMap((g) =>
            g.id !== undefined && g.id > 0 ? [{ id: g.id, icon: normalizeIcon(g.icon ?? undefined) }] : [],
          ),
          name: item.name ?? undefined,
          // Logs spell icons "inv_helmet_15.jpg"; the CDN helper adds the extension.
          icon: normalizeIcon(item.icon ?? undefined),
        }];
      });
    }
  }
  if (orphanCombatantInfo > 0) {
    warnings.push(
      `${orphanCombatantInfo} combatant-info event(s) were outside boss pulls — that's trash combat (WCL fires one per player per combat segment); only boss pulls feed the tracker. Inspect them below.`,
    );
  }

  /*
   * 3a. Damage taken, indexed per victim so each death can take the hits that
   * led to it. Built before the deaths are walked, keyed by actor id, sorted so
   * a recap can be sliced without re-sorting per death.
   */
  const damageByTarget = new Map<number, { at: number; ability: string; source?: string; amount: number; absorbed?: number }[]>();
  for (const rawEvent of events.damageTaken ?? []) {
    const parsed = rawDamageEventSchema.safeParse(rawEvent);
    if (!parsed.success || parsed.data.targetID === undefined) continue;
    const name = parsed.data.ability?.name;
    // A hit with no named ability tells the reader nothing they can act on, and
    // "Unknown Ability" in a recap is worse than a shorter recap.
    if (!name) continue;
    const list = damageByTarget.get(parsed.data.targetID) ?? [];
    list.push({
      at: parsed.data.timestamp,
      ability: name,
      source: parsed.data.sourceID === undefined ? undefined : anyActorById.get(parsed.data.sourceID)?.name,
      amount: parsed.data.amount ?? 0,
      ...(parsed.data.absorbed ? { absorbed: parsed.data.absorbed } : {}),
    });
    damageByTarget.set(parsed.data.targetID, list);
  }
  for (const list of damageByTarget.values()) list.sort((a, b) => a.at - b.at);

  /* 3. Friendly deaths, bucketed into pulls. */
  for (const rawEvent of events.deaths) {
    const parsed = rawDeathEventSchema.safeParse(rawEvent);
    if (!parsed.success || parsed.data.targetID === undefined) continue;
    const fight = bossFightOf(parsed.data);
    const actor = actorById.get(parsed.data.targetID);
    if (!fight || !actor) continue;
    const row = rows.get(keyOf(fight.id, actor.name));
    if (!row) continue;
    row.deaths++;
    // When and to what, not just how many. Clamped into the pull the same way
    // cast times are, so a death on the boundary can't land outside the fight it
    // belongs to.
    //
    // The killer is resolved against every actor, not just players: what killed
    // a raider is almost always a boss or an add. A name we can't resolve is
    // left off rather than guessed at — "died to something" is the truth then.
    const killer = parsed.data.killerID === undefined ? undefined : anyActorById.get(parsed.data.killerID);
    /*
     * The hits that led to it: what this player took in the seconds before,
     * newest first, so the last thing to land reads first.
     *
     * `DEATH_RECAP_MS` is duplicated as a plain number here rather than imported
     * from `fetch-report` — normalize is pure and must not depend on the fetch
     * layer. The fetch asks for a slightly wider window than this slices, so a
     * change to one is safe without the other.
     */
    const RECAP_MS = 10_000;
    const died = parsed.data.timestamp;
    const recap = (damageByTarget.get(parsed.data.targetID) ?? [])
      .filter((hit) => hit.at <= died && hit.at >= died - RECAP_MS)
      .map((hit) => ({
        atMs: Math.max(0, hit.at - fight.startTime),
        ability: hit.ability,
        ...(hit.source ? { source: hit.source } : {}),
        amount: hit.amount,
        ...(hit.absorbed ? { absorbed: hit.absorbed } : {}),
      }))
      .reverse();

    row.deathTimes.push({
      atMs: Math.max(0, Math.min(parsed.data.timestamp, fight.endTime) - fight.startTime),
      ...(killer?.name ? { killer: killer.name } : {}),
      ...(parsed.data.killingAbility?.name ? { ability: parsed.data.killingAbility.name } : {}),
      ...(recap.length > 0 ? { recap } : {}),
    });
  }

  /* 4. Consumable casts (server-filtered to the tracked spell ids). */
  /** Per-player tallies for everything outside a boss pull, built on demand. */
  const offPullByActor = new Map<string, NormalizedPlayerOffPull>();
  const offPullFor = (actorName: string, className?: string): NormalizedPlayerOffPull => {
    let entry = offPullByActor.get(actorName);
    if (!entry) {
      entry = {
        actorName,
        className,
        potions: [],
        otherCasts: [],
        drums: 0,
        runes: 0,
        healthstones: 0,
        sappers: 0,
        petConsumables: [],
      };
      offPullByActor.set(actorName, entry);
    }
    return entry;
  };

  for (const rawEvent of events.casts) {
    const parsed = rawCastEventSchema.safeParse(rawEvent);
    if (!parsed.success) continue;
    const event = parsed.data;
    if (event.type === "begincast" || event.sourceID === undefined) continue;
    const fight = bossFightOf(event);
    const actor = actorById.get(event.sourceID);
    if (!actor) continue;
    const abilityId = event.ability?.guid ?? event.abilityGameID;

    /*
     * A scroll read onto a pet. Self-scrolls arrive as auras at the pull and
     * are counted there, so only the pet-targeted ones are taken from the cast
     * stream — otherwise every raider's own scroll would be counted twice.
     */
    const scroll = scrollCastName(abilityId);
    if (scroll) {
      const target = event.targetID !== undefined ? anyActorById.get(event.targetID) : undefined;
      if (target?.petOwner === event.sourceID) {
        offPullFor(actor.name, actor.subType).petConsumables.push(scroll);
      }
      continue;
    }

    const hit = classifyCast(abilityId, event.ability?.name);
    /*
     * Pet food is a night-long buff applied between pulls, so it's recorded
     * per player rather than per pull — and recorded wherever it happened,
     * since "did they feed the pet tonight" has one answer either way.
     */
    if (hit?.category === "pet") {
      offPullFor(actor.name, actor.subType).petConsumables.push(hit.name);
      continue;
    }

    const row = fight ? rows.get(keyOf(fight.id, actor.name)) : undefined;

    /*
     * No pull to hang it on: trash, running back, buffing up — or a pull this
     * player has no ranked row for. Same gold and the same habit either way,
     * and dropping it (which is what used to happen) made a raider who potions
     * hard through the trash read as one who never potions at all.
     */
    if (!row) {
      if (!hit) continue;
      const off = offPullFor(actor.name, actor.subType);
      if (hit.category === "potion") off.potions.push(hit.name);
      else {
        off.otherCasts.push(hit.name);
        if (hit.category === "drums") off.drums++;
        else if (hit.category === "rune") off.runes++;
        else if (hit.category === "healthstone") off.healthstones++;
        else if (hit.category === "sapper") off.sappers++;
      }
      continue;
    }
    if (!fight) continue; // unreachable: a row implies its fight
    if (!hit) {
      // Not a consumable — maybe a tracked class cooldown or a totem drop.
      const cooldown = abilityId !== undefined ? COOLDOWN_BY_ID.get(abilityId) : undefined;
      const totem = TOTEM_CAST_BY_NAME.get((event.ability?.name ?? "").toLowerCase());
      if (!cooldown && !totem) continue;
      const targetActor =
        event.targetID !== undefined && event.targetID !== event.sourceID
          ? actorById.get(event.targetID)
          : undefined;
      if (cooldown) row.cooldowns.push(cooldown.name);
      row.castTimes.push({
        name: cooldown?.name ?? (totem as string),
        atMs: Math.max(0, Math.min(event.timestamp, fight.endTime) - fight.startTime),
        ...(targetActor ? { target: targetActor.name } : {}),
        // Mana Tide is both a cooldown and a totem — it belongs in both views.
        ...(totem ? { totem: true } : {}),
      });
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
      const source = sourcePlayerOf(event.sourceID);
      if (!fight || !source) continue;

      const ts = Math.min(Math.max(event.timestamp, fight.startTime), fight.endTime);
      const acc = uptimeAcc(fight, source.name, track, event.targetID, event.targetInstance);
      if (event.type === "removedebuff" || event.type === "removebuff") {
        if (acc.openAt !== undefined) {
          closeInterval(acc, ts);
        } else if (acc.totalMs === 0) {
          // First sighting is a removal: the aura was up since the pull.
          acc.totalMs = ts - fight.startTime;
          acc.segments.push([0, ts - fight.startTime]);
        }
      } else if (event.type.startsWith("apply") || event.type.startsWith("refresh")) {
        // Stack events imply the aura is active; they never close an interval.
        if (acc.openAt === undefined) {
          // A refresh can only land on an aura that is already up — a refresh
          // as the FIRST sighting means it was pre-cast before the pull
          // (Hunter's Mark applied pre-fight), so credit from the pull start.
          const preCast =
            event.type.startsWith("refresh") && acc.totalMs === 0 && acc.segments.length === 0;
          acc.openAt = preCast ? fight.startTime : ts;
        }
        if (acc.lastApplicationTs !== ts) {
          acc.applications++;
          acc.lastApplicationTs = ts;
        }
        /*
         * Stack-ups are counted; refreshes are DERIVED as the rest at
         * serialization. Only `applydebuffstack` carries a stack number —
         * probed: `refreshdebuff` sends none, and one landed Sunder emits both
         * at the same millisecond. Counting refreshes here instead would depend
         * on which of the two the log happens to send first, and the two counts
         * could then add up to more than the landed casts they split.
         */
        if (event.stack !== undefined && event.type.endsWith("stack")) {
          if (acc.lastStackUpTs !== ts) {
            acc.stackUps++;
            acc.lastStackUpTs = ts;
            acc.stackPoints.push([ts - fight.startTime, event.stack]);
          }
        }
      }
    }
  };
  ingestUptime(events.debuffs ?? []);
  ingestUptime(events.buffs ?? []);

  /*
   * 5b. Flasks the pull-time snapshot cannot see.
   *
   * Every other flask is read off `combatantinfo` in step 3, because that is
   * where a buff already running at the pull shows up. The Unstable Flasks are
   * not in it — Warcraft Logs omits them — so a raider who drank one before the
   * pull graded as having no flask at all, on the preparation column that feeds
   * the loot score. They arrive as apply/remove buff events instead.
   *
   * So: build each raider's flask intervals across the whole night, then stamp
   * any pull whose START falls inside one. Deliberately not a duration
   * calculation — the log says when the aura ended, and an assumed two hours
   * would be a guess that outlives the evidence. An aura still up when the log
   * stops simply runs to the end.
   *
   * Never overwrites a flask the snapshot already found: that one is a direct
   * observation at the pull, and this is an inference between two events.
   */
  const flaskSpans = new Map<string, { from: number; to: number; label: string }[]>();
  const openFlask = new Map<string, { from: number; label: string }>();
  for (const rawEvent of events.buffs ?? []) {
    const parsed = rawAuraEventSchema.safeParse(rawEvent);
    if (!parsed.success) continue;
    const event = parsed.data;
    const abilityId = event.abilityGameID ?? event.ability?.guid;
    const label = abilityId === undefined ? undefined : FLASK_BUFF_IDS.get(abilityId);
    if (!label || event.targetID === undefined) continue;
    // The flask is on whoever it landed on, not whoever the event is sourced
    // from — a raider drinking one is both, but only the target is meaningful.
    const target = actorById.get(event.targetID);
    if (!target) continue;
    const key = `${target.name}|${label}`;
    if (event.type === "removebuff") {
      const open = openFlask.get(key);
      if (open) {
        const spans = flaskSpans.get(target.name) ?? [];
        spans.push({ from: open.from, to: event.timestamp, label });
        flaskSpans.set(target.name, spans);
        openFlask.delete(key);
      }
      continue;
    }
    if (event.type.startsWith("apply") || event.type.startsWith("refresh")) {
      // A refresh with nothing open means it was drunk before the log started.
      if (!openFlask.has(key)) openFlask.set(key, { from: event.timestamp, label });
    }
  }
  // Anything still up when the night ended stays up to the end of the night.
  for (const [key, open] of openFlask) {
    const name = key.slice(0, key.lastIndexOf("|"));
    const spans = flaskSpans.get(name) ?? [];
    spans.push({ from: open.from, to: Number.POSITIVE_INFINITY, label: open.label });
    flaskSpans.set(name, spans);
  }
  if (flaskSpans.size > 0) {
    for (const row of rows.values()) {
      if (row.flask !== undefined) continue;
      const fight = fights.find((f) => f.id === row.fightId);
      if (!fight) continue;
      const span = flaskSpans
        .get(row.actorName)
        ?.find((s) => s.from <= fight.startTime && fight.startTime < s.to);
      if (span) row.flask = span.label;
    }
  }

  // Close intervals still open at the fight end, then group each player's
  // accumulators per track. The headline pct stays the best single target
  // (≈ the boss — adds with brief uptime never win); every target the track
  // touched (boss, adds, buffed friendlies) goes into the per-victim
  // breakdown with its up-intervals.
  const trackGroups = new Map<string, { row: NormalizedPlayerFight; track: UptimeTrack; accs: UptimeAcc[] }>();
  for (const acc of uptimeAccs.values()) {
    closeInterval(acc, acc.fight.endTime);
    const row = rows.get(keyOf(acc.fight.id, acc.actorName));
    if (!row) continue;
    const key = `${acc.fight.id}|${acc.actorName.toLowerCase()}|${acc.track.name.toLowerCase()}`;
    const group = trackGroups.get(key) ?? { row, track: acc.track, accs: [] };
    group.accs.push(acc);
    trackGroups.set(key, group);
  }
  for (const { row, track, accs } of trackGroups.values()) {
    const pctOf = (ms: number) => Math.round(Math.min(100, (ms / Math.max(1, row.durationMs)) * 100));
    const bestPct = pctOf(Math.max(...accs.map((a) => a.totalMs)));
    if (bestPct < 1) continue;
    const targets: NormalizedUpkeepTarget[] = accs
      .map((acc) => {
        const target = anyActorById.get(acc.targetId);
        return {
          target: target?.name ?? `Unknown #${acc.targetId}`,
          instance: acc.targetInstance,
          boss: target?.subType === "Boss",
          ...(target?.type === "Player" ? { player: true } : {}),
          pct: pctOf(acc.totalMs),
          segments: acc.segments,
          applications: acc.applications,
          // Derived, never counted: whatever landed and did not move the stack
          // renewed the duration. Guarantees the two halves sum to the casts.
          ...(acc.stackPoints.length > 0
            ? {
                stackUps: acc.stackUps,
                refreshes: Math.max(0, acc.applications - acc.stackUps),
                stackPoints: acc.stackPoints,
              }
            : {}),
        };
      })
      .filter((t) => t.segments.length > 0)
      .sort(
        (a, b) =>
          Number(b.boss) - Number(a.boss) ||
          b.pct - a.pct ||
          compareText(a.target, b.target) ||
          (a.instance ?? 0) - (b.instance ?? 0),
      );
    row.upkeep.push({ name: trackLabel(track), pct: bestPct, targets });
  }
  for (const row of rows.values()) {
    row.upkeep.sort((a, b) => b.pct - a.pct || compareText(a.name, b.name));
    row.castTimes.sort((a, b) => a.atMs - b.atMs || compareText(a.name, b.name));
    row.deathTimes.sort((a, b) => a.atMs - b.atMs);
  }

  // Stable order: pull order, then name.
  const allRows = [...rows.values()].sort(
    (a, b) => a.fightId - b.fightId || compareText(a.actorName, b.actorName),
  );

  return {
    title: raw.title?.trim() || "Untitled report",
    zone: raw.zone?.name ?? undefined,
    startTime: new Date(raw.startTime).toISOString(),
    endTime: new Date(raw.endTime).toISOString(),
    rows: allRows,
    // Only players who actually used something off-pull get a record — an
    // empty one would claim we looked and found nothing, which is the same
    // shape as never having looked.
    offPull: [...offPullByActor.values()]
      .filter(
        (o) =>
          o.potions.length > 0 || o.otherCasts.length > 0 || o.petConsumables.length > 0,
      )
      .sort((a, b) => compareText(a.actorName, b.actorName)),
    warnings,
    ignoredCombatantInfo: {
      total: orphanCombatantInfo,
      players: ignoredPlayers.size,
      sample: ignoredSample,
    },
    unclassifiedAuras: [...unclassified.values()]
      .sort((a, b) => b.count - a.count || compareText(a.name, b.name))
      .slice(0, 80),
  };
}
