"use server";

import { z } from "zod";
import { refreshAfterWrite } from "@/lib/refresh";
import { requireCapability } from "@/lib/auth/can";
import { resolveViewer } from "@/lib/auth/viewer";
import { getRepo, getWriteRepo, type AwardEditInput, type WriteRepo } from "@/lib/data/repo";
import { actingOfficer } from "@/app/acting-officer";
import type { Quality } from "@/lib/types";

/**
 * Manual winner resolution for awards whose winner didn't auto-match the
 * roster (typos, renames, cross-realm pugs, disenchants). Resolution only
 * touches the award's character link — item, timestamp and rawWinnerName are
 * immutable history.
 */

const resolveInputSchema = z.discriminatedUnion("resolution", [
  z.object({ awardId: z.string().min(1), resolution: z.literal("character"), characterId: z.string().min(1) }),
  z.object({ awardId: z.string().min(1), resolution: z.literal("external") }),
  z.object({ awardId: z.string().min(1), resolution: z.literal("unresolved") }),
]);

export type ResolveAwardInput = z.infer<typeof resolveInputSchema>;

export interface ResolveAwardActionResult {
  ok: boolean;
  message: string;
}

export async function resolveAwardAction(input: ResolveAwardInput): Promise<ResolveAwardActionResult> {
  const parsed = resolveInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid resolution request." };

  try {
    requireCapability(await resolveViewer(), "loot.award");
    const repo = await getWriteRepo();
    const data = parsed.data;
    const result = await repo.resolveAward(
      data.awardId,
      data.resolution === "character"
        ? { kind: "character", characterId: data.characterId }
        : { kind: data.resolution },
    );
    if (!result.ok) return { ok: false, message: result.error };

    refreshAfterWrite("/", "layout");
    const message =
      data.resolution === "character"
        ? "Award assigned — wishlist matching has been re-derived."
        : data.resolution === "external"
          ? "Marked off-roster."
          : "Moved back to unresolved.";
    return { ok: true, message };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Resolving failed." };
  }
}

/**
 * Full award editing from the ledger: add a new award to a session, edit an
 * existing one (item / winner / off-spec / note), delete awards, or delete a
 * whole Gargul import. The winner picker resolves to one of three shapes; the
 * action turns it into a concrete character link, auto-matching a typed name
 * against the roster exactly like an import does.
 */

const winnerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("character"), characterId: z.string().min(1) }),
  z.object({ kind: z.literal("name"), rawWinnerName: z.string().trim().min(1, "Enter the winner's name.") }),
  z.object({ kind: z.literal("external"), rawWinnerName: z.string().trim().min(1, "Name the off-roster destination.") }),
]);

const awardFieldsSchema = z.object({
  itemId: z.number().int().positive("Enter a valid item id."),
  /** Fallback name for items not in the cache; the cache name wins when known. */
  itemName: z.string().optional(),
  offspec: z.boolean(),
  note: z.string().optional(),
  winner: winnerSchema,
});

const addAwardSchema = awardFieldsSchema.extend({ raidSessionId: z.string().min(1) });
const updateAwardSchema = awardFieldsSchema.extend({
  awardId: z.string().min(1),
  /**
   * The day it was won, as the editor offers it. Absent means "leave it" —
   * which is what every caller that isn't re-dating an award sends, so an
   * ordinary edit can never re-stamp a Gargul timestamp by accident.
   */
  awardedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.").optional(),
});

export type AddAwardInput = z.infer<typeof addAwardSchema>;
export type UpdateAwardInput = z.infer<typeof updateAwardSchema>;
type AwardFields = z.infer<typeof awardFieldsSchema>;

export interface LootActionResult {
  ok: boolean;
  message: string;
}

/** Turn the validated form fields into the concrete award the repo wants. */
async function buildAwardInput(repo: WriteRepo, fields: AwardFields): Promise<AwardEditInput | { error: string }> {
  const winner = fields.winner; // a const keeps the discriminated-union narrowing inside closures
  let rawWinnerName: string;
  let characterId: string | null = null;
  let external = false;
  if (winner.kind === "character") {
    const character = (await repo.listCharacters()).find((c) => c.character.id === winner.characterId);
    if (!character) return { error: "That character no longer exists." };
    rawWinnerName = character.character.name;
    characterId = character.character.id;
  } else if (winner.kind === "external") {
    rawWinnerName = winner.rawWinnerName;
    external = true;
  } else {
    // A free-typed name links automatically when it matches the roster (typo-free renames).
    rawWinnerName = winner.rawWinnerName;
    characterId = (await repo.findCharacterByName(rawWinnerName))?.id ?? null;
  }

  // The item-cache name is authoritative; fall back to a typed name, then a plain id label.
  const cached = await repo.getItem(fields.itemId);
  const itemName = cached?.name ?? (fields.itemName?.trim() || `Item #${fields.itemId}`);

  return { itemId: fields.itemId, itemName, rawWinnerName, characterId, external, offspec: fields.offspec, note: fields.note };
}

export async function addAwardAction(input: AddAwardInput): Promise<LootActionResult> {
  const parsed = addAwardSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid award." };
  try {
    requireCapability(await resolveViewer(), "loot.award");
    const repo = await getWriteRepo();
    const built = await buildAwardInput(repo, parsed.data);
    if ("error" in built) return { ok: false, message: built.error };
    const result = await repo.addLootAward(parsed.data.raidSessionId, built);
    if (!result.ok) return { ok: false, message: result.error };
    refreshAfterWrite("/", "layout");
    return { ok: true, message: `Added “${result.award.itemName}” for ${result.award.rawWinnerName}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Adding the award failed." };
  }
}

/**
 * Edit one recorded award.
 *
 * Two capabilities, because two different things can happen here. Correcting
 * the item, the winner, the off-spec flag or the note is ordinary council work
 * (`loot.award`). Moving the award to another **date** rewrites when the guild
 * was told loot was won — recency, fairness windows and the ledger's own order
 * all read that field — so it needs `loot.amend` on top, and the guild decides
 * who holds it. The check is per-field rather than on the whole action: an
 * officer without `loot.amend` can still fix a typo in a winner's name.
 *
 * Every change that lands is written to the guild audit log with the officer's
 * name, in the same transaction as the edit.
 */
export async function updateAwardAction(input: UpdateAwardInput): Promise<LootActionResult> {
  const parsed = updateAwardSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid award." };
  try {
    requireCapability(await resolveViewer(), "loot.award");
    const repo = await getWriteRepo();
    const existing = (await repo.listLootAwards()).find((a) => a.award.id === parsed.data.awardId);
    if (!existing) return { ok: false, message: "That award no longer exists." };

    // Keep the time of day: a Gargul import knows when the item dropped, and
    // re-dating the night is no reason to throw that away.
    const awardedAt = parsed.data.awardedAt
      ? `${parsed.data.awardedAt}${existing.award.awardedAt.slice(10) || "T12:00:00"}`
      : undefined;
    if (awardedAt && awardedAt.slice(0, 10) !== existing.award.awardedAt.slice(0, 10)) {
      // Resolved again rather than reused: `enforcement.test.ts` reads the
      // call shape to prove a capability is enforced somewhere, and a check
      // it cannot see is a checkbox in the grant editor that protects nothing.
      requireCapability(await resolveViewer(), "loot.amend");
    }

    const built = await buildAwardInput(repo, parsed.data);
    if ("error" in built) return { ok: false, message: built.error };
    const result = await repo.updateLootAward(
      parsed.data.awardId,
      { ...built, awardedAt },
      await actingOfficer(),
    );
    if (!result.ok) return { ok: false, message: result.error };
    refreshAfterWrite("/", "layout");
    return { ok: true, message: "Award updated — wishlist matching re-derived." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Updating the award failed." };
  }
}

const deleteAwardsSchema = z.object({ awardIds: z.array(z.string().min(1)).min(1) });
export type DeleteAwardsInput = z.infer<typeof deleteAwardsSchema>;

export async function deleteAwardsAction(input: DeleteAwardsInput): Promise<LootActionResult> {
  const parsed = deleteAwardsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Nothing selected to delete." };
  try {
    requireCapability(await resolveViewer(), "loot.award");
    const repo = await getWriteRepo();
    const officer = await actingOfficer();
    let deleted = 0;
    for (const id of parsed.data.awardIds) {
      if (await repo.deleteLootAward(id, officer)) deleted++;
    }
    if (deleted > 0) refreshAfterWrite("/", "layout");
    return { ok: true, message: `Deleted ${deleted} award${deleted === 1 ? "" : "s"}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Deleting failed." };
  }
}

const deleteSessionSchema = z.object({ sessionId: z.string().min(1) });
export type DeleteSessionInput = z.infer<typeof deleteSessionSchema>;

export async function deleteSessionAction(input: DeleteSessionInput): Promise<LootActionResult> {
  const parsed = deleteSessionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid request." };
  try {
    requireCapability(await resolveViewer(), "loot.award");
    const repo = await getWriteRepo();
    const result = await repo.deleteRaidSession(parsed.data.sessionId, await actingOfficer());
    if (!result.ok) return { ok: false, message: result.error };
    refreshAfterWrite("/", "layout");
    const reportNote =
      result.unlinkedReports > 0
        ? ` ${result.unlinkedReports} linked log${result.unlinkedReports === 1 ? "" : "s"} unlinked (kept).`
        : "";
    return {
      ok: true,
      message: `Import deleted — ${result.deletedAwards} award${result.deletedAwards === 1 ? "" : "s"} removed.${reportNote}`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Deleting the import failed." };
  }
}

/**
 * One item from the cache, for the award dialog's preview.
 *
 * The dialog used to receive the whole item cache as a prop so it could do this
 * lookup locally — over a hundred kilobytes serialized into every visit to the
 * loot ledger, for a dialog most visits never open. It only ever needed the one
 * item whose id was typed, so it asks for that instead.
 */
export async function lookupItemAction(
  itemId: number,
): Promise<{ id: number; name?: string; quality?: Quality; icon?: string } | null> {
  if (!Number.isInteger(itemId) || itemId <= 0) return null;
  try {
    const repo = await getRepo();
    const item = await repo.getItem(itemId);
    return item ? { id: item.id, name: item.name, quality: item.quality, icon: item.icon } : null;
  } catch {
    // A failed lookup only costs the preview; the award itself still saves.
    return null;
  }
}
