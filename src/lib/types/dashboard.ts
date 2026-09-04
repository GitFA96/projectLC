/**
 * The front page.
 *
 * Part of `@/lib/types`, which re-exports every one of these — import from
 * there, not from this file, so a type moving between domains costs nothing.
 */

import type { WowClass } from "@/lib/constants/wow";
import type { FairnessGroup, ItemContention } from "./loot";
import type { Guild, Item, RaidSession, WclRole } from "./entities";

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

/**
 * One award that landed on the winner's own wishlist — a raider getting the
 * item they actually asked for.
 *
 * "BiS" is the wishlist and nothing more. This app has no notion of a first
 * choice against a second one: the council was asked and said the call is too
 * situational to automate, which is why `item_comments` carries the argument
 * instead. A SixtyUpgrades wishlist IS the raider's BiS list for that phase, so
 * "on their wishlist" is the strongest honest reading of the word and the only
 * one the data supports.
 */
export interface BisWin {
  awardId: string;
  itemId: number;
  itemName: string;
  /** The cached item, when the name resolved — for the icon and quality. */
  item?: Item;
  winnerName: string;
  winnerClass?: WowClass;
  /** Roster slug for the character link, absent for an unresolved winner. */
  winnerSlug?: string;
  offspec: boolean;
  /** Set when a tier token was what actually dropped, and this is what it buys. */
  redeemsTo?: { itemId: number; itemName: string };
}

export interface DashboardData {
  guild: Guild;
  rosterSize: number;
  activePhaseAwards: number;
  avgActivePhaseCompletion?: number;
  lastRaid?: RaidSession;
  recentSessions: { session: RaidSession; awardCount: number }[];
  contestedItems: ItemContention[];
  /**
   * Wishlist hits from the most recent raid week, newest first.
   *
   * `from`/`to` are the window the list was cut from, and the card prints them
   * — the week is anchored to the last raid rather than to today (see
   * `analysis/loot-recency.ts`), so the dates are how a reader tells which
   * week they are looking at. `total` counts the whole window; `wins` is the
   * capped list, and the difference is what the "N more" link is for.
   */
  bisWins: { from?: string; to?: string; wins: BisWin[]; total: number };
  /** "All raids" first, then one group per phase that has awards. */
  fairness: FairnessGroup[];
  /** Awards whose winner is neither a roster character nor marked off-roster. */
  unresolvedCount: number;
}
