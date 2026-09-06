import { emptyBoard, type Board, type GuildRoster } from "@/lib/analysis/raid-planner";
import type {
  ConsumableAdjustment,
  ConsumablePrice,
  ReportPayback,
  LootPriorityWeights,
} from "@/lib/types";
import type { Repo } from "@/lib/data/repo";
import type { StoreContext } from "./context";

/**
 * The reads whose answer is a setting rather than a derived number.
 *
 * Each is either handed to the model in its config or is simply absent here.
 * The SQLite backend overrides every one of them from the `meta` table; the
 * seed backend keeps these answers, which is why the demo has no boards, no
 * saved rosters and no prices.
 *
 * An empty answer means "unset, use the defaults" and never "none exist" — the
 * distinction matters at the call site, and getting it backwards is how a
 * missing setting turns into a zero on a page.
 */

export function settingViews(ctx: StoreContext) {
  const { config, policy } = ctx;
  return {
    async getGuildPolicy() {
      return policy;
    },

    async getLootPriorityWeights(): Promise<LootPriorityWeights> {
      return policy.weights;
    },

    async listGuides() {
      return config.guides ?? [];
    },

    async listWishlistAlternatives() {
      return config.wishlistAlternatives ?? [];
    },

    async getReportExcludedFights(code: string): Promise<number[]> {
      return config.excludedFightsByCode?.[code] ?? [];
    },

    // Per-report prices are persisted config, not entity-store data — the
    // in-memory/seed model has none, so gold falls back to code defaults. The
    // SQLite backend overrides this to read the raid's logged prices.
    async getReportConsumablePrices(): Promise<Record<string, ConsumablePrice>> {
      return {};
    },

    // And the same again for the payback record: what a night banked in marks
    // is something an officer wrote down. No pot recorded reads as "not
    // recorded" on the page, which is the honest answer for a demo backend.
    async getReportPayback(): Promise<ReportPayback> {
      return { marks: 0, markGold: 0, paid: {} };
    },

    async getReportConsumableAdjustments(code: string): Promise<ConsumableAdjustment[]> {
      return config.consumableAdjustmentsByCode?.[code] ?? [];
    },

    async listConsumableAdjustments(): Promise<Record<string, ConsumableAdjustment[]>> {
      return config.consumableAdjustmentsByCode ?? {};
    },

    // Resolved abilities are persisted config like prices; the seed model has none.
    async listAbilities() {
      return [];
    },

    // Same: a board is something an officer wrote down, not something the
    // pull rows imply, so the read-only demo has none and offers an empty board.
    async getRaidBoard(): Promise<Board> {
      return emptyBoard();
    },

    async getTemplateBoard(): Promise<Board> {
      return emptyBoard();
    },

    // Guild boards are officer-authored too, and there is no seed file for
    // them: the demo has no rosters until somebody makes one, and it can't.
    async listGuildRosters(): Promise<GuildRoster[]> {
      return [];
    },

    async getGuildRoster(): Promise<GuildRoster | undefined> {
      return undefined;
    },
  } satisfies Partial<Repo> & ThisType<Repo>;
}
