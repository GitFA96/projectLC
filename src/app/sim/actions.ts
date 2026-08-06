"use server";

import { z } from "zod";
import { getRepo, getWriteRepo } from "@/lib/data/repo";
import { refreshAfterWrite } from "@/lib/refresh";
import {
  activity,
  compareRotations,
  profileFromCasts,
  type Activity,
  type RotationComparison,
} from "@/lib/analysis/rotation";
import { buildMatchNote } from "@/lib/analysis/builds";
import {
  auditHeadline,
  auditSimContext,
  bossDebuffUptime,
  playerBuffUptime,
  type SimContextAudit,
} from "@/lib/sim/context";
import { buildRaidSimRequest, talentWarning, type IndividualSimSettings } from "@/lib/sim/request";
import { classOfSettings } from "@/lib/sim/profile";
import {
  parseSimEvents,
  representativeRun,
  simActionRefs,
  simDpsOf,
  simProfile,
  type NameBook,
  type TimedEvent,
} from "@/lib/sim/result";
import { describeSetup, type SetupRow } from "@/lib/sim/setup";
import { findings, findingsHeadline, type Finding } from "@/lib/sim/findings";
import { SimError, decodeSimLink, runSim, simConfigured } from "@/lib/sim/run";
import { fetchFightCasts } from "@/lib/wcl/fight-casts";
import { fetchFightDebuffUptime, fetchPlayerAuras } from "@/lib/wcl/fight-upkeep";
import { BLOOD_FRENZY_BLEEDS, bloodFrenzyEvidence, modelsBloodFrenzy } from "@/lib/sim/inference";
import { fetchReportAbilities } from "@/lib/wcl/fight-graph";
import { TRACKED_AURA_NAMES } from "@/lib/wcl/class-tracks";
import { WclError } from "@/lib/wcl/client";
import {
  parseRefKey,
  refKey,
  resolveAbilitiesFromWowhead,
  wowheadUrl,
  type AbilityInfo,
  type AbilityRef,
} from "@/lib/items/ability-data";

/**
 * Running one pull against that raider's simulation.
 *
 * Everything expensive happens here rather than at render: the cast fetch is
 * live (so it works on reports imported before this feature existed) and the
 * sim is a subprocess. Both are cached by their inputs, so re-opening the same
 * pull costs nothing.
 */

const runSchema = z.object({
  wowClass: z.string().min(1),
  spec: z.string().min(1),
  reportCode: z.string().min(1),
  fightId: z.number().int().nonnegative(),
  actorName: z.string().min(1),
});

/** What the panel needs to render one ability: where it links, what it does. */
export interface AbilityLink {
  /** "spell:25236" — also what the lookup button sends back. */
  key: string;
  url: string;
  description?: string;
  /**
   * Whether Wowhead has already been asked about this one. Not the same as
   * having a description: an ability with a row but no effect text must stop
   * prompting, or the lookup button never goes away.
   */
  cached: boolean;
}

export type SimComparisonResult =
  | {
      status: "ok";
      encounterName: string;
      durationMs: number;
      loggedDps?: number;
      simDps?: number;
      comparison: RotationComparison;
      audit: SimContextAudit;
      auditHeadline: string;
      setup: SetupRow[];
      activity: Activity;
      /** Every ability on screen, by name — link, description, whether it's named. */
      abilities: Record<string, AbilityLink>;
      /** Ability names still showing as a bare id. */
      unnamed: string[];
      /** Action-by-action, both sides — the same view Warcraft Logs offers. */
      events: { logged: TimedEvent[]; sim: TimedEvent[] };
      /** What the logs say moved this fight, ranked by the damage behind it. */
      findings: Finding[];
      findingsHeadline: string;
      /** Build/context caveats — shown, never used to block the comparison. */
      notes: string[];
    }
  | { status: "no-sim" }
  | { status: "not-configured" }
  | { status: "error"; message: string };

export async function runSimComparison(input: {
  wowClass: string;
  spec: string;
  reportCode: string;
  fightId: number;
  actorName: string;
}): Promise<SimComparisonResult> {
  const parsed = runSchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: "Invalid request." };
  if (!simConfigured()) return { status: "not-configured" };

  const { wowClass, spec, reportCode, fightId, actorName } = parsed.data;
  const repo = await getRepo();

  const detail = await repo.getSimSpec(wowClass, spec);
  if (!detail?.profile) return { status: "no-sim" };
  let settings: IndividualSimSettings;
  try {
    settings = JSON.parse(detail.profile) as IndividualSimSettings;
  } catch {
    return {
      status: "error",
      message: `The saved setup for ${wowClass} · ${spec} is unreadable — paste the link again.`,
    };
  }

  /*
   * The pull row is read from every player's rows for that fight, not from the
   * chosen raider's performance page. A spec profile is pointed at whoever
   * played the spec — including names that match no roster character, which the
   * per-character read could never return.
   */
  const pullRows = await repo.listPullRows(reportCode, fightId);
  const pull = pullRows.find((r) => r.actorName === actorName);
  if (!pull) return { status: "error", message: "That pull is no longer in the imported data." };

  /*
   * `pullRows` above is every raider on the pull, not just this one — a raid
   * debuff is recorded against whoever applied it and a party buff against its
   * provider, so filtering to one character's rows answers neither.
   *
   * What this report was actually asked for — see TrackCoverage in sim/context.
   */
  const reports = await repo.listWclReports();
  const importedTracks = reports.find((r) => r.report.code === reportCode)?.report.upkeepTracks;

  try {
    const cached = await repo.listAbilities();
    const [logged, bleeds, playerAuras] = await Promise.all([
      fetchFightCasts(reportCode, fightId, actorName),
      /*
       * Blood Frenzy is not in the combat log, so it has to be reasoned out of
       * the bleeds that carry it. Fetched live rather than tracked at import,
       * which means every already-imported report answers it — see fight-upkeep.
       *
       * Asked ONLY when this spec's sim actually models the debuff. The audit
       * has always been driven by what a given sim models, but the query wasn't:
       * every warlock and priest comparison was paying a round trip to Warcraft
       * Logs for two warrior bleeds whose answer it would then discard.
       */
      modelsBloodFrenzy(settings)
        ? fetchFightDebuffUptime(reportCode, fightId, BLOOD_FRENZY_BLEEDS).catch(
            () => [] as Awaited<ReturnType<typeof fetchFightDebuffUptime>>,
          )
        : Promise.resolve([] as Awaited<ReturnType<typeof fetchFightDebuffUptime>>),
      /*
       * Every buff this raider carried. The stored upkeep tracks only cover
       * auras a player is responsible for, so blessings, drums and Heroism
       * landing ON him were reported as "not tracked by this app" — a gap in
       * our own collection, not in the log.
       */
      fetchPlayerAuras(reportCode, fightId, actorName).catch(() => undefined),
    ]);
    /*
     * Three sources, weakest first: the guild's other reports, then the pull
     * itself, then anything resolved from Wowhead. The logs win on wording
     * where they have it (that's what the raider sees in-game), and Wowhead
     * fills the ids no log has ever carried — including the item-id actions
     * (sappers, Bloodlust Brooch) that no cast event can ever name.
     */
    const names: NameBook = {};
    const spellNames: Record<number, string> = { ...logged.spellNames };
    for (const [id, name] of Object.entries(spellNames)) names[`spell:${id}`] = name;
    const infoByKey = new Map(cached.map((a) => [refKey(a), a]));
    const applyCached = () => {
      for (const a of cached) {
        /*
         * An item's Use effect and the spell the log records for it are the
         * same click. Naming the item after that spell is what collapses them
         * into one row: otherwise a sapper charge shows up twice — "sim only"
         * on the item and "pull only" on the spell — and the raider is told
         * they skipped something they actually used.
         */
        const viaSpell = a.useSpellId ? spellNames[a.useSpellId] : undefined;
        names[refKey(a)] ??= viaSpell ?? a.name;
      }
    };
    applyCached();

    const { request, warnings } = buildRaidSimRequest(settings, {
      gear: pull.gear,
      durationMs: logged.durationMs,
    });
    /*
     * The averaged run for every number on screen, plus a handful of
     * single-iteration runs for the timeline — one per seed. A timeline has to
     * be one pull, and picking the seed whose DPS lands nearest the 3,000-run
     * mean means the pull on screen is representative rather than whichever one
     * seed 1 happened to produce. See representativeRun.
     */
    const timelineSeeds = [1, 2, 3, 4, 5, 6, 7, 8];
    const talents = talentWarning(settings, pull.talents);
    const [result, ...candidates] = await Promise.all([
      runSim(request),
      ...timelineSeeds.map((randomSeed) =>
        runSim(
          buildRaidSimRequest(settings, {
            gear: pull.gear,
            durationMs: logged.durationMs,
            withTimeline: true,
            randomSeed,
          }).request,
        ).catch(() => undefined),
      ),
    ]);
    const timelineResult = representativeRun(candidates, simDpsOf(result) ?? 0);

    /*
     * Only now reach for the other reports' ability dictionaries, and only for
     * as long as something is still unnamed.
     *
     * This used to fetch every report the character appears in, in parallel,
     * on every comparison — eleven extra WCL queries at once for a dictionary
     * that usually adds nothing, because the pull's own casts already name what
     * the raider pressed. Under that burst WCL starts returning degraded
     * responses, and one of those poisoned the overview cache and made a fight
     * that plainly exists report as missing.
     */
    for (const code of reports.map((r) => r.report.code)) {
      if (code === reportCode) continue;
      if (simActionRefs(result, names).every((r) => names[refKey(r.ref)])) break;
      const dictionary = await fetchReportAbilities(code).catch(() => ({}) as Record<number, string>);
      for (const [id, name] of Object.entries(dictionary)) {
        spellNames[Number(id)] ??= name;
        names[`spell:${id}`] ??= name;
      }
      applyCached();
    }

    const a = profileFromCasts({
      label: `${actorName} — logged`,
      durationMs: logged.durationMs,
      casts: logged.casts,
      talents: pull.talents,
      dps: pull.amount === undefined ? undefined : Math.round(pull.amount),
      damageByName: logged.damageByName,
      hitsByName: logged.hitsByName,
      damageTimesByName: logged.damageTimes,
    });
    const b = simProfile(result, {
      label: "Sim — same gear, same length",
      names,
      talents: pull.talents,
      durationMs: logged.durationMs,
      timelineLogs: timelineResult?.logs,
    });

    const act = activity(logged.casts, logged.durationMs);
    const setup = describeSetup({ settings, request, result, pull, activity: act });

    const audit = auditSimContext({
      settings,
      pull,
      bossDebuffs: bossDebuffUptime(pullRows),
      playerBuffs: playerBuffUptime(pullRows, actorName),
      tracks: {
        collected: new Set(TRACKED_AURA_NAMES),
        atImport: importedTracks ? new Set(importedTracks) : undefined,
      },
      // Drums are a party buff from a leatherworker — the audited raider's own
      // row is the one place the answer certainly isn't. Same for a shaman's
      // Bloodlust and every totem drop.
      raidDrums: pullRows.reduce((sum, r) => sum + r.drums, 0),
      raidCasts: pullRows.reduce<Record<string, number>>((acc, r) => {
        for (const c of r.castTimes) acc[c.name] = (acc[c.name] ?? 0) + 1;
        return acc;
      }, {}),
      bloodFrenzy: bloodFrenzyEvidence(pullRows, bleeds),
      playerAuras,
      simDurationMs: logged.durationMs,
    });

    /*
     * Every ability on screen gets a Wowhead link and, once looked up, a
     * description — not only the ones no log could name. A raider reading
     * "Heroic Strike 40/min vs 12/min" benefits from the same tooltip as one
     * reading "Item 10646", and the lookup is cached forever either way.
     */
    const comparison = compareRotations(a, b);
    const shown = new Set(comparison.abilities.map((x) => x.name));
    const refsByName = new Map<string, AbilityRef>();
    for (const { name, ref } of simActionRefs(result, names)) refsByName.set(name, ref);
    for (const [id, name] of Object.entries(spellNames)) {
      if (!refsByName.has(name)) refsByName.set(name, { kind: "spell", id: Number(id) });
    }

    const abilities: Record<string, AbilityLink> = {};
    for (const name of shown) {
      const ref = refsByName.get(name) ?? parseRefKey(nameAsRefKey(name));
      if (!ref) continue;
      const info = infoByKey.get(refKey(ref));
      abilities[name] = {
        key: refKey(ref),
        url: wowheadUrl(ref),
        description: info?.description,
        cached: info !== undefined,
      };
    }
    const unnamed = [...shown].filter((n) => /^(Spell|Item) \d+$/.test(n));

    const findingsInput = {
      abilities: comparison.abilities,
      audit: audit.rows,
      activity: act,
      durationMs: logged.durationMs,
      loggedDps: a.dps,
      simDps: b.dps,
    };
    const found = findings(findingsInput);

    const notes = [
      ...warnings.map((w) => w.message),
      ...(talents ? [talents.message] : []),
      ...(buildMatchNote(a.build, b.build) ? [buildMatchNote(a.build, b.build)!] : []),
    ];

    return {
      status: "ok",
      encounterName: logged.encounterName,
      durationMs: logged.durationMs,
      loggedDps: a.dps,
      simDps: b.dps,
      comparison,
      audit,
      auditHeadline: auditHeadline(audit),
      setup,
      activity: act,
      abilities,
      unnamed,
      events: {
        /*
         * Casts and hits interleaved, the way Warcraft Logs presents a fight.
         * Capped: a long pull runs to a few thousand lines and the whole result
         * crosses the wire to the browser.
         */
        logged: [
          ...logged.casts.map((c) => ({ tMs: c.tMs, name: c.name, kind: "cast" as const })),
          ...logged.damageEvents.map((d) => ({
            tMs: d.tMs,
            name: d.name,
            kind: "damage" as const,
            amount: d.amount,
          })),
        ]
          .sort((x, y) => x.tMs - y.tMs || x.kind.localeCompare(y.kind))
          .slice(0, 4000),
        sim: parseSimEvents(timelineResult?.logs, names).slice(0, 4000),
      },
      findings: found,
      findingsHeadline: findingsHeadline(findingsInput, found),
      notes,
    };
  } catch (e) {
    if (e instanceof SimError || e instanceof WclError) return { status: "error", message: e.message };
    return { status: "error", message: e instanceof Error ? e.message : "The comparison failed." };
  }
}

/** "Item 10646" is its own ref — that placeholder is where the kind survives. */
function nameAsRefKey(name: string): string {
  const m = /^(Spell|Item) (\d+)$/.exec(name);
  return m ? `${m[1].toLowerCase()}:${m[2]}` : "";
}

const resolveSchema = z.object({
  keys: z.array(z.string().regex(/^(spell|item):\d+$/)).min(1).max(100),
});

/**
 * Look up the abilities in a comparison, and cache them.
 *
 * Same shape as the item backfill: a trickle of one-at-a-time requests, capped
 * per press, cached forever, and a ref Wowhead has nothing for stays unnamed
 * rather than being retried in a loop. Resolved here rather than at import time
 * because which abilities matter only becomes clear once a sim has run.
 *
 * The kind travels with the id deliberately. Wowhead has both a spell 23827 and
 * an item 23827, and they are unrelated — asking the wrong endpoint returns a
 * confident wrong name, which is worse than the bare number it replaced.
 */
export async function resolveSimAbilities(input: {
  keys: string[];
}): Promise<{ ok: boolean; message: string }> {
  const parsed = resolveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Nothing to look up." };
  try {
    const repo = await getWriteRepo();
    const known = new Set((await repo.listAbilities()).map((a) => refKey(a)));
    const todo = parsed.data.keys
      .filter((k) => !known.has(k))
      .flatMap((k) => {
        const ref = parseRefKey(k);
        return ref ? [ref] : [];
      });
    if (todo.length === 0) return { ok: true, message: "Every ability here is already named." };

    const { resolved, failed, throttled } = await resolveAbilitiesFromWowhead(todo);
    const written = await repo.addAbilities(resolved as AbilityInfo[]);
    refreshAfterWrite("/", "layout");

    const parts = [`Named ${written} of ${todo.length}.`];
    if (failed.length > 0) {
      // Naming the failures matters: an id Wowhead has nothing for is usually a
      // sign we asked the wrong id space, and the officer can check the link.
      parts.push(
        `No Wowhead entry for ${failed.map((f) => `${f.kind} ${f.id}`).join(", ")}.`,
      );
    }
    if (throttled) parts.push("Wowhead started refusing requests — press again in a minute for the rest.");
    return { ok: written > 0 || failed.length === 0, message: parts.join(" ") };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Lookup failed." };
  }
}

const saveSchema = z.object({
  wowClass: z.string().min(1),
  spec: z.string().min(1),
  link: z.string().trim(),
});

/**
 * Both the spec page and the index, in one call.
 *
 * The index is prerendered and carries each spec's "setup saved" badge, so
 * revalidating only the page that was edited leaves the grid claiming a spec has
 * no setup right after one was pasted into it.
 */
const refreshSim = () => refreshAfterWrite("/sim", "layout");

/**
 * Save (or clear, with an empty link) one spec's wowsims setup.
 *
 * The export states its own class, so a Warrior link pasted onto the Shaman page
 * is refused outright rather than saved and puzzled over later — that is the one
 * mismatch which makes every number downstream meaningless. Everything softer
 * (spec, build, race, professions) is reported by the pre-run check instead,
 * because an officer may legitimately want to sim a build nobody played.
 */
export async function saveSimProfile(input: {
  wowClass: string;
  spec: string;
  link: string;
}): Promise<{ ok: boolean; message: string }> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input." };
  const { wowClass, spec, link } = parsed.data;
  const repo = await getWriteRepo();

  if (!link) {
    await repo.setSimProfile(wowClass, spec, undefined);
    refreshSim();
    return { ok: true, message: `Setup removed from ${wowClass} · ${spec}.` };
  }
  if (!simConfigured()) {
    return {
      ok: false,
      message:
        "No simulator configured. Download wowsimcli from github.com/wowsims/tbc-new/releases and set WOWSIMCLI_PATH in .env.local.",
    };
  }
  try {
    const json = await decodeSimLink(link);
    const stated = classOfSettings(JSON.parse(json) as IndividualSimSettings);
    if (stated && stated !== wowClass) {
      return {
        ok: false,
        message: `That link is a ${stated} setup, and this is the ${wowClass} · ${spec} profile. Save it under ${stated} instead.`,
      };
    }
    await repo.setSimProfile(wowClass, spec, json);
    refreshSim();
    return { ok: true, message: `Setup saved for ${wowClass} · ${spec}.` };
  } catch (e) {
    return { ok: false, message: e instanceof SimError ? e.message : "Could not read that link." };
  }
}

const adoptSchema = z.object({
  wowClass: z.string().min(1),
  spec: z.string().min(1),
  slug: z.string().min(1),
});

/**
 * Adopt a per-character setup left over from before spec profiles.
 *
 * Those were promoted automatically wherever the build resolved to exactly one
 * spec. What reaches this action is the remainder: builds this guild's logs name
 * more than one way — 0/44/17 is Feral, Guardian *and* Warden — where only the
 * officer can say which profile it belongs in.
 */
export async function adoptSimSetting(input: {
  wowClass: string;
  spec: string;
  slug: string;
}): Promise<{ ok: boolean; message: string }> {
  const parsed = adoptSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input." };
  const { wowClass, spec, slug } = parsed.data;
  const repo = await getWriteRepo();
  const detail = await repo.getSimSpec(wowClass, spec);
  const stranded = detail?.stranded.find((s) => s.slug === slug);
  if (!stranded) return { ok: false, message: "That saved setup is no longer available." };
  await repo.setSimProfile(wowClass, spec, stranded.json);
  refreshSim();
  return { ok: true, message: `${slug}'s saved setup is now the ${wowClass} · ${spec} profile.` };
}
