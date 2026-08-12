"use server";

import { z } from "zod";
import { getWriteRepo } from "@/lib/data/repo";
import { refreshAfterWrite } from "@/lib/refresh";
import { requireCapability } from "@/lib/auth/can";
import { resolveViewer } from "@/lib/auth/viewer";
import { COMMENT_CATEGORIES } from "@/lib/comments";

/**
 * Officer comment log on a character profile — add and remove timestamped
 * notes (richer than the single inline `note`). Used by the comments card on
 * the profile and surfaced in the character-comparison view.
 */

const addSchema = z.object({
  characterId: z.string().min(1),
  category: z.enum(COMMENT_CATEGORIES).default("note"),
  body: z.string().trim().min(1, "Write something first.").max(2000, "Keep comments under 2000 characters."),
  author: z.string().trim().max(60).optional(),
});

export async function addComment(input: {
  characterId: string;
  category?: string;
  body: string;
  author?: string;
}): Promise<{ ok: boolean; message?: string }> {
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid comment." };
  try {
    requireCapability(await resolveViewer(), "comments.write");
    const repo = await getWriteRepo();
    const result = await repo.addCharacterComment({
      characterId: parsed.data.characterId,
      category: parsed.data.category,
      body: parsed.data.body,
      author: parsed.data.author || undefined,
    });
    if (!result.ok) return { ok: false, message: result.error };
    refreshAfterWrite("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not add the comment." };
  }
}

export async function deleteComment(input: {
  commentId: string;
}): Promise<{ ok: boolean; message?: string }> {
  if (!input.commentId) return { ok: false, message: "Missing comment id." };
  try {
    requireCapability(await resolveViewer(), "comments.write");
    const repo = await getWriteRepo();
    const removed = await repo.deleteCharacterComment(input.commentId);
    if (!removed) return { ok: false, message: "Comment not found — it may already be gone." };
    refreshAfterWrite("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not remove the comment." };
  }
}
