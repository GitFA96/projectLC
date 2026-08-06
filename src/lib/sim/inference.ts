import type { WclPlayerFight } from "@/lib/types";
import type { DebuffUpkeep } from "@/lib/wcl/fight-upkeep";

/**
 * Answering for a debuff the combat log never writes down.
 *
 * Blood Frenzy is an Arms talent that makes the warrior's own Rend and Deep
 * Wounds add 4% physical damage taken. TBC Classic does not emit it: across
 * this guild's reports it appears in no ability dictionary (884–1129 abilities
 * each) and produces no events under any of its rank ids, while Mortal Strike,
 * Rend and Deep Wounds from the same warriors are all there. So "we didn't see
 * it" says nothing at all, and a sim that assumes it will always look flattered
 * unless somebody reasons around the gap.
 *
 * The reasoning: the debuff rides on the warrior's own bleeds, so if an
 * Arms-spec warrior had Rend or Deep Wounds on the boss, Blood Frenzy was on it
 * too — for as long as the bleed was.
 *
 * The hole in it, stated rather than hidden: the log cannot show whether that
 * warrior actually spent the points. Blood Frenzy sits deep in the Arms tree,
 * and this app deliberately treats a talent array as an opaque fingerprint
 * rather than decoding which abilities it bought (a 33/28/0 warrior once turned
 * out to have Death Wish when a plausible reading said otherwise). So the
 * result is labelled inferred, carries who it came from and their build, and is
 * never presented as something we observed.
 *
 * Pure. The caller supplies the pull's rows and the measured bleed uptimes.
 */

/** Bleeds that carry Blood Frenzy, in the order we'd rather cite them. */
export const BLOOD_FRENZY_BLEEDS = ["Rend", "Deep Wounds"];

/**
 * Whether this spec's sim models Blood Frenzy at all.
 *
 * The audit only ever emits a row for a debuff the sim was given, but the
 * *query* behind this one wasn't gated the same way: every comparison, for every
 * class, spent a Warcraft Logs round trip measuring two warrior bleeds whose
 * answer a caster's sim then discarded. A physical spec's export ticks this; a
 * warlock's doesn't, because 4% physical damage taken does nothing for it.
 */
export function modelsBloodFrenzy(settings: {
  debuffs?: Record<string, unknown>;
}): boolean {
  const value = settings.debuffs?.bloodFrenzy;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") return value !== "" && !/^TristateEffectMissing$/i.test(value);
  return false;
}

/**
 * Specs whose warriors are far enough into Arms to have taken it.
 *
 * Warcraft Logs labels the guild's hybrid "kebab" build as Arms as well, which
 * is the reason this is a spec check and not a talent check: both builds that
 * can carry Blood Frenzy land here, and a Fury warrior — who also applies Deep
 * Wounds, from the same tier-3 talent every warrior takes — does not.
 */
const ARMS_SPECS = new Set(["arms"]);

export type BloodFrenzyEvidence =
  | {
      kind: "inferred";
      pct: number;
      /** The warrior whose bleed carries it. */
      by: string;
      /** Their tree points as logged, e.g. "33/28/0" — the reader judges the build. */
      build?: string;
      /** Which bleed the uptime came from. */
      via: string;
    }
  /** An Arms warrior was there, but kept no bleed on the boss. */
  | { kind: "no-bleed"; by: string }
  /** Nobody in the raid could have brought it. */
  | { kind: "no-arms-warrior" };

export function bloodFrenzyEvidence(
  pullRows: WclPlayerFight[],
  bleeds: DebuffUpkeep[],
): BloodFrenzyEvidence {
  const arms = pullRows.filter(
    (r) => r.className === "Warrior" && ARMS_SPECS.has((r.spec ?? "").toLowerCase()),
  );
  if (arms.length === 0) return { kind: "no-arms-warrior" };

  const byName = new Map(arms.map((r) => [r.actorName.toLowerCase(), r]));
  const mine = bleeds
    .filter((b) => byName.has(b.source.toLowerCase()) && BLOOD_FRENZY_BLEEDS.includes(b.ability))
    .sort((a, b) => b.pct - a.pct);

  const best = mine[0];
  if (!best || best.pct <= 0) {
    return { kind: "no-bleed", by: arms.map((r) => r.actorName).join(", ") };
  }
  const row = byName.get(best.source.toLowerCase());
  return {
    kind: "inferred",
    pct: best.pct,
    by: best.source,
    build: row && row.talents.length > 0 ? row.talents.join("/") : undefined,
    via: best.ability,
  };
}
