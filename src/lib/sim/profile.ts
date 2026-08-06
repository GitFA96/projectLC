import type { WclPlayerFight } from "@/lib/types";
import { talentsToTreePoints, type IndividualSimSettings } from "@/lib/sim/request";

/**
 * A sim setup belongs to a class and spec, not to a raider — and this module is
 * how we tell whether the raider we're about to point it at is actually that
 * spec.
 *
 * The rule throughout: **read what a source says, never infer what it means**.
 * A wowsims export states its own class (`player.class = "ClassWarrior"`), so
 * the class check is exact. Nothing states the spec, so the spec is answered by
 * the guild's OWN logs: every pull where Warcraft Logs named a spec teaches us
 * that this class with these talents is called that. Katzewarr's 21/40/0 logs as
 * Fury on 76 kills and 33/28/0 as Arms on 34, so his saved setup resolves to
 * Fury without anyone hard-coding a talent tree to a spec name.
 *
 * That mapping is deliberately allowed to be AMBIGUOUS. Warcraft Logs calls
 * 0/44/17 Feral, Guardian and Warden depending on what the druid was doing, and
 * 10/41/10 both Justicar and Protection — it reads the role off the pull, not
 * off the build. Where the logs disagree with themselves we say all the names
 * they used rather than picking the most common one and calling it the answer.
 *
 * Pure. Everything here is a function of a settings blob, a pull row, and what
 * the logs have already recorded.
 */

/** Its own class, as the export states it. Undefined when the field is absent. */
export function classOfSettings(settings: IndividualSimSettings): string | undefined {
  const raw = settings.player?.class;
  if (typeof raw !== "string" || raw === "") return undefined;
  return raw.replace(/^Class/, "");
}

/** Its own race, same treatment. The logs record nobody's race, so this is one-sided. */
export function raceOfSettings(settings: IndividualSimSettings): string | undefined {
  const raw = (settings.player as { race?: unknown } | undefined)?.race;
  if (typeof raw !== "string" || raw === "") return undefined;
  // "RaceBloodElf" reads better split than run together.
  return raw.replace(/^Race/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
}

/**
 * The spec-options key wowsims hung on the player ("dpsWarrior",
 * "enhancementShaman", "warlock").
 *
 * Found structurally rather than from a list: whichever key ENDS in the class
 * the export already told us it is. A memorised list of spec keys would rot the
 * first time wowsims renamed one, and would quietly return nothing for the
 * classes nobody had thought to add.
 */
export function specOptionKey(settings: IndividualSimSettings): string | undefined {
  const wowClass = classOfSettings(settings);
  const player = settings.player;
  if (!wowClass || !player) return undefined;
  const suffix = new RegExp(`${wowClass}$`, "i");
  return Object.keys(player).find((k) => suffix.test(k) && k !== "class");
}

/** The professions the setup claims. Order is wowsims'; we don't sort it. */
export function professionsOfSettings(settings: IndividualSimSettings): string[] {
  const p = settings.player as { profession1?: unknown; profession2?: unknown } | undefined;
  return [p?.profession1, p?.profession2].filter(
    (x): x is string => typeof x === "string" && x !== "" && x !== "ProfessionUnknown",
  );
}

/** Points per talent tree, from whichever form the side has it in. */
export function treePointsOfSettings(settings: IndividualSimSettings): number[] | undefined {
  const s = settings.player?.talentsString;
  return s ? talentsToTreePoints(s) : undefined;
}

/**
 * Compare two builds without tripping on trailing zeroes.
 *
 * wowsims drops empty trailing trees ("21/40") where the logs always report all
 * three ("21/40/0"). Comparing raw arrays calls an identical build a mismatch —
 * the same false positive `talentWarning` was fixed for.
 */
export function sameBuild(a: number[] | undefined, b: number[] | undefined): boolean {
  if (!a || !b) return false;
  const width = Math.max(a.length, b.length);
  for (let i = 0; i < width; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return false;
  }
  return true;
}

/** "21/40/0" at a shared width, so two builds print comparably. */
export function buildLabel(points: number[] | undefined, width = 3): string | undefined {
  if (!points || points.length === 0) return undefined;
  const w = Math.max(width, points.length);
  return Array.from({ length: w }, (_, i) => points[i] ?? 0).join("/");
}

const fingerprintKey = (wowClass: string, points: number[]) =>
  `${wowClass}|${buildLabel(points)}`;

/** What the logs have called one build, commonest naming first. */
export interface SpecNaming {
  spec: string;
  pulls: number;
}

/** class + build → every spec name Warcraft Logs used for it. */
export type SpecFingerprints = Map<string, SpecNaming[]>;

/**
 * Learn the class/build → spec-name mapping from the pulls the logs did name.
 *
 * Built from the guild's own reports on purpose. A hard-coded table would be
 * domain knowledge invented here (invariant 4), would miss the names Warcraft
 * Logs actually emits for this guild — Justicar, Warden, Dreamstate, Gladiator —
 * and would need editing every time a raider respecs.
 */
export function specFingerprints(pulls: readonly WclPlayerFight[]): SpecFingerprints {
  const counts = new Map<string, Map<string, number>>();
  for (const p of pulls) {
    if (!p.className || !p.spec || p.talents.length === 0) continue;
    const key = fingerprintKey(p.className, p.talents);
    const inner = counts.get(key) ?? new Map<string, number>();
    inner.set(p.spec, (inner.get(p.spec) ?? 0) + 1);
    counts.set(key, inner);
  }
  const out: SpecFingerprints = new Map();
  for (const [key, inner] of counts) {
    out.set(
      key,
      [...inner]
        .map(([spec, pulls]) => ({ spec, pulls }))
        .sort((a, b) => b.pulls - a.pulls || a.spec.localeCompare(b.spec)),
    );
  }
  return out;
}

/** One fingerprint, flat — the shape that survives the server/client boundary. */
export interface SpecFingerprintRow {
  wowClass: string;
  /** "21/40/0". */
  build: string;
  specs: SpecNaming[];
}

export function fingerprintRows(fingerprints: SpecFingerprints): SpecFingerprintRow[] {
  return [...fingerprints].map(([key, specs]) => {
    const sep = key.indexOf("|");
    return { wowClass: key.slice(0, sep), build: key.slice(sep + 1), specs };
  });
}

export function fingerprintsFromRows(rows: readonly SpecFingerprintRow[]): SpecFingerprints {
  return new Map(rows.map((r) => [`${r.wowClass}|${r.build}`, r.specs]));
}

/** Every spec name the logs have used for this class with this build. */
export function specsForBuild(
  fingerprints: SpecFingerprints,
  wowClass: string | undefined,
  points: number[] | undefined,
): SpecNaming[] {
  if (!wowClass || !points || points.length === 0) return [];
  return fingerprints.get(fingerprintKey(wowClass, points)) ?? [];
}

/**
 * The spec a pull was, preferring what the log said outright.
 *
 * The fallback earns its place from the fingerprints, not from volume: on this
 * guild's data today it changes nothing, because all 500-odd rows Warcraft Logs
 * left unlabelled are wipes, and the sim section only offers kills. What it
 * buys is that the picker can never silently lose a raider from a spec they
 * demonstrably played — the alternative is a kill vanishing with no visible
 * reason, which is the failure mode nobody debugs.
 */
export function specOfPull(
  pull: Pick<WclPlayerFight, "spec" | "className" | "talents">,
  fingerprints: SpecFingerprints,
): { spec?: string; inferred: boolean; alternatives: string[] } {
  if (pull.spec) return { spec: pull.spec, inferred: false, alternatives: [] };
  const named = specsForBuild(fingerprints, pull.className, pull.talents);
  if (named.length === 0) return { inferred: false, alternatives: [] };
  return {
    spec: named[0].spec,
    inferred: true,
    alternatives: named.slice(1).map((n) => n.spec),
  };
}

export type CheckState = "match" | "differs" | "unknown";

export interface ProfileCheckRow {
  label: string;
  /** What the spec profile assumes. */
  profile: string;
  /** What this pull actually says — or why it can't. */
  logged: string;
  state: CheckState;
  /** Why the row matters, on hover. */
  note?: string;
}

export interface ProfileCheckInput {
  settings: IndividualSimSettings;
  /** The spec whose profile this is — the page you're standing on. */
  spec: string;
  wowClass: string;
  pull: Pick<WclPlayerFight, "spec" | "className" | "talents" | "sappers">;
  fingerprints: SpecFingerprints;
}

/**
 * What the profile assumes, against what the log recorded for this pull.
 *
 * States the disagreements; blocks nothing. An officer may well want to sim a
 * raider against a build he didn't play — "what if he'd gone Fury" is a real
 * question — and a comparison you're not allowed to run is a comparison you
 * can't argue with. Every row that can't be answered says so rather than
 * reading as agreement.
 */
export function profileCheck(input: ProfileCheckInput): ProfileCheckRow[] {
  const { settings, spec, wowClass, pull, fingerprints } = input;
  const rows: ProfileCheckRow[] = [];

  /* Class: the one thing both sides state outright. */
  const simClass = classOfSettings(settings);
  rows.push({
    label: "Class",
    profile: simClass ?? "not stated",
    logged: pull.className ?? "not logged",
    state:
      simClass === undefined || pull.className === undefined
        ? "unknown"
        : simClass === pull.className
          ? "match"
          : "differs",
    note: "The sim export names its own class. A mismatch means this setup cannot describe this raider at all.",
  });

  /* Spec: this page's, against what the logs call the pull. */
  const pullSpec = specOfPull(pull, fingerprints);
  rows.push({
    label: "Spec",
    profile: spec,
    logged: pullSpec.spec
      ? pullSpec.inferred
        ? `${pullSpec.spec} — from the build; Warcraft Logs left this pull unlabelled`
        : pullSpec.spec
      : "not logged, and no other pull has named this build",
    state: pullSpec.spec === undefined ? "unknown" : pullSpec.spec === spec ? "match" : "differs",
    note: "Which spec Warcraft Logs recorded. Where it recorded none, the same build on a labelled pull answers for it.",
  });

  /* Build: the number both sides actually have. */
  const simPoints = treePointsOfSettings(settings);
  const simBuild = buildLabel(simPoints);
  const pullBuild = buildLabel(pull.talents.length > 0 ? pull.talents : undefined);
  const simNames = specsForBuild(fingerprints, wowClass, simPoints).map((n) => n.spec);
  rows.push({
    label: "Talents",
    profile: simBuild ?? "no talent string",
    logged: pullBuild ?? "not logged",
    state:
      simBuild === undefined || pullBuild === undefined
        ? "unknown"
        : sameBuild(simPoints, pull.talents)
          ? "match"
          : "differs",
    note:
      simNames.length > 0
        ? `This guild's logs call the profile's build ${simNames.join(" or ")}. Different builds have different ceilings — read a mismatch as context, not a verdict.`
        : "Different builds have different ceilings — read a mismatch as context, not a verdict.",
  });

  /*
   * Race and professions are per-RAIDER facts, and a spec profile is shared. The
   * logs record neither, so neither can be confirmed — saying so is the point of
   * the row. Engineering is the one exception: a thrown sapper is proof.
   */
  const race = raceOfSettings(settings);
  if (race) {
    rows.push({
      label: "Race",
      profile: race,
      logged: "not recorded in the logs",
      state: "unknown",
      note: "Racials are in the sim's number. A shared spec profile carries one race, and Warcraft Logs never says whose it should be.",
    });
  }

  const professions = professionsOfSettings(settings);
  if (professions.length > 0) {
    const engineering = professions.some((p) => /engineering/i.test(p));
    const sappers = pull.sappers > 0;
    rows.push({
      label: "Professions",
      profile: professions.join(" · "),
      logged: sappers
        ? `threw ${pull.sappers} sapper charge${pull.sappers === 1 ? "" : "s"} — engineering confirmed`
        : "not recorded in the logs",
      // Only ever positive evidence: no sapper on a two-minute pull proves
      // nothing, so its absence must not read as a contradiction.
      state: engineering && sappers ? "match" : "unknown",
      note: "Profession perks are in the sim's number. Only engineering leaves a trace in a log, and only when something was thrown.",
    });
  }

  return rows;
}

/** The rows worth interrupting for — a shared profile pointed at the wrong build. */
export function profileCheckWarnings(rows: ProfileCheckRow[]): ProfileCheckRow[] {
  return rows.filter((r) => r.state === "differs");
}
