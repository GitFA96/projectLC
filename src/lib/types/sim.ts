/**
 * wowsims setups and the specs they belong to.
 *
 * Part of `@/lib/types`, which re-exports every one of these — import from
 * there, not from this file, so a type moving between domains costs nothing.
 */

import type { SpecFingerprintRow } from "@/lib/sim/profile";

/* The sim section — one wowsims setup per class and spec, not per raider. */

/** A per-character setup that predates spec profiles, and where it could go. */
export interface StrandedSimSetting {
  slug: string;
  json: string;
  /** Class from the character, falling back to what the export states. */
  wowClass?: string;
  /** "21/40/0" — the build the export carries. */
  build?: string;
  /**
   * Every spec this guild's logs have called that build. More than one means no
   * migration could place it — the logs name 0/44/17 three different ways.
   */
  specs: string[];
}

/** A class+spec someone in this guild has actually raided as. */
export interface SimSpecView {
  /** Warcraft Logs' own class string, never forced into our enum. */
  wowClass: string;
  spec: string;
  /** A wowsims setup has been saved for this spec. */
  hasProfile: boolean;
  /** Boss kills logged on this spec. */
  kills: number;
  /** Who played it, most kills first. */
  raiders: { actorName: string; slug?: string; kills: number }[];
  /** Newest raid night holding one of those kills, ISO. */
  lastKillAt?: string;
}

/** One logged kill, with everything the pre-run check needs to judge it. */
export interface SimPullView {
  reportCode: string;
  fightId: number;
  actorName: string;
  encounterName: string;
  durationMs: number;
  parsePercent?: number;
  /** ISO date of the raid night — the other axis you can browse by. */
  raidDate: string;
  className?: string;
  spec?: string;
  /** The spec came from the build because Warcraft Logs left this pull blank. */
  specInferred: boolean;
  talents: number[];
  sappers: number;
}

/** Everything one spec's workbench renders. */
export interface SimSpecDetail {
  wowClass: string;
  spec: string;
  /** The saved wowsims setup, as protojson. Undefined until one is pasted. */
  profile?: string;
  pulls: SimPullView[];
  /**
   * class + build → the spec names this guild's logs used for it. Sent to the
   * browser so the pre-run check stays pure and needs no round trip per pull.
   */
  fingerprints: SpecFingerprintRow[];
  /**
   * Per-character setups from before spec profiles that no migration could
   * place — offered for the officer to adopt rather than deleted.
   */
  stranded: StrandedSimSetting[];
}
