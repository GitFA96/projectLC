/**
 * A phase's worth of raid nights, aggregated.
 *
 * Part of `@/lib/types`, which re-exports every one of these — import from
 * there, not from this file, so a type moving between domains costs nothing.
 */

import type { CharacterStatus } from "@/lib/constants/wow";
import type { ConsumableAdjustment, ConsumablePrice, RaidUpkeepRow, RaiderUsage, ReportPayback } from "./raid";
import type { WclRole } from "./entities";

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
  /**
   * What this night banked in Marks of Illidari and what went back out.
   *
   * Absent, or all zeroes, for a night nobody recorded a pot against — which
   * keeps that raid out of the payback ledger entirely rather than entering it
   * as a night where everyone was owed nothing.
   */
  payback?: ReportPayback;
}

/**
 * What the roster says about a logged raider, keyed by slug (= their character
 * name, lowercased — the same key `RaiderUsage.slug` carries).
 *
 * The season views need it to tell a guild character from a pug, and the logs
 * themselves never say: a pug is a real player who raided with us, and every
 * name in a report looks the same until the roster is asked. Handed in rather
 * than folded into `RaiderUsage`, because it is roster state and not something
 * the night's pulls know.
 */
export interface SeasonRosterEntry {
  status: CharacterStatus;
  /** Whose alt this is, when the roster links one. */
  mainName?: string;
}

/** One raider's cross-raid tallies, with per-raid medians (robust to a wild night). */
export interface SeasonRaiderStat {
  name: string;
  slug?: string;
  className?: string;
  role: WclRole;
  /** Roster status, when the raider matched a character. Absent = not on the roster. */
  status?: CharacterStatus;
  /** Whose alt they are, for the alt filter's benefit. */
  mainName?: string;
  /** Reports the raider appeared in (of those selected). */
  raids: number;
  /**
   * Gold across every selected raid, **unrounded**.
   *
   * The views sum these — a filter's total, the whole roster's — and rounding
   * per raider first drifts: a scroll costs 0.5g and a drum charge 0.24g, so
   * 150 rounded rows land tens of gold from what they're worth, and the same
   * season then reads two ways in two cards. Round it where it's shown.
   */
  goldTotal: number;
  /** Rounded: a per-row figure, and nothing adds these up. */
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

/** One player's use of one consumable across the selected raids. */
export interface SeasonConsumableUser {
  name: string;
  slug?: string;
  className?: string;
  status?: CharacterStatus;
  /**
   * Raids the PLAYER appeared in, not raids they used this consumable in — the
   * denominator for "per raid". Someone who drank ten potions on the one night
   * they showed up averages ten, not ten twenty-firsts.
   */
  raids: number;
  uses: number;
  /** Unrounded — see the note on `SeasonConsumableStat.gold`. */
  gold: number;
}

/**
 * One consumable across the selected raids, with everyone who used it.
 *
 * `users` holds only players with at least one use. Listing who *didn't* would
 * need the app to know who *should* have, and it doesn't: a mage with no haste
 * potions and a mage who forgot their flask look identical from here, and only
 * one of them is a problem. That judgement is the council's.
 *
 * Family and potion sub-family are deliberately not stored — `consumableGroupOf`
 * and `potionPurposeOf` derive them from the label, so there is one curated list
 * rather than a copy of it in every row.
 */
export interface SeasonConsumableStat {
  name: string;
  uses: number;
  /**
   * Gold, **unrounded** — the view rolls these up (all potions, everyone's
   * flasks) and rounding first then summing drifts: a drum charge costs 0.24g
   * and a scroll 0.5g, so a season's worth of rounded rows lands tens of gold
   * away from what the same rows are worth. Round where it's displayed.
   */
  gold: number;
  /**
   * Raids (of those selected) this consumable was used in at all.
   *
   * True of this row and **not summable across rows** — two consumables used in
   * ten raids each may be the same ten. A view rolling several rows into one
   * (all potions, all flasks) has to leave it out rather than add it up.
   */
  raids: number;
  /** Sorted by uses, descending. */
  users: SeasonConsumableUser[];
}

/** One raider's standing in the payback ledger, across every raid with a pot. */
export interface SeasonPaybackRaider {
  name: string;
  slug?: string;
  className?: string;
  /**
   * Raids with a recorded pot that this raider spent in.
   *
   * Only those: a night with no pot is not a night they went unpaid, and
   * counting it would make every raider who missed a payday look shorted.
   */
  raids: number;
  /** Their spend across those raids — the basis every split was worked out on. */
  spend: number;
  /** What the splits said they were owed, summed. */
  recommended: number;
  /** What the officers recorded actually handing over, summed. */
  paid: number;
  /** Marks the splits allocated them, summed. */
  marks: number;
  /**
   * `recommended − paid`. Positive means still owed; negative means they have
   * had more than the splits called for.
   *
   * This is the number the ledger exists to show, and the one an officer reads
   * when deciding who to favour next. It is **not** fed back into any split —
   * evening out is a judgement, and the app does not make it (see
   * `AGENTS.md` invariant 5).
   */
  balance: number;
}

/** One night in the ledger. Raids with no pot recorded never appear. */
export interface SeasonPaybackRaid {
  code: string;
  title: string;
  startTime: string;
  zone?: string;
  marks: number;
  markGold: number;
  potGold: number;
  recommended: number;
  paid: number;
  marksAllocated: number;
  /** Marks the spend ceiling left in the bank. */
  marksLeft: number;
}

/** The payback ledger across the selected raids. */
export interface SeasonPaybackView {
  /** Furthest behind first — who the next payday should favour. */
  raiders: SeasonPaybackRaider[];
  /** Newest night first. */
  raids: SeasonPaybackRaid[];
  potGold: number;
  recommendedTotal: number;
  paidTotal: number;
  marksTotal: number;
  /**
   * Selected raids with no pot recorded. Named rather than ignored: a ledger
   * that silently covers 3 of 12 nights is worse than one that says so.
   */
  raidsWithoutPot: number;
}

export interface SeasonRankingsView {
  reportCount: number;
  /** Sorted by total gold spent, descending. */
  raiders: SeasonRaiderStat[];
  /** Every consumable used, most gold first. */
  consumables: SeasonConsumableStat[];
  /** Boss debuffs first, then by best average uptime. */
  uptime: SeasonUptimeRow[];
  notables: SeasonNotable[];
  /**
   * Payback across every selected raid that recorded a pot — the running
   * account of who has had their consumables covered and who has not.
   */
  payback: SeasonPaybackView;
}
