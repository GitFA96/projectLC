import { z } from "zod";
import type { BossDeathProfile } from "@/lib/analysis/deaths";
import type {
  attendanceExemptionSchema,
  characterCommentSchema,
  itemCommentSchema,
  characterSchema,
  accountSchema,
  authSessionSchema,
  feedbackContextSchema,
  feedbackReportSchema,
  guildAuditEntrySchema,
  guildInviteSchema,
  guildRoleSchema,
  membershipSchema,
  currentGearOverrideSchema,
  gearSetSchema,
  guildSchema,
  itemSchema,
  lootAwardSchema,
  raidSessionSchema,
  slotItemSchema,
  statBlockSchema,
  awardDecisionSchema,
  wclPlayerFightSchema,
  wclPlayerOffPullSchema,
  wclReportSchema,
  wclRoleSchema,
} from "@/lib/import/schemas";
import type { SpecFingerprintRow } from "@/lib/sim/profile";
import type {
  CharacterStatus,
  GearOverrideSource,
  GearSpec,
  Phase,
  Quality,
  Role,
  SlotId,
  WowClass,
} from "@/lib/constants/wow";

export type { CharacterStatus, GearOverrideSource, GearSpec, Phase, Quality, Role, SlotId, WowClass };

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
export type AwardDecision = z.infer<typeof awardDecisionSchema>;
export type WclReport = z.infer<typeof wclReportSchema>;
export type WclPlayerFight = z.infer<typeof wclPlayerFightSchema>;
export type WclPlayerOffPull = z.infer<typeof wclPlayerOffPullSchema>;
export type WclGearItem = WclPlayerFight["gear"][number];
/** One victim of a maintained debuff/buff during a pull, with its up-intervals. */
export type WclUpkeepTarget = NonNullable<WclPlayerFight["upkeep"][number]["targets"]>[number];
export type WclRole = z.infer<typeof wclRoleSchema>;
export type AttendanceExemption = z.infer<typeof attendanceExemptionSchema>;
export type CharacterComment = z.infer<typeof characterCommentSchema>;
export type ItemComment = z.infer<typeof itemCommentSchema>;
export type FeedbackReport = z.infer<typeof feedbackReportSchema>;
export type FeedbackContext = z.infer<typeof feedbackContextSchema>;
export type FeedbackStatus = FeedbackReport["status"];
export type FeedbackKind = FeedbackReport["kind"];
export type FeedbackPriority = FeedbackReport["priority"];

/* Identity. See docs/guild-and-player-profiles.md §3. */
export type Account = z.infer<typeof accountSchema>;
export type AuthSession = z.infer<typeof authSessionSchema>;
export type GuildVisibility = Guild["visibility"];
export type GuildRole = z.infer<typeof guildRoleSchema>;
export type Membership = z.infer<typeof membershipSchema>;
export type GuildInvite = z.infer<typeof guildInviteSchema>;
export type GuildAuditEntry = z.infer<typeof guildAuditEntrySchema>;

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
  /**
   * What was actually handed over, when it wasn't this item: the armor token
   * that buys it. The slot counts as served the moment the token is won —
   * the walk to the Shattrath vendor is the raider's errand, not a loot
   * decision — but the ledger says "Helm of the Vanquished Champion" and the
   * row has to be able to say so too.
   */
  awardedVia?: { itemId: number; itemName: string };
  /**
   * What they'd take for this slot instead, in their own order. Empty when
   * nobody has recorded a fallback — which is different from "they'd take
   * nothing else", and the UI says so.
   */
  alternatives: { itemId: number; itemName?: string; rank: number; note?: string }[];
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
  /**
   * When the award was an armor token: the wishlisted piece it buys. Present
   * only when the token route is what made this a match, so an officer reading
   * an off-spec token award can see the piece it would have bought.
   */
  redeemsTo?: { itemId: number; itemName: string };
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
   * Per-reset check ("did they raid that week with this character?"), **the
   * recent window only** — the last `policy.attendance.weeks` raid weeks (EU
   * reset, Wednesday) the guild logged, newest last.
   *
   * A fixed-width strip, which is what the loot table's dots need: one dot per
   * week on a row that must not grow with a raider's history. The whole record
   * is `allWeeks`.
   */
  weeks: AttendanceWeek[];
  /** Attended, non-excused weeks **of the recent window**. */
  weeksAttended: number;
  /** Non-excused weeks of the recent window — that window's denominator. */
  weeksTracked: number;
  /** Weeks of the recent window marked excused (shown, counted neither way). */
  weeksExcused: number;
  /**
   * Every reset week the guild logged since this character first appeared —
   * the whole record, oldest first, untruncated.
   *
   * Separate from `weeks` rather than replacing it because the two have
   * different jobs: the profile answers "what is their record", the loot table
   * answers "how have they been lately" in a row of fixed width.
   */
  allWeeks: AttendanceWeek[];
  /** Attended, non-excused weeks across the whole record. */
  allWeeksAttended: number;
  /** Non-excused weeks across the whole record — the all-time denominator. */
  allWeeksTracked: number;
  /**
   * The figure this guild judges attendance on, resolved once from
   * `policy.attendance.basis` so every surface shows the same number.
   *
   * Without it each page picked its own denominator and a raider could read
   * 92% on their profile, 100% on the loot sheet and a third figure on the
   * board — all correct, all describing the same weeks. `undefined` when there
   * is nothing to count yet, which is not the same as zero.
   */
  scoreBasis: "raid" | "week";
  scorePct?: number;
  scoreAttended: number;
  scoreTracked: number;
}

export interface AttendanceWeek {
  /** ISO date of the reset Wednesday opening the week. */
  start: string;
  attended: boolean;
  /** Imported guild reports in that week. */
  reports: number;
  /** Officer-marked excused absence — neither attended nor missed for the markup. */
  excused: boolean;
  /**
   * Which tier the guild was raiding that week, by zone rather than by date —
   * the same rule awards and sessions use, so a week is read one way across the
   * app. A week that touched two tiers takes the higher one; `undefined` when
   * no log that week named a zone the phase map knows.
   */
  phase?: Phase;
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
  /** The off-spec kit's pinned slots — empty unless an off-spec is recorded. */
  offSpecOverrides: CurrentGearOverride[];
  /** Those pins as a set. Never merged into `current`: loot is judged on the main spec. */
  offSpecCurrent?: GearSet;
}

/**
 * The raiding record a contender is judged on — one lookup per character.
 * Both fields are whole rollups rather than the three scored numbers, so the
 * council can open a contender and read what the score was actually built from
 * (recent form, gear-adjusted parse, which half of "prepared" they miss).
 */
export interface RaiderMetrics {
  attendance?: AttendanceSummary;
  /** Rollup over every logged pull of their career — parse and prep come from here. */
  career?: PerformanceSummary;
  /** ≈ gold per raid on consumables at default prices. Context, never scored. */
  goldPerRaid?: number;
}

export type LootPriorityFactorKey = "attendance" | "lootDebt" | "performance" | "preparation";

/** The council's weighting, editable in the app. Values are percentages. */
export type LootPriorityWeights = Record<LootPriorityFactorKey, number>;

/**
 * One item's spec priority chain — the council's sheet, as data. Seeded from
 * the guild's markdown sheet and overridable per item in the app.
 */
export interface ItemPriorityRule {
  /** The name the rule is filed under (matching is by normalized name). */
  itemName: string;
  /** The chain as written: "Hunter > DPS Warrior > MS > OS". */
  chain: string;
  /** Parsed rungs, highest priority first. */
  tiers: { tags: string[]; manual: boolean }[];
  note?: string;
  /** The seeded sheet, or an officer's edit on top of it. */
  origin: "sheet" | "officer";
  /** Sheet section the rule came from (the boss), when seeded. */
  source?: string;
  /**
   * The phase whose sheet an officer's edit was written against. Absent on a
   * seeded rule, which is already reached through a phase's sheet.
   */
  phase?: number;
}

/** One component of a priority score, with the evidence behind it. */
export interface LootPriorityFactor {
  key: LootPriorityFactorKey;
  label: string;
  weight: number;
  /** 0..100. Undefined means no data — the factor drops out rather than scoring 0. */
  score?: number;
  /** "12 of 14 logged raids", "no on-spec loot this phase" — what the number is. */
  detail: string;
}

/**
 * A multiplier applied to the weighted mean, for things that are categorical
 * rather than a percentage: roster standing, and whether this raider has
 * already been handed something for this slot.
 */
export interface LootPriorityAdjustment {
  key: "standing" | "slotServed";
  label: string;
  multiplier: number;
  note: string;
}

export interface LootPriority {
  /** 0..100 after adjustments; undefined when no factor had any data to go on. */
  score?: number;
  factors: LootPriorityFactor[];
  /** Applied to the weighted mean in order. Empty means nothing pulled them down. */
  adjustments: LootPriorityAdjustment[];
}

/** One item a contender has already been handed — the loot panel's evidence. */
export interface ContenderAward {
  itemId: number;
  itemName: string;
  awardedAt: string;
  offspec: boolean;
  /** The slot it fills, when the cache or a wishlist knows. */
  slot?: SlotId;
  /** It lands in the contested item's slot family — "they just got a belt". */
  sameSlot: boolean;
  /**
   * Where this item sat on their own list: 0 their pick, 1+ a ranked fallback.
   * The slot-served penalty reads it, because being handed a filler is not the
   * same as being served.
   */
  listRank?: number;
  /**
   * We had a list to check and this wasn't on it — they were handed something
   * nobody asked for. Distinct from both fields being absent, which means
   * there was no list to check and we can't say either way.
   */
  notListed?: boolean;
}

export interface ContentionWisher {
  character: Character;
  phases: Phase[];
  /**
   * Where this item sits on their list for its slot: 0 is the imported BiS,
   * 1 the first ranked fallback, and so on.
   *
   * Shown, never scored. The council decided the BiS-versus-second-choice call
   * is too situational to encode, so the badge informs the argument and the
   * item's notes carry it.
   */
  listRank: number;
  /** What they currently have in the item's slot family. */
  currentInSlot: SlotItem[];
  satisfied: boolean;
  onSpecAwardsActivePhase: number;
  /** Everything they've been handed this phase, newest first. */
  awardsThisPhase: ContenderAward[];
  /** On-spec awards across every phase — the long view next to the phase count. */
  totalOnSpecAwards: number;
  /**
   * Which rung of the item's priority chain they sit on — 0 is the top. The
   * sheet decides eligibility before any metric is consulted, so this leads
   * the sort and the score only ever breaks ties inside a tier. Undefined when
   * the chain names nobody they satisfy (or there's no chain at all).
   */
  priorityTier?: number;
  /** That rung's own words, for the badge: "Hunter" or "Resto Shaman = Healing Priest". */
  priorityTierLabel?: string;
  /** Where the council should rank them. Undefined once they're satisfied. */
  priority?: LootPriority;
  /** 1-based position among the unsatisfied contenders, best first. */
  rank?: number;
  /** The raiding record behind `priority`, for the columns next to it. */
  metrics?: RaiderMetrics;
}

export interface ItemContention {
  item?: Item;
  itemId: number;
  itemName: string;
  wishers: ContentionWisher[];
  awards: AwardWithContext[];
  openCount: number;
  /** Alts that list the item. Never ranked — noted so the want isn't invisible. */
  altWishers: string[];
  /** The council's spec priority for this item, when the sheet covers it. */
  priorityRule?: ItemPriorityRule;
  /** Rungs a human has to rule on ("Set completion") — shown, never applied. */
  manualTiers: string[];
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
  /** The flask half of `flaskOrElixirsPct` — a night-long buff that survives death. */
  flaskPct: number;
  /** The elixir half — cheaper, shorter, and gone the moment they die. */
  elixirsPct: number;
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
  /**
   * Every pull they were on, excused ones included.
   *
   * The table shows them all — an officer who excused the farm boss still wants
   * to see how it went — so the exclusion lives in `excusedFightIds` rather than
   * in what's missing from this array. `summary` is over the counted ones only.
   */
  rows: WclPlayerFight[];
  /** Pulls the officer took out of the count on the raid page. */
  excusedFightIds: number[];
  summary: PerformanceSummary;
  /** What they used away from the boss pulls that night. Absent = nothing logged. */
  offPull?: WclPlayerOffPull;
  /** Total boss pulls in the report (all players) — rows.length of them attended. */
  reportPulls: number;
}

export interface CharacterPerformance {
  character: Character;
  /** Newest report first. */
  reports: PerformanceReportView[];
  /** Rollup across every report the character appears in (undefined when none). */
  career?: PerformanceSummary;
  /** Off-pull consumable records, one per report that had any. */
  offPull: WclPlayerOffPull[];
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
  /**
   * The same player-pulls graded by how much of the elixir budget was filled.
   * `flask` and `full` (battle + guardian) are both complete; `partial` is one
   * slot up and one empty, which the percentage above cannot distinguish.
   */
  coverage: { flask: number; full: number; partial: number; none: number };
  /**
   * Elixirs the curated list doesn't place in a slot, with how many pulls
   * carried them. A gap in our data rather than in anyone's night — and the
   * reason some partial coverage can't name which half is missing.
   */
  unplacedElixirs: { label: string; pulls: number }[];
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
  /** Combat potions consumed, the pre-pull one included. */
  potions: number;
  /** Sapper charges thrown (both goblin and super). */
  sappers: number;
  /** In-fight items other than sappers (healthstones, runes, gems, seeds, drums). */
  otherItems: number;
  /** Every in-fight consumable: potions + all non-potion casts (incl. sappers). */
  consumablesTotal: number;
  /** Pulls opened with a potion already running. Included in `potions`. */
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

/**
 * An officer's correction to one raider's consumable count for one raid.
 *
 * The log is evidence, not gospel: it can't see a flask drunk before the pull
 * timer, a potion on the run back, or a night somebody's client dropped. This
 * records the difference rather than editing the log, so it can always be
 * undone and always be shown as what it is — a judgement call, with a name on
 * it.
 */
export interface ConsumableAdjustment {
  /** The raider's logged actor name. */
  actorName: string;
  /** Consumable name — matches the breakdown and price lists. */
  name: string;
  /** Uses added (+) or removed (-). Never zero. */
  delta: number;
  /** Why the officer changed it. */
  note?: string;
  /**
   * Who recorded it, as `actingOfficer` names them. Stamped server-side on the
   * entries a save actually changed — never sent by the client, and never
   * rewritten on entries somebody else already owns. Absent on corrections made
   * before attribution existed, which is why it stays optional.
   */
  by?: string;
  /** ISO timestamp it was recorded. */
  at: string;
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
   * Per-boss death profiles, hardest first — "why do we struggle on this
   * boss", read through when people die rather than how many.
   */
  deathProfiles: BossDeathProfile[];
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
  /** This raid's hand corrections to consumable counts. */
  adjustments?: ConsumableAdjustment[];
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
  /** Split out, because a flask and one cheap elixir are not the same night. */
  flaskPct: number;
  elixirsPct: number;
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
