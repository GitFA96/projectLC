import { z } from "zod";
import type {
  attendanceExemptionSchema,
  characterCommentSchema,
  characterSchema,
  currentGearOverrideSchema,
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
import type { GearOverrideSource, Phase, Quality, Role, SlotId, WowClass } from "@/lib/constants/wow";

export type { GearOverrideSource, Phase, Quality, Role, SlotId, WowClass };

/* Core entities (inferred from the canonical zod schemas) */
export type Guild = z.infer<typeof guildSchema>;
export type Character = z.infer<typeof characterSchema>;
export type Item = z.infer<typeof itemSchema>;
export type SlotItem = z.infer<typeof slotItemSchema>;
export type StatBlock = z.infer<typeof statBlockSchema>;
export type GearSet = z.infer<typeof gearSetSchema>;
export type CurrentGearOverride = z.infer<typeof currentGearOverrideSchema>;
export type RaidSession = z.infer<typeof raidSessionSchema>;
export type LootAward = z.infer<typeof lootAwardSchema>;
export type WclReport = z.infer<typeof wclReportSchema>;
export type WclPlayerFight = z.infer<typeof wclPlayerFightSchema>;
export type WclGearItem = WclPlayerFight["gear"][number];
/** One victim of a maintained debuff/buff during a pull, with its up-intervals. */
export type WclUpkeepTarget = NonNullable<WclPlayerFight["upkeep"][number]["targets"]>[number];
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
  /** The loot award that satisfied the slot — the handle for undoing it. */
  awardId?: string;
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
  /** The imported current set with any pinned slots already applied. */
  current?: GearSet;
  wishlists: PhaseWishlistView[];
  awards: AwardWithContext[];
  summary: CharacterSummary;
  /** Officer comment log, newest first. */
  comments: CharacterComment[];
  /** The slots an officer pinned by hand — which parts of `current` aren't the import. */
  currentOverrides: CurrentGearOverride[];
  /** The imported set as it was exported, before pinning. Undefined when nothing was imported. */
  importedCurrent?: GearSet;
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
  /** % of pulls covered: flask or at least one elixir / food / temp weapon buff. */
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
  sappers: number;
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
  /** Pull start, ms from report start — absolute pull/kill clock times derive from it. Absent on pre-timeline imports. */
  startMs?: number;
  /**
   * Officer-excluded pull: it stays visible in the fight list (and in the
   * filter), but feeds nothing derived — no prep coverage, no consumable or
   * cooldown counts, no uptime, no improvement findings.
   */
  excluded?: boolean;
}

/** One provider's uptime of a track during a single boss pull. */
export interface UpkeepFightProvider {
  name: string;
  slug?: string;
  className?: string;
  pct: number;
  /** Per-victim breakdown (boss first, then adds/friendlies) with up-intervals. Absent on pre-timeline imports. */
  targets?: WclUpkeepTarget[];
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
  /**
   * Boss-by-boss breakdown: who kept the track up on each pull and how well
   * (best provider first). Pulls where nobody kept it are absent — the UI
   * renders those as gaps from the fight list. Absent on season inputs — the
   * cross-raid rollup only needs the night averages.
   */
  perFight?: { fightId: number; providers: UpkeepFightProvider[] }[];
}

/* Raid buffs seen from the receiving end — "uptime by player" */

/** One provider's share of a raid buff on one player during a pull. */
export interface PlayerBuffSource {
  name: string;
  slug?: string;
  className?: string;
  pct: number;
  /** [startMs, endMs] pairs relative to the fight start. */
  segments: [number, number][];
  /** ≈ times this provider (re)applied it on that player. */
  applications?: number;
  /**
   * When the provider cast it on them, ms from the pull start — the press
   * itself, next to the window it bought (Innervate at 1:12, up until 1:32).
   * Only for buffs cast from a tracked cooldown.
   */
  casts?: number[];
}

/** One player's coverage of a raid buff during one pull, across every provider. */
export interface PlayerBuffRecipient {
  name: string;
  slug?: string;
  className?: string;
  /** Coverage of the pull with the buff up, counting overlapping providers once. */
  pct: number;
  /** Who kept it on them, best coverage first. */
  sources: PlayerBuffSource[];
}

/**
 * One raid buff (Innervate, Mana Tide, shouts, every totem aura) tracked from
 * the receiving end: who had it and for how long, plus who provided it.
 */
export interface RaidPlayerBuffRow {
  name: string;
  /** WCL class string of the providers, for coloring. */
  className?: string;
  /**
   * Night average per recipient: their per-pull coverage averaged over the
   * pulls they were in (a pull they attended without the buff counts as 0).
   */
  recipients: { name: string; slug?: string; className?: string; pct: number; pulls: number }[];
  /** Who provided it across the night, most applications first. */
  providers: { name: string; slug?: string; className?: string; applications: number }[];
  /** Per-pull breakdown, pull order. Pulls where nobody had it are absent. */
  perFight: { fightId: number; recipients: PlayerBuffRecipient[] }[];
}

/**
 * One shaman's totem drops during a pull, in cast order. TBC never logs the
 * buff a totem hands out, so the drop itself — which totem, dropped when — is
 * the only honest record of totem work.
 */
export interface TotemDropLane {
  name: string;
  slug?: string;
  className?: string;
  drops: { name: string; atMs: number }[];
}

export interface RaidTotemFight {
  fightId: number;
  lanes: TotemDropLane[];
}

/**
 * What one purchased consumable item costs and how many uses it yields. Cost
 * per use = gold / charges — Drums of Battle is ~15g for ~50 charges, most
 * potions are their full price for a single charge.
 */
export interface ConsumablePrice {
  gold: number;
  charges: number;
}

/** Who used a given consumable type, and how many they threw. */
export interface ConsumableProvider {
  name: string;
  slug?: string;
  count: number;
}

/** One consumable type used in-fight, with who used it and how often. */
export interface ConsumableTypeRow {
  name: string;
  uses: number;
  /** Raiders who used it, most uses first. */
  providers: ConsumableProvider[];
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
  potionTypes: ConsumableTypeRow[];
  /** Non-potion in-fight items (gems, seeds, healthstones, runes, drums, sappers). */
  inFightTypes: ConsumableTypeRow[];
  /** Total sapper charges thrown across all player-pulls this night. */
  sappersTotal: number;
}

/**
 * One raider's in-fight consumable and cooldown usage for the night — the
 * per-player tallies the rankings tab leaderboards are built from.
 */
/* Parse boards — the WCL-style "everyone × every boss" percentile grid */

/** One boss kill the boards have a column for. */
export interface ParseBoardColumn {
  fightId: number;
  encounterName: string;
  durationMs: number;
}

/**
 * One raider on one kill, carrying both percentiles Warcraft Logs ranks them
 * on: the board's own metric (damage done / healing done) and — for anyone who
 * deals damage — the same pull ranked on damage to the BOSS alone. They differ by
 * up to ten points on a fight with adds, which is the whole reason to keep
 * both rather than pick one.
 */
export interface ParseBoardCell {
  fightId: number;
  parse: number;
  /** Percentile within the item-level bracket — the gear-adjusted read. */
  bracket?: number;
  /** dps/hps behind the parse. */
  amount?: number;
  /** Spec played on that pull — what the row's icon shows. */
  spec?: string;
  /** Boss-only percentile, absent for healers and for pre-boss-damage imports. */
  bossParse?: number;
  /** Boss-only dps behind `bossParse`. */
  bossAmount?: number;
}

export interface ParseBoardRow {
  name: string;
  slug?: string;
  className?: string;
  /** The spec they played most of the night. */
  spec?: string;
  /** Mean of the parses they have, rounded — the board's sort key. */
  avg?: number;
  /** Kills ranked, of the columns shown. */
  ranked: number;
  /** The same average on boss damage alone. */
  bossAvg?: number;
  bossRanked: number;
  cells: ParseBoardCell[];
}

/**
 * One table of the rankings grid: a role, with a column per boss kill,
 * mirroring Warcraft Logs' own rankings view. Boss damage is a metric the
 * table switches to, not a second table — nobody should appear twice.
 */
export interface ParseBoard {
  key: "dps" | "healers" | "tanks";
  label: string;
  /** What the percentiles measure, for the caption. */
  metric: string;
  /** Caption for the boss-damage metric; absent when this board has none. */
  bossMetric?: string;
  columns: ParseBoardColumn[];
  rows: ParseBoardRow[];
}

export interface RaiderUsage {
  name: string;
  slug?: string;
  className?: string;
  role: WclRole;
  /** Combat potions thrown (excludes the pre-pot). */
  potions: number;
  /** Sapper charges thrown (both goblin and super). */
  sappers: number;
  /** In-fight items other than sappers (healthstones, runes, gems, seeds, drums). */
  otherItems: number;
  /** Every in-fight consumable: potions + all non-potion casts (incl. sappers). */
  consumablesTotal: number;
  /** Pulls opened with a potion already running. */
  prepots: number;
  /** Major class cooldowns cast across the night. */
  cooldowns: number;
  /** What they used, most-used first — the highlight of the consumables leaderboard. */
  itemBreakdown: { name: string; count: number }[];
  /** Cooldowns cast, most-used first. */
  cooldownBreakdown: { name: string; count: number }[];
  /** Total deaths across the raid — the reapply multiplier for prep buffs. */
  deaths: number;
  /**
   * Prep/passive consumables (flask, battle/guardian elixirs, food, weapon
   * buff, scrolls, off-slot extras like Flame Cap) with a death-aware per-raid
   * use count, for the total-gold view. Flask counts once (persists death); the
   * rest count 1 + deaths (re-applied after each death).
   */
  prepBreakdown: { name: string; count: number }[];
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
  /** Raid buffs from the receiving end (shouts, Innervate), most recipients first. */
  playerBuffs: RaidPlayerBuffRow[];
  /** Shaman totem drops per pull — pulls where nobody dropped one are absent. */
  totems: RaidTotemFight[];
  cooldowns: RaidCooldownRow[];
  /** Raiders with at least one preparation gap, worst first. */
  improvements: PlayerImprovements[];
  /** Per-raider usage tallies for the rankings tab, most consumables first. */
  usage: RaiderUsage[];
  /**
   * Parse percentiles as a grid — damage dealers, tanks, healers and boss
   * damage, each with a column per boss kill. Boards nobody has a parse in are
   * left out entirely.
   */
  parseBoards: ParseBoard[];
}


/* Cross-raid ("season") rankings — aggregate across selected reports */

/** Slim per-report data the season aggregation runs over (from each RaidReportView). */
export interface SeasonReportInput {
  code: string;
  title: string;
  zone?: string;
  startTime: string;
  usage: RaiderUsage[];
  upkeep: RaidUpkeepRow[];
  /** This raid's logged consumable prices (empty → code defaults). */
  overrides: Record<string, ConsumablePrice>;
}

/** One raider's cross-raid tallies, with per-raid medians (robust to a wild night). */
export interface SeasonRaiderStat {
  name: string;
  slug?: string;
  className?: string;
  role: WclRole;
  /** Reports the raider appeared in (of those selected). */
  raids: number;
  goldTotal: number;
  goldMedianPerRaid: number;
  consumablesTotal: number;
  consumablesMedianPerRaid: number;
  deathsTotal: number;
  deathsMedianPerRaid: number;
}

/** One maintained track with its best average keepers across the season. */
export interface SeasonUptimeRow {
  name: string;
  kind: "debuff" | "buff" | "selfbuff";
  className?: string;
  providers: { name: string; slug?: string; pct: number; raids: number }[];
}

/** A highlighted leader or laggard for the notables strip. */
export interface SeasonNotable {
  tone: "positive" | "negative";
  label: string;
  raider: { name: string; slug?: string; className?: string };
  detail: string;
}

export interface SeasonRankingsView {
  reportCount: number;
  /** Sorted by total gold spent, descending. */
  raiders: SeasonRaiderStat[];
  /** Boss debuffs first, then by best average uptime. */
  uptime: SeasonUptimeRow[];
  notables: SeasonNotable[];
}

/* Character-vs-character comparison (up to 4, the contribution side-by-side) */

/** One maintained debuff/buff a compared character kept up, averaged over the selected logs. */
export interface ComparedUpkeep {
  name: string;
  kind: "debuff" | "buff" | "selfbuff";
  pct: number;
  /** Uptime on boss targets only (undefined on pre-timeline imports). */
  bossPct?: number;
  /** ≈ landed casts per pull the track was up (Sunder effort vs. uptime). */
  appliesPerFight?: number;
}

/** A report a compared character appears in — the options for the per-column log picker. */
export interface ComparedReportRef {
  code: string;
  title: string;
  zone?: string;
  startTime: string;
}

/** One character's column in the comparison: the contribution metrics side-by-side. */
export interface ComparedCharacter {
  character: Character;
  /** Spec as actually played in logs (falls back to roster spec for display). */
  loggedSpec?: string;
  /** Resolved main name when this is a linked alt. */
  mainCharacterName?: string;
  /** True once at least one logged pull (within the selected logs) exists. */
  hasLogs: boolean;
  reports: number;
  fights: number;
  /** Every report this character appears in (newest first) — the log-picker options. */
  availableReports: ComparedReportRef[];
  /** The report codes currently feeding the log-derived metrics (a subset, or all). */
  selectedReportCodes: string[];
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
  /* Cooldown discipline — major class CDs pressed across the selected logs. */
  cooldownsTotal: number;
  cooldownsPerFight: number;
  /** Most-used first, e.g. Death Wish ×14. */
  cooldownBreakdown: { name: string; count: number }[];
  /* In-fight utility items (totals across the selected logs). */
  sappers: number;
  healthstones: number;
  runes: number;
  drums: number;
  /** ≈ gold per raid on consumables (default prices), prep + in-fight. */
  goldPerRaid?: number;
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
