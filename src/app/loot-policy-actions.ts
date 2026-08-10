"use server";

import { getWriteRepo } from "@/lib/data/repo";
import { refreshAfterWrite } from "@/lib/refresh";
import { parsePriorityChain } from "@/lib/loot/priority-chain";
import { isSpecTag } from "@/lib/loot/spec-tags";
import { parsePrioritySheet } from "@/lib/loot/priority-sheet";
import type { LootPriorityWeights } from "@/lib/types";
import type { PolicyOverrides } from "@/lib/analysis/policy";

/**
 * Editing the council's loot policy: the factor weighting behind every score,
 * and one item's spec priority chain.
 *
 * Both are seeded from something the guild already wrote down — the priority
 * sheet, and the defaults in lib/analysis/loot-priority — and both are meant
 * to be argued with. Nothing here validates the policy itself; it only checks
 * that what's stored can be read back.
 *
 * Guild-scoped rather than route-scoped: the weighting is edited on the guild
 * page and applies everywhere, while a chain is edited on the item it governs.
 * When the app grows past one guild these become the first things that need a
 * guild id — see docs/guild-and-player-profiles.md.
 */

export interface PriorityActionResult {
  ok: boolean;
  message: string;
  /** Tokens in the chain that no rule can evaluate — saved, but worth flagging. */
  manualTokens?: string[];
}

export async function saveItemPriorityAction(input: {
  itemName: string;
  /** Empty hands the item back to the seeded sheet. */
  chain: string;
  note?: string;
}): Promise<PriorityActionResult> {
  try {
    const repo = await getWriteRepo();
    const result = await repo.setItemPriorityRule(input.itemName, input.chain, input.note);
    if (!result.ok) return { ok: false, message: result.error };
    refreshAfterWrite("/", "layout");
    if (!input.chain.trim()) {
      return { ok: true, message: "Back to the guild's sheet for this item." };
    }
    // A rung of pure free text still saves — it just can't rank anyone, and an
    // officer should hear that from us rather than discover it mid-raid.
    const manualTokens = parsePriorityChain(input.chain).tiers
      .filter((t) => t.manual)
      .map((t) => t.tags.join(" = "));
    return { ok: true, message: "Priority saved.", manualTokens };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Saving the priority failed." };
  }
}

/**
 * Pin a sheet name to an item id, so the row renders like every other item.
 *
 * Accepts a Wowhead URL as well as a bare id, because that is what an officer
 * has in hand when they have just looked the thing up. An empty value unpins.
 */
export async function setSheetItemIdAction(input: {
  itemName: string;
  /** Bare id, a Wowhead link, or empty to unpin. */
  value: string;
}): Promise<PriorityActionResult> {
  const raw = input.value.trim();
  let itemId: number | undefined;
  if (raw) {
    // `item=32837`, `/item=32837/warglaive…`, or just the number.
    const match = /item=(\d+)/.exec(raw) ?? /^(\d+)$/.exec(raw);
    const parsed = match ? Number(match[1]) : Number.NaN;
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return { ok: false, message: "Paste a Wowhead item link, or the item id on its own." };
    }
    itemId = parsed;
  }
  try {
    const repo = await getWriteRepo();
    const result = await repo.setSheetItemId(input.itemName, itemId);
    if (!result.ok) return { ok: false, message: result.error ?? "Could not pin that item." };
    refreshAfterWrite("/", "layout");
    return {
      ok: true,
      message: itemId
        ? `Pinned to item ${itemId} — its icon and tooltip appear once the item backfill has seen it.`
        : "Unpinned. The name is matched automatically again.",
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not pin that item." };
  }
}

export async function saveLootWeightsAction(
  weights: Partial<LootPriorityWeights>,
): Promise<PriorityActionResult> {
  return savePolicyAction({ weights });
}

/**
 * Save any part of the council's policy.
 *
 * Partial by design: the weights editor sends weights, the standing editor
 * sends standing, and neither can clobber the other. Everything unnamed keeps
 * whatever the record already holds.
 */
export async function savePolicyAction(
  overrides: PolicyOverrides,
): Promise<PriorityActionResult> {
  try {
    const repo = await getWriteRepo();
    const current = await repo.getGuildPolicy();
    // Merge against what's stored, one level deep — the same shape resolvePolicy
    // uses, so a partial save can never drop a sibling the officer set earlier.
    const merged: PolicyOverrides = { ...current };
    for (const [key, value] of Object.entries(overrides) as [keyof PolicyOverrides, object][]) {
      merged[key] = { ...(current[key] as object), ...value } as never;
    }
    // `roster.weights` is a record inside a record, and the loop above only
    // goes one level — a save naming one weight would drop the siblings.
    if (overrides.roster?.weights || current.roster?.weights) {
      merged.roster = {
        ...merged.roster,
        weights: { ...current.roster?.weights, ...overrides.roster?.weights },
      };
    }
    const result = await repo.setGuildPolicy(merged);
    if (!result.ok) return { ok: false, message: result.error };
    refreshAfterWrite("/", "layout");
    return { ok: true, message: "Policy saved — every contested item re-ranks." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Saving the policy failed." };
  }
}

/** Hand the whole policy back to the app's defaults. */
export async function resetPolicyAction(): Promise<PriorityActionResult> {
  try {
    const repo = await getWriteRepo();
    const result = await repo.setGuildPolicy({});
    if (!result.ok) return { ok: false, message: result.error };
    refreshAfterWrite("/", "layout");
    return { ok: true, message: "Policy reset to the app's defaults." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Resetting the policy failed." };
  }
}

/** Which tokens of a draft chain the app can actually rank on — for live feedback. */
export async function checkPriorityChainAction(
  chain: string,
): Promise<{ tiers: { label: string; manual: boolean }[]; unknown: string[] }> {
  const parsed = parsePriorityChain(chain);
  const unknown = [...new Set(parsed.tiers.flatMap((t) => t.tags).filter((t) => !isSpecTag(t)))];
  return {
    tiers: parsed.tiers.map((t) => ({ label: t.tags.join(" = "), manual: t.manual })),
    unknown,
  };
}

export interface SheetActionResult {
  ok: boolean;
  message: string;
}

/**
 * Replace a phase's priority sheet with pasted markdown.
 *
 * Overwriting is the update flow here, exactly as it is for gear sets: a sheet
 * is one document the council rewrites between phases, not a set of rows to
 * merge. Per-item officer edits survive it, because those are keyed by item
 * name and layered on top of whatever sheet is in force.
 */
export async function savePrioritySheetAction(input: {
  phase: number;
  markdown: string;
  author?: string;
  note?: string;
}): Promise<SheetActionResult> {
  try {
    const repo = await getWriteRepo();
    const result = await repo.setPrioritySheet(input);
    if (!result.ok) return { ok: false, message: result.error };
    refreshAfterWrite("/", "layout");
    return {
      ok: true,
      message: `Phase ${input.phase} sheet saved — ${result.ruleCount} items. Every contested drop re-ranks.`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Saving the sheet failed." };
  }
}

/** Drop a pasted sheet, handing the phase back to the seeded one (or to empty). */
export async function resetPrioritySheetAction(phase: number): Promise<SheetActionResult> {
  try {
    const repo = await getWriteRepo();
    const result = await repo.deletePrioritySheet(phase);
    if (!result.ok) return { ok: false, message: result.error };
    refreshAfterWrite("/", "layout");
    return { ok: true, message: `Phase ${phase} is back to the sheet it shipped with.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Resetting the sheet failed." };
  }
}

/** What a pasted sheet would parse to, without storing it — the preview. */
export async function previewPrioritySheetAction(
  markdown: string,
): Promise<{ ruleCount: number; sections: string[] }> {
  const rules = parsePrioritySheet(markdown);
  return {
    ruleCount: rules.length,
    sections: [...new Set(rules.map((r) => r.source))],
  };
}

/**
 * What a proposed policy would move, without saving it.
 *
 * Exists because a policy field is a number with no visible blast radius:
 * turning off "a single elixir counts" reads like a small tightening and, on
 * real data, can take most of a roster from fully prepared to nothing. The
 * officer should meet that before pressing save.
 */
export async function previewPolicyAction(overrides: PolicyOverrides) {
  const repo = await getWriteRepo();
  return repo.previewGuildPolicy(overrides);
}
