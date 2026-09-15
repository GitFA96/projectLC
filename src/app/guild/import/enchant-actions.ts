"use server";

import { getWriteRepo } from "@/lib/data/repo";
import { refreshAfterWrite } from "@/lib/refresh";
import { requireCapability } from "@/lib/auth/can";
import { resolveViewer } from "@/lib/auth/viewer";
import { resolveEnchantNames } from "@/lib/items/enchant-names";

/**
 * Naming the enchants raiders are actually wearing.
 *
 * The gear panel names an enchant from the guild's own imported lists, which
 * only covers what somebody put on a list — a scope, a resistance enchant, the
 * attack power on a pair of gloves nobody wishlisted all render as a bare id.
 * This resolves those ids against the enchantment table, one lookup per id
 * ever, capped per run like the item backfill it sits next to.
 *
 * "One lookup per id ever" is `recordRefusedEnchantIds` doing the work. Without
 * it the queue is "ids nothing names", which counts an id the dictionary has
 * already declined the same as one nobody has asked about — so every press
 * re-fetched the same ids and the badge never moved (change-chains §4f2).
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
    requireCapability(await resolveViewer(), "import.run");
    const repo = await getWriteRepo();
    const unnamed = await repo.listUnnamedEnchantIds();
    if (unnamed.length === 0) {
      return { ok: true, message: "Every enchant worn in a logged pull already has a name.", ...empty };
    }

    const { resolved, failed, throttled } = await resolveEnchantNames(unnamed, {
      limit: RESOLVE_LIMIT,
    });
    if (resolved.length > 0) await repo.addEnchantNames(resolved);
    // Only a run that was answered. A throttled run stops mid-queue and the id
    // it stopped on was never answered for — filing that would strike a
    // perfectly resolvable enchant off the list on a bad afternoon.
    if (failed.length > 0) await repo.recordRefusedEnchantIds(failed);
    const remaining = Math.max(0, unnamed.length - resolved.length - failed.length);

    refreshAfterWrite("/", "layout");
    const parts = [`${resolved.length} enchant${resolved.length === 1 ? "" : "s"} named`];
    // Deliberately not "not in the enchantment table". That was a claim about
    // the table, and it went on being printed after the dictionary's host moved
    // and every single lookup began failing — including for ids already named
    // in this deployment's own table. Say what happened, not what it means.
    if (failed.length > 0) {
      parts.push(
        `${failed.length} got no answer${resolved.length === 0 ? " — the dictionary may be down or moved" : ""}`,
      );
    }
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

/**
 * Put refused enchant ids back in the queue.
 *
 * Sibling of `retryRefusedItemNames`, and it exists for a blunter reason: an
 * enchant id has no spelling to correct, so the only thing that ever changes
 * the answer is the source. When the dictionary moves house — which it has done
 * once — every stored refusal is wrong at the same moment, and this is the
 * press that says so.
 */
export async function retryRefusedEnchantIds(): Promise<{ ok: boolean; message: string }> {
  try {
    requireCapability(await resolveViewer(), "import.run");
    const repo = await getWriteRepo();
    const cleared = await repo.clearRefusedEnchantIds();
    refreshAfterWrite("/", "layout");
    return {
      ok: true,
      message:
        cleared === 0
          ? "Nothing was waiting on a second look."
          : `${cleared} id${cleared === 1 ? "" : "s"} back in the queue — press the lookup button again.`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not clear the list." };
  }
}
