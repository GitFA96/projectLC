import type { WclGearItem } from "@/lib/types";

/**
 * Turning a logged pull into a wowsims run.
 *
 * The point of this module is that the sim is configured FROM the log, not
 * from a guess: the gear he actually wore, the talents he actually had, and
 * the length the pull actually ran. That's what makes the comparison "you vs
 * you played perfectly" instead of "you vs a theoretical BiS warrior", which
 * is the version a raider can argue with.
 *
 * Everything here is pure. Running the binary lives in ./run.
 */

/**
 * wowsims equipment index → Warcraft Logs gear-array index.
 *
 * Derived by matching item ids between one raider's exported sim link and the
 * gear snapshot of a pull he raided in — not from memory. WCL slots 3 (shirt)
 * and 18 (tabard) have no sim equivalent and are dropped; they carry no stats.
 */
export const SIM_SLOT_TO_WCL_SLOT: readonly number[] = [
  0, // head
  1, // neck
  2, // shoulder
  14, // back
  4, // chest
  8, // wrist
  9, // hands
  5, // waist
  6, // legs
  7, // feet
  10, // finger 1
  11, // finger 2
  12, // trinket 1
  13, // trinket 2
  15, // main hand
  16, // off hand
  17, // ranged
];

/** One equipped item in the shape wowsims expects. */
export interface SimItem {
  id: number;
  enchant?: number;
  gems?: number[];
}

/**
 * The pull's gear, in sim slot order. A slot the log has nothing for becomes an
 * empty object rather than being skipped — the array is positional, so dropping
 * an entry would shift every later slot onto the wrong body part.
 */
export function simEquipmentFromGear(gear: WclGearItem[]): SimItem[] {
  const byWclSlot = new Map(gear.map((g) => [g.slot, g]));
  return SIM_SLOT_TO_WCL_SLOT.map((wclSlot) => {
    const item = byWclSlot.get(wclSlot);
    if (!item || item.id <= 0) return {} as SimItem;
    const out: SimItem = { id: item.id };
    if (item.enchant) out.enchant = item.enchant;
    const gems = (item.gems ?? []).map((g) => g.id).filter((id) => id > 0);
    if (gems.length > 0) out.gems = gems;
    return out;
  });
}

/** Talent trees as wowsims spells them: dash-separated per-tree strings. */
export function talentsToTreePoints(talentsString: string): number[] {
  return talentsString
    .split("-")
    .map((tree) => [...tree].reduce((sum, ch) => sum + (Number.parseInt(ch, 10) || 0), 0));
}

/**
 * Fewer runs than this and the mean is still moving.
 *
 * A wowsims DPS figure is an average over iterations, and the spread on a
 * two-minute warrior pull is a few hundred DPS. At 1,000 runs the reported
 * number wobbles by enough to read as a real difference between two comparisons
 * of the same pull — which is worse than useless when the officer is trying to
 * tell a rotation problem from noise. 3,000 costs a fraction of a second here.
 */
export const MIN_ITERATIONS = 3000;

export interface SimOverrides {
  /** Worn gear from the pull. Omit to keep whatever the saved settings carry. */
  gear?: WclGearItem[];
  /** Pull length in ms — the sim runs the window the kill actually took. */
  durationMs?: number;
  iterations?: number;
  /**
   * Build a TIMELINE run: one iteration, with its combat log.
   *
   * It has to be its own run. Asking a 3,000-iteration sim for a debug log
   * returns more than one iteration's worth — a real one came back with 100
   * Heroic Strike casts across 78 distinct timestamps, 22 of them repeated —
   * and drawing that as a timeline stacks several pulls on top of each other.
   * A timeline is one pull by definition, so the iteration floor below (which
   * exists to steady a DPS average) doesn't apply to it.
   */
  withTimeline?: boolean;
  randomSeed?: number;
}

/** Loosely-typed wowsims settings — we only touch the fields we override. */
export interface IndividualSimSettings {
  player?: Record<string, unknown> & {
    equipment?: { items?: unknown[] };
    talentsString?: string;
    rotation?: { type?: string; priorityList?: unknown[] };
    /** Personal buffs (blessings, Unleashed Rage) — separate from raidBuffs. */
    buffs?: Record<string, unknown>;
  };
  encounter?: Record<string, unknown> & { duration?: number; durationVariation?: number };
  raidBuffs?: Record<string, unknown>;
  debuffs?: Record<string, unknown>;
  partyBuffs?: Record<string, unknown>;
}

export interface RaidSimRequest {
  raid: {
    parties: { players: unknown[]; buffs?: unknown }[];
    numActiveParties: number;
    buffs?: unknown;
    debuffs?: unknown;
  };
  encounter: unknown;
  simOptions: {
    iterations: number;
    randomSeed: number;
    debug?: boolean;
    debugFirstIteration?: boolean;
  };
}

/** Problems worth telling the officer about rather than silently absorbing. */
export interface RequestWarning {
  code: "no-rotation" | "no-gear" | "talent-mismatch";
  message: string;
}

export interface BuiltRequest {
  request: RaidSimRequest;
  warnings: RequestWarning[];
}

/**
 * Wrap an individual-sim export into the RaidSimRequest the CLI takes, applying
 * the pull's gear and length.
 *
 * The rotation check matters: the web UI converts its "Simple" rotation into an
 * APL before it sends anything, and the Go sim only reads `priorityList`. A
 * link exported on Simple therefore runs with NO rotation — the character
 * auto-attacks, rage-caps, and reports a plausible-looking low number with no
 * error anywhere. We refuse to let that pass silently.
 */
export function buildRaidSimRequest(
  settings: IndividualSimSettings,
  overrides: SimOverrides = {},
): BuiltRequest {
  const warnings: RequestWarning[] = [];
  const player: Record<string, unknown> = { ...(settings.player ?? {}) };

  const priority = settings.player?.rotation?.priorityList ?? [];
  if (settings.player?.rotation?.type !== "TypeAPL" || priority.length === 0) {
    warnings.push({
      code: "no-rotation",
      message:
        "This sim export has no APL priority list, so the sim would auto-attack and report a meaningless number. In wowsims, switch the rotation to APL and export the link again.",
    });
  }

  if (overrides.gear) {
    if (overrides.gear.length === 0) {
      warnings.push({ code: "no-gear", message: "The pull carried no gear snapshot, so the sim kept the gear from the saved setup." });
    } else {
      player.equipment = { items: simEquipmentFromGear(overrides.gear) };
    }
  }

  const encounter: Record<string, unknown> = { ...(settings.encounter ?? {}) };
  if (overrides.durationMs !== undefined) {
    encounter.duration = Math.max(1, Math.round(overrides.durationMs / 1000));
    // The pull is a known length, not a distribution — variance would compare
    // his 134-second kill against sim runs of 129 to 139 seconds.
    encounter.durationVariation = 0;
  }

  return {
    warnings,
    request: {
      raid: {
        parties: [{ players: [player], buffs: settings.partyBuffs }],
        numActiveParties: 1,
        buffs: settings.raidBuffs,
        debuffs: settings.debuffs,
      },
      encounter,
      simOptions: {
        iterations: overrides.withTimeline
          ? 1
          : Math.max(MIN_ITERATIONS, overrides.iterations ?? MIN_ITERATIONS),
        randomSeed: overrides.randomSeed ?? 1,
        debugFirstIteration: overrides.withTimeline ?? false,
      },
    },
  };
}

/**
 * Whether the saved sim setup matches the build he actually played. Returns a
 * warning rather than blocking — the officer decides whether the comparison is
 * worth reading, and may well want to see it anyway.
 */
export function talentWarning(
  settings: IndividualSimSettings,
  pullTalents: number[] | undefined,
): RequestWarning | undefined {
  const simTalents = settings.player?.talentsString;
  if (!simTalents || !pullTalents || pullTalents.length === 0) return undefined;
  const simTree = talentsToTreePoints(simTalents);
  // A wowsims talent string drops trailing empty trees ("21/40"), while the
  // logs always report all three ("21/40/0"). Comparing lengths would call an
  // identical build a mismatch — and a warning that fires when nothing is wrong
  // is worse than none, because it trains the reader to ignore it.
  const width = Math.max(simTree.length, pullTalents.length);
  const pad = (xs: number[]) => Array.from({ length: width }, (_, i) => xs[i] ?? 0);
  const simPadded = pad(simTree);
  const pullPadded = pad(pullTalents);
  if (simPadded.some((n, i) => n !== pullPadded[i])) {
    return {
      code: "talent-mismatch",
      message: `The sim is set up as ${simPadded.join("/")} but this pull was played as ${pullPadded.join("/")}. Different builds have different ceilings — read the gap as context, not a verdict.`,
    };
  }
  return undefined;
}
