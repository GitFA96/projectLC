import { UPTIME_TRACK_BY_LABEL } from "@/lib/wcl/class-tracks";
import { hasFlaskOrElixir } from "@/lib/analysis/preparation";
import { DEFAULT_POLICY, type GuildPolicy } from "@/lib/analysis/policy";
import type {
  ConsumableTypeRow,
  ImprovementFinding,
  PlayerBuffRecipient,
  ParseBoard,
  ParseBoardColumn,
  ParseBoardRow,
  PlayerBuffSource,
  PlayerImprovements,
  RaidCooldownRow,
  RaidFight,
  RaidPlayerBuffRow,
  RaidPrepStats,
  RaidReportView,
  RaiderUsage,
  RaidSession,
  RaidTotemFight,
  RaidUpkeepRow,
  TotemDropLane,
  UpkeepFightProvider,
  WclPlayerFight,
  WclReport,
} from "@/lib/types";

/**
 * Raid-wide rollup of one report (one raid night): preparation coverage,
 * maintained debuff/buff uptime, cooldown usage, and per-raider preparation
 * gaps. Pure — the store resolves roster slugs and hands them in so matched
 * players can deep-link to their performance page.
 */



/** "Hydross, Lurker +2 more" — keeps boss lists short. */
function bossList(names: string[], cap = 3): string {
  if (names.length <= cap) return names.join(", ");
  return `${names.slice(0, cap).join(", ")} +${names.length - cap} more`;
}

function pct(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 100);
}

/** Overlapping/adjacent up-intervals folded into disjoint ones, in time order. */
export function mergeSegments(segments: [number, number][]): [number, number][] {
  const sorted = [...segments].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const [from, to] of sorted) {
    const last = merged[merged.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  return merged;
}

/** % of a pull covered by the union of up-intervals — two providers overlapping still count once. */
function coveragePct(segments: [number, number][], durationMs: number): number {
  if (durationMs <= 0) return 0;
  const up = mergeSegments(segments).reduce((sum, [from, to]) => sum + (to - from), 0);
  return Math.round(Math.min(100, (up / durationMs) * 100));
}

/**
 * Prep-buff re-application model for the gold estimate. Approximate hours each
 * timed buff lasts — a buff kept up across a raid longer than this (present in
 * an early AND a late pull) was re-applied, so it's counted more than once
 * (e.g. a flask, 2h, on a 3-hour night ≈ 2 flasks). Easy to tune.
 */
export const PREP_HOURS = { flask: 2, elixir: 1, food: 1, weapon: 1, scroll: 1 } as const;

/**
 * How many times a prep buff was bought this raid. Base 1; consumed buffs (not
 * flask, which survives death) add one per death; and a buff maintained across
 * a raid longer than it lasts is scaled by how many of its windows the night
 * spans. The largest of these wins.
 */
export function prepApplications(opts: {
  durationHours: number;
  persistsDeath: boolean;
  spanHours: number;
  deaths: number;
  early: boolean;
  late: boolean;
}): number {
  const { durationHours, persistsDeath, spanHours, deaths, early, late } = opts;
  const deathApps = persistsDeath ? 1 : 1 + deaths;
  const durationApps =
    early && late && spanHours > durationHours ? Math.ceil(spanHours / durationHours) : 1;
  return Math.max(1, deathApps, durationApps);
}

export interface RaidReportInput {
  report: WclReport;
  session?: RaidSession;
  rows: WclPlayerFight[];
  reportPulls: number;
  /** Lowercased actor name → roster slug, for deep-linking matched raiders. */
  slugByActor: Map<string, string>;
  /**
   * Pulls the officers switched off for this report (a farm wipe, an off-night
   * gimmick fight). They stay in the fight list, flagged, but contribute
   * nothing to prep coverage, consumable/cooldown counts, uptime or
   * improvements.
   */
  excludedFightIds?: number[];
  /** The council's policy — what counts as prepared, and how gaps are ranked. */
  policy?: GuildPolicy;
}

export function summarizeRaidReport(input: RaidReportInput): RaidReportView {
  const { report, session, rows: allRows, reportPulls, slugByActor } = input;
  const policy = input.policy ?? DEFAULT_POLICY;
  const severity = policy.improvementSeverity;
  const slugOf = (actorName: string) => slugByActor.get(actorName.toLowerCase());
  const excluded = new Set(input.excludedFightIds ?? []);

  /* Distinct boss pulls, in pull order — every pull, excluded ones flagged. */
  const fightById = new Map<number, RaidFight>();
  for (const r of allRows) {
    if (!fightById.has(r.fightId)) {
      fightById.set(r.fightId, {
        fightId: r.fightId,
        encounterName: r.encounterName,
        kill: r.kill,
        fightPercentage: r.fightPercentage,
        durationMs: r.durationMs,
        startMs: r.fightStartMs,
        ...(excluded.has(r.fightId) ? { excluded: true } : {}),
      });
    }
  }
  const fights = [...fightById.values()].sort((a, b) => a.fightId - b.fightId);
  // Everything below this line is derived from the INCLUDED pulls only.
  const rows = excluded.size === 0 ? allRows : allRows.filter((r) => !excluded.has(r.fightId));

  // Raid span + early/late pull halves feed the duration-based prep model:
  // a buff present in both halves of a long night was re-applied.
  const spanMs = Date.parse(report.endTime) - Date.parse(report.startTime);
  const spanHours = Number.isFinite(spanMs) && spanMs > 0 ? spanMs / 3_600_000 : 0;
  const includedFights = fights.filter((f) => !f.excluded);
  const nFights = includedFights.length;
  const fightHalf = new Map<number, { early: boolean; late: boolean }>();
  includedFights.forEach((f, i) =>
    fightHalf.set(f.fightId, { early: i < Math.ceil(nFights / 2), late: i >= Math.floor(nFights / 2) }),
  );

  /* Rows grouped per raider (by logged name). */
  const byActor = new Map<string, WclPlayerFight[]>();
  for (const r of rows) {
    const list = byActor.get(r.actorName) ?? [];
    list.push(r);
    byActor.set(r.actorName, list);
  }

  /* ---- Preparation + in-fight totals ---- */
  // Each consumable type tracks who used it (actor → count) for the per-type
  // provider breakdown the overview folds out.
  const potionTypes = new Map<string, Map<string, number>>();
  const inFightTypes = new Map<string, Map<string, number>>();
  let potionsTotal = 0;
  let prepots = 0;
  let sappersTotal = 0;
  const bump = (m: Map<string, Map<string, number>>, name: string, actorName: string) => {
    const providers = m.get(name) ?? new Map<string, number>();
    providers.set(actorName, (providers.get(actorName) ?? 0) + 1);
    m.set(name, providers);
  };
  for (const r of rows) {
    for (const p of r.potions) {
      bump(potionTypes, p, r.actorName);
      potionsTotal++;
    }
    for (const c of r.otherCasts) bump(inFightTypes, c, r.actorName);
    if (r.prepot) prepots++;
    sappersTotal += r.sappers;
  }
  const toTypeRows = (m: Map<string, Map<string, number>>): ConsumableTypeRow[] =>
    [...m]
      .map(([name, providerMap]) => ({
        name,
        uses: [...providerMap.values()].reduce((s, n) => s + n, 0),
        providers: [...providerMap]
          .map(([actorName, count]) => ({ name: actorName, slug: slugOf(actorName), count }))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name));
  const prep: RaidPrepStats = {
    rows: rows.length,
    raiders: byActor.size,
    flaskOrElixirPct: pct(rows.filter((r) => hasFlaskOrElixir(r, policy.preparation)).length, rows.length),
    foodPct: pct(rows.filter((r) => r.food).length, rows.length),
    weaponBuffPct: pct(rows.filter((r) => r.weaponBuff).length, rows.length),
    prepotPct: pct(prepots, rows.length),
    potionsTotal,
    prepots,
    potionTypes: toTypeRows(potionTypes),
    inFightTypes: toTypeRows(inFightTypes),
    sappersTotal,
  };

  /* ---- Per-raider usage tallies (rankings tab) ---- */
  const usage: RaiderUsage[] = [...byActor]
    .map(([actorName, playerRows]): RaiderUsage => {
      const itemCounts = new Map<string, number>();
      const cdCounts = new Map<string, number>();
      let potions = 0;
      let sappers = 0;
      let otherCastsTotal = 0;
      let prepotCount = 0;
      let cooldownsTotal = 0;
      let deaths = 0;
      let className: string | undefined;
      let role = playerRows[0]?.role ?? "dps";
      // Prep/passive buffs are per-pull coverage, not casts — collect the
      // distinct ones the player ran plus whether they held each in an early
      // AND a late pull (→ re-applied over a long night), for the model below.
      const flaskNames = new Set<string>();
      const elixirNames = new Set<string>();
      const scrollNames = new Set<string>();
      const extraNames = new Set<string>();
      let anyFood = false;
      let anyWeapon = false;
      const present = {
        flask: { early: false, late: false },
        elixir: { early: false, late: false },
        scroll: { early: false, late: false },
        food: { early: false, late: false },
        weapon: { early: false, late: false },
      };
      for (const r of playerRows) {
        for (const p of r.potions) {
          itemCounts.set(p, (itemCounts.get(p) ?? 0) + 1);
          potions++;
        }
        for (const c of r.otherCasts) itemCounts.set(c, (itemCounts.get(c) ?? 0) + 1);
        for (const cd of r.cooldowns) {
          cdCounts.set(cd, (cdCounts.get(cd) ?? 0) + 1);
          cooldownsTotal++;
        }
        otherCastsTotal += r.otherCasts.length;
        sappers += r.sappers;
        deaths += r.deaths;
        if (r.prepot) prepotCount++;
        const pos = fightHalf.get(r.fightId) ?? { early: false, late: false };
        const mark = (k: keyof typeof present) => {
          present[k].early ||= pos.early;
          present[k].late ||= pos.late;
        };
        if (r.flask) {
          flaskNames.add(r.flask);
          mark("flask");
        }
        if (r.elixirs.length > 0) mark("elixir");
        for (const e of r.elixirs) elixirNames.add(e);
        if (r.scrolls.length > 0) mark("scroll");
        for (const s of r.scrolls) scrollNames.add(s);
        for (const x of r.extras) extraNames.add(x);
        if (r.food) {
          anyFood = true;
          mark("food");
        }
        if (r.weaponBuff) {
          anyWeapon = true;
          mark("weapon");
        }
        className = r.className ?? className;
        role = r.role ?? role;
      }
      const rank = (m: Map<string, number>) =>
        [...m]
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      // Duration + death aware: flask survives death but re-buys over a long
      // night; consumed buffs add one per death; situational extras stay death-aware.
      const apps = (kind: keyof typeof present, persistsDeath: boolean) =>
        prepApplications({ durationHours: PREP_HOURS[kind], persistsDeath, spanHours, deaths, ...present[kind] });
      const prepBreakdown = [
        ...[...flaskNames].map((name) => ({ name, count: apps("flask", true) })),
        ...[...elixirNames].map((name) => ({ name, count: apps("elixir", false) })),
        ...[...scrollNames].map((name) => ({ name, count: apps("scroll", false) })),
        ...[...extraNames].map((name) => ({ name, count: 1 + deaths })),
        ...(anyFood ? [{ name: "Food", count: apps("food", false) }] : []),
        ...(anyWeapon ? [{ name: "Weapon oil/stone", count: apps("weapon", false) }] : []),
      ].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      return {
        name: actorName,
        slug: slugOf(actorName),
        className,
        role,
        potions,
        sappers,
        otherItems: otherCastsTotal - sappers,
        consumablesTotal: potions + otherCastsTotal,
        prepots: prepotCount,
        cooldowns: cooldownsTotal,
        itemBreakdown: rank(itemCounts),
        cooldownBreakdown: rank(cdCounts),
        deaths,
        prepBreakdown,
      };
    })
    .sort((a, b) => b.consumablesTotal - a.consumablesTotal || a.name.localeCompare(b.name));

  /* ---- Maintained debuff/buff uptime ---- */
  // Per track → per provider: average their pct across the pulls they were in.
  // Alongside, keep the raw per-pull numbers for the boss-by-boss breakdown.
  const upkeepByTrack = new Map<string, Map<string, { sum: number; pulls: number; className?: string }>>();
  const upkeepByTrackFight = new Map<string, Map<number, UpkeepFightProvider[]>>();
  for (const r of rows) {
    for (const u of r.upkeep) {
      const providers = upkeepByTrack.get(u.name) ?? new Map();
      const acc = providers.get(r.actorName) ?? { sum: 0, pulls: 0, className: r.className };
      acc.sum += u.pct;
      acc.pulls += 1;
      providers.set(r.actorName, acc);
      upkeepByTrack.set(u.name, providers);

      const fightMap = upkeepByTrackFight.get(u.name) ?? new Map<number, UpkeepFightProvider[]>();
      const fightProviders = fightMap.get(r.fightId) ?? [];
      fightProviders.push({
        name: r.actorName,
        slug: slugOf(r.actorName),
        className: r.className,
        pct: u.pct,
        targets: u.targets,
      });
      fightMap.set(r.fightId, fightProviders);
      upkeepByTrackFight.set(u.name, fightMap);
    }
  }
  const upkeep: RaidUpkeepRow[] = [...upkeepByTrack].map(([name, providerMap]) => {
    const providers = [...providerMap]
      .map(([actorName, acc]) => ({
        name: actorName,
        slug: slugOf(actorName),
        pct: Math.round(acc.sum / Math.max(1, acc.pulls)),
      }))
      .sort((a, b) => b.pct - a.pct);
    const track = UPTIME_TRACK_BY_LABEL.get(name.toLowerCase());
    const dominantClass = [...providerMap.values()][0]?.className;
    // A track that has since left the catalogue (or an import that predates it)
    // still has to sort somewhere: enemy targets mean it was a debuff, purely
    // friendly ones a buff. Without this an old row would claim "on boss".
    const allTargets = [...(upkeepByTrackFight.get(name) ?? new Map<number, UpkeepFightProvider[]>()).values()]
      .flat()
      .flatMap((p) => p.targets ?? []);
    const onlyPlayerTargets = allTargets.length > 0 && allTargets.every((t) => t.player);
    const perFight = [...(upkeepByTrackFight.get(name) ?? new Map<number, UpkeepFightProvider[]>())]
      .map(([fightId, fightProviders]) => ({
        fightId,
        providers: fightProviders.sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.fightId - b.fightId);
    return {
      name,
      className: dominantClass,
      kind: track?.kind ?? (onlyPlayerTargets ? "selfbuff" : "debuff"),
      providers,
      bestPct: providers[0]?.pct ?? 0,
      perFight,
    };
  });
  // Debuffs (on the boss) first, then by best uptime descending.
  const kindOrder = { debuff: 0, selfbuff: 1, buff: 1 } as const;
  upkeep.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || b.bestPct - a.bestPct || a.name.localeCompare(b.name));

  /* ---- Raid buffs from the receiving end ("uptime by player") ---- */
  // The provider's row carries the per-victim breakdown; invert it into
  // track → pull → recipient → providers, so a raider can be read as "what did
  // I have up, and who gave it to me".
  const classByActor = new Map<string, string | undefined>();
  const pullsByActor = new Map<string, number>();
  for (const r of rows) {
    if (r.className) classByActor.set(r.actorName, r.className);
    pullsByActor.set(r.actorName, (pullsByActor.get(r.actorName) ?? 0) + 1);
  }
  const durationOf = new Map(fights.map((f) => [f.fightId, f.durationMs]));
  interface BuffTrackAcc {
    className?: string;
    /** fightId → recipient → provider → their coverage of that recipient. */
    perFight: Map<number, Map<string, Map<string, PlayerBuffSource>>>;
    applicationsByProvider: Map<string, number>;
  }
  const buffTracks = new Map<string, BuffTrackAcc>();
  for (const r of rows) {
    for (const u of r.upkeep) {
      const track = UPTIME_TRACK_BY_LABEL.get(u.name.toLowerCase());
      if (track?.kind !== "buff") continue;
      for (const t of u.targets ?? []) {
        if (!t.player) continue;
        const acc = buffTracks.get(u.name) ?? {
          className: r.className,
          perFight: new Map(),
          applicationsByProvider: new Map(),
        };
        acc.className ??= r.className;
        const recipients = acc.perFight.get(r.fightId) ?? new Map<string, Map<string, PlayerBuffSource>>();
        const sources = recipients.get(t.target) ?? new Map<string, PlayerBuffSource>();
        const prev = sources.get(r.actorName);
        // Presses of the button, when the buff comes from a tracked cooldown:
        // a targeted one (Innervate) only counts on the raider it was aimed at.
        const casts = r.castTimes
          .filter((c) => c.name === u.name && (c.target === undefined || c.target === t.target))
          .map((c) => c.atMs);
        sources.set(r.actorName, {
          name: r.actorName,
          slug: slugOf(r.actorName),
          className: r.className,
          pct: Math.max(prev?.pct ?? 0, t.pct),
          segments: [...(prev?.segments ?? []), ...t.segments],
          applications: (prev?.applications ?? 0) + (t.applications ?? 0),
          ...(casts.length > 0 ? { casts: [...(prev?.casts ?? []), ...casts] } : {}),
        });
        recipients.set(t.target, sources);
        acc.perFight.set(r.fightId, recipients);
        acc.applicationsByProvider.set(
          r.actorName,
          (acc.applicationsByProvider.get(r.actorName) ?? 0) + (t.applications ?? 0),
        );
        buffTracks.set(u.name, acc);
      }
    }
  }
  const playerBuffs: RaidPlayerBuffRow[] = [...buffTracks]
    .map(([name, acc]): RaidPlayerBuffRow => {
      // Coverage sums per recipient across pulls; the night average divides by
      // the pulls they were IN, so a pull spent unbuffed counts as a zero.
      const coverageByRecipient = new Map<string, number>();
      const perFight = [...acc.perFight]
        .map(([fightId, recipientMap]) => {
          const durationMs = durationOf.get(fightId) ?? 0;
          const recipients: PlayerBuffRecipient[] = [...recipientMap]
            .map(([recipient, sourceMap]) => {
              const sources = [...sourceMap.values()]
                .map((s) => ({
                  ...s,
                  segments: mergeSegments(s.segments),
                  ...(s.casts ? { casts: [...new Set(s.casts)].sort((a, b) => a - b) } : {}),
                }))
                .sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name));
              const pct = coveragePct(sources.flatMap((s) => s.segments), durationMs);
              coverageByRecipient.set(recipient, (coverageByRecipient.get(recipient) ?? 0) + pct);
              return { name: recipient, slug: slugOf(recipient), className: classByActor.get(recipient), pct, sources };
            })
            .sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name));
          return { fightId, recipients };
        })
        .sort((a, b) => a.fightId - b.fightId);
      const recipients = [...coverageByRecipient]
        .map(([recipient, total]) => ({
          name: recipient,
          slug: slugOf(recipient),
          className: classByActor.get(recipient),
          pct: Math.round(total / Math.max(1, pullsByActor.get(recipient) ?? 1)),
          pulls: pullsByActor.get(recipient) ?? 0,
        }))
        .sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name));
      const providers = [...acc.applicationsByProvider]
        .map(([provider, applications]) => ({
          name: provider,
          slug: slugOf(provider),
          className: classByActor.get(provider),
          applications,
        }))
        .sort((a, b) => b.applications - a.applications || a.name.localeCompare(b.name));
      return { name, className: acc.className, recipients, providers, perFight };
    })
    // Raid-wide buffs (shouts, totems) first, spot buffs like Innervate after.
    .sort((a, b) => b.recipients.length - a.recipients.length || a.name.localeCompare(b.name));

  /* ---- Totem drops ---- */
  // TBC logs the drop but never the buff a totem hands out, so the timeline of
  // presses is the whole story: which totem each shaman put down, and when.
  const totemsByFight = new Map<number, Map<string, TotemDropLane>>();
  for (const r of rows) {
    const drops = r.castTimes.filter((c) => c.totem);
    if (drops.length === 0) continue;
    const lanes = totemsByFight.get(r.fightId) ?? new Map<string, TotemDropLane>();
    const lane = lanes.get(r.actorName) ?? {
      name: r.actorName,
      slug: slugOf(r.actorName),
      className: r.className,
      drops: [],
    };
    lane.drops.push(...drops.map((c) => ({ name: c.name, atMs: c.atMs })));
    lane.drops.sort((a, b) => a.atMs - b.atMs || a.name.localeCompare(b.name));
    lanes.set(r.actorName, lane);
    totemsByFight.set(r.fightId, lanes);
  }
  const totems: RaidTotemFight[] = [...totemsByFight]
    .map(([fightId, lanes]) => ({
      fightId,
      lanes: [...lanes.values()].sort((a, b) => b.drops.length - a.drops.length || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.fightId - b.fightId);

  /* ---- Cooldown usage ---- */
  const cooldownByName = new Map<string, Map<string, number>>();
  for (const r of rows) {
    for (const cd of r.cooldowns) {
      const providers = cooldownByName.get(cd) ?? new Map<string, number>();
      providers.set(r.actorName, (providers.get(r.actorName) ?? 0) + 1);
      cooldownByName.set(cd, providers);
    }
  }
  const cooldowns: RaidCooldownRow[] = [...cooldownByName]
    .map(([name, providerMap]) => ({
      name,
      uses: [...providerMap.values()].reduce((s, n) => s + n, 0),
      providers: [...providerMap]
        .map(([actorName, count]) => ({ name: actorName, slug: slugOf(actorName), count }))
        .sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name));

  /* ---- Per-raider preparation gaps ---- */
  const improvements: PlayerImprovements[] = [];
  for (const [actorName, playerRows] of byActor) {
    const ordered = [...playerRows].sort((a, b) => a.fightId - b.fightId);
    const findings: ImprovementFinding[] = [];

    // Enchants come from the latest pull's gear snapshot.
    const latest = ordered[ordered.length - 1];
    const missing = latest?.missingEnchants ?? [];
    if (missing.includes("Main hand")) {
      findings.push({ severity: "high", label: "No weapon enchant", detail: "main-hand has no permanent enchant" });
    }
    const otherEnchants = missing.filter((m) => m !== "Main hand");
    if (otherEnchants.length > 0) {
      findings.push({ severity: "medium", label: "Missing enchants", detail: otherEnchants.join(", ") });
    }

    // Flask/elixir + food are at-pull facts (fair on wipes too).
    const noFlaskOrElixir = ordered.filter((r) => !hasFlaskOrElixir(r, policy.preparation));
    if (noFlaskOrElixir.length > 0) {
      const allNight = noFlaskOrElixir.length === ordered.length;
      findings.push({
        severity: allNight ? "high" : "medium",
        label: allNight ? "No flask/elixir all night" : "No flask/elixir",
        detail: allNight ? undefined : `on ${bossList(noFlaskOrElixir.map((r) => r.encounterName))}`,
      });
    }
    const noFood = ordered.filter((r) => !r.food);
    if (noFood.length > 0) {
      findings.push({
        severity: "low",
        label: noFood.length === ordered.length ? "No food buff" : "No food",
        detail: noFood.length === ordered.length ? undefined : `on ${bossList(noFood.map((r) => r.encounterName))}`,
      });
    }
    // No potion on a KILL (wipes can end before a repot — don't punish those).
    const killsNoPot = ordered.filter((r) => r.kill && r.potions.length === 0 && !r.prepot);
    if (killsNoPot.length > 0) {
      findings.push({
        severity: "low",
        label: "No potion on a kill",
        detail: `on ${bossList(killsNoPot.map((r) => r.encounterName))}`,
      });
    }

    if (findings.length === 0) continue;
    const score = findings.reduce((s, f) => s + severity[f.severity], 0);
    improvements.push({
      name: actorName,
      slug: slugOf(actorName),
      className: latest?.className,
      role: latest?.role ?? "dps",
      score,
      findings: findings.sort((a, b) => severity[b.severity] - severity[a.severity]),
    });
  }
  improvements.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  /* ---- Parse boards (the WCL-style grid) ---- */
  const parseBoards = buildParseBoards(rows, fights, slugOf);

  return {
    report, session, fights, reportPulls, prep, upkeep, playerBuffs, totems, cooldowns, improvements, usage,
    parseBoards,
  };
}


/**
 * Parses as a grid: one table per role, a column per boss kill, mirroring
 * Warcraft Logs' own rankings view.
 *
 * Each cell carries BOTH percentiles WCL ranks a raider on — the role's metric
 * and, for anyone who deals damage, the same pull ranked on damage to the boss
 * alone. They're different numbers (on a night with adds, by up to ten points),
 * so the board switches metric rather than repeating every raider in a second
 * table.
 *
 * Only kills get a column — a wipe has no percentile to report — and a raider
 * only appears in a board if they were ranked on at least one of them, so a
 * healer never shows up as a row of blanks under Damage Dealers. Averages are
 * over the kills they actually have a parse for, never over the whole night:
 * missing a boss shouldn't read as a zero.
 */
function buildParseBoards(
  rows: WclPlayerFight[],
  fights: RaidFight[],
  slugOf: (actorName: string) => string | undefined,
): ParseBoard[] {
  const columnsAll: ParseBoardColumn[] = fights
    .filter((f) => f.kill && !f.excluded)
    .map((f) => ({ fightId: f.fightId, encounterName: f.encounterName, durationMs: f.durationMs }));
  if (columnsAll.length === 0) return [];

  const definitions: {
    key: ParseBoard["key"];
    label: string;
    metric: string;
    keeps: (r: WclPlayerFight) => boolean;
    /** Healers deal no meaningful boss damage — WCL ranks them at ~0. */
    bossDamage: boolean;
  }[] = [
    {
      key: "dps",
      label: "Damage Dealers",
      metric: "damage done, all targets",
      keeps: (r) => r.role === "dps",
      bossDamage: true,
    },
    {
      key: "healers",
      label: "Healers",
      metric: "healing done",
      keeps: (r) => r.role === "healer",
      bossDamage: false,
    },
    {
      key: "tanks",
      label: "Tanks",
      metric: "damage done, within the tank bracket",
      keeps: (r) => r.role === "tank",
      bossDamage: true,
    },
  ];

  const boards: ParseBoard[] = [];
  for (const def of definitions) {
    const byActor = new Map<string, WclPlayerFight[]>();
    for (const r of rows) {
      if (!def.keeps(r) || r.parsePercent === undefined) continue;
      const list = byActor.get(r.actorName) ?? [];
      list.push(r);
      byActor.set(r.actorName, list);
    }
    if (byActor.size === 0) continue;

    // Columns nobody in this board was ranked on would be dead width.
    const ranked = new Set([...byActor.values()].flat().map((r) => r.fightId));
    const columns = columnsAll.filter((c) => ranked.has(c.fightId));

    const boardRows: ParseBoardRow[] = [...byActor]
      .map(([actorName, playerRows]): ParseBoardRow => {
        const cells = columns.flatMap((column) => {
          const row = playerRows.find((r) => r.fightId === column.fightId);
          if (!row || row.parsePercent === undefined) return [];
          return [
            {
              fightId: column.fightId,
              parse: row.parsePercent,
              bracket: row.bracketPercent,
              amount: row.amount,
              spec: row.spec,
              ...(def.bossDamage && row.bossParsePercent !== undefined
                ? { bossParse: row.bossParsePercent, bossAmount: row.bossAmount }
                : {}),
            },
          ];
        });
        const bossCells = cells.filter((c) => c.bossParse !== undefined);
        const newest = playerRows[playerRows.length - 1];
        return {
          name: actorName,
          slug: slugOf(actorName),
          className: newest?.className,
          spec: modeOf(playerRows.map((r) => r.spec)),
          avg: mean(cells.map((c) => c.parse)),
          ranked: cells.length,
          bossAvg: mean(bossCells.map((c) => c.bossParse!)),
          bossRanked: bossCells.length,
          cells,
        };
      })
      .sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1) || a.name.localeCompare(b.name));

    boards.push({
      key: def.key,
      label: def.label,
      metric: def.metric,
      // Offered only when the report actually carries boss-damage parses —
      // imports from before they were fetched keep the single metric.
      ...(boardRows.some((r) => r.bossRanked > 0)
        ? { bossMetric: "damage to the boss only — no adds, no cleave padding" }
        : {}),
      columns,
      rows: boardRows,
    });
  }
  return boards;
}

/** Rounded mean, or undefined for nothing to average. */
function mean(values: number[]): number | undefined {
  return values.length > 0
    ? Math.round(values.reduce((sum, v) => sum + v, 0) / values.length)
    : undefined;
}

/** The most frequent value, ties broken by first appearance. */
function modeOf(values: (string | undefined)[]): string | undefined {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
}
