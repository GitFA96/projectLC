import { TBC_RAIDS, raidOfBoss } from "@/lib/constants/wow";

/**
 * Whose night a report is.
 *
 * A log records pulls, never whose raid it was. The guild's own Wednesday and
 * a Sunday pug look identical in every column — same bosses, same potions, same
 * gold — so this is an officer's statement about a report, not something the
 * import can work out. It is the report-level twin of `characters.status`,
 * which answers the same question one raider at a time (see
 * `isGuildCharacter`).
 *
 * Only `guild` feeds the guild's own record: attendance, gold per raid,
 * performance and every loot score built on them. The other two are kept in
 * full and read on their own headings — a night that happened is still a night
 * that happened, and deleting it to keep the numbers clean would throw away the
 * only record of it (invariant 6).
 */
export type RaidScope = "guild" | "one-off" | "pug";

/** What a report with no stored scope is. Nothing is written for this value. */
export const DEFAULT_RAID_SCOPE: RaidScope = "guild";

/**
 * The three, in the order they are offered and shown. Guild first because it is
 * the default and the one an officer is usually looking at.
 */
export const RAID_SCOPES: readonly {
  scope: RaidScope;
  /** Heading and menu label. */
  label: string;
  /** One line under the heading, saying what the scope does to the numbers. */
  blurb: string;
}[] = [
  {
    scope: "guild",
    label: "Guild",
    blurb:
      "The guild's own raids. Attendance, gold per raid, performance and every loot score are counted from these nights and no others.",
  },
  {
    scope: "one-off",
    label: "One-off",
    blurb:
      "A one-off run with the wider community. Kept in full and readable here; counted towards nobody's attendance, gold or performance.",
  },
  {
    scope: "pug",
    label: "Pug",
    blurb:
      "A pug raid. Kept in full and readable here; counted towards nobody's attendance, gold or performance.",
  },
];

const SCOPE_VALUES = new Set<string>(RAID_SCOPES.map((s) => s.scope));

/**
 * Read a stored or user-supplied scope, or undefined when it is not one.
 *
 * Never throws and never guesses: a meta row hand-edited to something this
 * build has never heard of, or a `?scope=` somebody typed, has to read as "no
 * scope given" so the caller falls back to the default rather than filing a
 * night under a heading that does not exist.
 */
export function parseRaidScope(raw: unknown): RaidScope | undefined {
  return typeof raw === "string" && SCOPE_VALUES.has(raw) ? (raw as RaidScope) : undefined;
}

/** Does this scope's night count towards the guild's own record? */
export function isGuildScope(scope: RaidScope): boolean {
  return scope === "guild";
}

/** The label for a scope, for a heading or a badge. */
export function raidScopeLabel(scope: RaidScope): string {
  return RAID_SCOPES.find((s) => s.scope === scope)?.label ?? scope;
}

/**
 * Where a night's bosses say it was, in the order `TBC_RAIDS` lists them.
 *
 * **Not** `report.zone`. That column looks like a zone and isn't — it carries
 * whatever the raid leader typed ("SSC+TK Wednesday", "ssc/tk", "gruul then
 * bt"), which is why the import page offers it as a free-text label at all.
 * Matching that against raid names finds nothing, silently, and every week
 * files itself under nothing. The encounter names come from the log, so this is
 * the one answer that cannot drift from what was actually killed.
 *
 * A night that ran two instances belongs to both, and is listed under both.
 * Taking the larger half instead would file an SSC+TK night under SSC and lose
 * it to anybody looking for their Kael'thas kill.
 */
export function raidsOfEncounters(encounterNames: Iterable<string>): string[] {
  const names = new Set<string>();
  for (const encounter of encounterNames) {
    const raid = raidOfBoss(encounter);
    if (raid) names.add(raid.name);
  }
  return [...names].sort((a, b) => raidRank(a) - raidRank(b));
}

/** Where a night with no boss this app recognises is filed. */
export const OTHER_RAID = "Other";

function raidRank(name: string): number {
  const index = TBC_RAIDS.findIndex((r) => r.name === name);
  return index === -1 ? TBC_RAIDS.length : index;
}

/**
 * Keep only the nights that ran one of the raids picked.
 *
 * **An empty selection is everything**, not nothing. The filter exists to
 * narrow a long list, so "I have picked nothing" has to mean "show me all of
 * it" — the alternative is a control whose default state is an empty page.
 *
 * A night that ran two instances survives if either was picked, and one whose
 * bosses matched nothing survives only when `Other` itself is picked. Both
 * follow from the list being about where somebody raided, not about a single
 * label the night carries.
 */
export function filterReportsByRaids<T>(
  reports: readonly T[],
  raidsOf: (report: T) => readonly string[],
  selected: readonly string[],
): T[] {
  if (selected.length === 0) return [...reports];
  const wanted = new Set(selected);
  return reports.filter((report) => {
    const raids = raidsOf(report);
    return raids.length === 0 ? wanted.has(OTHER_RAID) : raids.some((r) => wanted.has(r));
  });
}

/**
 * Drop picks that no night in this list can satisfy.
 *
 * A raid stays selected in the URL while the scope changes underneath it —
 * pick Black Temple, switch to Pug, and the guild's raid is still in the query
 * string with nothing to match. Left alone that reads as an empty scope rather
 * than as a filter nobody cleared, so the picks are pruned to what is on offer.
 */
export function keepOfferedRaids(
  selected: readonly string[],
  offered: readonly string[],
): string[] {
  const available = new Set(offered);
  return [...new Set(selected)].filter((raid) => available.has(raid));
}

export interface RaidGroup<T> {
  /** The raid, as `TBC_RAIDS` names it, or `OTHER_RAID`. */
  raid: string;
  /** The short form ("BT", "MH"), for a narrow heading. `OTHER_RAID` has none. */
  short?: string;
  reports: T[];
}

/**
 * Section a list of nights by the raid each one ran, in `TBC_RAIDS` order.
 *
 * Input order is preserved inside every section, so a caller that sorted newest
 * first keeps that. A night that ran two instances appears in both sections —
 * see `raidsOfEncounters` — and one whose bosses matched nothing lands in a
 * single `Other` section at the end rather than vanishing, which is what makes
 * a missing entry in `TBC_RAIDS` visible instead of silent.
 */
export function groupReportsByRaid<T>(
  reports: readonly T[],
  raidsOf: (report: T) => readonly string[],
): RaidGroup<T>[] {
  const byRaid = new Map<string, T[]>();
  for (const report of reports) {
    const raids = raidsOf(report);
    for (const raid of raids.length > 0 ? raids : [OTHER_RAID]) {
      const bucket = byRaid.get(raid);
      if (bucket) bucket.push(report);
      else byRaid.set(raid, [report]);
    }
  }
  return [...byRaid]
    .sort(([a], [b]) => raidRank(a) - raidRank(b))
    .map(([raid, grouped]) => ({
      raid,
      short: TBC_RAIDS.find((r) => r.name === raid)?.short,
      reports: grouped,
    }));
}
