/**
 * One raid night, from every angle the app looks at it: preparation, upkeep,
 * buffs, totems, consumables, parses, improvements and gold.
 *
 * Part of `@/lib/types`, which re-exports every one of these — import from
 * there, not from this file, so a type moving between domains costs nothing.
 */

import type { BossDeathProfile } from "@/lib/analysis/deaths";
import type { CoverageGrade } from "@/lib/analysis/preparation";
import type { ElixirSlot } from "@/lib/wcl/consumables";
import type { RaidDeployableView } from "@/lib/analysis/deployables";
import type { RaidDispelView } from "@/lib/analysis/dispels";
import type { RaidInterruptView } from "@/lib/analysis/interrupts";
import type { RaidSession, WclReport, WclRole, WclUpkeepTarget } from "./entities";

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
  /**
   * Combat potions drunk this night, boss pulls AND trash, pre-pots included.
   *
   * The coverage percentages above it are per player-pull and stay that way —
   * a flask is a state at a pull, a potion is an event on the night.
   */
  potionsTotal: number;
  /** Pulls opened potted. Per pull by nature, so boss pulls only. */
  prepots: number;
  /** Potion casts by type, most-used first — trash included. */
  potionTypes: ConsumableTypeRow[];
  /** Non-potion consumables (gems, seeds, healthstones, runes, drums, sappers, pet food) — trash included. */
  inFightTypes: ConsumableTypeRow[];
  /** Total sapper charges thrown this night, boss pulls and trash. */
  /** Sapper charges and Arcane Bombs — everything that took Engineering to set off. */
  explosivesTotal: number;
}

/**
 * One raider's consumable and cooldown usage for the night — the per-player
 * tallies the rankings tab leaderboards are built from.
 *
 * The night, not the boss pulls inside it: everything below counts trash use
 * too, which is where most of a raid actually happens. Cooldowns are the
 * exception and are boss-pull only — a class cooldown pressed on trash says
 * nothing about whether it was pressed when it mattered.
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
  /** Combat potions consumed across the night, the pre-pull one included. */
  potions: number;
  /** Sapper charges thrown (both goblin and super). */
  sappers: number;
  /** Consumables other than potions and sappers (healthstones, runes, gems, seeds, drums, pet food). */
  otherItems: number;
  /** Every consumable used: potions + all non-potion casts (incl. sappers). */
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
 * What one raid night banked to hand back, and what has gone out so far.
 *
 * The raid's Marks of Illidari are the pot: a real, countable number of tokens
 * that buy potions and flasks, banked fresh each week. Both halves are recorded
 * per night rather than fixed anywhere, because both move — the raid banks a
 * different number every week, and the mark's gold value drifts with the
 * server economy the same way a flask's does.
 *
 * `paid` is the officers' record of what has actually been handed over, kept
 * beside the recommendation rather than replacing it: "what we owe" and "what
 * we've settled" are different facts and the card shows both.
 */
export interface ReportPayback {
  /** Marks of Illidari the raid banked that night. */
  marks: number;
  /** What one mark is worth in gold, as the officers price it today. */
  markGold: number;
  /** Gold already handed over, by logged raider name. */
  paid: Record<string, number>;
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

/**
 * One raider's preparation on one pull — the fact, before any aggregation.
 *
 * Kept per pull because a raid night is not one state: a raider fed on nine
 * pulls and not on five is neither "fed" nor "not fed", and a single tick per
 * raider has to pick one. Absent from a raider's `pulls` means they were not
 * on that pull at all, which is a third thing again.
 */
/**
 * A flask or elixir applied during a pull rather than before it.
 *
 * `category` is the curated slot the aura falls in, so a reader can tell a
 * forgotten flask from a second battle elixir without matching on the name.
 */
export interface LateConsumable {
  name: string;
  category: "flask" | ElixirSlot;
  /** ms from the pull start. */
  atMs: number;
  /**
   * It was already up when the pull started, so this is a **second** one drunk
   * during the fight rather than a raider fixing a gap.
   *
   * The distinction is the whole value of the field: without it "drank another
   * Major Agility at 0:12" and "turned up with nothing and fixed it at 0:12"
   * are one number, and they are opposite facts about a raider.
   */
  refill?: boolean;
}

export interface PreparednessPull {
  fightId: number;
  /** How much of the elixir budget was filled — the fact, not the standard. */
  grade: CoverageGrade;
  /**
   * Whether that grade clears the council's bar — `hasConsumableCoverage`.
   *
   * The standard beside the fact, and they are not the same number: under
   * `coverage: "full"` a half set is real coverage and still not enough. The
   * table colours its pips from `grade` and counts its percentage from this, so
   * the flask column and the Prepared column can never drift apart.
   */
  covered: boolean;
  /** The empty half of a partial set, when the curated list can name it. */
  missingSlot?: ElixirSlot;
  flask?: string;
  elixirs: string[];
  /**
   * Flasks and elixirs that went up **after** the pull started.
   *
   * Empty on every report imported before this was fetched, and empty is also
   * what "they came ready" looks like — the two are indistinguishable here, so
   * a reader must never present an empty list as "nobody was late"
   * (docs/change-chains.md §1).
   *
   * Never folded into `flask` or `elixirs`: those are what the raider brought
   * to the pull, they are what the coverage grade and the loot score read, and
   * a late one must not quietly turn an unprepared pull into a prepared one.
   */
  lateConsumables: LateConsumable[];
  food: boolean;
  /** Scroll buffs up at the pull, rank included. */
  scrolls: string[];
  weaponBuff: boolean;
  /**
   * Temporary weapon enchantments at the pull, main hand first.
   *
   * **Both hands, because a raider buffs both.** A dual-wielding rogue runs a
   * different poison on each, and reporting only the main hand called that
   * half a job done. Empty when neither carried one.
   *
   * Ids and nothing more: Warcraft Logs records that a weapon slot held a
   * temporary enchant, never which stone, oil or poison applied it. The enchant
   * dictionary names most of them; the sharpening stones only resolve to effect
   * text. Nothing here guesses an item.
   */
  weaponEnchants: { hand: "main" | "off"; id: number }[];
  /** Enchantable slots carrying a permanent enchant at this pull. */
  enchanted: number;
  /** Slots expected to be enchanted that weren't, by label. */
  missingEnchants: string[];
  /** Gems socketed across the worn set at this pull. */
  gems: number;
  /** False for pulls imported before gear tracking — an empty set, not a naked raider. */
  hasGear?: true;
  /** Average item level worn, shirt and tabard excluded. */
  ilvl?: number;
  /**
   * Coverage AND food — `isPrepared`, the same rule the loot-priority factor
   * and the standing board read. Computed here so nothing downstream invents a
   * second definition of the word.
   */
  prepared: boolean;
}

/**
 * What a raider put on their pet, for the whole night.
 *
 * **Not per pull, and it cannot be.** Pet food is a twenty-minute buff applied
 * between pulls, so the ingest records it once per player per report — there is
 * no fight row to hang it on. The table shows the same answer at every scope
 * and says so, rather than implying a pull-by-pull fact it does not have.
 */
export interface PreparednessPet {
  /** Pet food applied across the night, most-used first: [name, times]. */
  food: [string, number][];
  /** Scrolls read onto the pet, most-used first. */
  scrolls: [string, number][];
  /**
   * Consumables the pet was seen carrying that no cast accounts for — scrolls
   * and food both — earliest first.
   *
   * Deduped against `food` and `scrolls` rather than listed beside them: one
   * applied during a pull produces a cast *and* an aura, and showing both would
   * read as two. What survives is what only the aura stream saw — which, on
   * this guild's logs, is most of it, because pets are scrolled and fed between
   * pulls and a log holds no out-of-combat time.
   *
   * Carries no count, and must not be given one. A pet re-entering play
   * republishes its whole aura set, so sightings count summons, not items.
   */
  held: { name: string; atMs: number }[];

  /**
   * Each application in the order it happened.
   *
   * What makes a scoped view readable: the night's total against one pull
   * reads as a bug, while "fed before this boss" is the same fact answering
   * the question actually being asked. `fightId` absent means between pulls,
   * which is where most feeding happens.
   */
  applications: { name: string; atMs?: number; fightId?: number }[];
}

/** One item seen in a slot across a raid night, with the evidence behind it. */
export interface PreparednessWorn {
  itemId: number;
  name?: string;
  ilvl?: number;
  /** Pulls in the report that wore it. */
  pulls: number;
  /** Bosses it was worn on, most pulls first. */
  encounters: string[];
  /**
   * Temporary enchant ids seen on THIS item, most-seen first.
   *
   * Per item rather than per raider, because that is the question a swap
   * raises: the off-set weapon that never gets an oil is invisible when the
   * enchant is only read off whichever weapon was in hand at the last pull.
   */
  tempEnchantIds: number[];
}

/**
 * A gear slot that held more than one item over the night.
 *
 * The reason this exists is the fishing pole. Lurker is spawned by fishing, so
 * a raider pulls him holding a level 30 rod — which is a real fact about that
 * pull and a terrible answer to "how geared is this raider". The swap is the
 * thing worth reporting; the pull's own snapshot was never wrong, it was just
 * being read as something it isn't.
 */
export interface PreparednessSwap {
  /** Gear-slot label ("Main hand", "Off hand"). */
  label: string;
  /** Items seen there, most-worn first. The first is the raider's usual. */
  items: PreparednessWorn[];
}

/** One raider's night, pull by pull. */
export interface PreparednessRow {
  name: string;
  slug?: string;
  className?: string;
  spec?: string;
  role: WclRole;
  /** In pull order. Pulls they missed are absent rather than blank. */
  pulls: PreparednessPull[];
  /**
   * Absent when the log recorded nothing for a pet — which is **not** the same
   * as "they forgot". Warcraft Logs types every pet, shaman totem, druid treant
   * and Shadowfiend identically (`Pet/Pet`), so nothing here can tell a hunter
   * who owns a pet from a shaman who owns a totem, and the table must not put a
   * cross against anyone on that basis.
   */
  pet?: PreparednessPet;
  /**
   * Average item level over the raider's **usual** gear — the item worn on the
   * most pulls in each slot, not whatever the latest pull happened to hold.
   *
   * A single pull is a bad witness: the Lurker fisher's snapshot is honest and
   * says 124 when they are wearing 129, because a fishing rod really was in
   * their hand. Taking the most-worn item per slot answers the question the
   * column is actually asking.
   */
  ilvl?: number;
  /** Weapon slots that held more than one item this night. Empty is the norm. */
  weaponSwaps: PreparednessSwap[];
}

/**
 * One name the app took to Wowhead and did not get an id for.
 *
 * Distinct from "not looked up yet" on purpose: the lookup queues are built
 * from what the item cache cannot match, so without this record the two are the
 * same number and pressing the button changes nothing, forever.
 */
export interface RefusedNameView {
  /** Normalized — what the queues compare with. */
  nameKey: string;
  /** As written, for a person to read and correct. */
  name: string;
  /** Why: an unknown name, no exact match, or several items sharing it. */
  reason: string;
  /** What Wowhead did offer instead — a near-miss is obvious on sight. */
  near: string[];
  checkedAt: string;
}

export interface PreparednessView {
  /** Alphabetical — the order that never moves under the reader. */
  rows: PreparednessRow[];
  /** How many slots are expected to carry an enchant — the denominator. */
  enchantSlots: number;
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
  /** What everyone brought, pull by pull — the preparedness table's whole input. */
  preparedness: PreparednessView;
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
  /**
   * What went on the pets, and what the cast stream missed. Its own view
   * because it is the one consumable this app reports as a range — the gold
   * ranking still charges the logged half and nothing else.
   */
  petSpend: PetSpendView;
  /**
   * Who cleansed what off whom — a timeline per boss pull, and counts per
   * instance for the trash.
   *
   * Empty on every report imported before dispels were fetched, which is not
   * the same statement as a night nobody dispelled on. The view carries a
   * `total` so the page can say which it cannot tell.
   */
  dispels: RaidDispelView;
  /**
   * Who stopped which cast, and where.
   *
   * Empty on every report imported before interrupts were fetched, which is not
   * the same statement as a night nobody interrupted on. The view carries a
   * total so the board can say which of the two it is looking at.
   */
  interrupts: RaidInterruptView;
  /**
   * What the raid put on the ground, pull by pull — land mines, snake traps,
   * thornlings, dog whistles, flame turrets.
   *
   * Empty on reports imported before those five were curated, which is not the
   * same as a night nobody laid one on; the view carries a `total` so the page
   * can say which it cannot tell.
   */
  deployables: RaidDeployableView;
}

/**
 * One consumable a pet had this night, with the evidence behind each number.
 *
 * Two counts, because a pet has two kinds of witness and they are not
 * interchangeable — see `analysis/pet-consumables.ts` for why the app reports a
 * range here and a single number everywhere else.
 */
export interface PetSpendLine {
  name: string;
  /** Which re-buy window it is read against — the curated group decides. */
  group: "food" | "scroll";
  /** Applications the cast stream recorded. What the gold ranking charges. */
  logged: number;
  /**
   * The aura was on the pet. True with `logged: 0` is the interesting case: a
   * consumable nothing has ever been charged for. Carries no count and must
   * never be given one (docs/change-chains.md §5e).
   */
  seen: boolean;
  /** What keeping it up for the whole night takes. Never below `logged`. */
  maintained: number;
}

/** One raider's pets for a night, worst gap first. */
export interface PetSpendRow {
  name: string;
  slug?: string;
  className?: string;
  role: WclRole;
  lines: PetSpendLine[];
  loggedUses: number;
  maintainedUses: number;
}

/**
 * Pet consumables across a report — the raid page's own section, priced where
 * every other consumable is priced and folded into nothing.
 */
export interface PetSpendView {
  /** Raiders the log put something on a pet for. Empty on a night with none. */
  rows: PetSpendRow[];
  /** Report span in hours — the numerator of the maintained reading. */
  spanHours: number;
  /** The re-buy windows it was read against, so the page can state them. */
  windowHours: { food: number; scroll: number };
  loggedUses: number;
  maintainedUses: number;
}
