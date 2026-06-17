import { z } from "zod";
import type {
  attendanceExemptionSchema,
  characterCommentSchema,
  characterSchema,
  gearSetSchema,
  guildSchema,
  itemSchema,
  lootAwardSchema,
  raidSessionSchema,
  slotItemSchema,
  statBlockSchema,
  wclPlayerFightSchema,
  wclReportSchema,
  wclRoleSchema,
} from "@/lib/import/schemas";
import type { Phase, Quality, Role, SlotId, WowClass } from "@/lib/constants/wow";

export type { Phase, Quality, Role, SlotId, WowClass };

/* Core entities (inferred from the canonical zod schemas) */
export type Guild = z.infer<typeof guildSchema>;
export type Character = z.infer<typeof characterSchema>;
export type Item = z.infer<typeof itemSchema>;
export type SlotItem = z.infer<typeof slotItemSchema>;
export type StatBlock = z.infer<typeof statBlockSchema>;
export type GearSet = z.infer<typeof gearSetSchema>;
export type RaidSession = z.infer<typeof raidSessionSchema>;
export type LootAward = z.infer<typeof lootAwardSchema>;
export type WclReport = z.infer<typeof wclReportSchema>;
export type WclPlayerFight = z.infer<typeof wclPlayerFightSchema>;
export type WclGearItem = WclPlayerFight["gear"][number];
export type WclRole = z.infer<typeof wclRoleSchema>;
export type AttendanceExemption = z.infer<typeof attendanceExemptionSchema>;
export type CharacterComment = z.infer<typeof characterCommentSchema>;

/* Derived view models (computed, never stored) */

export type WishlistSlotState = "awarded" | "equipped" | "open";

export interface WishlistRow {
  slot: SlotId;
  wished: SlotItem;
  /** What the character currently has in that slot (undefined when no current set). */
  current?: SlotItem;
  state: WishlistSlotState;
  /** Set when state === "awarded". */
  awardedAt?: string;
}

export interface WishlistCompletion {
  satisfied: number;
  total: number;
  pct: number; // 0..100, rounded
}

export interface StatDeltaRow {
  key: string;
  label: string;
  current: number;
  target: number;
  delta: number;
}

export interface AwardWishlistMatch {
  matched: boolean;
  phases: Phase[];
}

/** A loot award joined with everything the UI needs to render a ledger row. */
export interface AwardWithContext {
  award: LootAward;
  session: RaidSession;
  sessionPhase?: Phase;
  character?: Character;
  item?: Item;
  wishlist: AwardWishlistMatch;
}

/**
 * Raid attendance derived from imported Warcraft Logs reports (one report =
 * one raid night). The fair denominator is "raids since their first logged
 * appearance" — reports from before someone joined don't count against them.
 * Pull coverage measures presence within attended nights (late join / early
 * leave); the recent window is the last 10 tracked raids.
 */
export interface AttendanceSummary {
  /** All imported reports, for context ("never in any of N logged raids"). */
  raidsTotal: number;
  raidsAttended: number;
  /** Reports since (and including) their first appearance — the denominator. */
  raidsTracked: number;
  raidPct: number;
  /** Report start of their first logged appearance; undefined when never seen. */
  firstSeenAt?: string;
  recentAttended: number;
  recentTotal: number;
  recentPct: number;
  pullsAttended: number;
  /** Total boss pulls of the reports they attended. */
  pullsTotal: number;
  pullPct: number;
  /**
   * Per-reset check ("did they raid that week with this character?"): the most
   * recent raid weeks (EU reset, Wednesday) in which the guild has at least one
   * imported log, since the character's first appearance — newest last, max 8.
   */
  weeks: AttendanceWeek[];
  /** Attended, non-excused weeks. */
  weeksAttended: number;
  /** Non-excused weeks — the per-reset denominator. */
  weeksTracked: number;
  /** Weeks marked as an excused absence (shown, but not counted either way). */
  weeksExcused: number;
}

export interface AttendanceWeek {
  /** ISO date of the reset Wednesday opening the week. */
  start: string;
  attended: boolean;
  /** Imported guild reports in that week. */
  reports: number;
  /** Officer-marked excused absence — neither attended nor missed for the markup. */
  excused: boolean;
}

export interface CharacterSummary {
  character: Character;
  /** Wishlist completion per phase that has an imported wishlist. */
  completionByPhase: { phase: Phase; completion: WishlistCompletion }[];
  totalAwards: number;
  activePhaseAwards: number;
  offspecAwards: number;
  lastAwardAt?: string;
  hasCurrentGear: boolean;
  /** Undefined until at least one Warcraft Logs report is imported. */
  attendance?: AttendanceSummary;
  /** Spec from their most recent logged pulls — may disagree with the roster entry. */
  loggedSpec?: string;
  /** Resolved name of this alt's main (when status "alt" and the link is valid). */
  mainCharacterName?: string;
  /** Names of characters that list this one as their main (this char is a main). */
  altNames?: string[];
}

export interface PhaseWishlistView {
  phase: Phase;
  set: GearSet;
  rows: WishlistRow[];
  completion: WishlistCompletion;
  statDeltas: StatDeltaRow[];
}

export interface CharacterBundle {
  character: Character;
  current?: GearSet;
  wishlists: PhaseWishlistView[];
  awards: AwardWithContext[];
  summary: CharacterSummary;
  /** Officer comment log, newest first. */
  comments: CharacterComment[];
}

export interface ContentionWisher {
  character: Character;
  phases: Phase[];
  /** What they currently have in the item's slot family. */
  currentInSlot: SlotItem[];
  satisfied: boolean;
  onSpecAwardsActivePhase: number;
}

export interface ItemContention {
  item?: Item;
  itemId: number;
  itemName: string;
  wishers: ContentionWisher[];
  awards: AwardWithContext[];
  openCount: number;
}

export interface FairnessEntry {
  character: Character;
  onSpec: number;
  offSpec: number;
}

/** Award distribution for one scope: a single phase, or "all" raids tracked. */
export interface FairnessGroup {
  phase: Phase | "all";
  entries: FairnessEntry[];
}

/** One row of the /items index: cached + wishlisted + awarded items with demand counts. */
export interface ItemDemand {
  itemId: number;
  name: string;
  quality?: Quality;
  icon?: string;
  slot?: SlotId | null;
  source?: { zone: string; boss?: string };
  phase?: Phase;
  wisherCount: number;
  openCount: number;
  awardCount: number;
  lastAwardedAt?: string;
}

/* Warcraft Logs performance views (derived) */

/** Rollup over a set of player-fight rows (one report, or a whole career). */
export interface PerformanceSummary {
  fights: number;
  kills: number;
  wipes: number;
  deaths: number;
  medianParse?: number;
  bestParse?: number;
  medianBracket?: number;
  /** Dominant role/spec across the rows. */
  role: WclRole;
  spec?: string;
  /** % of pulls covered: flask or two elixirs / food / temp weapon buff. */
  flaskOrElixirsPct: number;
  foodPct: number;
  weaponBuffPct: number;
  /** Both flask-or-elixirs AND food up — the headline preparation number. */
  preparedPct: number;
  potionsTotal: number;
  potionsPerFight: number;
  prepots: number;
  drums: number;
  runes: number;
  healthstones: number;
  /** From the most recent pull in the rows. */
  missingEnchants: string[];
}

export interface PerformanceReportView {
  report: WclReport;
  session?: RaidSession;
  rows: WclPlayerFight[];
  summary: PerformanceSummary;
  /** Total boss pulls in the report (all players) — rows.length of them attended. */
  reportPulls: number;
}

export interface CharacterPerformance {
  character: Character;
  /** Newest report first. */
  reports: PerformanceReportView[];
  /** Rollup across every report the character appears in (undefined when none). */
  career?: PerformanceSummary;
  /** Undefined until at least one report is imported. */
  attendance?: AttendanceSummary;
}

export interface WclReportView {
  report: WclReport;
  session?: RaidSession;
  playerCount: number;
  encounterCount: number;
  killCount: number;
}

/* Raid-wide logs dashboard (one report = one raid night) */

export interface RaidFight {
  fightId: number;
  encounterName: string;
  kill: boolean;
  fightPercentage?: number;
  durationMs: number;
}

/** One maintained debuff/buff, with who kept it up and how well across the night. */
export interface RaidUpkeepRow {
  name: string;
  /** WCL class string of the providers (for coloring) — the dominant one. */
  className?: string;
  /** debuff = on the boss; buff/selfbuff = on a friendly target. */
  kind: "debuff" | "buff" | "selfbuff";
  providers: { name: string; slug?: string; pct: number }[];
  /** Best single-provider average uptime across the night. */
  bestPct: number;
}

/** Raid-wide preparation + in-fight consumable totals. */
export interface RaidPrepStats {
  /** Player-pulls (the denominator for the coverage percentages). */
  rows: number;
  raiders: number;
  flaskOrElixirPct: number;
  foodPct: number;
  weaponBuffPct: number;
  prepotPct: number;
  potionsTotal: number;
  prepots: number;
  /** Potion casts by type, most-used first. */
  potionTypes: { name: string; uses: number }[];
  /** Non-potion in-fight items (gems, seeds, healthstones, runes, drums). */
  inFightTypes: { name: string; uses: number }[];
}

export interface RaidCooldownRow {
  name: string;
  uses: number;
  providers: { name: string; slug?: string; count: number }[];
}

export type ImprovementSeverity = "high" | "medium" | "low";

export interface ImprovementFinding {
  severity: ImprovementSeverity;
  label: string;
  /** Boss names or extra context. */
  detail?: string;
}

/** One raider's preparation gaps for the night, worst first. */
export interface PlayerImprovements {
  name: string;
  slug?: string;
  className?: string;
  role: WclRole;
  /** Severity-weighted sum — drives the worst-first ordering. */
  score: number;
  findings: ImprovementFinding[];
}

export interface RaidReportView {
  report: WclReport;
  session?: RaidSession;
  fights: RaidFight[];
  reportPulls: number;
  prep: RaidPrepStats;
  upkeep: RaidUpkeepRow[];
  cooldowns: RaidCooldownRow[];
  /** Raiders with at least one preparation gap, worst first. */
  improvements: PlayerImprovements[];
}


/* Character-vs-character comparison (up to 4, the contribution side-by-side) */

/** One maintained debuff/buff a compared character kept up, career-averaged. */
export interface ComparedUpkeep {
  name: string;
  kind: "debuff" | "buff" | "selfbuff";
  pct: number;
}

/** One character's column in the comparison: the contribution metrics side-by-side. */
export interface ComparedCharacter {
  character: Character;
  /** Spec as actually played in logs (falls back to roster spec for display). */
  loggedSpec?: string;
  /** Resolved main name when this is a linked alt. */
  mainCharacterName?: string;
  /** True once at least one logged pull exists — gates the log-derived metrics. */
  hasLogs: boolean;
  reports: number;
  fights: number;
  /* Damage / output — median dps (hps for healers) across logged pulls. */
  output?: number;
  outputUnit: "dps" | "hps";
  /* Performance */
  medianParse?: number;
  bestParse?: number;
  medianBracket?: number;
  deaths: number;
  deathsPerFight: number;
  /* Attendance */
  attendance?: AttendanceSummary;
  /* Consumables (coverage across logged pulls) */
  preparedPct: number;
  flaskOrElixirsPct: number;
  foodPct: number;
  weaponBuffPct: number;
  potionsPerFight: number;
  prepots: number;
  /* Uptime of the buffs/debuffs their spec is responsible for, career-averaged. */
  upkeep: ComparedUpkeep[];
  /* Comments — the detailed officer log. */
  comments: CharacterComment[];
}

export interface CharacterComparisonView {
  characters: ComparedCharacter[];
  /** Every upkeep track present on any compared character, debuffs first — the row set. */
  upkeepTracks: { name: string; kind: "debuff" | "buff" | "selfbuff" }[];
}

/** A name seen in imported logs that matches no tracked character. */
export interface UntrackedLogPlayer {
  name: string;
  /** WCL class/spec strings from the log, for prefilling a new character. */
  className?: string;
  spec?: string;
  role: WclRole;
  /** Boss pulls they appear in, across all imported reports. */
  appearances: number;
  reportCount: number;
  lastSeen: string;
}

export interface DashboardData {
  guild: Guild;
  rosterSize: number;
  activePhaseAwards: number;
  avgActivePhaseCompletion?: number;
  lastRaid?: RaidSession;
  recentSessions: { session: RaidSession; awardCount: number }[];
  contestedItems: ItemContention[];
  /** "All raids" first, then one group per phase that has awards. */
  fairness: FairnessGroup[];
  /** Awards whose winner is neither a roster character nor marked off-roster. */
  unresolvedCount: number;
}
