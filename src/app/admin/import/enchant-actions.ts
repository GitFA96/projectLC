"use server";

import { getWriteRepo } from "@/lib/data/repo";
import { refreshAfterWrite } from "@/lib/refresh";
import { resolveEnchantNames } from "@/lib/items/enchant-names";

/**
 * Naming the enchants raiders are actually wearing.
 *
 * The gear panel names an enchant from the guild's own imported lists, which
 * only covers what somebody put on a list — a scope, a resistance enchant, the
 * attack power on a pair of gloves nobody wishlisted all render as a bare id.
 * This resolves those ids against the enchantment table, one lookup per id
 * ever, capped per run like the item backfill it sits next to.
 */

export interface BackfillEnchantsResult {
  ok: boolean;
  message: string;
  /** Ids named this run. */
  resolved: number;
  /** Ids the enchantment table had nothing for — they stay as ids. */
  failed: number;
  /** Still unnamed after this run (the per-run cap left some over). */
  remaining: number;
}

/**
 * How many unknown ids one press looks up. A roster's whole backlog is under a
 * hundred, so one or two presses clears it and nothing is ever re-fetched.
 */
const RESOLVE_LIMIT = 60;

export async function backfillEnchantNames(): Promise<BackfillEnchantsResult> {
  const empty = { resolved: 0, failed: 0, remaining: 0 };
  try {
    const repo = await getWriteRepo();
    const unnamed = await repo.listUnnamedEnchantIds();
    if (unnamed.length === 0) {
      return { ok: true, message: "Every enchant worn in a logged pull already has a name.", ...empty };
    }

    const { resolved, failed, throttled } = await resolveEnchantNames(unnamed, {
      limit: RESOLVE_LIMIT,
    });
    if (resolved.length > 0) await repo.addEnchantNames(resolved);
    const remaining = Math.max(0, unnamed.length - resolved.length - failed.length);

    refreshAfterWrite("/", "layout");
    const parts = [`${resolved.length} enchant${resolved.length === 1 ? "" : "s"} named`];
    if (failed.length > 0) parts.push(`${failed.length} not in the enchantment table`);
    if (remaining > 0) {
      parts.push(
        throttled
          ? `${remaining} left — the database is throttling us, try again shortly`
          : `${remaining} left for the next press`,
      );
    }
    return {
      ok: true,
      message: parts.join(" · ") + ".",
      resolved: resolved.length,
      failed: failed.length,
      remaining,
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Could not look up enchant names.",
      ...empty,
    };
  }
}
