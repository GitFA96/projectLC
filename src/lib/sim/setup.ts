import type { WclPlayerFight } from "@/lib/types";
import type { IndividualSimSettings, RaidSimRequest } from "@/lib/sim/request";
import { talentsToTreePoints } from "@/lib/sim/request";
import type { RaidSimResult } from "@/lib/sim/result";
import type { Activity } from "@/lib/analysis/rotation";

/**
 * The parameters a comparison actually ran under, stated rather than assumed.
 *
 * Reading a DPS gap means knowing what produced both numbers: how many
 * iterations the sim averaged, what it was hitting and through how much armour,
 * which build was played, how long the kill took, and how much of that time the
 * raider could attack at all. Left implicit, every one of those is a way for
 * the comparison to be quietly wrong.
 *
 * Shaped as facts, not as a two-column diff. Most of these have one side only —
 * iterations are the sim's, deaths are the pull's — and laying them out as
 * "sim vs pull" produced a table that was half empty dashes, which reads as
 * missing data rather than as a question that doesn't apply. Each row states
 * its own value and says so when the two sides disagree.
 *
 * Pure — everything is read back off the request, the result and the pull.
 */

/** wowsims Stat enum index for armour, from proto/common.proto. */
const STAT_ARMOR = 31;

export type SetupState =
  /** Both sides stated the same thing — the comparison is on solid ground here. */
  | "agree"
  /** Both sides stated it and they differ — read the gap with this in mind. */
  | "differ"
  /** Only one side has an answer; the other doesn't have the concept. */
  | "single";

export interface SetupRow {
  label: string;
  /** The headline value. */
  value: string;
  /** Second line — the other side, or the qualifier that makes the value honest. */
  detail?: string;
  /** Why this parameter matters, on hover. */
  note?: string;
  state: SetupState;
}

function secs(ms: number): string {
  return `${Math.round(ms / 1000)}s`;
}

function targetOf(settings: IndividualSimSettings) {
  const targets = (settings.encounter as { targets?: unknown[] } | undefined)?.targets;
  return (targets?.[0] ?? undefined) as
    | { level?: number; mobType?: string; stats?: number[]; name?: string }
    | undefined;
}

/** A row whose two sides may or may not agree — the state follows from that. */
function pair(
  label: string,
  sim: string | undefined,
  logged: string | undefined,
  opts: { note?: string; simLabel?: string; loggedLabel?: string } = {},
): SetupRow {
  const simLabel = opts.simLabel ?? "sim";
  const loggedLabel = opts.loggedLabel ?? "pull";
  if (sim !== undefined && logged !== undefined) {
    return sim === logged
      ? { label, value: sim, detail: "sim and pull agree", note: opts.note, state: "agree" }
      : {
          label,
          value: `${loggedLabel} ${logged}`,
          detail: `${simLabel} ${sim}`,
          note: opts.note,
          state: "differ",
        };
  }
  const only = sim ?? logged;
  return {
    label,
    value: only ?? "not captured",
    detail: only === undefined ? undefined : sim !== undefined ? simLabel : loggedLabel,
    note: opts.note,
    state: "single",
  };
}

export function describeSetup(input: {
  settings: IndividualSimSettings;
  request: RaidSimRequest;
  result: RaidSimResult;
  pull: WclPlayerFight;
  activity: Activity;
}): SetupRow[] {
  const { settings, request, result, pull } = input;
  const target = targetOf(settings);
  const armor = target?.stats?.[STAT_ARMOR];
  const iterations = result.iterationsDone ?? request.simOptions.iterations;

  /*
   * The logs report all three trees; wowsims drops trailing empty ones ("21/40"
   * vs "21/40/0"). Pad BOTH sides to the same width — padding one direction
   * only still reports an identical build as a mismatch, which is the exact
   * false positive talentWarning was fixed for.
   */
  const simTree = settings.player?.talentsString
    ? talentsToTreePoints(settings.player.talentsString)
    : undefined;
  const width = Math.max(simTree?.length ?? 0, pull.talents.length);
  const pad = (xs: number[]) => Array.from({ length: width }, (_, i) => xs[i] ?? 0).join("/");
  const simTalents = simTree ? pad(simTree) : undefined;
  const pullTalents = pull.talents.length > 0 ? pad(pull.talents) : undefined;

  const worn = pull.gear.filter((g) => (g.ilvl ?? 0) > 0);
  const avgIlvl =
    worn.length > 0 ? Math.round(worn.reduce((s, g) => s + (g.ilvl ?? 0), 0) / worn.length) : undefined;

  const simSecs = ((request.encounter as { duration?: number }).duration ?? 0) * 1000;

  return [
    { label: "Boss", value: pull.encounterName, state: "single" },
    pair("Kill time", secs(simSecs), secs(pull.durationMs), {
      note: "The sim runs the pull's real length, with no variance.",
    }),
    pair("Talents", simTalents, pullTalents, {
      note: "Different builds have different ceilings — a mismatch makes the gap context, not a verdict.",
    }),
    {
      label: "Active time",
      value: `${input.activity.activePct}% attacking`,
      detail: `${secs(input.activity.idleMs)} idle · the sim never stops`,
      note: "Share of the pull spent casting. A real pull has phases, knockbacks and target swaps; most of a DPS gap on a movement fight lives here.",
      // The sim is always 100% — stating that as a disagreement is the point.
      state: input.activity.activePct >= 95 ? "agree" : "differ",
    },
    {
      label: "Iterations",
      value: `${iterations.toLocaleString("en-US")} runs`,
      detail: "DPS is the mean of all of them",
      note: "A single run varies by hundreds of DPS; the average is the only number worth comparing.",
      state: "single",
    },
    {
      label: "Rotation",
      value:
        settings.player?.rotation?.type === "TypeAPL"
          ? `APL · ${settings.player.rotation.priorityList?.length ?? 0} priorities`
          : "no APL",
      detail:
        settings.player?.rotation?.type === "TypeAPL"
          ? "sim presses this list perfectly"
          : "the sim would only auto-attack",
      state: settings.player?.rotation?.type === "TypeAPL" ? "single" : "differ",
    },
    {
      label: "Sim target",
      value: [target?.level ? `level ${target.level}` : undefined, target?.mobType?.replace(/^MobType/, "")]
        .filter(Boolean)
        .join(" · ") || "default",
      detail: armor === undefined ? "armour not set" : `${armor.toLocaleString("en-US")} armour`,
      // Stated as what armour does rather than as what it's worth: it is the
      // biggest lever on a physical sim and none at all on a caster's, and this
      // row is now read on every spec's page.
      note: "Armour reduces the physical damage the target takes; spell damage ignores it entirely.",
      state: "single",
    },
    {
      label: "Gear",
      value: avgIlvl === undefined ? "not captured" : `${avgIlvl} average ilvl`,
      detail: avgIlvl === undefined ? undefined : `${worn.length} items, as worn on the pull`,
      note: "The sim wears the pull's gear, not a BiS list.",
      state: "single",
    },
    {
      label: "Spec as logged",
      value: pull.spec ?? "not recorded",
      detail: "what Warcraft Logs called it",
      state: "single",
    },
    {
      label: "Deaths",
      value: String(pull.deaths),
      detail: pull.deaths > 0 ? "time dead is time not attacking" : undefined,
      state: pull.deaths > 0 ? "differ" : "agree",
    },
  ];
}
