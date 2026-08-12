"use server";

import { z } from "zod";
import { getWriteRepo } from "@/lib/data/repo";
import { refreshAfterWrite } from "@/lib/refresh";
import { requireCapability } from "@/lib/auth/can";
import { resolveViewer } from "@/lib/auth/viewer";
import { ITEM_COMMENT_VOICES } from "@/lib/comments";

/**
 * Notes on an item — a raider's about their own claim, an officer's about the
 * council's.
 *
 * This exists because of a decision, not a gap: the council was asked whether a
 * second-choice wisher should contend against a BiS wisher and how far behind,
 * and answered that it depends on how many options the raider has and what else
 * those options block. That is judgement, and forcing it into a multiplier
 * would make the board confidently wrong. So the app records the argument and
 * leaves the call to the people making it.
 */

const addSchema = z.object({
  itemId: z.number().int().positive(),
  characterId: z.string().min(1).optional(),
  voice: z.enum(ITEM_COMMENT_VOICES).default("officer"),
  body: z.string().trim().min(1, "Write something first.").max(2000, "Keep notes under 2000 characters."),
  author: z.string().trim().max(60).optional(),
});

export async function addItemComment(input: {
  itemId: number;
  characterId?: string;
  voice?: string;
  body: string;
  author?: string;
}): Promise<{ ok: boolean; message?: string }> {
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid note." };
  try {
    requireCapability(await resolveViewer(), "comments.write");
    const repo = await getWriteRepo();
    const result = await repo.addItemComment({
      itemId: parsed.data.itemId,
      characterId: parsed.data.characterId || undefined,
      voice: parsed.data.voice,
      body: parsed.data.body,
      author: parsed.data.author || undefined,
    });
    if (!result.ok) return { ok: false, message: result.error };
    refreshAfterWrite("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not add the note." };
  }
}

export async function deleteItemComment(input: {
  commentId: string;
}): Promise<{ ok: boolean; message?: string }> {
  if (!input.commentId) return { ok: false, message: "Missing note id." };
  try {
    requireCapability(await resolveViewer(), "comments.write");
    const repo = await getWriteRepo();
    const removed = await repo.deleteItemComment(input.commentId);
    if (!removed) return { ok: false, message: "Note not found — it may already be gone." };
    refreshAfterWrite("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not remove the note." };
  }
}
