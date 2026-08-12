import type { WclPlayerFight } from "@/lib/types";

import { compareText } from "@/lib/sort";

/**
 * Talent builds as played, for deciding whether two performances can honestly
 * be set side by side.
 *
 * A class name and a spec label are not enough. Warcraft Logs calls a warrior
 * "Arms" whenever the Arms tree holds the most points, so a hybrid built for a
 * raid debuff and a deep Arms build share one label while having different
 * damage ceilings — and comparing across them reads as a performance gap when
 * it is a build difference. The talent point split separates them.
 *
 * The array is treated as OPAQUE on purpose. It answers "same build?" and
 * nothing else. Deriving which abilities a build could use would need the real
 * talent tree layout, which this app doesn't have and must not guess: a 33/28/0
 * warrior in this guild's logs turned out to have Death Wish when a plausible
 * reading of the tiers said it shouldn't.
 */

/** How two performances relate, for labelling a comparison. */
export type BuildMatch =
  /** Same points in every tree — directly comparable. */
  | "same"
  /** Both builds known and different — comparable, but say so loudly. */
  | "different"
  /** At least one side predates talent capture — we cannot tell. */
  | "unknown";

export interface BuildInfo {
  /** Points per tree in the game's tree order, as logged. */
  talents: number[];
  /** "33/28/0", or undefined when the pull carries no talents. */
  label?: string;
  /** Equality key — undefined when unknown, so unknowns never compare equal. */
  key?: string;
}

/** True when the log actually carried a build (all-zero is still a build). */
export function hasBuild(talents: number[] | undefined): talents is number[] {
  return Array.isArray(talents) && talents.length > 0;
}

export function buildOf(talents: number[] | undefined): BuildInfo {
  if (!hasBuild(talents)) return { talents: [] };
  const label = talents.join("/");
  return { talents: [...talents], label, key: label };
}

/** The build a pull was played with. */
function buildOfFight(fight: Pick<WclPlayerFight, "talents">): BuildInfo {
  return buildOf(fight.talents);
}

/**
 * How two builds relate. Unknown wins over different: if we can't see one side
 * we say so rather than implying a mismatch that may not exist.
 */
export function compareBuilds(a: BuildInfo, b: BuildInfo): BuildMatch {
  if (a.key === undefined || b.key === undefined) return "unknown";
  return a.key === b.key ? "same" : "different";
}

/** One-line explanation for the UI — why a comparison may not be like-for-like. */
export function buildMatchNote(a: BuildInfo, b: BuildInfo): string | undefined {
  switch (compareBuilds(a, b)) {
    case "same":
      return undefined;
    case "different":
      return `Different builds — ${a.label} vs ${b.label}. Ability access and damage ceiling differ, so treat the gap as context, not a verdict.`;
    case "unknown":
      return "Talents weren't captured for at least one of these pulls, so we can't confirm the builds match. Re-import the report to fill this in.";
  }
}

/**
 * Group a player's pulls by the build they were played with, commonest first.
 * The roster's single spec label hides that a raider swaps between builds
 * across a season; this is what shows it.
 */
export function buildsPlayed(
  fights: Pick<WclPlayerFight, "talents">[],
): { build: BuildInfo; pulls: number }[] {
  const byKey = new Map<string, { build: BuildInfo; pulls: number }>();
  for (const f of fights) {
    const build = buildOfFight(f);
    if (build.key === undefined) continue;
    const hit = byKey.get(build.key);
    if (hit) hit.pulls += 1;
    else byKey.set(build.key, { build, pulls: 1 });
  }
  return [...byKey.values()].sort(
    (x, y) => y.pulls - x.pulls || compareText((x.build.label ?? ""), y.build.label ?? ""),
  );
}
