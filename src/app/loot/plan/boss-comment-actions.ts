"use server";

import { getWriteRepo } from "@/lib/data/repo";
import { refreshAfterWrite } from "@/lib/refresh";
import { requireCapability } from "@/lib/auth/can";
import { resolveViewer } from "@/lib/auth/viewer";

/**
 * The council's notes under a boss on the loot plan.
 *
 * Gated on `comments.write`, the same capability as a note on a character or an
 * item — all three are "an officer writing down the part that isn't scored", and
 * splitting them would mean a role that can explain a loot call on the item page
 * but not on the page the call is actually made from.
 *
 * Appended, never edited. A decision that changed is a second note, and the
 * first one is the reason it changed — which is the whole point of writing it
 * down somewhere a council can find it three weeks later.
 */
export interface BossCommentActionResult {
  ok: boolean;
  message: string;
}

export async function addBossCommentAction(input: {
  zone: string;
  boss: string;
  body: string;
  author?: string;
}): Promise<BossCommentActionResult> {
  try {
    requireCapability(await resolveViewer(), "comments.write");
    const repo = await getWriteRepo();
    const result = await repo.addBossComment(input);
    if (!result.ok) return { ok: false, message: result.error };
    // The plan is the only page that reads these today, but it is reached by
    // zone from the nav and from pasted links — "layout" so every variant of it
    // re-renders rather than only the one the officer happened to be on.
    refreshAfterWrite("/loot/plan", "layout");
    return { ok: true, message: `Noted under ${input.boss}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not save the note." };
  }
}

export async function deleteBossCommentAction(id: string): Promise<BossCommentActionResult> {
  try {
    requireCapability(await resolveViewer(), "comments.write");
    const repo = await getWriteRepo();
    const deleted = await repo.deleteBossComment(id);
    if (!deleted) return { ok: false, message: "That note is already gone." };
    refreshAfterWrite("/loot/plan", "layout");
    return { ok: true, message: "Note removed." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not remove the note." };
  }
}
